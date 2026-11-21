import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: { contents: 'export { PoseMotion } from "./pose-motion";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { PoseMotion } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const pose = (x, y, heading = 0, observedAt = null, mapSessionKey = "session-a") => ({
  position: [x, y], heading, mapSessionKey, source: "exact_pose", sceneRevision: 1, sceneEpoch: "epoch",
  floorCoherent: true, ageSeconds: 0, observedAt,
});
// Robot time in seconds for a sample taken `ms` after the start.
const robot = (ms) => 1_800_000_000 + ms / 1_000;
// Plays `motion` from `from` to `to` in 16 ms frames and returns each drawn x.
const play = (motion, from, to) => {
  const xs = [];
  for (let now = from; now <= to; now += 16) xs.push(motion.at(now).position[0]);
  return xs;
};

test("the robot moves at an even pace on the robot's clock however unevenly samples arrive", () => {
  const motion = new PoseMotion();
  // 0.3 m/s sampled every 100 ms on the robot; arrivals are 20 to 120 ms late.
  const lateness = [20, 120, 30, 110, 25, 90, 20, 120, 40, 100, 20, 120, 30];
  const xs = [];
  let now = 0;
  for (let sample = 0, frame = 0; frame < 140; frame += 1, now += 16) {
    while (sample < lateness.length && sample * 100 + lateness[sample] <= now) {
      motion.push(pose(sample * 0.03, 0, 0, robot(sample * 100)), now);
      sample += 1;
    }
    if (sample > 0) xs.push(motion.at(now).position[0]);
  }
  const steps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(steps.every((step) => step >= -1e-9), "never moves backwards");
  // Once playing, each 16 ms frame moves close to the 4.8 mm the robot did.
  const moving = steps.slice(20, 70);
  assert.ok(moving.every((step) => step > 0.0035 && step < 0.0065), `uneven steps ${moving.map((s) => s.toFixed(4))}`);
});

test("without robot times the arrival times pace the robot, and it rests on the newest sample", () => {
  const motion = new PoseMotion();
  const first = pose(0, 0);
  motion.push(first, 0);
  assert.equal(motion.at(0), first);
  assert.equal(motion.moving(), false);
  const second = pose(0.5, 0.25, 0.4);
  motion.push(second, 100);
  assert.equal(motion.moving(), true);
  const path = play(motion, 100, 400);
  assert.ok(path.every((x, i) => i === 0 || x >= path[i - 1]), "never moves backwards");
  assert.equal(motion.at(1_000), second);
  assert.equal(motion.moving(), false);
  // The same pose again is not a new sample.
  motion.push(pose(0.5, 0.25, 0.4), 1_100);
  assert.equal(motion.at(1_200), second);
});

test("a robot that waits starts its next step from rest and plays it whole", () => {
  const motion = new PoseMotion();
  motion.push(pose(0, 0, 0, robot(0)), 50);
  motion.at(2_000);
  motion.push(pose(0.3, 0, 0, robot(5_000)), 5_050);
  const xs = play(motion, 5_050, 6_200);
  assert.equal(xs[0], 0);
  assert.ok(xs[3] < 0.03, "eases out of rest");
  assert.ok(xs.slice(1).every((x, i) => x >= xs[i]));
  assert.equal(xs.at(-1), 0.3);
});

test("a jump, another map or a lost position is not interpolated", () => {
  const motion = new PoseMotion();
  motion.push(pose(0, 0, 0, robot(0)), 0);
  const jump = pose(2, 0, 0, robot(100));
  motion.push(jump, 100);
  assert.equal(motion.at(100), jump);
  const remapped = pose(2.1, 0, 0, robot(200), "session-b");
  motion.push(remapped, 200);
  assert.equal(motion.at(200), remapped);
  motion.push({ ...remapped, position: null, observedAt: robot(300) }, 300);
  assert.equal(motion.at(300), null);
});

test("an older or repeated robot sample changes nothing", () => {
  const motion = new PoseMotion();
  const newest = pose(0.1, 0, 0, robot(100));
  motion.push(pose(0, 0, 0, robot(0)), 0);
  motion.push(newest, 100);
  motion.push(pose(5, 0, 0, robot(50)), 150);
  motion.push(pose(0.05, 0, 0, robot(100)), 160);
  assert.equal(motion.at(10_000), newest);
});

test("the heading turns the short way across a half turn", () => {
  const motion = new PoseMotion();
  motion.push(pose(0, 0, 3, robot(0)), 0);
  motion.push(pose(0, 0, -3, robot(100)), 100);
  for (const now of [150, 200, 250, 300]) {
    const heading = motion.at(now).heading;
    assert.ok(Math.abs(heading) > 2.99, `turned through zero to ${heading}`);
  }
});

test("a stop does not overshoot the robot past where it stopped", () => {
  const motion = new PoseMotion();
  for (let i = 0; i <= 5; i += 1) motion.push(pose(i * 0.03, 0, 0, robot(i * 100)), i * 100 + 10);
  motion.push(pose(0.15, 0, 0, robot(600)), 610);
  motion.push(pose(0.15, 0, 0, robot(700)), 710);
  const xs = play(motion, 610, 2_000);
  assert.ok(Math.max(...xs) <= 0.15 + 1e-9, `overshot to ${Math.max(...xs)}`);
});

test("listeners hear new positions and a clear, not a sample where the robot already is", () => {
  const motion = new PoseMotion();
  let heard = 0;
  const stop = motion.subscribe(() => { heard += 1; });
  motion.push(pose(0, 0, 0, robot(0)), 0);
  motion.push(pose(0, 0, 0, robot(100)), 100);
  assert.equal(heard, 1);
  motion.push(pose(0.1, 0, 0, robot(200)), 200);
  assert.equal(heard, 2);
  motion.clear();
  motion.clear();
  assert.equal(heard, 3);
  assert.equal(motion.at(250), null);
  stop();
  motion.push(pose(0, 0), 300);
  assert.equal(heard, 3);
});
