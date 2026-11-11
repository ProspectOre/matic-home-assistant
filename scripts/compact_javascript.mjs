import { minify } from "terser";

// Preserve public properties, exported names, class names and legal links.
// Internal function names have already been minified by esbuild. Inlining is
// off: with the startup graph in one chunk it copies helper bodies into their
// call sites, about 12 KiB of them.
export async function compactJavaScript(source) {
  const result = await minify(source, {
    module: true, ecma: 2022, keep_classnames: true, keep_fnames: false,
    compress: { passes: 2, inline: false },
    format: { ascii_only: true, comments: /^!/u },
  });
  if (typeof result.code !== "string") throw new Error("JavaScript compaction produced no code");
  return result.code;
}
