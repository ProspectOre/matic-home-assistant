import { minify } from "terser";

// Preserve public properties, exported APIs, reflected names and legal links.
// The versioned whole-tree fingerprint includes these final module bytes.
export async function compactJavaScript(source) {
  const result = await minify(source, {
    module: true, ecma: 2022, keep_classnames: true, keep_fnames: true,
    format: { ascii_only: true, comments: /^!/u },
  });
  if (typeof result.code !== "string") throw new Error("JavaScript compaction produced no code");
  return result.code;
}
