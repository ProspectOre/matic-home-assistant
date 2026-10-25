import assert from "node:assert/strict";
import test from "node:test";
import { compactJavaScript } from "../../scripts/compact_javascript.mjs";

const load = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("module compaction preserves exports, reflected names and protocol properties", async () => {
  const source = `
    export class Robot { run_id = "run-1"; state() { return this.run_id; } }
    export function label(robot) { return robot.state(); }
  `;
  const module = await load(await compactJavaScript(source));
  assert.equal(module.Robot.name, "Robot");
  assert.equal(module.label.name, "label");
  assert.equal(module.label(new module.Robot()), "run-1");
  assert.equal(new module.Robot().run_id, "run-1");
});

test("module compaction retains license pointers and ASCII-encodes text without changing values", async () => {
  const source = `export const label = "caf\u00e9";\n/*! Licenses: sample.js.LEGAL.txt */`;
  const compact = await compactJavaScript(source);
  assert.match(compact, /Licenses: sample\.js\.LEGAL\.txt/u);
  assert.doesNotMatch(compact, /[^\x00-\x7f]/u);
  assert.equal((await load(compact)).label, "caf\u00e9");
});

test("module compaction preserves tagged template whitespace and evaluation order", async () => {
  const source = `
    const values = [];
    const tag = (parts, value) => { values.push(value); return parts.raw.join("|"); };
    export const first = tag\`a  b\n c\${values.length}\`;
    export const second = tag\`d\${values.length}\`;
    export { values };
  `;
  const before = await load(source);
  const after = await load(await compactJavaScript(source));
  assert.equal(after.first, before.first);
  assert.equal(after.second, before.second);
  assert.deepEqual(after.values, before.values);
});
