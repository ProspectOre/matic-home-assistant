# Unreleased scene-pipeline measurements

September 30, 2026, 06:53–06:55 PDT. Source head `aa3b2b9` with the frozen
uncommitted pipeline repairs; production fingerprint
`1b4078ae1db5f1c2c3f702100dec5a7056ba9b55827a16bc3251037d6bd297a9`.
These local synthetic results do not qualify installed RC9 or real devices.

## Packaged desktop journey

Command: `node scripts/measure_map_studio_performance.mjs v0.4.5 --headed`.
The unchanged schema-5 collector is identified in the
[preceding receipt](performance-0.5-refinements.md). Headed Chromium
151.0.7922.34, Apple M4/10 logical CPUs, 1280×900/DPR 1, unthrottled loopback,
fresh contexts, no-store assets, no tracing. Three AB/BA/AB pairs use identical
scene hashes and 100 interactions each; all interactions were reported.
One-minute host load during samples was 3.8–4.9; other host work was uncontrolled.

| Measure | Current candidate | Gate |
|---|---:|---:|
| Actual registered integration startup, gzip estimate | 89,434 bytes / 87.3 KiB | ≤90 KiB |
| Added lazy workflow, gzip estimate | 11,859 bytes / 11.6 KiB | ≤30 KiB |
| Input p95, three samples | 56 / 56 / 56 ms | ≤100 ms |
| Tasks over 50 ms, three samples | 0 / 0 / 0 | No routine task over 50 ms |

The control also records p95 56 ms and zero Long Tasks. No input improvement is
claimed. Event Timing's 16 ms threshold and quantization remain intact; these
values are a lab input proxy. Review-harness bytes are accounted separately.

## Paired maximum-scene uploader diagnostic

A separate source-bundle ABBA diagnostic compares the preceding `aa3b2b9`
renderer with the frozen repair. The collector fingerprint is
`53327ade01c9a3c0faf5f4d008cac0669809e1e6cd4844992c8fdab42560d2f1`;
the candidate TypeScript-tree fingerprint is
`84b9e2c2712ad793da07625c7648eab2db6e565f7bc5e211772a21fcdbe6d43d`.
Same browser/hardware/viewport; start/end one-minute load was 6.4/5.9.

Both receive identical predecoded 1.5-million-point scenes: 12 MB point bytes,
one warm complete frame, then four contiguous sparse revisions and four camera
actions before the next animation frame. The warm frame, fixture generation,
hashing, final GPU readback and disposal are outside timed renderer work.

| Measure | Preceding renderer, two samples | Repair, two samples |
|---|---:|---:|
| Largest actual transfer in one frame | 48,000,000 bytes | 524,288 bytes |
| Total CPU upload plus GPU copy bytes | 48,000,000 bytes | 12,262,144 bytes |
| Latest complete scene ready | 6.3 / 10.8 ms | 395.4 / 395.5 ms |
| Renderer task-duration proxy | 6.8 / 8.4 ms | 45.2 / 49.7 ms |
| Tasks over 50 ms | 0 / 0 | 0 / 0 |
| Peak / post-disposal point buffers | 1 / 0 | 2 / 0 |

The repair retains the complete warm scene during staging, copies 12 MB within
the GPU and uploads four dirty 64 KiB blocks from the CPU. All four final GPU
readbacks match every point byte, report no GL error, and dispose every buffer.
Numeric capacity reservations are separate from actual data transfers. CPU
uploads and GPU copies have different costs; their byte sum is not a CPU metric.
The measured tradeoff is bounded per-frame work and atomic presentation at the
cost of later publication, a second buffer and higher aggregate task proxies.
No CPU, compositor-FPS, native-memory or broad resource improvement is claimed.

Candidate-only real-worker delta decoding took 71.0–74.8 ms per maximum scene,
with exact output hashes, one dirty block per revision, one worker/no failures,
and no observed main-thread Long Tasks. The preceding parser has no matching
decode API, so these four observations are not a comparative speed result.

An initial diagnostic mislabeled typed-array `bufferData` uploads as capacity
reservations and left its local HTTP listener open. Its report is retained and
excluded from qualification; both collector defects were corrected before the
final run, which exited normally. No production source changed between runs.

These short diagnostics do not measure sustained memory/VRAM, real-device
interaction, actual presentation FPS, live transport or installed recovery.
Those gates remain in [the evidence matrix](acceptance-0.5.md); transport stays
default-OFF. Previous receipts and unexplained outliers remain historical evidence.
