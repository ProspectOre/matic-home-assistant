import { ContractError, boundedString } from "./backend-contracts";
import type { WifiRoomSignal, WifiSignalCell, WifiSignalLayer } from "./contracts";

const MAX_CELLS = 4096;
const MAX_ROOMS = 256;

const finite = (value: unknown, min = -1e6, max = 1e6): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new ContractError("invalid-wifi-signal");
  }
  return value;
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object") throw new ContractError("invalid-wifi-signal");
  return value as Record<string, unknown>;
};

const count = (value: unknown): number => {
  const parsed = finite(value, 1, 2 ** 31 - 1);
  if (!Number.isInteger(parsed)) throw new ContractError("invalid-wifi-signal");
  return parsed;
};

/**
 * Parse the survey cells and room summaries for the current floor. Loaded
 * with the layer, off the startup path. The response carries no network names.
 */
export const parseWifiSignal = (value: unknown): WifiSignalLayer => {
  const root = record(value);
  const rooms = root.rooms ?? [];
  if (typeof root.enabled !== "boolean" || !Array.isArray(root.cells) || root.cells.length > MAX_CELLS
    || !Array.isArray(rooms) || rooms.length > MAX_ROOMS) {
    throw new ContractError("invalid-wifi-signal");
  }
  const cells = root.cells.map((candidate): WifiSignalCell => {
    const cell = record(candidate);
    return { x: finite(cell.x), y: finite(cell.y), dbm: finite(cell.dbm, -120, 0),
      samples: count(cell.samples), updatedAt: finite(cell.updated_at, 0, 1e11) };
  });
  const summaries = rooms.map((candidate): WifiRoomSignal => {
    const room = record(candidate);
    // Room names follow the floor plan's limit of 256 UTF-8 bytes.
    return { name: boundedString(room.name, 256, "invalid-wifi-signal", true), dbm: finite(room.dbm, -120, 0), weakest: finite(room.weakest, -120, 0), samples: count(room.samples) };
  }).sort((left, right) => left.dbm - right.dbm);
  return { status: "ready", surveying: root.enabled, cells, rooms: summaries };
};
