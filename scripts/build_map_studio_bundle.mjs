import { build } from "esbuild";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STAMP_FILE, hashSources } from "./source_stamp.mjs";
import { compactHtmlTemplates } from "./compact_html_templates.mjs";
import { materialIconImports, materialIconModules, isMaterialIconInput, writeMaterialIconLicense, MATERIAL_ICON_INPUTS } from "./material_icon_modules.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const production = resolve(root, "custom_components/matic_robot/map_studio_v4");
const review = resolve(root, "tests/browser/.generated/map-studio-v4-review");
const panel = "frontend/map-studio-v4/index.ts";
// The import() targets outside the startup graph, found by the first pass.
const lazyEntries = new Set();
// Developer notes stay beside their rules as CSS comments in the sources.
// esbuild keeps template text verbatim, so the build drops each comment that
// fills its own lines in a css`` template instead of shipping it. A comment
// sharing a line with CSS is left alone rather than risk joining two tokens.
// Whitespace the CSS grammar ignores (around braces, semicolons, commas and
// child combinators, after a colon, runs of spaces) goes too, as do the
// optional semicolon before a closing brace and a number's leading zero;
// quoted strings, url() and ${} interpolations (none nests braces) are kept
// as written.
const styleComments = {
  name: "style-comments",
  setup(compiler) {
    compiler.onLoad({ filter: /frontend[\\/]map-studio-v4(?:-review)?[\\/][^\\/]+\.ts$/ }, async ({ path }) => {
      const source = (lazyEntries.has(path) ? 'import "./index";' : "") + materialIconImports(await readFile(path, "utf8"));
      const contents = source.replace(/\bcss`[^`]*`/gu, (template) => template.replace(
        /\n[ \t]*\/\*(?:(?!\$\{)[\s\S])*?\*\/[ \t]*(?=\n)/gu, "",
      ).split(/("[^"\n]*"|'[^'\n]*'|url\([^)]*\)|\$\{[^}]*\})/u).map((part, index) => index % 2 ? part : part
        .replace(/\s*([{};,>])\s*/gu, "$1").replace(/;\}/gu, "}").replace(/([^\w.-])0\.(\d)/gu, "$1.$2").replace(/:\s+/gu, ":").replace(/\s+/gu, " ")).join(""));
      // Indentation inside template literals ships as text, though HTML and
      // CSS collapse it and the shader and worker sources ignore it; no
      // template here keeps whitespace (no <pre>, no white-space: pre).
      return { contents: compactHtmlTemplates(contents).replace(/\n[ \t]+/gu, "\n"), loader: "ts" };
    });
  },
};
// One compilation gives the review harness the exact same component chunks
// as the installed panel. Only the production entry's reachable graph ships.
const options = {
  plugins: [materialIconModules, styleComments],
  absWorkingDir: root,
  entryPoints: {
    index: panel,
    review: "frontend/map-studio-v4-review/review.ts",
    mockups: "frontend/map-studio-v4-review/mockups.ts",
    stage: "frontend/map-studio-v4-review/stage.ts",
  },
  bundle: true, format: "esm", target: "es2022", charset: "ascii", minify: true,
  splitting: true, legalComments: "linked", entryNames: "[name]", chunkNames: "chunks/[name]-[hash]",
  outdir: production, write: false, metafile: true,
};
// esbuild gives the modules shared by each distinct set of entries a chunk of
// their own, which split the startup graph into thirteen files that gzip
// compressed apart. A lazy chunk loads only after the panel, so a first pass
// finds the import() targets outside the startup graph and the second has each
// import the panel entry: every startup module is then shared by all entries
// and lands in one chunk.
const modules = (await build(options)).metafile.inputs;
const startup = new Set();
const reach = (path) => {
  if (startup.has(path)) return;
  startup.add(path);
  for (const dependency of modules[path].imports) {
    // esbuild lists an import it dropped, one of types only for example, as external.
    if (dependency.kind !== "dynamic-import" && !dependency.external) reach(dependency.path);
  }
};
reach(panel);
for (const { imports } of Object.values(modules)) {
  for (const { kind, path } of imports) {
    if (kind === "dynamic-import" && !startup.has(path)) lazyEntries.add(resolve(root, path));
  }
}
const result = await build(options);
const graph = new Map(Object.entries(result.metafile.outputs).map(([path, metadata]) => [resolve(root, path), metadata]));
const shipped = new Set();
function visit(path) {
  if (shipped.has(path)) return;
  const metadata = graph.get(path);
  if (!metadata) throw new Error(`Missing compiled asset: ${path}`);
  shipped.add(path);
  for (const dependency of metadata.imports) {
    if (!dependency.external) visit(resolve(root, dependency.path));
  }
}
visit(resolve(production, "index.js"));
// Blender owns assets/; rebuilding JavaScript must preserve its checked-in atlas.
for (const name of await readdir(production)) {
  if (name !== "assets") await rm(resolve(production, name), { recursive: true, force: true });
}
await rm(review, { recursive: true, force: true });
for (const output of result.outputFiles) {
  const name = relative(production, output.path);
  if (name.startsWith("..")) throw new Error("Compiled asset escaped its output directory");
  // esbuild's linked legal notices belong beside their owning JavaScript,
  // including notices for shared chunks used by the review harness.
  const owner = output.path.replace(/\.LEGAL\.txt$/u, "");
  const destination = resolve(shipped.has(owner) ? production : review, name);
  // Keep the notice link concise; the complete license text stays untouched.
  let contents = owner === output.path
    ? output.text.replace("/*! For license information please see ", "/*! Licenses: ")
    : output.text;
  if (!shipped.has(owner) && owner === output.path) {
    // The browser must use one module identity for shared production code,
    // even when both entries are loaded in the same audit page.
    for (const dependency of graph.get(output.path).imports) {
      const dependencyPath = resolve(root, dependency.path);
      if (dependency.external || !shipped.has(dependencyPath)) continue;
      const local = relative(dirname(output.path), dependencyPath);
      const specifier = local.startsWith(".") ? local : `./${local}`;
      contents = contents.replaceAll(JSON.stringify(specifier), JSON.stringify(`/map_studio_v4/${relative(production, dependencyPath)}`));
    }
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}
// Keep the complete canonical icon license beside the shipped modules.
await writeMaterialIconLicense(production);
// Records which sources this review bundle was compiled from, so the audit
// harness can refuse a bundle that no longer matches the working tree.
const inputs = [...new Set([...Object.keys(result.metafile.inputs).filter((path) => !isMaterialIconInput(path)),
  "scripts/build_map_studio_bundle.mjs", "scripts/compact_html_templates.mjs",
  "scripts/compact_javascript.mjs", "scripts/material_icon_modules.mjs",
  ...MATERIAL_ICON_INPUTS.map((path) => relative(root, path)),
  "scripts/normalize_map_studio_bundle.mjs", "scripts/source_stamp.mjs",
  "package.json", "package-lock.json",
  "custom_components/matic_robot/map_studio_v4/assets/robot-atlas.json",
  "custom_components/matic_robot/map_studio_v4/assets/robot-atlas.webp",
  "scripts/robot_model/build_robot.py",
])].sort();
await writeFile(
  resolve(review, STAMP_FILE),
  `${JSON.stringify({ inputs, sourceHash: await hashSources(root, inputs) }, null, 2)}\n`,
);
