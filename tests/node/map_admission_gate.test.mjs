import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { scheduleAfterMapAdmission } from "./map-admission-gate";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4/", import.meta.url)),
  },
  bundle: true, format: "esm", write: false, platform: "node", target: "node24",
});
const { scheduleAfterMapAdmission } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const state = (available = false, generation = 1, owner = "owner-a") => ({ activity: "cleaning", smartStop: null, map: { available }, generation, owner });
const makeStore = (initial) => {
  const listeners = new Set();
  return {
    value: initial,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    patch(value) { this.value = value; for (const listener of [...listeners]) listener(value); },
  };
};
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("map admission waits for two animation frames after map availability", async () => {
  const store = makeStore(state());
  const frames = [];
  const saved = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    let admitted = 0;
    scheduleAfterMapAdmission(store, (value) => value.activity === "cleaning", () => { admitted += 1; }, 2000);
    store.patch(state(true));
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.equal(frames.length, 1);
    assert.equal(admitted, 0);
    frames.shift()();
    assert.equal(admitted, 1);
    assert.equal(frames.length, 0);
  } finally {
    [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = saved;
  }
});

test("map admission falls back after the bounded timeout when frames never arrive", async () => {
  const store = makeStore(state());
  const saved = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    let admitted = 0;
    scheduleAfterMapAdmission(store, () => true, () => { admitted += 1; }, 5);
    store.patch(state());
    await tick(15);
    assert.equal(admitted, 1);
  } finally {
    [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = saved;
  }
});

test("map admission cancellation and inactive transitions retire frames and timeout", async () => {
  const store = makeStore(state());
  const frames = new Map();
  let nextFrame = 0;
  const saved = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.requestAnimationFrame = (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  try {
    let active = true;
    let admitted = 0;
    const cancel = scheduleAfterMapAdmission(store, () => active, () => { admitted += 1; }, 15);
    store.patch(state(true));
    assert.equal(frames.size, 1);
    cancel();
    assert.equal(frames.size, 0);
    await tick();
    assert.equal(admitted, 0);

    const resume = scheduleAfterMapAdmission(store, () => active, () => { admitted += 1; }, 15);
    store.patch(state(true, 2));
    active = false;
    store.patch(state(true, 2));
    assert.equal(frames.size, 0);
    active = true;
    store.patch(state(true, 2));
    assert.equal(frames.size, 1);
    const [id, first] = [...frames.entries()][0];
    frames.delete(id);
    first();
    const [secondId, second] = [...frames.entries()][0];
    frames.delete(secondId);
    second();
    assert.equal(admitted, 1);
    resume();
  } finally {
    [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = saved;
  }
});

test("map admission rejects frames from a retired generation and does not admit for a changed owner", () => {
  const store = makeStore(state());
  const frames = new Map();
  let nextFrame = 0;
  const saved = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.requestAnimationFrame = (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  let cancel;
  try {
    let admitted = 0;
    cancel = scheduleAfterMapAdmission(store, (value) => value.activity === "cleaning" && value.owner === "owner-a", () => { admitted += 1; }, 2000);
    store.patch(state(true, 1, "owner-a"));
    const [oldId, oldFrame] = [...frames.entries()][0];
    frames.delete(oldId);
    store.patch(state(true, 2, "owner-a"));
    oldFrame();
    assert.equal(admitted, 0);
    while (frames.size && admitted === 0) {
      const [id, callback] = [...frames.entries()].at(-1);
      frames.delete(id);
      callback();
    }
    assert.equal(admitted, 1);
  } finally {
    cancel?.();
    [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = saved;
  }
});

test("map admission retires its work when the captured owner changes", async () => {
  const store = makeStore(state());
  const frames = new Map();
  let nextFrame = 0;
  const saved = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.requestAnimationFrame = (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  let cancel;
  try {
    let admitted = 0;
    const owner = store.value.owner;
    cancel = scheduleAfterMapAdmission(store, (value) => value.owner === owner, () => { admitted += 1; }, 10);
    store.patch(state(true, 1, owner));
    assert.equal(frames.size, 1);
    store.patch(state(true, 1, "owner-b"));
    assert.equal(frames.size, 0);
    await tick(15);
    assert.equal(admitted, 0);
  } finally {
    cancel?.();
    [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = saved;
  }
});
