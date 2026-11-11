import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { FrameGovernor } from "./frame-governor";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { FrameGovernor } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

// Draws the scene on `count` animation frames, each arriving the next of
// `intervals` ms after the one before, and returns the scale after each frame
// that changed it. A governor's first frame has no drawn frame before it.
const drawFrames = (governor, clock, intervals, count) => {
  const changes = [];
  for (let frame = 0; frame < count; frame += 1) {
    clock.time += [intervals].flat()[frame % [intervals].flat().length];
    if (governor.begin(clock.time, true)) changes.push([frame, governor.scale]);
    assert.equal(governor.end(clock.time, true, false), true, "a drawn frame needs the next one to time it");
  }
  return changes;
};

test("two slow samples in a row reduce detail and an on-time sample breaks the run", () => {
  const governor = new FrameGovernor(false);
  const clock = { time: 1_000 };
  assert.deepEqual(drawFrames(governor, clock, 34, 9), [[8, 0.75]]);
  assert.equal(governor.frameMs, 34);
  assert.deepEqual(drawFrames(governor, clock, [34, 34, 34, 34, 16, 16, 16, 16], 12), [],
    "slow, on time, slow: the on-time sample ends the run");
  assert.deepEqual(drawFrames(governor, clock, 34, 4), [[3, 0.5625]]);
});

test("frames that arrive on a refresh or one late are judged by their mean", () => {
  // 24 ms of work on a 60 Hz display never arrives 24 ms apart.
  const late = new FrameGovernor(false);
  assert.deepEqual(drawFrames(late, { time: 0 }, [16.7, 33.3, 33.3, 16.7], 9), [[8, 0.75]]);
  const governor = new FrameGovernor(false);
  const clock = { time: 0 };
  drawFrames(governor, clock, 34, 9);
  assert.deepEqual(drawFrames(governor, clock, [16.7, 16.7, 16.7, 33.3], 800), [],
    "one late frame in four neither reduces nor recovers");
  assert.equal(governor.scale, 0.75);
});

test("one long frame does not reduce detail", () => {
  const governor = new FrameGovernor(false);
  assert.deepEqual(drawFrames(governor, { time: 0 }, [16, 16, 16, 16, 16, 300, 16, 16], 400), []);
});

test("detail never drops below a quarter", () => {
  const governor = new FrameGovernor(false);
  drawFrames(governor, { time: 0 }, 50, 80);
  assert.equal(governor.scale, 0.25);
});

test("the stride thins a scene to the scale without leaving under 50,000 points", () => {
  const governor = new FrameGovernor(false);
  assert.equal(governor.stride(1_200_000), 1);
  drawFrames(governor, { time: 0 }, 34, 9);
  assert.equal(governor.scale, 0.75);
  assert.deepEqual([1_200_000, 100_000, 99_999, 5_300, 0].map((points) => governor.stride(points)), [2, 2, 1, 1, 1]);
  drawFrames(governor, { time: 1_000 }, 50, 80);
  assert.equal(governor.scale, 0.25);
  assert.deepEqual([1_200_000, 199_999].map((points) => governor.stride(points)), [4, 3]);
});

test("a touch device is slow under 25 frames a second, not under 42", () => {
  const touch = new FrameGovernor(true);
  assert.deepEqual(drawFrames(touch, { time: 0 }, 34, 40), [], "30 frames a second meets the touch target");
  assert.deepEqual(drawFrames(new FrameGovernor(true), { time: 0 }, 50, 9), [[8, 0.75]]);
});

test("a display that refreshes slower than the target does not count as slow frames", () => {
  const governor = new FrameGovernor(false);
  // One drawn frame, then two with nothing drawn: the second idle interval is the display's.
  governor.begin(0, true);
  assert.equal(governor.end(0, true, false), true);
  governor.begin(33.4, true);
  assert.equal(governor.end(33.4, false, true), true, "one more frame times the display");
  governor.begin(66.8, true);
  assert.equal(governor.end(66.8, false, true), false, "then the frames stop");
  const clock = { time: 1_000 };
  assert.deepEqual(drawFrames(governor, clock, 33.4, 40), []);
  assert.deepEqual(drawFrames(governor, clock, 67, 8), [[7, 0.75]], "frames the display did skip still count");
});

test("a frame that redraws only the 2D canvas is not timed as the display's interval", () => {
  const governor = new FrameGovernor(false);
  governor.begin(0, true);
  governor.end(0, true, false);
  governor.begin(16, true);
  assert.equal(governor.end(16, false, false), false);
});

test("detail recovers after 120 on-time frames and waits twice as long when that does not hold", () => {
  const governor = new FrameGovernor(false);
  const clock = { time: 0 };
  drawFrames(governor, clock, 34, 9);
  assert.equal(governor.scale, 0.75);
  assert.deepEqual(drawFrames(governor, clock, 16, 120), [[119, 1]]);
  assert.deepEqual(drawFrames(governor, clock, 34, 8), [[7, 0.75]]);
  assert.deepEqual(drawFrames(governor, clock, 16, 236), []);
  assert.deepEqual(drawFrames(governor, clock, 16, 4), [[3, 1]]);
  // That recovery held for a full wait, so the next reduction starts from the short wait again.
  drawFrames(governor, clock, 16, 240);
  drawFrames(governor, clock, 34, 8);
  assert.equal(governor.scale, 0.75);
  assert.deepEqual(drawFrames(governor, clock, 16, 120), [[119, 1]]);
});

test("a fixed quality is never governed, and a new setting starts over", () => {
  const governor = new FrameGovernor(false);
  governor.reset(0.65);
  for (let time = 0; time < 2_000; time += 100) {
    assert.equal(governor.begin(time, false), false);
    assert.equal(governor.end(time, true, false), false, "no extra frame is asked for");
  }
  assert.equal(governor.scale, 0.65);
  const clock = { time: 0 };
  drawFrames(governor, clock, 34, 5);
  governor.reset(1);
  assert.deepEqual(drawFrames(governor, clock, 34, 4), [], "the slow sample before the setting does not count");
  assert.equal(governor.scale, 1);
});

test("a pause drops the frame being timed", () => {
  const governor = new FrameGovernor(false);
  const clock = { time: 0 };
  drawFrames(governor, clock, 34, 3);
  governor.pause();
  clock.time += 60_000;
  drawFrames(governor, clock, 16, 3);
  assert.equal(governor.frameMs, 25, "the minute away was not a frame");
});
