import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as materialIcons from "@mdi/js";
import { build } from "esbuild";
import { materialIconImports, materialIconModules, isMaterialIconInput, writeMaterialIconLicense, MATERIAL_ICON_LICENSE_FILE, MATERIAL_ICON_INPUTS, MATERIAL_ICON_NOTICE } from "../../scripts/material_icon_modules.mjs";
import { hashSources } from "../../scripts/source_stamp.mjs";

const load = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const compile = async (source, extra = {}) => build({
  stdin: { contents: source, loader: "js" },
  bundle: true, format: "esm", write: false, plugins: [materialIconModules], ...extra,
});
const loadImports = async (source) => load((await compile(source)).outputFiles[0].text);

test("named aliases and multiline imports retain exact canonical geometry and the legal notice", async () => {
  const source = `import {
    mdiBrush as paint,
    mdiUndo,
  } from '@mdi/js';
  import { mdiContentCopy as copy } from "@mdi/js";
  export { paint, mdiUndo, copy };`;
  const transformed = materialIconImports(source);
  const icons = await loadImports(transformed);
  assert.deepEqual({ ...icons }, {
    copy: materialIcons.mdiContentCopy, mdiUndo: materialIcons.mdiUndo, paint: materialIcons.mdiBrush,
  });
  assert.ok(transformed.includes('import paint from "matic-icon:mdiBrush";'));
  assert.equal(materialIconImports(source), transformed);
});

test("comments, strings, templates, and other imports are unchanged", () => {
  const source = `/*! Keep this notice. */
  // import { mdiBrush } from "@mdi/js";
  const text = 'import { mdiUndo } from "@mdi/js";';
  const template = \`import { mdiEraser } from "@mdi/js";\`;
  import { html } from "lit";
  const arrow = "🗺️";
  export { text, template, arrow };`;
  assert.equal(materialIconImports(source), source);
});

for (const source of [
  'import icons from "@mdi/js";',
  'import * as icons from "@mdi/js";',
  'import "@mdi/js";',
  'import type { mdiBrush } from "@mdi/js";',
  'import { type mdiBrush } from "@mdi/js";',
]) {
  test(`rejects unsupported import: ${source}`, () => {
    assert.throws(() => materialIconImports(source), /require named value imports/u);
  });
}

test("unknown and non-string exports fail rather than inventing a path", () => {
  for (const name of ["mdiDoesNotExist", "default", "toString"]) {
    assert.throws(() => materialIconImports(`import { ${name} as icon } from "@mdi/js";`), /Unknown Material Design icon/u);
  }
});

test("the source stamp tracks canonical data, resolver metadata, and license changes", async () => {
  assert.match(MATERIAL_ICON_INPUTS[0], /@mdi\/js\/commonjs\/mdi\.js$/u);
  assert.match(MATERIAL_ICON_INPUTS[1], /@mdi\/js\/package\.json$/u);
  assert.match(MATERIAL_ICON_INPUTS[2], /@mdi\/js\/LICENSE$/u);
  const directory = await mkdtemp(join(tmpdir(), "matic-icon-stamp-"));
  try {
    const inputs = ["mdi.js", "package.json", "LICENSE"];
    for (let index = 0; index < inputs.length; index += 1) {
      await writeFile(join(directory, inputs[index]), await readFile(MATERIAL_ICON_INPUTS[index]));
    }
    const original = await hashSources(directory, inputs);
    for (const input of inputs) {
      const path = join(directory, input);
      const contents = await readFile(path);
      await writeFile(path, Buffer.concat([contents, Buffer.from("\nchanged\n")]));
      assert.notEqual(await hashSources(directory, inputs), original);
      await writeFile(path, contents);
    }
    assert.equal(await hashSources(directory, inputs), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("import bindings retain hoisting and the directive prologue", async () => {
  const transformed = materialIconImports(`"use strict";
    export const before = paint;
    import { mdiBrush as paint } from "@mdi/js";
    export const after = paint;`);
  assert.ok(transformed.startsWith('"use strict";'));
  const icons = await loadImports(transformed);
  assert.equal(icons.before, materialIcons.mdiBrush);
  assert.equal(icons.after, materialIcons.mdiBrush);
});

test("the emitted owning chunk retains its legal notice and exact geometry", async () => {
  const source = materialIconImports('import { mdiEraser } from "@mdi/js"; export const path = mdiEraser;');
  const result = await compile(source, { minify: true, legalComments: "linked", outfile: "icon-owner.js", metafile: true });
  const virtualInputs = Object.keys(result.metafile.inputs).filter(isMaterialIconInput);
  assert.deepEqual(virtualInputs, ["matic-material-icon:mdiEraser"]);
  const javascript = result.outputFiles.find((file) => file.path.endsWith("icon-owner.js"));
  const legal = result.outputFiles.find((file) => file.path.endsWith(".LEGAL.txt"));
  assert.ok(javascript);
  assert.ok(legal);
  assert.ok(legal.text.includes(MATERIAL_ICON_NOTICE));
  assert.match(javascript.text, /icon-owner\.js\.LEGAL\.txt/u);
  assert.equal((await load(javascript.text)).path, materialIcons.mdiEraser);
});


test("the shipped license artifact is byte-for-byte the stamped canonical license", async () => {
  const directory = await mkdtemp(join(tmpdir(), "matic-icon-license-"));
  try {
    await writeMaterialIconLicense(directory);
    assert.deepEqual(
      await readFile(join(directory, MATERIAL_ICON_LICENSE_FILE)),
      await readFile(MATERIAL_ICON_INPUTS[2]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
