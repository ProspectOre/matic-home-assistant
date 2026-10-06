# Matic 0.5 performance evidence

This is paired source and compiled-asset evidence for RC9. The [unreleased refinements](performance-0.5-refinements.md)
have a separate current lab receipt; these RC9 results do not qualify them or establish runtime,
field, mobile, transport, or physical acceptance.
The release ledger is [acceptance-0.5.md](acceptance-0.5.md).

The authority baseline is stable v0.4.6; the paired control remains v0.4.5.
RC9 has separate untraced headed and headless receipts; the production bundle fingerprint below identifies both. [Controlled diagnostics](performance-0.5-diagnostics.md) retain their differing results and the unexplained input outlier. Earlier RC7 measurements remain historical.
The audit corrected startup accounting: the earlier 80,712-byte estimate
counted only v4 and omitted 61,269 bytes of globally registered editor,
classic-panel, and icon modules. That 141,981-byte total exceeded 90 KiB.
RC9 removed Classic and its switch; its Configure editor loaded on demand.
Current 0.5 source removes that remaining editor and global loader; the RC9 measurements below remain historical. Clear selection commits once instead of once per room.
Earlier RC4 input results do not qualify this disconnect-admission repair.

## Method

Build with `npm run build:map-studio-v4`, then run
`node scripts/measure_map_studio_performance.mjs v0.4.5 > result.json`.
Add `--headed` to measure a visible Chromium window. Launch and reported mode
share the same option; never relabel a headless measurement as headed.
`--trace-dir <private-directory>` records diagnostic traces with extra overhead;
trace-enabled timings do not qualify the untraced performance gate. The script
also records per-sample host load averages and logical CPU count. Schema 5 adds
the collector hash, source commit and tracked-change flag, plus bounded event
details and static action labels for the ten slowest interactions. The source
flag excludes untracked files; actual loaded bundle hashes identify the bytes.
Both builds use the same observers and action bookkeeping. No collector-overhead
calibration or attribution of the earlier 552 ms sample is claimed.
The script serves the tag and current compiled assets on loopback, blocks
external requests, and requires identical synthetic scene SHA-256 hashes.
It opens fresh contexts in AB, BA, AB order. Each journey warms the plan
workflow, then performs 100 inputs: 60 2D/3D toggles, five plan preview/edit/back
loops (20 inputs), and ten room-list/back loops (20 inputs).

The untraced headless comparison ran at `2026-09-29T04:52:14.698Z`
(9:52 p.m. PDT on September 28) on headless Chromium 151.0.7922.34, macOS arm64, Apple M4,
1280×900, DPR 1, no throttling, and no-store assets. Other automated suites
were stopped; no background HA tab was opened during this measurement. Three fresh contexts per build ran in AB/BA/AB order; scene and
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

## Untraced headless result
RC9 production bundle `fea378f99e6dbc3c046e69392b877a345c0ad281904ea1d91f222198c0918480`, measured against baseline bundle `55fdd0680408a32fcf72a1478bb88445505185a6047317312ebf0e67d7c52752`; all six samples used the same scene fingerprint.

| Measure | Stable v0.4.5 | 0.5 candidate |
|---|---:|---:|
| Initial v4 JS / complete integration JS, estimated gzip bytes | 79,821 / Unmeasured | 80,693 / 82,736 |
| Registered modules / added lazy workflow, estimated gzip bytes | Unmeasured / 0 | 2,043 / 11,854 |
| Input p95 estimates, three runs, ms | 40 / 48 / 32 | 48 / 48 / 40 |
| Long Tasks over 50 ms, three runs | 1 / 1 / 1 | 2 / 0 / 0 |
| Longest reported Long Task | 125 ms | 111 ms |
| Post-journey JS heap range, three observations, bytes | 5,107,856–6,490,224 | 5,961,564–6,110,444 |
| Input maximum estimates, three runs, ms | 144 / 104 / 88 | 128 / 64 / 56 |

Candidate input p95 remains within the 100 ms lab threshold, but this headless receipt reported 2/0/0 Long Tasks (longest 111 ms), while baseline reported 1/1/1 (longest 125 ms). The later headed comparison reported p95 56/56/56 ms and zero Long Tasks; one input maximum was 552 ms. Controlled diagnosis is linked above; neither receipt is discarded and no all-performance pass is claimed. The 100-room Clear regression records 100 → 1 commits and 99 → 0 intermediate nonempty preview keys, not network-request counts. Heap observations are not retention bounds; field, mobile, sustained runtime, and release acceptance remain open.

Fingerprints (path-sorted compiled JS names and bytes, SHA-256):

| Input | Fingerprint |
|---|---|
| Baseline commit | `f15dfa25d373fe2b4a448595ad0fc40c1d5ed191` |
| Baseline bundle | `55fdd0680408a32fcf72a1478bb88445505185a6047317312ebf0e67d7c52752` |
| Candidate source | RC9 follow-up; source revision not included in measurement receipt |
| Candidate production bundle | `fea378f99e6dbc3c046e69392b877a345c0ad281904ea1d91f222198c0918480` |
| Candidate review-only bundle | `c3cef28abdf74b28802fc6dc554ac1682dc4d6dbfb004996ddc13a22e11d8a46` |
| Registered frontend assets | `1077ff78f92cbd3191e9f3ac551d00a6101f0cb377cc43ca0cd534df1777887d` |
| Common synthetic scene | `a0349b25e755d0cc8fc55dba8f35982535b91c708654e7cbf87799850ca922a4` |

Historical RC7 paired receipt (`2026-09-28T23:03:18Z`): candidate bundle `7682ac4a0176262c97993b8328aa1086e5c482de1519e6cb26f0592287f4b6a0`, 82,411 complete initial gzip bytes, 11,857 lazy workflow bytes, p95 48/48/40 ms, and 0/0/0 Long Tasks. Its baseline result was 79,821 initial v4 bytes, p95 40/48/48 ms, and 0/0/0 Long Tasks. Other automated suites were stopped; a temporary background HA tab was briefly opened and closed during that historical run. These counts remain historical and do not replace the RC9 comparison above.

## Prior runs and diagnostic follow-up

Earlier source `b8ee8fd` measured 82,289 initial and 11,704 lazy gzip bytes, input p95 40/40/48 ms, and zero Long Tasks at 1:24 a.m. PDT on September 28; it does not identify the current candidate.

RC4 source `92e1605` at 06:42 UTC on September 28 measured 82,279 initial gzip bytes, p95 48/40/40 ms and no Long Tasks; those earlier observations remain retained separately from this repair.
Prior runs remain evidence: `0c1923d` at 11:04 p.m. reported candidate p95 72/80/64 ms and task peaks 89/80/54 ms; `444c373` at 10:49 p.m. reported p95 48/48/56 ms and one 58 ms Long Task.
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

Source `444c373`: five warm-up and 20 measured packaged-panel lifecycles, with settled test callbacks removed and GC forced each cycle. JS heap rose non-linearly from 2,182,628 to 2,446,652 bytes; DOM nodes rose 677→697. All 25 workers terminated, all 25 URLs were revoked, and active popstate listeners returned to zero. A narrow heap snapshot found no named panel instance; shell/canvas matches were cached Lit markup. This is counted cleanup evidence, not a heap/GPU bound or production-stability claim. The fixture instruments workers; raw results and the prior callback-retaining comparison remain private.

## Scene-content transport correction

RC8 live observation delivered 1,142 contiguous invalidations in 56.376 s; a delayed subscription correctly requested overflow recovery, then delivered 588 contiguous updates. Protocol delivery does not establish frontend efficiency. A source-level paired Chromium test used the same paused clock, settled startup, and 200 content revisions over 10 synthetic seconds; each revision resolved the single held delta request. Compare RC8 effects with the correction using that identical fixture. Counts include startup; no private scenes were used.

| Path | Catalog reads | Full-scene reads | Delta reads |
|---|---:|---:|---:|
| Polling control, both versions | 3 | 2 | 201 |
| Enabled workspace, before correction | 203 | 202 | 1 |
| Enabled workspace, corrected | 3 | 2 | 201 |
| No decompression support, before → corrected | 203 → 3 | 202 → 4 | 0 |

The corrected stream retained one delta owner and admitted the final scene revision. A held startup catalog remained one request rather than forcing another after release. The correction separates content revision from coherence identity; snapshots cannot move the admitted scene revision ahead of its delta. These are synthetic request counts, not installed-runtime latency, bandwidth, or a 70% total-traffic claim. Production transport remains off.

## Current trace diagnosis

A separate six-sample trace captured compositor/readback waits in every renderer task over 50 ms. Main-thread CPU medians were 1.34–2.62 ms; nested JavaScript peaked at 0.57 ms and layout/paint at 0.40 ms. GPU work overlapped the longest candidate waits. This supports synchronization waiting rather than long application execution, but does not establish the cause of slow GPU completion. Traced counts and timings do not replace the untraced receipt or close the Long Tasks gate; no speculative execution-strategy change was made.

## Remaining measurements

Reference desktop ≥55 fps, supported mobile ≥30 fps, actual touch input, slow-device stalls, sustained heap/GPU bounds, and live frontend traffic remain open. Counted lifecycle cleanup does not establish retention bounds. Final numerical latency/resync/request gates and exact-candidate parity must precede switchover; proposed one-second status p95, three-second resync p95, and 70% request reduction remain hypotheses. Raw evidence stays private.
