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

Measured September 25 at 8:12 p.m. Pacific (`2026-09-26T03:12:17.508Z`):

| Measure | Stable v0.4.5 | 0.5 worktree |
|---|---:|---:|
| Initial production JS, estimated gzip bytes | 79,821 | 79,156 |
| Initial distinct production JS resources | 1 | 4 |
| Added workflow JS, estimated gzip bytes | 0 (eager) | 11,361 |
| Review-only initial JS, estimated gzip bytes | Included above | 4,489 (not shipped) |
| Input p95 estimates, three runs, ms | 32 / 32 / 32 | 32 / 32 / 40 |
| Median / range of p95 estimates, ms | 32 / 32–32 | 32 / 32–40 |
| Maximum observed input estimates, ms | 48 / 48 / 48 | 32 / 40 / 40 |
| Tasks over 50 ms, three runs | 0 / 0 / 0 | 0 / 0 / 0 |
| Longest task over 50 ms | None observed | None observed |
| Post-journey JS heap range, bytes | 5,178,756–6,763,004 | 5,890,920–7,443,440 |

The 90 KiB initial and 30 KiB workflow size budgets pass. This sample's
candidate input p95 estimates are below 100 ms and it observed no routine task
over 50 ms. The equal median does not establish an input-speed improvement.
A prior trial overlapping other test execution showed candidate tasks up to
55 ms; system load matters and this result does not close runtime task gates.
The separately loaded diagnostics chunk is 1,897 gzip bytes.
Earlier Chrome 153 synthetic DevTools evidence recorded LCP 217 ms, CLS 0,
and one 171 ms interaction (168 ms presentation delay); CrUX was unavailable.
That different harness sample remains separate from this paired comparison.

Fingerprints (path-sorted compiled JS names and bytes, SHA-256):

| Input | Fingerprint |
|---|---|
| Baseline commit | `f15dfa25d373fe2b4a448595ad0fc40c1d5ed191` |
| Baseline bundle | `55fdd0680408a32fcf72a1478bb88445505185a6047317312ebf0e67d7c52752` |
| Candidate production bundle | `ed53b0adad2778676757fd122b7d37b473bc1a9310cd6f8c5620a584f8cfb732` |
| Candidate review-only bundle | `18799769b04b558498f435251616e2a43c99bab3c32aa394dd498a195a0a2570` |
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
