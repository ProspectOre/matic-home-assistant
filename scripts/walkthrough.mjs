// The interface stage matrix (docs/testing.md#interface-stage): cell IDs,
// the hash that stages each cell, and a staging server for the CLI
// (scripts/stage_walkthrough.mjs) and the browser spec.
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { createGalleryServer } from "../tests/browser/gallery_server.mjs";

export const walkthrough = JSON.parse(readFileSync(new URL("./walkthrough_cells.json", import.meta.url), "utf8"));
export const STAGE_PATH = "/map-studio-v4-stage";
export const FRAME_PATH = "/map-studio-v4-stage-frame";

/** Every cell ID, row by row: R01-C01 … R13-C09. */
export const cellIds = () =>
  walkthrough.rows.flatMap((row) => walkthrough.columns.map((column) => `${row.id}-${column.id}`));

/** The row and column of a cell ID, or null. */
export function findCell(id) {
  const match = /^(R\d{2})-(C\d{2})$/u.exec(id ?? "");
  const row = match && walkthrough.rows.find((candidate) => candidate.id === match[1]);
  const column = match && walkthrough.columns.find((candidate) => candidate.id === match[2]);
  return row && column ? { row, column } : null;
}

/** A row's hash part: its steps, the first staged first. */
export const rowHash = (row) => `steps=${row.steps.join(",")}`;

/** The exact hash that stages a cell: its ID, its row part, its column part. */
export function cellHash(id) {
  const cell = findCell(id);
  if (!cell) throw new Error(`Unknown cell ${id}`);
  return `cell=${id}&${rowHash(cell.row)}&${cell.column.hash}`;
}

export const cellUrl = (origin, id, path = STAGE_PATH) => `${origin}${path}#${cellHash(id)}`;

/** Supplement whole-page snapshots when shadow/display:contents controls are omitted. */
export async function accessibilityReadout(page) {
  const tree = await page.locator("body").ariaSnapshot();
  const lines = new Set(tree.split("\n").map((line) => line.trim()));
  const supplement = [];
  const controls = page.locator('button,input,select,textarea,a[href],[role="button"],[role="switch"],[role="checkbox"],[role="menuitem"],[role="slider"]');
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    const snapshot = await control.ariaSnapshot();
    const first = snapshot.split("\n")[0]?.trim();
    if (first && !lines.has(first)) supplement.push(snapshot);
  }
  return tree + (supplement.length
    ? `\n\nDirect control snapshots supplementing whole-page capture omissions:\n${supplement.join("\n")}`
    : "");
}

/** This computer's IPv4 addresses on its local networks. */
export const lanAddresses = () =>
  Object.values(networkInterfaces()).flat()
    .filter((address) => address && address.family === "IPv4" && !address.internal)
    .map((address) => address.address);

/**
 * Serves the built review bundle. Only this computer can reach it unless
 * `lan` is true; either way it stops serving when `close()` resolves.
 */
export async function startStaging({ lan = false, port = 4180 } = {}) {
  const server = createGalleryServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", resolve);
  });
  const bound = server.address().port;
  const hosts = ["127.0.0.1", ...(lan ? lanAddresses() : [])];
  return {
    server,
    port: bound,
    origins: hosts.map((host) => `http://${host}:${bound}`),
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
