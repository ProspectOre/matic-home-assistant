import { readdir, readFile, writeFile } from "node:fs/promises";

const bundleDirectory = new URL(
  "../custom_components/matic_robot/map_studio_v4/",
  import.meta.url,
);
const bundlePath = new URL("index.js", bundleDirectory);
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

const normalizedWhitespace = source.replaceAll(
  literalWhitespaceClassTail,
  escapedWhitespaceClassTail,
);

const javascriptPaths = (await readdir(bundleDirectory, { recursive: true }))
  .filter((path) => path.endsWith(".js"))
  .sort();

// Some Home Assistant File Editor releases decode uploaded UTF-8 source as
// Latin-1 before saving it. Keep every distributable JavaScript asset byte-safe
// across that deployment path by escaping UI glyphs. JavaScript evaluates these
// escapes to the same strings at runtime.
for (const relativePath of javascriptPaths) {
  const path = new URL(relativePath, bundleDirectory);
  const contents =
    relativePath === "index.js"
      ? normalizedWhitespace
      : await readFile(path, "utf8");
  const asciiSafeSource = contents.replace(
    /[^\x00-\x7f]/gu,
    (character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0xffff
        ? `\\u${codePoint.toString(16).padStart(4, "0")}`
        : `\\u{${codePoint.toString(16)}}`;
    },
  );

  if (/[^\x00-\x7f]/u.test(asciiSafeSource)) {
    throw new Error(`${relativePath} still contains non-ASCII bytes`);
  }

  await writeFile(path, asciiSafeSource, "ascii");
}
