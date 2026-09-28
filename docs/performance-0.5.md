# Matic 0.5 performance evidence

This is paired source and compiled-asset evidence for the current Matic 0.5
candidate, not RC runtime, field, mobile, transport, or physical acceptance.
The release ledger is
[acceptance-0.5.md](acceptance-0.5.md).

The authority baseline is stable v0.4.6; the paired control remains v0.4.5.
Current product source is `0c1923dca8502dea9a74d3397442161588d60562`.
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

The untraced comparison ran at `2026-09-28T06:04:27.965Z`
(11:04 p.m. PDT on September 27) on headless Chromium 151.0.7922.34, macOS arm64, Apple M4,
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
`0c1923dca8502dea9a74d3397442161588d60562`.

| Measure | Stable v0.4.5 | 0.5 candidate |
|---|---:|---:|
| Initial v4 JS, estimated gzip bytes | 79,821 | 81,405 |
| Initial distinct v4 JS resources | 1 | 4 |
| Registered global modules, estimated gzip bytes | Unmeasured | 1,954 |
| Complete initial integration JS, estimated gzip bytes | Unmeasured | 83,359 |
| Added workflow JS, estimated gzip bytes | 0 (eager) | 11,704 |
| Review-only initial JS, estimated gzip bytes | Included above | 4,567 (not shipped) |
| Input p95 estimates, three runs, ms | 104 / 96 / 104 | 72 / 80 / 64 |
| Median / range of p95 estimates, ms | 104 / 96–104 | 72 / 64–80 |
| Maximum observed input estimates, ms | 312 / 200 / 192 | 104 / 96 / 72 |
| Tasks at the 50 ms Long Tasks API threshold, three runs | 36 / 14 / 17 | 10 / 12 / 3 |
| Longest reported Long Task per run, ms | 294 / 190 / 178 | 89 / 80 / 54 |
| Post-journey JS heap range, three observations, bytes | 4,275,308–6,386,532 | 4,888,200–6,160,368 |

Complete startup fell 58,622 bytes (41.3%) and now passes 90 KiB. The v4 lazy
workflow remains below 30 KiB. Optional classic compatibility is 42,251 gzip
bytes and is reported separately; it is not a v4 workflow or a claimed size pass.
The 100-room Clear regression records 100 → 1 commits and 99 → 0 intermediate
nonempty preview keys; these are store/key counts, not network-request counts.
The candidate met the input p95 target in this lab run; both builds had tasks
over 50 ms. Candidate task peaks were 89/80/54 ms. One-minute host load ranged
from 27.2 to 32.7 on 10 logical CPUs. Timing variation across runs prevents a causal
improvement claim. Heap observations are not retention bounds; field, mobile,
sustained runtime, and release acceptance remain open.

Fingerprints (path-sorted compiled JS names and bytes, SHA-256):

| Input | Fingerprint |
|---|---|
| Baseline commit | `f15dfa25d373fe2b4a448595ad0fc40c1d5ed191` |
| Baseline bundle | `55fdd0680408a32fcf72a1478bb88445505185a6047317312ebf0e67d7c52752` |
| Candidate source commit | `0c1923dca8502dea9a74d3397442161588d60562` |
| Candidate production bundle | `ce1e3c854b9075b43d950306141843c01c5fc89ecb62225e9c064d4e4493d749` |
| Candidate review-only bundle | `6a62550e1806c22934599956995451078ef482c7ea630bb87a9757a95a23589d` |
| Registered frontend assets | `ebcf69582d7b781e4d76cc6fb733cca1e4f932baf7f937521debaf6987eeca98` |
| Common synthetic scene | `a0349b25e755d0cc8fc55dba8f35982535b91c708654e7cbf87799850ca922a4` |

## Prior failed run and diagnostic follow-up

The intervening 10:49 p.m. run on `444c373` reported candidate p95 48/48/56 ms and one 58 ms Long Task; it is retained alongside the failed run.
At 10:00 p.m. PDT on September 27, source `a48541c` failed the untraced targets:
candidate p95 was 168/72/176 ms, with 21/7/34 Long Tasks (peaks 278/136/260 ms);
control p95 was 120/80/192 ms with 46/7/32 Long Tasks (peaks 147/203/201 ms).
A trace-enabled run of those prior assets and the same scene ended at 10:08 p.m.
One-minute host load ranged from 17.5 to 75.2 on
10 logical CPUs. Each sample's longest renderer task was a compositor commit
waiting on GPU readback. Candidate peaks were 134/515/636 ms wall time with
1.29/2.19/1.58 ms renderer CPU; the 636 ms task contained 634.95 ms
`GLES2::ReadPixels` with 0.62 ms CPU. Baseline showed the same wait path.
This localizes the stalls, but does not identify their cause or clear the
task/input budgets. Diagnostic timings include tracing overhead; private raw
traces and the failed untraced result are retained without selecting a best run.

## Earlier drawing and compositor follow-up

Historical bundle `7186581d0ed2bc31247a038a8def77d35380389880b7fcf288d57c40fb623e00`
was measured at 10:23–10:25 p.m. Pacific on September 25, before a later
contrast-token rebuild. Trace-enabled AB/BA/AB probes used the common scene
in headed and headless Chromium. Each sample added three Paint drags and three
Erase drags interrupted by pointer cancellation. Every Paint changed the draft;
all nine candidate cancellations per mode preserved it, while all nine baseline
cancellations changed it. No drawing interval had a task over 50 ms.
Observed drawing input maxima were 32 ms headless and 56 ms headed; navigation
p95 was 32/56 ms for both builds. One candidate headless navigation task took
147.262 ms wall / 4.347 ms CPU: its compositor Commit took 146.359/3.467 ms,
with an overlapping GPU task at 145.500/0.394 ms. Nested JavaScript, paint, and
layout events were each below 0.3 ms. Headed samples had no Long Tasks.
This localizes a wait without explaining its cause or waiving the task gate.
Drawing rAF p95 of 16.8–17.7 ms is callback cadence, not presented-frame FPS.
Exploratory probes with incomplete traces/input counts are excluded; raw evidence stays local.

## Retention diagnostic

Source `444c373` used five warm-up and 20 measured packaged-panel lifecycles.
After removing settled test callbacks and forcing GC each cycle, JS heap rose
from 2,182,628 to 2,446,652 bytes, non-linearly; DOM nodes rose from 677 to 697.
All 25 instrumented workers terminated, all 25 URLs were revoked, and active
popstate listeners returned to zero. A narrow heap snapshot found no named
panel instance; shell/canvas matches belonged to cached Lit template markup.
This does not identify every retained object or establish a leak, memory bound,
GPU behavior, or production stability. The fixture uses instrumented workers;
raw results and the earlier callback-retaining comparison remain private.

## Remaining measurements

Reference desktop ≥55 fps and supported mobile ≥30 fps, real tablet/touch
input, slow-device stalls, sustained heap/GPU bounds, and live HA update
traffic remain open. The 20-cycle browser lifecycle regression proves counted
listener/worker/URL disposal and stale-result rejection; it does not measure
heap or GPU retention. Transport baseline, numerical latency/resync/request
gates, and exact-candidate parity must precede default switchover. The proposed
one-second status p95, three-second resync p95, and 70% request reduction remain
hypotheses. Evidence must stay local and omit private maps and identifiers.
