import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// The review bundle's source stamp: the bundle build writes `source-stamp.json`
// beside the review bundle, naming every esbuild input and the hash of their
// contents. The audit harness recomputes the hash over the same inputs before it
// captures anything, so screenshots can never be stamped with a head whose
// sources the gitignored bundle does not reflect.
export const STAMP_FILE = "source-stamp.json";

export async function hashSources(root, inputs) {
  const hash = createHash("sha256");
  for (const input of [...inputs].sort()) {
    hash.update(input);
    hash.update("\0");
    hash.update(await readFile(resolve(root, input)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
