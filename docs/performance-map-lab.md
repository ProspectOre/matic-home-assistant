# Map capacity lab

This offline synthetic gallery supplements the [qualification proposal](qualification-map-experience.md); it does not connect to Home Assistant or robots.
Run on a named machine with production/review bundles from the same source; record revision, source stamp, browser/device, viewport, fixture hash and conditions. Candidate runs must match.

```sh
export MATIC_CAPACITY_DIR="/path/to/private/receipts"
node scripts/measure_map_capacity.mjs --checkout . --points 1200000 --cycles 20 --soak-seconds 1800 > "$MATIC_CAPACITY_DIR/capacity-1200000.json"
node scripts/measure_map_capacity.mjs --checkout . --points 1500000 --cycles 20 --soak-seconds 0 > "$MATIC_CAPACITY_DIR/capacity-1500000.json"
```

The 1.2M run adds a 30-minute idle soak after 20 remounts; the 1.5M run covers
the larger fixture and remounts. Each selects 3D before replacement. Store output
outside the repository. Deterministic points repeat coordinates and use a small
room catalog, not a 17+ room multi-floor home or three robots. The gallery gets
a prepared scene model, bypassing wire parsing, worker decode and backend
transport; it does not cover sparse geometry, interactions, recovery or devices.
Output records admissions, hashes, Chromium, two-frame timing and post-GC
JS/backing-store samples. Two frames do not prove GPU upload or visible points;
backing storage is not GPU memory. The gallery retains its fixture, so compare
warm states and trends; these samples alone do not prove no leaks or qualify
resource gates.

`scripts/measure_surface_capacity.mjs` is a separate close-zoom lab. It parses
grouped synthetic floor and raised cells, requires complete upload and a WebGL2
surface draw, and checks app-visible graphics handles after disposal. Run it on
the frozen production and review bundles with `--smoke` first; use 1.2M and
1.5M points for independent capacity runs and `--soak-seconds 1800` for the
idle retention observation. It does not measure driver memory, the actual host,
or physical-device acceptance.

The existing `scripts/measure_map_studio_performance.mjs` measures an offline
paired interaction journey and the startup-byte estimate. Neither gallery benchmark
qualifies first-map network graph or bytes with workspace push. Measure total first-map
traffic on a supporting backend with push enabled automatically and periodic polling
continuing, and on an older backend using polling fallback. Preserve the existing
98,304-byte gzip limit; neither benchmark changes it. Capture driver resources,
owned buffers, worker/listener/timer cleanup, actual supported-device behavior
and named-host measurements separately. Emulation is not physical-device proof.

On the measured working build with review-source hash
`68cbd298a3c4715ab79395d97cc1a62e566234f363f4719411b376b31af365d0`,
the normal first-map request set totaled 98,292 bytes when each requested
JavaScript asset was gzip-compressed at level 9; the push-enabled fixture later
requested 114,129 bytes in total. In the delayed-map cleaning fixture, the
two-second fallback allowed optional queue assets to start before the first map
opportunity: that request set totaled about 138 KB by the same method. These
are calculated gzip sizes of observed request paths, not measured wire bytes or
actual-host network performance. The release budget applies to the static graph;
the larger delayed-map request set remains a performance qualification item.
Removing two trailing blank lines later changed the source stamp to
`43f1d38e93fa1378655e8c3ff87ca0975d861b008291133276618e18e060ee50`; all 83 production/review assets stayed byte-identical.

### Close-zoom surface capacity

On November 1, a 1.5-million-cell synthetic scene completed 20 remounts on the
working source stamped above. Every cycle admitted all cells before zooming,
drew floor and raised surfaces, and reported no page, request, console or WebGL
errors. After disposal, tracked WebGL handles returned to their initial counts.
The private receipt has SHA-256
`205aba5fc17b2b033c849ec32514aa6ab5e0adfffd2374428dcd09cc0304f5f7`.

The remount-to-surface p95 was 11.5 seconds while other browser tests and a
retention run overlapped; observed system load was high. This is not a latency
qualification or a hardware GPU measurement. The fixture is synthetic and
does not exercise Home Assistant transport, actual host memory, or physical
device acceptance. The handle counts do not measure driver memory reclamation.

A second 20-cycle run after the browser sweep also passed the upload, surface,
error and tracked-handle checks. Its remount-to-surface p50 was 3.22 seconds
and p95 was 19.13 seconds. The idle soak still overlapped and system load
remained high, so a quiet-host comparison is still required. Its private
receipt SHA-256 is
`16fd54b9a200e0ecccb56c56ae99177187e004507873f301edb8076bdcea2f57`.

At the same measured source stamp, the 1.2M fixture completed 20 remounts and
30 idle samples over 1,800 seconds. Tracked handles returned to baseline, and
forced-GC heap and backing storage were essentially flat. Other tests overlapped;
this does not prove driver reclamation or transport-enabled retention. Receipt
SHA-256: `8078c55a2c857ac9ee668811bf16c19814fbc1aab63f31ccdf3bbed63f9ad2ec`.

### Quiet-host follow-up (November 1, 2026)

At clean source `5beb88d6c546fa3c0ac254fca21257ed2ca36fe0`, the unchanged
parser/renderer stamp `43f1d38e…ee50` completed all 20 cycles with 1.5M cells.
No local test suite ran concurrently. On the Apple M4 with headless Chromium
151 and SwiftShader, remount-to-surface p50 was 1.91 seconds, p95 2.80 seconds
and maximum 2.93 seconds. Every cycle admitted the full fixture; page, console,
request and WebGL error lists were empty, and tracked handles returned to zero.
The receipt SHA-256 is
`83e62df2f9e5d8bebc8994f69dc620855b4f2f38697777c6a3a3f9fc73e4ab02`.
This replaces the contended timing as the current synthetic observation, not a
physical-device or Home Assistant host qualification. No idle soak was repeated.

## Large-home acceptance still required

The 1.2M/1.5M desktop runs are preliminary point-capacity observations. A
synthetic browser regression covers 250 room records, three workspace identities,
saved-floor selection and stale-catalog isolation; two entries share one
synthetic scene source. Neither evidence establishes at least 17 real rooms
across multiple floors or three distinct robots operating end to end. Current
receipts do not include actual-host process CPU/memory through startup,
concurrent robot activity and save/recovery; a
concurrent network trace with reconnect/loss and polling fallback; or physical
acceptance on a real multi-floor map. The final qualification must exercise all
three robots and floors together on the supported host and physical devices,
record host CPU/memory and network/reconnect evidence, and verify map/floor/robot
identity. Do not treat the synthetic gallery, browser tests or single-scene
captures as substitutes.

### Synthetic three-store test-process stress (historical)

An isolated Python test environment ran
`.venv/bin/python -m pytest -s -q tests/test_slam_multi_robot_capacity.py`;
both tests passed. The capacity case staged three independent stores, each with
two floors and two layers of 2,050 pages, totaling 196,865,600 raw staged bytes.
The Python test process reported a 264,978,432-byte startup high-water mark,
1,011,564,544 bytes during staging, and 1,283,784,704 bytes after flush/reload;
the active-floor sample was 382,107,648 bytes. Timing and RSS include the Home Assistant test harness,
asynchronous serialization, flush/reload, allocator effects and concurrent
machine work. The private qualification receipt has SHA-256
`b4bff40c2aaaa152b47866540ca46a5e935a3eac83a8ee0de7bc2263e1be2351`.

This is preliminary synthetic store evidence, not actual-host Core memory/CPU,
network traffic or reconnect behavior, nor physical multi-floor acceptance. The
source was still changing after the run and it is not bound to the final freeze.
Actual-host startup, steady and save/recovery peaks remain blocking; no proposed
acceptance threshold is inferred from these numbers.

### Synthetic three-robot Home Assistant integration (preliminary)

`tests/e2e/test_multi_robot_scale.py` passed with three separate Home Assistant
config entries connected to three loopback TLS/gRPC robot simulators. Each
simulator advertised two synthetic floors; one plan contained 17 synthetic
rooms. The scenario exercised concurrent photo patrols with colliding photo
IDs, floor switching, entry reload and isolation of the other entries. The
targeted simulator regression suite passed 30 tests in 64.70 seconds. This is end-to-end through
Home Assistant and the client protocol, but the robots, floors and rooms are
simulated. It does not measure network capacity or host CPU/memory, establish
real multi-floor map identity or camera framing, or qualify physical acceptance.

The companion `tests/e2e/test_multi_robot_workspace.py` passed functional
coverage for Home Assistant WebSocket subscription/replay and entry
unload/reload across three TLS/gRPC simulators. It checked simultaneous
entry-scoped events, two connections, per-entry final readback and bounded
drain without cross-entry delivery. This is synthetic protocol behavior, not
sustained throughput or actual network/host capacity evidence.

A stronger short functional stream-load run used loopback Home Assistant and
three Hermes simulators: 300 updates over 5.214 seconds, or 57.53 aggregate and
19.18 per robot per second. Each of two WebSocket clients saw robot-state event
counts `[7, 7, 6]` and total events 69 and 43; coalescing was allowed. Both had
no error or resync through a bounded final drain, reached the final delivered
revision, independently read all final battery values and verified cleanup. In
a separate quiet phase, a change to one robot reached both clients on its own
subscription without events on the other two. Private JUnit receipt SHA-256: `50b093c96a786db917e8cf08f326182035cd0c7e5f7ad84ab704fa525fd564eb`.
This is brief synthetic functional load only; it does not qualify sustained
throughput, actual-host/network performance or physical behavior.

## Historical receipts

The [earlier baseline and working-source measurements](performance-map-lab-history.md) are retained separately.
