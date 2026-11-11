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
const pose = (x, y, heading = 0, mapSessionKey = "session-a") => ({
  position: [x, y], heading, mapSessionKey, source: "exact_pose", sceneRevision: 1, sceneEpoch: "epoch",
  floorCoherent: true, ageSeconds: 0,
});

test("the robot steps to each sample over the time between samples, then rests on it", () => {
  const motion = new PoseMotion();
  const first = pose(0, 0);
  motion.push(first, 0);
  // The first sample has nothing to step from.
  assert.equal(motion.at(0), first);
  assert.equal(motion.moving(0), false);
  const second = pose(0.5, 0.25, 0.4);
  motion.push(second, 100);
  assert.deepEqual(motion.at(100).position, [0, 0]);
  assert.deepEqual(motion.at(150).position, [0.25, 0.125]);
  assert.ok(Math.abs(motion.at(150).heading - 0.2) < 1e-9);
  assert.equal(motion.at(200), second);
  assert.equal(motion.moving(199), true);
  assert.equal(motion.moving(200), false);
  // A sample mid-step starts from where the robot is drawn.
  motion.push(pose(1, 0.25, 0.4), 250);
  motion.push(pose(1, 0.5, 0.4), 325);
  assert.deepEqual(motion.at(325).position, [0.75, 0.25]);
});

test("a slow robot steps for at most a second, and a jump or another map is not interpolated", () => {
  const motion = new PoseMotion();
  motion.push(pose(0, 0), 0);
  motion.push(pose(0.4, 0), 5_000);
  assert.deepEqual(motion.at(5_500).position, [0.2, 0]);
  const jump = pose(2, 0);
  motion.push(jump, 6_000);
  assert.equal(motion.at(6_000), jump);
  const remapped = pose(2.1, 0, 0, "session-b");
  motion.push(remapped, 6_100);
  assert.equal(motion.at(6_100), remapped);
});

test("the heading turns the short way across a half turn", () => {
  const motion = new PoseMotion();
  motion.push(pose(0, 0, 3), 0);
  motion.push(pose(0, 0, -3), 100);
  const heading = motion.at(150).heading;
  assert.ok(Math.abs(Math.abs(heading) - Math.PI) < 1e-9, `turned through zero to ${heading}`);
});

test("listeners hear new steps and a clear, not a sample where the robot already is", () => {
  const motion = new PoseMotion();
  let heard = 0;
  const stop = motion.subscribe(() => { heard += 1; });
  motion.push(pose(0, 0), 0);
  motion.push(pose(0, 0), 100);
  assert.equal(heard, 1);
  motion.push(pose(0.1, 0), 200);
  assert.equal(motion.at(250).position[0], 0.05);
  motion.clear();
  motion.clear();
  assert.equal(heard, 3);
  assert.equal(motion.at(250), null);
  stop();
  motion.push(pose(0, 0), 300);
  assert.equal(heard, 3);
});
