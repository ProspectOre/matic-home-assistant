# Runtime-contract candidate: desktop measurement

Measured October 5, 2026 at 09:46 PDT against clean product source
`d9310fd75139302b8d00bd7ff20f943c043313dc`. This refresh qualifies the
packaged synthetic desktop journey only. It does not qualify an installed RC,
mobile devices, sustained resources, or live transport.

## Method and identity

Command: `node scripts/measure_map_studio_performance.mjs v0.4.5 --headed`.
The committed bundle was measured without rebuilding. The unchanged schema-5
collector runs three AB/BA/AB pairs, with fresh contexts and the same 100-input
journey in each sample: 60 view switches, five plan loops, and ten room-list
loops after workflow warm-up. All 100 interactions were reported in each run.

Headed Chromium 151.0.7922.34 ran on Apple M4/macOS arm64, 10 logical CPUs,
1280×900/DPR 1, unthrottled loopback, no-store assets, and no tracing. External
requests were blocked. No other local build/test process was found at preflight;
other host activity was uncontrolled. Per-sample host load remains in the private
receipt. Both builds used the same four-room, 5,300-point synthetic scene.

| Input | SHA-256 or commit |
|---|---|
| v0.4.5 control | `f15dfa25d373fe2b4a448595ad0fc40c1d5ed191` |
| Control bundle | `55fdd0680408a32fcf72a1478bb88445505185a6047317312ebf0e67d7c52752` |
| Candidate bundle | `f4659af917a4c4f53b626157566c2ec618cac4935b0483ebdee369faeee39262` |
| Collector | `882e2814c6f9a6527f640d5cdaa10ff09582d3c5e421ca14320d2e13a3bc747d` |
| Common scene | `a0349b25e755d0cc8fc55dba8f35982535b91c708654e7cbf87799850ca922a4` |

## Observed results

| Measure | v0.4.5 | Candidate | Inherited gate |
|---|---:|---:|---:|
| Complete registered startup, gzip estimate | Unmeasured | 90,671 bytes | ≤92,160 bytes |
| Added lazy workflow, gzip estimate | 0 bytes | 11,905 bytes | ≤30,720 bytes |
| Input p95, three runs | 56 / 56 / 56 ms | 56 / 56 / 56 ms | ≤100 ms |
| Maximum input, three runs | 56 / 56 / 56 ms | 56 / 56 / 56 ms | Reported |
| Tasks over 50 ms, three runs | 0 / 0 / 0 | 0 / 0 / 0 | No routine task over 50 ms |

Startup includes 88,628 bytes of production panel JavaScript and 2,043 bytes
of HA-registered extra modules. The review-only harness is reported separately.
These are level-9 gzip estimates from requested files; the build-graph estimates
use different compression/accounting and should not be substituted for this
complete-registration total. The historical control lacks host-wide byte
accounting. No input-speed improvement over the control is demonstrated.

Event Timing retains the 16 ms threshold, native quantization, and conservative
imputation for unreported interactions. These observations are a lab proxy,
not field INP; [lab and field measurements serve different purposes](https://web.dev/articles/vitals).
The earlier unexplained input outlier and traced compositor waits remain
recorded in [prior diagnostics](performance-0.5-diagnostics.md).

## Limits and remaining qualification

The run finished in 46.8 seconds and closed its browser and local server.
Temporary dependency links were removed, and no Chromium process remained.
The external controller's process-group memory counter omitted detached browser
descendants; it is not used as aggregate RSS or browser-resource proof.
Post-journey JavaScript heap snapshots likewise do not establish retention bounds.

This harness does not parameterize larger scenes, measure parsing/decompression
under load, track physical presentation FPS, or exercise live HA traffic and
recovery. Sustained CPU/heap/GPU, actual Android/iOS touch and safe areas, native
zoom/assistive technology, and installed transport fault/fallback evidence remain
open. The earlier large-scene diagnostics used different code and methods.

Live transport remains default-OFF. Proposed 1 s status, 3 s resynchronization,
and 70% request-reduction targets remain unqualified. The authoritative release
dispositions are in the [acceptance matrix](acceptance-0.5.md).
