# Map capacity lab

[Testing](testing.md) · [Contributing](../CONTRIBUTING.md) · [Roadmap](roadmap.md)

Three scripts measure Matic Map on synthetic homes in headless Chromium. They
never contact Home Assistant or a robot. Use them to compare a change with the
build before it, on the same machine, with nothing else running.

Build first (`npm run build:map-studio-v4`) so the production and review
bundles come from the same source. Write results outside the repository, and
note the commit, machine, browser and options with each one.

## Large maps

```sh
node scripts/measure_map_capacity.mjs --checkout . --points 1200000 --cycles 20 --soak-seconds 1800
node scripts/measure_map_capacity.mjs --checkout . --points 1500000 --cycles 20 --soak-seconds 0
```

Each run opens a map of that many points in 3D, replaces it the given number
of times and prints JSON: what was admitted, frame timing, and JavaScript and
buffer memory after garbage collection. The first command then leaves the page
idle for 30 minutes, sampling memory once a minute. 1,500,000 points and 1,800
seconds are the script's upper limits.

The page is handed a prepared map, so parsing, the worker and the connection to
Home Assistant are not measured. Buffer memory is not GPU memory, and flat
samples do not prove there is no leak.

## Close zoom

```sh
node scripts/measure_surface_capacity.mjs --smoke
node scripts/measure_surface_capacity.mjs --points 1500000 --cycles 20
node scripts/measure_surface_capacity.mjs --points 1200000 --cycles 20 --soak-seconds 1800
```

This one parses floor and raised cells, requires every cell to be uploaded and
a WebGL2 surface to be drawn, and checks that the graphics handles the page
created are released when the map is closed. Run `--smoke` first. It does not
measure the graphics driver's own memory.

## Interaction and startup size

```sh
node scripts/measure_map_studio_performance.mjs /path/to/baseline-checkout
```

It runs the same journey on this checkout and on a baseline checkout built the
same way, and prints timings for both with an estimate of the bytes loaded
before the first map.

The first map may load at most 98,304 bytes of gzip-compressed JavaScript
(`STARTUP_BUDGET_BYTES` in `scripts/startup_graph.mjs`). `tests/test_frontend.py`
and `tests/browser/map_studio_v4_deferred_assets.spec.mjs` enforce it on every
pull request. The lab does not change that limit.

## What the lab can't show

- A synthetic home repeats coordinates and has few rooms. It is not a large
  home with several floors or several robots; `tests/e2e/test_multi_robot_scale.py`
  covers three simulated robots and a 17-room plan for correctness, not load.
- Headless Chromium on a desktop says nothing about a phone, a tablet or the
  Home Assistant host's own memory and processor use.
- Timings taken while other work runs on the machine are not comparable. One
  1.5-million-cell run measured 1.9 seconds at the median on a quiet machine
  and 3.2 seconds, with a far longer tail, on a busy one.
