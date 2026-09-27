import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const production = resolve(root, "custom_components/matic_robot/map_studio_v4");
const review = resolve(root, "tests/browser/.generated/map-studio-v4-review");
// One compilation gives the review harness the exact same component chunks
// as the installed panel. Only the production entry's reachable graph ships.
const result = await build({
  absWorkingDir: root,
  entryPoints: {
    index: "frontend/map-studio-v4/index.ts",
    review: "frontend/map-studio-v4/review.ts",
  },
  bundle: true, format: "esm", target: "es2022", charset: "ascii", minify: true,
  splitting: true, legalComments: "eof", entryNames: "[name]", chunkNames: "chunks/[name]-[hash]",
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
  const destination = resolve(shipped.has(output.path) ? production : review, name);
  let contents = output.text;
  if (!shipped.has(output.path)) {
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
