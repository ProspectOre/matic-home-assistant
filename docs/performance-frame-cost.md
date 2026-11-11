# Map frame cost

How the map keeps camera frames cheap, what CI holds it to, and how to measure a
device. No phone or desktop frame rate has been measured yet; the numbers below
come from a container and are labelled so.

## What a frame draws

WebGL draws the scene's points or close-zoom surfaces and every floor-plane
layer: room colors, room outlines, the selection, zones, floor types, the
travel path and the Wi-Fi map. The 2D canvas above it holds what follows the
camera in screen space: room names, the robot, the last-seen mark and the
drawing tools. A browser without WebGL2, or one whose overlay programs do not
link, paints the same shapes on the 2D canvas.

A frame reads no layout: the resize observer caches the canvas size, and only
input measures the canvas, for its position. Matrices and overlay buffers are
reused; a layer is rebuilt and uploaded when its data changes, not when the
camera moves. A pointer that only moves the cursor mark redraws the 2D canvas
and leaves WebGL alone. A still map draws nothing.

## CI gate

`tests/browser/map_studio_v4_frame_cost.spec.mjs` runs in the Browser UI
workflow's Chromium project. How long a frame takes on a runner's software GL
says little about a phone, so the gate counts what a frame does, which is the
same on every machine, with every layer on, in the 3D and the top view.

| Per camera frame | Limit | Measured |
|---|---:|---:|
| Layout reads | 0 | 0 |
| Typed arrays created | 0 | 0 |
| Buffer and texture uploads | 0 | 0 |
| Shader and program calls | 0 | 0 |
| 2D canvas redraws | 1 | 1 |
| Draw calls | 37 | 37 |
| WebGL calls | 358 | 354 to 358 |
| Text measurements | 4 | 4 |
| Median script time | 8 ms | 0.5 ms |

The counts are limits on this fixture: a change that adds a draw call fails
until the limit is raised on purpose. Script time is the one measure that
varies by machine. Three runs in a loaded four-core container gave a median of
0.5 ms, a 95th percentile of 0.7 to 3.8 ms and a maximum of 4.8 ms; the 8 ms
ceiling, half a 60 Hz frame, is a proposal until the owner agrees a limit.

The same spec checks that a still map draws nothing, that a cursor move makes
no WebGL call, and that the frames of a 400,000-point upload redraw the 2D
canvas at most twice and read no layout.

## Auto quality

Auto thins the scene when camera frames arrive late. It times the interval
between animation frames, which includes the GPU, where script time does not.
Animation frames are aligned to the display's refresh, so the measure is the
mean interval over four frames ([frame-governor.ts](../frontend/map-studio-v4/frame-governor.ts)).

| Rule | Value |
|---|---|
| Slow sample, desktop | mean over 24 ms (under 42 frames a second) |
| Slow sample, touch | mean over 40 ms (under 25 frames a second) |
| Display slower than the limit | limit becomes 1.5 times its refresh |
| Reduce | two slow samples in a row: detail × 0.75, never under 0.25 |
| Recover | 30 samples in a row under 0.8 of the limit: detail + 0.25 |
| Undone recovery | the next waits twice as long, up to 16 times |
| Timed frames | those that move the camera |
| Small scenes | thinning never leaves under 50,000 points |

Only camera frames are timed because a still map's frames are slow from page
work that less detail does not buy back: opening the gallery in headless
Chromium measured 112 ms a frame on a 5,300-point scene. These values are
proposals. They are covered by `tests/node/frame_governor.test.mjs` and have
not been tuned on a device.

A reduction lasts until the camera has moved through enough on-time frames, so
a map that was slow to move stays thinned while it is still. Drawing a still
map at full detail is a separate change.

## Measuring a device

```sh
npm run build:map-studio-v4
node scripts/measure_frame_rate.mjs --host 0.0.0.0
```

Open the printed address in the browser under test; a phone on USB can use
`adb reverse tcp:<port> tcp:<port>` and the default host instead. The page
loads the built gallery with a deterministic 1.2 million point scene and every
layer, moves the camera for ten seconds in the 3D view and in the top view at
Auto detail, and reports the intervals between animation frames. Each run
prints one JSON line with the commit, browser, graphics adapter, canvas size
and, per view, frames a second, interval percentiles and the detail Auto ended
on. It contacts no Home Assistant, robot or external origin.

`node scripts/measure_android_latency.mjs` measures touch-to-present latency on
the same scene, on an Android device attached over USB.

## Container receipt

Headless Chromium 153 on SwiftShader (software GL), 920×680 canvas, device
pixel ratio 1, four cores shared with other work, two runs. This shows that
the path works. It is not a device frame rate.

| View | Frames a second | Interval p50, ms | Points drawn of 1,200,000 |
|---|---:|---:|---:|
| 3D | 0.9, 1.2 | 1,433, 717 | 600,000 |
| Top | 1.3, 2.1 | 783, 467 | 400,000, 300,000 |

## Open

- Frame rate on a supported phone and a reference desktop, with the command
  above. The 0.5 targets were 30 and 55 frames a second.
- The agreed limits: the script-time ceiling and the Auto values above.
- WebKit and Firefox run the frame-cost spec nowhere; the counts are the
  renderer's own calls and do not depend on the engine.
