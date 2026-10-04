# Unreleased authority-refinement performance

This historical receipt qualifies the compiled bundle below in a synthetic desktop lab.
The [scene-pipeline measurement](performance-0.5-scene-pipeline.md) identifies the newer bytes.
It does not transfer RC9's installed or physical evidence to these changes.
Earlier runs and the unexplained RC9 input outlier remain recorded in
[performance-0.5.md](performance-0.5.md) and its diagnostic card.

## Candidate and method

Measured September 30, 2026 at 04:07 PDT. Source checkout: `5a92454` with
uncommitted Stop/selection review repairs. The production bundle fingerprint is
`01a8fc3d3f6052d026159da3251179c9a21bd3b0c69b0d12863c1ca9ce91b205`.
The schema-5 collector fingerprint is
`882e2814c6f9a6527f640d5cdaa10ff09582d3c5e421ca14320d2e13a3bc747d`.

Command: `node scripts/measure_map_studio_performance.mjs v0.4.5 --headed`.
Visible Chromium 151.0.7922.34 on Apple M4, 10 logical CPUs, 1280×900/DPR 1,
unthrottled loopback, no tracing, fresh browser context and no-store assets.
Three paired rounds alternate AB/BA/AB against the unchanged v0.4.5 bundle.
The identical synthetic scene is hash-checked. Each journey contains 100
inputs after workflow warm-up: 60 view switches, five plan loops, ten room loops.
Only one Matic measurement/test job ran; other host work was not controlled.
Recorded one-minute load was 2.5–2.9; longer averages retained earlier overload.

Event Timing uses its native 16 ms threshold and quantization. Unreported
interactions are conservatively imputed at 16 ms; all 100 interactions were
reported in each of these six samples. This is a lab input proxy, not field INP.
Candidate byte accounting includes the actual globally registered HA modules;
the historical control has panel-only accounting and no host-wide byte total.

## Observed results

| Measure | Candidate | Gate |
|---|---:|---:|
| Whole integration startup, gzip estimate | 85,346 bytes / 83.3 KiB | ≤90 KiB |
| Added lazy workflow, gzip estimate | 11,857 bytes / 11.6 KiB | ≤30 KiB |
| Input p95 in each of three runs | 56 / 56 / 56 ms | ≤100 ms |
| Maximum observed input in each run | 56 / 56 / 56 ms | Reported, no separate gate |
| Tasks over 50 ms in each run | 0 / 0 / 0 | No routine task over 50 ms |

The control also recorded p95 56/56/56 ms and zero tasks over 50 ms.
These samples establish no response-time improvement over the control.
The 03:18 authority build also passed this journey with bundle fingerprint
`5bcd24fe7eff39274c63feb9aef0c244a5028a77e19aaf45c863fec3e036153d`;
that retained receipt is historical and does not identify the current source.

## Remaining gates

One post-journey heap observation per sample does not prove retention bounds.
This run does not measure sustained CPU/GPU use, seeded large-scene rendering,
desktop/mobile FPS, actual Android/iOS interaction, or live HA traffic/recovery.
The older input outlier has not been causally explained by these passing runs.

Workspace transport remains default-OFF. Installed fault/fallback parity and
final numerical latency, resynchronization and request/resource gates are
required before switchover; 1 s / 3 s / 70% remain proposed targets.
Raw receipts stay local. The release gate is [acceptance-0.5.md](acceptance-0.5.md).

## Large-scene resource diagnostic

A separate 04:41 PDT run used clean head `aa3b2b9`, the same production bundle
above, and collector `bce3c79f02d5a14fe45a259d6b3a1431bf4e499dfca270eff3d63b99328641e4`.
Fresh headed Chromium contexts rendered identical hash-checked 250,000 and
1,500,000-point scenes. Each sample ran 60 seconds of synthetic camera controls,
12 five-second checkpoints and three unmount/remount cycles. One AB pair at
250,000 points and one BA pair at 1,500,000 points are descriptive samples.
Scene buffers were injected after parsing; parsing/decompression are excluded.

| Scene / build | Admission to ready, ms | Active renderer task / script CPU proxies, s | First / last post-GC JS heap, bytes |
|---|---:|---:|---:|
| 250,000 / v0.4.5 | 9.0 | 1.418 / 0.530 | 2,471,756 / 2,691,516 |
| 250,000 / candidate | 3.8 | 2.353 / 0.836 | 2,553,504 / 2,808,480 |
| 1,500,000 / candidate | 10.3 | 3.103 / 1.100 | 2,563,340 / 2,805,524 |
| 1,500,000 / v0.4.5 | 9.7 | 2.472 / 0.912 | 2,469,408 / 2,688,524 |

All samples rendered the full point count through WebGL2 without asset errors.
Mounted DOM/listener counts remained constant during interaction; all three
unmounts returned both builds to 391 nodes and 13 listeners, with remounts at
821–822 nodes and 59 listeners. Both builds retained small post-GC heap increases
over three cycles. This short run does not prove leak freedom.

The candidate's task/script proxies were higher in both pairs; no CPU improvement
or resource-gate pass is claimed. GC time was measured separately from active
segments. Other host work was uncontrolled, and no repeated distribution or
trace attribution is available. JS heap excludes native buffers and GPU memory;
these counters do not establish whole-process CPU, presentation FPS, sustained
memory/VRAM bounds, or a numerical transport gate. Raw receipts and the collector
are retained privately for independent method review and targeted diagnosis.

A 05:04 PDT diagnostic reused those compiled bytes and identical 250,000-point
scene, with exactly 300 separately settled camera actions in each of three
AB/BA/AB pairs. TaskDuration/action was 0.817/0.810, 0.821/0.796 and
0.816/0.819 ms (control/candidate); script means were 0.165/0.162 ms/action.
Those small differences establish no improvement or broad per-action regression
for this synthetic journey. The checkout was dirty, but its compiled fingerprints
matched the earlier receipt; these measurements do not cover later source edits.

Per-action DevTools snapshots and two-frame settling change the workload; the
builds also use different gallery harnesses. Two separately profiled 300-action
samples were about 98% idle, with too few active samples for reliable hotspot
attribution. The old interval run did not count actual actions, so this follow-up
cannot reconstruct or explain its CPU difference. It does not close resource,
GPU, transport, real-device or presentation-frame gates.
