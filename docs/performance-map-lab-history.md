# Historical map-capacity receipts

These earlier synthetic observations supplement the [current lab procedure](performance-map-lab.md). They do not qualify the current candidate.

## Baseline receipt

Source `460362131bb1691e032995915c9e605f525c6e8a`, review-source stamp
`62387c5fe85863efe3def7c17f7527f5eda769582ad004c3b201abb06edf5782`,
recomputed from archived source and installed dependency inputs;
Apple M4 desktop, macOS arm64, headless Chromium 151, 1280 × 900 at DPR 1,
loopback with no external requests. This run overlapped other local work and a
second fixture; it is not a quiet-host timing baseline. The 1.5M-point fixture was admitted with
3D selected on all 20 remounts. Two-frame timing had p50 29 ms, p95 43 ms and
maximum 46 ms; it does not measure GPU completion. Forced-GC JS heap was
2.94 MB at the warm baseline and 3.78 MB after the last cycle; browser backing
storage was 24.62 MB at both rounded observations. These observations do not
qualify the proposed performance thresholds. A 1.2M-point run also admitted all
20 replacements in 3D, then completed a 30-minute idle soak. Forced-GC heap
rose from 2.95 MB warm to 3.77 MB at the first soak sample and stayed at 3.77 MB
through all 30 samples; backing storage stayed at 19.77 MB across those samples.
The fixture and browser retain their baseline allocations. These partial desktop
observations do not establish resource cleanup or final-candidate acceptance.

## Later working-source receipts

Freeze 14 completed a 1.2M-point, 20-replacement run and all 30 samples of
the requested 1,800-second idle soak. Every replacement admitted the full
fixture in the three-view mode. The forced-GC heap and browser backing-store
observations were flat across all soak samples at 3,868,560 bytes and
19,783,850 bytes respectively. This is a historical result: review-source
hash `da76b7c6ecb6c4a7a81c74f075fcf4ff9258627497b97e9bd11fbacb6695dd95`
and bundle fingerprint `981a431f505a05e3c53a0fd6e3c992b7bc29037f3b9343ab1a34aa966c1324c1`
precede subsequent source changes. Fixture SHA-256 was
`efc80c1975f3669587be2bcead5cb5d227175c6ada227567031a57b290a9c557` and harness
SHA-256 was `7c053b53ebf9a90bd89d52cfd6e7e1de34a42539fce81352e7b6f9166d0fc7f0`.
The private archived receipt is `freeze14-1200000-20cycle-1800s.json`; its
checksum, source-stamp, and load-log checksums are listed in the private
`capacity-history/SHA256SUMS` manifest (SHA-256
`9c09146e5e3ea84618c6db3fb1eab0e7148665ed1e16fa18a8d3e168688e841b`).

Freeze 15 paired 1.5M-point baseline and candidate runs using the same
synthetic fixture (`363ee7de7be3e533e081ac864153c298ee6a71f347202b393404f4dcf1ef8f6a`)
and collector (`7c053b53ebf9a90bd89d52cfd6e7e1de34a42539fce81352e7b6f9166d0fc7f0`).
Both admitted all 20 replacements in the three-view mode. Baseline review-source
hash was `62387c5fe85863efe3def7c17f7527f5eda769582ad004c3b201abb06edf5782`;
candidate hash was `c87b4d6926de646404a4fa64acb2eda25ef29b68737ee93ed40c83fd83705463`
with bundle fingerprint
`56fb32d1b0dd3950b2df62fffc82e5f31d0d206f38501fbdc8ddfa7ee1216f4b`.
Replacement-to-two-frame p50/p95/p99/max was 37.9/55.2/81.8/81.8 ms for
baseline and 37.9/71.6/78.4/78.4 ms for candidate. The paired run overlapped
other machine activity; these descriptive desktop timings do not meet physical
device or latency acceptance. The subsequent Freeze 15 1.2M soak was stopped
before producing a receipt while mobile camera fixes were pending; it is not a
completed soak. Both candidate results are historical until a new final-source
freeze is signaled. The private archive retains baseline and candidate JSON,
pair-load log, and source-stamp files under portable names; their checksums are
in the same `capacity-history/SHA256SUMS` manifest.
