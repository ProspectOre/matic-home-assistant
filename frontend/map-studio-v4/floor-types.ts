import { ContractError } from "./backend-contracts";
import type { FloorTypeOutline, FloorTypesLayer } from "./contracts";

// The integration caps all outlines together at 40,000 points.
const MAX_POINTS = 40_000;

/**
 * Parse the current floor's carpet and vent outlines. Loaded with the layer,
 * off the startup path.
 */
export const parseFloorTypes = (value: unknown): FloorTypesLayer => {
  if (!value || typeof value !== "object") throw new ContractError("invalid-floor-types");
  const layers = (value as Record<string, unknown>).layers;
  if (!layers || typeof layers !== "object") throw new ContractError("invalid-floor-types");
  let points = 0;
  const outlines = (candidate: unknown): FloorTypeOutline[] => {
    if (!Array.isArray(candidate)) throw new ContractError("invalid-floor-types");
    return candidate.map((outline): FloorTypeOutline => {
      if (!Array.isArray(outline) || outline.length < 3) throw new ContractError("invalid-floor-types");
      points += outline.length;
      if (points > MAX_POINTS) throw new ContractError("invalid-floor-types");
      return outline.map((point): readonly [number, number] => {
        if (!Array.isArray(point) || point.length !== 2
          || !point.every((part) => typeof part === "number" && Number.isFinite(part) && Math.abs(part) <= 1e6)) {
          throw new ContractError("invalid-floor-types");
        }
        return [point[0] as number, point[1] as number];
      });
    });
  };
  const root = layers as Record<string, unknown>;
  return { status: "ready", carpet: outlines(root.carpet), vent: outlines(root.vent) };
};
