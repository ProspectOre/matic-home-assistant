# Unreleased scene-pipeline qualification

This work restores the worker-decompression and incremental-upload requirements
in [the authority contract](architecture-0.5.md). It follows `aa3b2b9`; this is not installed RC9 evidence.
The current production bundle fingerprint is
`c3a72dc4cdf7d8b07eed22713cd4d269eac4fd1eeb0b862b2dda0fbc30722b86`.

## Ownership and invariants

- One codec validates the delta envelope, bounds deflate output, applies XOR,
  records dirty point blocks, and parses the resulting scene. The same codec
  runs in the worker and the bounded fallback; HTTP retains transport checks.
  Input/output are capped at 16 MiB and scenes at 1.5 million points.
- A worker receives transferred payloads and a clone of the accepted base;
  rendering never loses its base buffer. One active codec job and one FIFO waiter
  cover concurrent live/history reads. Cloning and transfer happen at dispatch;
  overflow rejects before either. Queued abort removes its job, worker failure
  drains into the established fallback, and disposal settles both jobs once,
  terminates even an idle worker and cancels an active inflate without a caller signal.
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
- Context loss and upload failure share one fallback transition, which installs
  the latest admitted scene before sampling it. Releasing WebGL clears resident
  point evidence; restoring while hidden stays idle, and resuming uploads the
  admitted scene even when its identity is unchanged.
- Delta recovery owns its replacement scene and long poll until their outcome;
  the retry cooldown cannot cancel a still-pending successful replacement.

## Source and packaged checks

Before the scheduler repair, the combined source run passed 62 cases:
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

Head `c6871f9` passes Python CI: 3,691 tests/100%, quality, privacy, clean
archives and fresh imports; HACS/Hassfest pass. Browser CI passes 1,008 cases,
with one named Firefox WebGL-loss capability skip. Its test-only camera repair
waits for actual revision/full-point publication, proves no early notification
or camera change, and preserves exact callback/fit assertions. The preceding
`80e34b5` run's 16 premature-disposal failures remain retained.

Head `dde52a9` then passes Python CI with the same 3,691 tests/100%, quality,
privacy, archive and fresh-import gates, plus HACS/Hassfest. Its browser CI passes
1,023 cases with the same named Firefox capability skip. These results qualify
the decoder scheduler; they do not qualify the subsequent renderer repair.

Regular review then found a healthy live/history overlap rejected by the shared
parser. The bounded scheduler replaces that single-request admission rule; it
does not add another parser or effects policy. Qualification of this repair and
its generated bytes is separate from the preceding green CI. Independent Luna
source review found no remaining defect after correcting idle-worker cleanup;
exact-head regular review, full CI and installed acceptance remain required.

Current local qualification covers 77 cases: 74 decoder/uploader/recovery/parser
cases passed together, then all three repaired startup cases passed in Chromium,
WebKit and Firefox safety. Source bytes remained frozen between these runs.
Controlled workers perform native transferable cloning; tests inspect exact job
kind, payload, base identity and serial admission, queued abort, overflow,
failure draining, retired callbacks and disposal. The real backend/effects
startup fixture proves both old workers retire, stale callbacks cannot alter
resources/notices/command state, and the new live scene reaches revision 8.
Earlier failures exposed idle-worker leakage and fixture assumptions about
independent history readiness and cancellation order; those receipts remain
retained. The typed build, 55 release/privacy contracts, clean archive file
parity and fresh imports pass. Desktop budgets use the current generated bytes.

Regular review found that context loss during compatible staging sampled the
old published scene. A neighboring independent review found hidden restoration
could retain scene identity with an empty new GPU buffer. The shared fallback
transition and resident-point reset fix those ownership gaps. Independent GPT-6
Luna source review found no remaining concrete defect in the repaired slice.

The frozen repair passes all 89 focused decoder, uploader, recovery, parser and
renderer-fault checks in the configured Chromium/WebKit/Firefox-safety projects.
The two new regressions fail against `dde52a9` in all three engines: fallback
paints the old red point instead of the admitted green point, and hidden restore
reports completion with zero uploads and mismatched buffer bytes. The repair
checks the fallback canvas pixels directly and every restored GPU point byte,
without changing configured limits. Both counterfactual receipts remain retained.
Current typed build, desktop budgets, release/privacy contracts, clean archive
parity and fresh imports pass. The repaired head still needs full CI, clean
regular review and installed readback; historical review/provenance holds remain.

Current Hassfest rejects the inherited exact NumPy pin. Both manifest and package
metadata now use `numpy>=2.3.2`, letting HA select its runtime above the tested minimum.
The existing 110 map/delta and release contracts pass with HA 2026.9.3 and
NumPy 2.3.2. Refreshed wheel/sdist parity, fresh import and privacy pass; exact-head
CI/Hassfest and regular review remain required. The original validator failure
is retained, following [HA dependency ownership](https://github.com/home-assistant/core/blob/dev/script/hassfest/requirements.py).

Head `f16b47d` passes 3,691 Python tests/100%, quality, privacy, archive/import,
HACS and Hassfest. Full browser CI passes 1,028 cases, skips the named Firefox
WebGL capability case, and fails the WebKit hidden-canvas keyboard draft check.
Both attempts show only zoom 100→643: renderer camera publication can occur
after the test's fixed 50 ms wait; the zero-size canvas guard cannot draw. The
test now waits for initial scene/camera publication and admitted hidden resize,
keeps whole-draft equality and focus checks, and includes all six blocked-target
cases in Firefox safety. Twenty focused cases and 15 hidden-case repetitions pass.
New-head full CI/regular review remain required. Failed readiness receipts retain
the rejected assumption that hidden resize always emits a camera intent.

The benchmark warm-up finding is rejected: recording requires a nonzero start,
so warm-up adds zero actions. The unchanged collector on clean `f16b47d` exits 0
with six 100-action samples; independent source review confirms the boundary.
No redundant reset or production change is added. Native review-history holds
remain separate from public dispositions and resolved conversations.
