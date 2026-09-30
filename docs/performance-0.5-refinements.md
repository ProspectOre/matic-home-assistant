# Unreleased authority-refinement performance

This receipt qualifies the compiled bundle below in a synthetic desktop lab.
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
