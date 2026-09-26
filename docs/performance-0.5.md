# Matic 0.5 performance evidence

This is reproducible local worktree evidence, not exact-candidate, field,
mobile, transport, or physical acceptance. The release ledger is
[acceptance-0.5.md](acceptance-0.5.md).

## Method

Build with `npm run build:map-studio-v4`, then run
`node scripts/measure_map_studio_performance.mjs v0.4.5 > result.json`.
The script serves the tag and current compiled assets on loopback, blocks
external requests, and requires identical synthetic scene SHA-256 hashes.
It opens fresh contexts in AB, BA, AB order. Each journey warms the plan
workflow, then performs 100 inputs: 60 2D/3D toggles, five plan preview/edit/back
loops (20 inputs), and ten room-list/back loops (20 inputs).

The September 25 Pacific measurement used headless Chromium 151.0.7922.34,
macOS arm64, Apple M4, 1280×900, DPR 1, no CPU/network throttling, and no-store
assets. Other task-owned Python and browser checks were paused for this run.
The script records its conditions and fingerprints with each result.
The candidate uses one multi-entry compilation: review-only assets are excluded
from shipped bytes, while the harness imports the exact production chunks.

Event Timing uses a 16 ms reporting threshold. Missing interactions are
imputed at 16 ms; recorded durations retain browser quantization. These p95
estimates are a lab proxy, not field INP. See the official
[Web Vitals definitions](https://web.dev/articles/vitals) and
[DevTools performance guidance](https://developer.chrome.com/docs/devtools/performance).
Gzip sizes use level 9 offline estimates; the local server sends uncompressed
JavaScript. Heap is one post-journey observation, not a retention bound.

## Results

Measured September 25 at 8:26 p.m. Pacific (`2026-09-26T03:26:55.942Z`):

| Measure | Stable v0.4.5 | 0.5 worktree |
|---|---:|---:|
| Initial production JS, estimated gzip bytes | 79,821 | 79,174 |
| Initial distinct production JS resources | 1 | 4 |
| Added workflow JS, estimated gzip bytes | 0 (eager) | 11,382 |
| Review-only initial JS, estimated gzip bytes | Included above | 4,489 (not shipped) |
| Input p95 estimates, three runs, ms | 32 / 32 / 32 | 40 / 32 / 40 |
| Median / range of p95 estimates, ms | 32 / 32–32 | 40 / 32–40 |
| Maximum observed input estimates, ms | 64 / 40 / 48 | 72 / 40 / 64 |
| Tasks over 50 ms, three runs | 0 / 0 / 0 | 1 / 0 / 1 |
| Longest task over 50 ms | None observed | 54 ms |
| Post-journey JS heap range, bytes | 5,231,380–7,917,400 | 5,747,820–7,693,356 |

The 90 KiB initial and 30 KiB workflow size budgets pass; input p95 estimates
are below 100 ms. Candidate tasks of 52 and 54 ms keep the task-duration gate
open. Three subsequent candidate-only diagnostic traces did not reproduce the
stalls (largest main-thread tasks 14.3, 35.13, and 15.39 ms); no source bottleneck
was attributed. Non-reproduction does not close the gate or establish a speedup.
A prior trial under concurrent test load observed tasks up to 55 ms.
The separately loaded diagnostics chunk is 1,897 gzip bytes.
Earlier Chrome 153 synthetic DevTools evidence recorded LCP 217 ms, CLS 0,
and one 171 ms interaction (168 ms presentation delay); CrUX was unavailable.
That different harness sample remains separate from this paired comparison.

Fingerprints (path-sorted compiled JS names and bytes, SHA-256):

| Input | Fingerprint |
|---|---|
| Baseline commit | `f15dfa25d373fe2b4a448595ad0fc40c1d5ed191` |
| Baseline bundle | `55fdd0680408a32fcf72a1478bb88445505185a6047317312ebf0e67d7c52752` |
| Candidate production bundle | `2b575b3e52a2ebe8ade02abe052c296936c473840c8216f566c43d822cbe2c18` |
| Candidate review-only bundle | `304ad6467f611a43439d69d92507747896fca3311f9692f5b65ff2aebbfafa96` |
| Common synthetic scene | `a0349b25e755d0cc8fc55dba8f35982535b91c708654e7cbf87799850ca922a4` |

## Remaining measurements

Reference desktop ≥55 fps and supported mobile ≥30 fps, real tablet/touch
input, slow-device stalls, sustained heap/GPU bounds, and live HA update
traffic remain open. The 20-cycle browser lifecycle regression proves counted
listener/worker/URL disposal and stale-result rejection; it does not measure
heap or GPU retention. Transport baseline, numerical latency/resync/request
gates, and exact-candidate parity must precede default switchover. The proposed
one-second status p95, three-second resync p95, and 70% request reduction remain
hypotheses. Evidence must stay local and omit private maps and identifiers.
