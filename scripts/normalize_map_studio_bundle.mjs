import { readFile, writeFile } from "node:fs/promises";

const bundlePath = new URL(
  "../custom_components/matic_robot/map_studio_v4/index.js",
  import.meta.url,
);
const source = await readFile(bundlePath, "utf8");

// esbuild preserves the whitespace class used by Lit's template parser as a
// literal tab plus newline. Escape only that exact sequence so the generated
// bundle remains byte-for-byte equivalent at runtime and passes diff checks.
const literalWhitespaceClassTail = " \t\n\\f\\r";
const escapedWhitespaceClassTail = " \\t\\n\\f\\r";
const occurrences = source.split(literalWhitespaceClassTail).length - 1;
if (occurrences !== 2) {
  throw new Error(`Unexpected Lit whitespace-class count: ${occurrences}`);
}

await writeFile(
  bundlePath,
  source.replaceAll(literalWhitespaceClassTail, escapedWhitespaceClassTail),
);
