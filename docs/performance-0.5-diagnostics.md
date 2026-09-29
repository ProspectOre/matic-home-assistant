# RC9 controlled performance follow-up

These September 29 measurements use RC9 production bundle
`fea378f99e6dbc3c046e69392b877a345c0ad281904ea1d91f222198c0918480`
and the identical synthetic scene recorded in [performance-0.5.md](performance-0.5.md).
No production code changed to obtain these results. Reports and raw traces remain local.
The [acceptance ledger](acceptance-0.5.md) retains release gates separately.

## Untraced visible-window comparison

At 12:55 p.m. PDT, the existing paired harness ran Chromium 151.0.7922.34 on
Apple M4/macOS arm64, 10 logical CPUs, 1280×900, DPR 1, unthrottled loopback,
fresh contexts/no-store assets, AB/BA/AB order and 100 inputs per sample.
Both bundles and all six scene fingerprints matched the earlier receipt.

| Measure, three samples | v0.4.5 control | RC9 |
|---|---:|---:|
| Input p95 estimate, ms | 56 / 56 / 56 | 56 / 56 / 56 |
| Input maximum estimate, ms | 56 / 56 / 56 | 552 / 72 / 56 |
| Long Tasks over 50 ms | 0 / 0 / 0 | 0 / 0 / 0 |

RC9's 82,736 initial and 11,854 lazy estimated gzip bytes meet the 90/30 KiB
budgets. All six samples meet the input p95 threshold; no timing improvement
over the control is claimed. The 552 ms maximum remains unexplained: that
receipt lacks event-level attribution. Zero Long Tasks does not explain it.
The collector filters event start times against a boundary set after warm-up;
inspection found no demonstrated warm-up inclusion bug. The old receipt lacks
the event ID/type and processing timestamps needed to reconstruct its cause.
The earlier headless 2/0/0 Long Tasks and 111 ms maximum remain evidence.
Neither mode establishes mobile, field, transport, or sustained resource bounds.

## Minimal compositor controls

Separate controls used ten seconds idle followed by ten seconds animation.
The WebGL control matched renderer context options, including antialiasing,
depth, high-performance preference and preserveDrawingBuffer=false.

| Control | Observations |
|---|---|
| Headless blank CSS animation | 730 compositor commits; no ReadPixels, GPU waits, or Long Tasks |
| Headless bare WebGL idle | 746 commits; no ReadPixels |
| Headless bare WebGL drawing | 655 draws, 656 commits, 655 ReadPixels; one 63.38 ms renderer task containing a 57.50 ms ReadPixels wait |
| Same bare WebGL, headed drawing | 599 commits; no ReadPixels or renderer Long Tasks; renderer task maximum 0.39 ms |

This reproduces the headless wait path without application code. It supports
a compositor-path contribution; it does not prove every application stall is
a headless artifact or waive the main-thread budget. Earlier application traces
also localize long wall-time tasks to compositor/readback waits with short CPU work.

## Event-level follow-up

A separate headed candidate-only diagnostic labeled 104 action windows,
including four warm-up actions, with two additional page evaluations per action.
It retained 1,937 measured Event Timing entries and 100 interaction IDs.
Input p95/max were 48/56 ms, with no Long Tasks; the 552 ms outlier did not recur.
The longest event belonged to opening the room list: 0.6 ms input delay,
0.5 ms handler time, and 54.9 ms estimated presentation remainder.
That remainder is duration minus input delay/processing, not an exposed
presentation timestamp. See the [Event Timing specification](https://www.w3.org/TR/event-timing/).
Instrumentation changes the journey and this one sample does not qualify or
explain the earlier outlier. Host load differed and is retained in its receipt.

## Presented-frame diagnostic

Three headed, traced candidate-only ten-second canvas orbits used the same scene,
with a 920×680 WebGL2 canvas and 600 scheduled mouse moves per sample. Trace
markers bounded each stimulus; counters came from the compositor pipeline,
not rAF callbacks. All production and scene fingerprints matched.

| Sample | Complete tracker span, s | Expected frames | Dropped frames | macOS presentation feedback |
|---|---:|---:|---:|---:|
| 1 | 10.044 | 592 | 1 | 624 |
| 2 | 10.029 | 603 | 0 | 604 |
| 3 | 10.030 | 604 | 0 | 602 |

The complete CanvasAnimation intervals reported zero missing-content and
checkerboard frames. V3/V4 dropped counts agree; they describe the same frame
and are not added. The first sample excludes a 0.35-second unfinished tracker
tail. Feedback counts cover the full marker spans of 10.397/10.055/10.030 s,
roughly 60 events/s; their scope differs from the completed tracker intervals.
Expected frames describe opportunities, not directly observed physical frames.
The first sample's feedback interval median/p95 were 16.665/17.501 ms.

Chromium defines V4-produced frames as expected minus V4-dropped frames in its
[tracker tests](https://chromium.googlesource.com/chromium/src/%2B/HEAD/cc/metrics/frame_sequence_tracker_unittest.cc).
That derived count divided by complete tracker duration gives 58.84/60.13/60.22
produced frames/s. All three meet ≥55 for this synthetic M4 orbit workload.
This is a scoped traced frame measurement, not an untraced input qualification.

These are browser presentation estimates. macOS feedback may use estimated
timestamps, and submissions, feedback events and tracker frames are distinct
counters. See Chromium's [frame lifecycle](https://chromium.googlesource.com/chromium/src.git/%2B/main/docs/life_of_a_frame.md)
and [frame metrics implementation](https://chromium.googlesource.com/chromium/src/%2B/HEAD/cc/metrics/frame_sequence_metrics.cc).
Tracing adds overhead; these short intervals do not establish sustained
desktop/mobile FPS, GPU stability, or physical scanout. They support responsive
rendering for this exact desktop/orbit workload; the reference FPS qualification
method, mobile input, retention/resource bounds and live transport budgets remain open.
