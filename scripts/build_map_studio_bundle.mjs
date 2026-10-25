import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STAMP_FILE, hashSources } from "./source_stamp.mjs";
import { compactHtmlTemplates } from "./compact_html_templates.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const production = resolve(root, "custom_components/matic_robot/map_studio_v4");
const review = resolve(root, "tests/browser/.generated/map-studio-v4-review");
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
    compiler.onLoad({ filter: /frontend[\\/]map-studio-v4[\\/][^\\/]+\.ts$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
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
const result = await build({
  plugins: [styleComments],
  absWorkingDir: root,
  entryPoints: {
    index: "frontend/map-studio-v4/index.ts",
    review: "frontend/map-studio-v4/review.ts",
    mockups: "frontend/map-studio-v4/mockups.ts",
    stage: "frontend/map-studio-v4/stage.ts",
  },
  bundle: true, format: "esm", target: "es2022", charset: "ascii", minify: true,
  splitting: true, legalComments: "linked", entryNames: "[name]", chunkNames: "chunks/[name]-[hash]",
  outdir: production, write: false, metafile: true,
});
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
await rm(production, { recursive: true, force: true });
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
// Records which sources this review bundle was compiled from, so the audit
// harness can refuse a bundle that no longer matches the working tree.
const inputs = [...new Set([...Object.keys(result.metafile.inputs),
  "scripts/build_map_studio_bundle.mjs", "scripts/compact_html_templates.mjs",
  "scripts/compact_javascript.mjs",
  "scripts/normalize_map_studio_bundle.mjs", "scripts/source_stamp.mjs",
  "package.json", "package-lock.json",
])].sort();
await writeFile(
  resolve(review, STAMP_FILE),
  `${JSON.stringify({ inputs, sourceHash: await hashSources(root, inputs) }, null, 2)}\n`,
);
