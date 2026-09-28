# Matic 0.5 performance evidence

This is paired source and compiled-asset evidence for the current Matic 0.5
candidate, not RC runtime, field, mobile, transport, or physical acceptance.
The release ledger is
[acceptance-0.5.md](acceptance-0.5.md).

The authority baseline is stable v0.4.6; the paired control remains v0.4.5.
Current product source is `a48541c5a49ec45c9c83a580678d55d4610ac960`.
The audit corrected startup accounting: the earlier 80,712-byte estimate
counted only v4 and omitted 61,269 bytes of globally registered editor,
classic-panel, and icon modules. That 141,981-byte total exceeded 90 KiB.
The selector adapter and explicit classic preference now defer those optional
implementations; Clear selection also commits once instead of once per room.
Earlier input results for RC3 do not qualify this changed candidate.

## Method

Build with `npm run build:map-studio-v4`, then run
`node scripts/measure_map_studio_performance.mjs v0.4.5 > result.json`.
Add `--headed` to measure a visible Chromium window. Launch and reported mode
share the same option; never relabel a headless measurement as headed.
`--trace-dir <private-directory>` records diagnostic traces with extra overhead;
trace-enabled timings do not qualify the untraced performance gate. The script
also records per-sample host load averages and logical CPU count.
The script serves the tag and current compiled assets on loopback, blocks
external requests, and requires identical synthetic scene SHA-256 hashes.
It opens fresh contexts in AB, BA, AB order. Each journey warms the plan
workflow, then performs 100 inputs: 60 2D/3D toggles, five plan preview/edit/back
loops (20 inputs), and ten room-list/back loops (20 inputs).

The untraced comparison ran at `2026-09-28T05:00:26.438Z`
(10:00 p.m. PDT on September 27) on headless Chromium 151.0.7922.34, macOS arm64, Apple M4,
1280×900, DPR 1, no throttling, and no-store assets. Other task-owned checks
were paused. Three fresh contexts per build ran in AB/BA/AB order; scene and
bundle fingerprints matched across all six samples. The script records
conditions and fingerprints.
The candidate uses one multi-entry compilation and the actual HA registration:
review-only assets are excluded from shipped bytes, while the harness imports
the exact production chunks and globally registered extra modules. Historical
baseline host-wide bytes are unmeasured, not zero.

Event Timing uses a 16 ms reporting threshold. Missing interactions are
imputed at 16 ms; recorded durations retain browser quantization. These p95
estimates are a lab proxy, not field INP. See the official
[Web Vitals definitions](https://web.dev/articles/vitals) and
[DevTools performance guidance](https://developer.chrome.com/docs/devtools/performance).
Gzip sizes use level 9 offline estimates; the local server sends uncompressed
JavaScript. Heap is one post-journey observation, not a retention bound.

## Latest paired result

Measured against the compiled assets for source commit
`a48541c5a49ec45c9c83a580678d55d4610ac960`.

| Measure | Stable v0.4.5 | 0.5 candidate |
|---|---:|---:|
| Initial v4 JS, estimated gzip bytes | 79,821 | 81,364 |
| Initial distinct v4 JS resources | 1 | 4 |
| Registered global modules, estimated gzip bytes | Unmeasured | 1,965 |
| Complete initial integration JS, estimated gzip bytes | Unmeasured | 83,329 |
| Added workflow JS, estimated gzip bytes | 0 (eager) | 11,704 |
| Review-only initial JS, estimated gzip bytes | Included above | 4,567 (not shipped) |
| Input p95 estimates, three runs, ms | 120 / 80 / 192 | 168 / 72 / 176 |
| Median / range of p95 estimates, ms | 120 / 80–192 | 168 / 72–176 |
| Maximum observed input estimates, ms | 160 / 240 / 232 | 288 / 152 / 280 |
| Tasks at the 50 ms Long Tasks API threshold, three runs | 46 / 7 / 32 | 21 / 7 / 34 |
| Longest task per run, ms | 147 / 203 / 201 | 278 / 136 / 260 |
| Post-journey JS heap range, three observations, bytes | 5,338,964–6,332,232 | 6,275,164–7,127,884 |

Complete startup fell 58,652 bytes (41.3%) and now passes 90 KiB. The v4 lazy
workflow remains below 30 KiB. Optional classic compatibility is 42,251 gzip
bytes and is reported separately; it is not a v4 workflow or a claimed size pass.
The 100-room Clear regression records 100 → 1 commits and 99 → 0 intermediate
nonempty preview keys; these are store/key counts, not network-request counts.
Both builds missed input and task-duration targets. System process observations
after this run showed substantial unrelated load, but do not establish its
cause. No timing improvement or current timing pass is claimed. Heap samples
do not establish retention bounds. Field, mobile, sustained runtime, and
release acceptance remain open.

Fingerprints (path-sorted compiled JS names and bytes, SHA-256):

| Input | Fingerprint |
|---|---|
| Baseline commit | `f15dfa25d373fe2b4a448595ad0fc40c1d5ed191` |
| Baseline bundle | `55fdd0680408a32fcf72a1478bb88445505185a6047317312ebf0e67d7c52752` |
| Candidate source commit | `a48541c5a49ec45c9c83a580678d55d4610ac960` |
| Candidate production bundle | `79767d67fa1d6a40cf7cc8a308cd3da26e877e0ba66ec5a0183ece636548c21c` |
| Candidate review-only bundle | `99c21ec8b78342ecfa3293aa65a36513d683fe1c82434be685d3c4c56bc652d9` |
| Registered frontend assets | `63bf09882b50b7c6823d9c4aeb51ad66302a3dd4aca91ff59144aec11725d28c` |
| Common synthetic scene | `a0349b25e755d0cc8fc55dba8f35982535b91c708654e7cbf87799850ca922a4` |

## Current diagnostic follow-up

A trace-enabled AB/BA/AB run ended at 10:08 p.m. PDT on September 27 using
the same assets and scene. One-minute host load ranged from 17.5 to 75.2 on
10 logical CPUs. Each sample's longest renderer task was a compositor commit
waiting on GPU readback. Candidate peaks were 134/515/636 ms wall time with
1.29/2.19/1.58 ms renderer CPU; the 636 ms task contained 634.95 ms
`GLES2::ReadPixels` with 0.62 ms CPU. Baseline showed the same wait path.
This localizes the stalls, but does not identify their cause or clear the
task/input budgets. Diagnostic timings include tracing overhead; private raw
traces and the failed untraced result are retained without selecting a best run.

## Earlier drawing and compositor follow-up

This is historical evidence for the prior candidate bundle
`7186581d0ed2bc31247a038a8def77d35380389880b7fcf288d57c40fb623e00`, before
the latest contrast-token rebuild. At 10:23–10:25 p.m. Pacific on September 25,
a trace-enabled probe repeated
AB/BA/AB in both headless and headed Chromium, using the same synthetic scene
hash as the paired result above.
Before the common 100-input journey, each sample performed three browser-input
Paint drags and three Erase drags interrupted with an injected pointer-cancel.
Each Paint changed the draft. All nine candidate cancellations per mode preserved
the committed draft; all nine baseline cancellations changed it. This verifies
the ownership repair under pointer input, beyond the synthetic event regressions.

No drawing interval produced a task over 50 ms. Observed drawing interaction
maxima were 32 ms for the headless candidate and 56 ms for the headed candidate;
these are observed Event Timing samples, without imputing missing pointer events.
Navigation p95 remained 32 ms headless and 56 ms headed for both builds.
The candidate had one 147 ms headless navigation task; the headed samples had
none. Markers place that task inside the measured navigation interval:
147.262 ms wall / 4.347 ms renderer CPU, including a 146.359 ms compositor
Commit / 3.467 ms CPU and overlapping 145.500 ms GPU task / 0.394 ms CPU.
Nested JavaScript, paint, and layout events were each below 0.3 ms.
This identifies another compositor wait, not a sustained JavaScript workload;
it does not establish why the wait occurred or waive the task-duration gate.

Drawing rAF interval p95 ranged from 16.8–17.7 ms for the candidate. Callback
cadence is not presented-frame throughput. Earlier exploratory probes with
synthetic gestures, incomplete trace persistence, or incorrect input counts
are excluded from these measurements. Raw traces and timings remain local.

## Remaining measurements

Reference desktop ≥55 fps and supported mobile ≥30 fps, real tablet/touch
input, slow-device stalls, sustained heap/GPU bounds, and live HA update
traffic remain open. The 20-cycle browser lifecycle regression proves counted
listener/worker/URL disposal and stale-result rejection; it does not measure
heap or GPU retention. Transport baseline, numerical latency/resync/request
gates, and exact-candidate parity must precede default switchover. The proposed
one-second status p95, three-second resync p95, and 70% request reduction remain
hypotheses. Evidence must stay local and omit private maps and identifiers.
