# Paired headed desktop receipt

Measured October 5, 2026 at 5:06 PM PDT (October 6, 00:06 UTC) against clean product source
`2b5e8d6ead987e126752a13a8d0024abec8af8a5`. This qualifies only the packaged,
synthetic desktop journey; it does not establish installed, mobile, sustained
resource, GPU/FPS, or live-transport performance.

## Method and identity

The checkout-local physical lockfile assets were rebuilt with
`npm run build:map-studio-v4`, then verified byte-identical to tracked hashes
before measurement. The resulting bundle was measured in headed Chromium 151 on
Apple M4/macOS arm64, 1280×900/DPR 1, unthrottled loopback and no-store assets.
Three AB/BA/AB pairs used fresh contexts and the same four-room, 5,300-point
synthetic scene. Each sample recorded 100 inputs: 60 view switches, five plan
loops and ten room-list loops after workflow warm-up. No tracing was enabled.

| Input | SHA-256 or commit |
|---|---|
| v0.4.5 control | `f15dfa25d373fe2b4a448595ad0fc40c1d5ed191` |
| Control bundle | `55fdd0680408a32fcf72a1478bb88445505185a6047317312ebf0e67d7c52752` |
| Candidate bundle | `79535d0aca5d275e49497533f20565947202b73e693f521f48ab11747c66c084` |
| Collector | `882e2814c6f9a6527f640d5cdaa10ff09582d3c5e421ca14320d2e13a3bc747d` |
| Common scene | `a0349b25e755d0cc8fc55dba8f35982535b91c708654e7cbf87799850ca922a4` |

## Results

| Measure | v0.4.5 | Candidate | Gate |
|---|---:|---:|---:|
| Complete registered startup gzip estimate | Not measured | 90,778 bytes | ≤92,160 bytes |
| Added lazy workflow gzip estimate | 0 bytes | 11,905 bytes | ≤30,720 bytes |
| Input p95, three runs | 56/56/56 ms | 56/56/56 ms | ≤100 ms |
| Tasks over 50 ms, three runs | 0/0/0 | 0/0/0 | No routine task over 50 ms |

The candidate startup includes 88,735 bytes of panel JavaScript and 2,043 bytes
of HA-registered modules. The 4,598-byte review-only harness is separate. These
are level-9 gzip estimates; the loopback server sends uncompressed JavaScript.
The baseline is panel-only and has no host-wide byte total. The equal p95 does
not demonstrate an input-speed improvement.

## Limits

The run took 48.85 seconds. A 100 ms sampler measured a peak owned process-tree
RSS of 929,972,224 bytes; all owned processes exited, tracked hashes were
unchanged and the temporary test-Python `.venv` symlink was removed. This short sampled
peak is not sustained-memory proof and may miss short-lived descendants.
Post-journey heap samples do not establish retention bounds.

The synthetic run does not measure larger-scene parsing/decompression, physical
presentation FPS, mobile interaction, live HA traffic or recovery. Sustained
CPU/heap/GPU, installed behavior, device/accessibility, and live transport
qualification remain open. Live transport remains default-OFF; proposed status,
resynchronization and request-reduction targets are unqualified. See the
[acceptance matrix](acceptance-0.5.md) for release gates.
