# Matic 0.5 performance evidence

This is paired source and compiled-asset evidence for the current Matic 0.5
candidate, not RC runtime, field, mobile, transport, or physical acceptance.
The release ledger is
[acceptance-0.5.md](acceptance-0.5.md).

The authority baseline is stable v0.4.6; the paired performance control remains
the measured v0.4.5 build. The measured browser assets were built from source
commit `3c60c22afd1d8043c0ef2c1d666fb145ed55a276`. The later backend-only
fail-closed cadence correction does not change these compiled browser assets.
They include abort-safe preview
turn release while retaining the per-connection wire cap until actual RPC
settlement, plus fail-closed fencing and catalog recovery for an unavailable
initial workspace snapshot. Managed normal starts also bind to their generated
native session UUID before accepting current-goal readback.

## Method

Build with `npm run build:map-studio-v4`, then run
`node scripts/measure_map_studio_performance.mjs v0.4.5 > result.json`.
Add `--headed` to measure a visible Chromium window. Launch and reported mode
share the same option; never relabel a headless measurement as headed.
The script serves the tag and current compiled assets on loopback, blocks
external requests, and requires identical synthetic scene SHA-256 hashes.
It opens fresh contexts in AB, BA, AB order. Each journey warms the plan
workflow, then performs 100 inputs: 60 2D/3D toggles, five plan preview/edit/back
loops (20 inputs), and ten room-list/back loops (20 inputs).

Two exact-source comparisons ran at `2026-09-27T11:29:09.433Z` and
`2026-09-27T11:30:04.237Z` (4:29 and 4:30 a.m. PDT) on headless Chromium
151.0.7922.34, macOS arm64, Apple M4, 1280×900, DPR 1, no throttling, and
no-store assets. Other task-owned checks were paused during each run. Across
both AB/BA/AB samples, scene and bundle fingerprints matched. The script records
conditions and fingerprints.
The candidate uses one multi-entry compilation: review-only assets are excluded
from shipped bytes, while the harness imports the exact production chunks.

Event Timing uses a 16 ms reporting threshold. Missing interactions are
imputed at 16 ms; recorded durations retain browser quantization. These p95
estimates are a lab proxy, not field INP. See the official
[Web Vitals definitions](https://web.dev/articles/vitals) and
[DevTools performance guidance](https://developer.chrome.com/docs/devtools/performance).
Gzip sizes use level 9 offline estimates; the local server sends uncompressed
JavaScript. Heap is one post-journey observation, not a retention bound.

## Latest paired result

Measured against the compiled assets for source commit
`3c60c22afd1d8043c0ef2c1d666fb145ed55a276`, including preview abort recovery,
the bounded in-flight RPC cap, initial-snapshot fencing, and tracked-session
attribution.

| Measure | Stable v0.4.5 | 0.5 worktree |
|---|---:|---:|
| Initial production JS, estimated gzip bytes | 79,821 | 80,274 |
| Initial distinct production JS resources | 1 | 4 |
| Added workflow JS, estimated gzip bytes | 0 (eager) | 11,510 |
| Review-only initial JS, estimated gzip bytes | Included above | 4,566 (not shipped) |
| Input p95 estimates, six runs, ms | 32 / 32 / 32 / 32 / 40 / 32 | 32 / 32 / 32 / 32 / 32 / 32 |
| Median / range of p95 estimates, ms | 32 / 32–40 | 32 / 32–32 |
| Maximum observed input estimates, ms | 40 / 32 / 40 / 32 / 88 / 40 | 32 / 40 / 32 / 40 / 32 / 40 |
| Tasks at the 50 ms Long Tasks API threshold, six runs | 0 / 0 / 0 / 0 / 1 / 0 | 0 / 0 / 0 / 0 / 0 / 0 |
| Longest task at or above threshold | 69 ms once | None observed |
| Post-journey JS heap range, six observations, bytes | 5,207,288–7,507,920 | 5,897,392–7,533,296 |

The 90 KiB initial and 30 KiB workflow size budgets pass; input p95 estimates
are below 100 ms. Candidate and baseline median p95 are equal in this lab
journey; this does not establish a speedup. One baseline run reached the Long
Tasks API's 50 ms threshold; none of the six candidate runs did. Keep the
routine-task gate open until representative runtime evidence establishes
whether any such task is routine. Candidate heap readings were 5.9–7.5 MB
versus 5.2–7.5 MB at baseline.
Heap is one post-journey observation per run and does not establish a retention
bound. These results do not qualify field INP, mobile, sustained runtime, or
release acceptance.

Fingerprints (path-sorted compiled JS names and bytes, SHA-256):

| Input | Fingerprint |
|---|---|
| Baseline commit | `f15dfa25d373fe2b4a448595ad0fc40c1d5ed191` |
| Baseline bundle | `55fdd0680408a32fcf72a1478bb88445505185a6047317312ebf0e67d7c52752` |
| Candidate source commit | `3c60c22afd1d8043c0ef2c1d666fb145ed55a276` |
| Candidate production bundle | `ec74800c3006c067e396d8f9635bd02fcf5d5570038fa2e68b0281674472c05c` |
| Candidate review-only bundle | `7f907c1a8f83cba6636655cc11c8c6935add196a3ea523af7148bb93a170d792` |
| Common synthetic scene | `a0349b25e755d0cc8fc55dba8f35982535b91c708654e7cbf87799850ca922a4` |

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
