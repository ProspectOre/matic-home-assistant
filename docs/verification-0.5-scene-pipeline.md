# Unreleased scene-pipeline qualification

This work restores the worker-decompression and incremental-upload requirements
in [the authority contract](architecture-0.5.md). It follows head `aa3b2b9` and is
not installed RC9 evidence. The frozen production bundle fingerprint is
`1b4078ae1db5f1c2c3f702100dec5a7056ba9b55827a16bc3251037d6bd297a9`.

## Ownership and invariants

- One codec validates the delta envelope, bounds deflate output, applies XOR,
  records dirty point blocks, and parses the resulting scene. The same codec
  runs in the worker and the bounded fallback; HTTP retains transport checks.
  Input/output are capped at 16 MiB and scenes at 1.5 million points.
- A worker receives transferred payloads and a clone of the accepted base;
  rendering never loses its base buffer. One decode may be pending. Abort,
  worker replacement and disposal cannot admit a retired result. Fallback
  disposal cancels an active inflate read, including without a caller signal.
- The renderer separates the latest admitted scene from the published frame.
  Compatible revisions keep the complete front buffer visible while one back
  buffer advances. Contiguous dirty-block hints coalesce into the latest target
  without rewinding its copied frontier. Missing lineage requires a full upload.
- GPU transfer work shares a 512 KiB animation-frame budget between initialized
  frontier copying and dirty patches. There are at most two point buffers and
  one pending scene; no revision queue is retained. Initial or incompatible
  frames display only initialized point prefixes. Compatible publication is atomic.
- Generation, entry/floor identity, suspension, context loss and disposal cancel
  obsolete uploads. GL failures fall back to the latest admitted scene; command
  guards remain independent. Publication uses the active view's camera. Frame
  timing includes upload work and completion does not schedule a redundant paint.
- Delta recovery owns its replacement scene and long poll until their outcome;
  the retry cooldown cannot cancel a still-pending successful replacement.

## Source and packaged checks

The typed production build passes. The combined source run passed 62 cases:
21 decoder, 18 uploader, 18 recovery, and five existing parser-resilience cases.
The new contracts run in Chromium, WebKit and Firefox safety; the five inherited
parser cases run in Chromium. Uploader contracts instrument a synthetic GL API,
so they establish byte/ownership behavior rather than real GPU pixels or memory.

After the final redundant-paint/frame-timing correction, the uploader and
packaged neighboring run passed 152 cases and failed one WebKit navigation.
The supported 100-room selection bound, real context loss/restoration, malformed
delta recovery, content revisions, quality and repeated lifecycle checks passed.
The failed plan-picker case timed out at initial `page.goto`, before app import;
the retained trace is blank with no network events. It establishes no app cause
and is not counted as a pass. One isolated rerun passed in 5.6 seconds with
unchanged source and limits, recording successful document/script responses and
the complete picker workflow. The original navigation cause remains unproven.

Earlier fixture failures remain retained: zero-vertex draws were incorrectly
counted as buffer reads; a fixed delay assumed upload completion; and fallback
disposal occurred before an inflate read started. Corrected tests assert actual
read/upload transitions at the original configured limits. A neighboring test
then detected a real redundant paint, which was removed from production.

The recovery counterfactual reproduces repeated scene reload/long-poll aborts
with the preceding source; the replacement accepts a delayed 204 while preserving
scene, pose, revision and command admission. It is separate from packaged CI.

## Remaining qualification

Independent source reviews found no unresolved P0/P1 in their bounded codec,
renderer and recovery slices. [Current measurements](performance-0.5-scene-pipeline.md)
pass the packaged desktop shell/input budgets and bounded real-GPU transfer contract.
Both clean release archives pass file parity and fresh-environment import; all
55 release/privacy contracts, Ruff/format and strict Python types pass. Exact-head
regular review, full CI and installed readback remain required. Real-device,
sustained CPU/heap/GPU, transport
and owner acceptance remain separate in [the evidence matrix](acceptance-0.5.md).
