import { ContractError } from "./backend-contracts";
import type { WifiSignalCell, WifiSignalLayer } from "./contracts";

const MAX_CELLS = 4096;

const finite = (value: unknown, min = -1e6, max = 1e6): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new ContractError("invalid-wifi-signal");
  }
  return value;
};

/**
 * Parse the survey cells for the current floor. Loaded with the layer, off the
 * startup path. The response carries no network names.
 */
export const parseWifiSignal = (value: unknown): WifiSignalLayer => {
  if (!value || typeof value !== "object") throw new ContractError("invalid-wifi-signal");
  const root = value as Record<string, unknown>;
  if (typeof root.enabled !== "boolean" || !Array.isArray(root.cells) || root.cells.length > MAX_CELLS) {
    throw new ContractError("invalid-wifi-signal");
  }
  const cells = root.cells.map((candidate): WifiSignalCell => {
    if (!candidate || typeof candidate !== "object") throw new ContractError("invalid-wifi-signal");
    const cell = candidate as Record<string, unknown>;
    return { x: finite(cell.x), y: finite(cell.y), dbm: finite(cell.dbm, -120, 0) };
  });
  return { status: "ready", surveying: root.enabled, cellSize: finite(root.cell_size, 0.05, 10), cells };
};
