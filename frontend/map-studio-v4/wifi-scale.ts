import type { WifiScale, WifiSignalCell } from "./contracts";

export interface WifiScaleBounds {
  readonly min: number;
  readonly max: number;
}

/** The range of averaged readings, without inventing values for unsampled space. */
export const wifiSampleBounds = (cells: readonly WifiSignalCell[]): WifiScaleBounds | null => {
  if (cells.length === 0) return null;
  let low = 0;
  let high = -120;
  for (const cell of cells) {
    low = Math.min(low, cell.dbm);
    high = Math.max(high, cell.dbm);
  }
  return { min: low, max: high };
};

/** Fixed signal scale, or a labeled comparison of the floor's sampled spots. */
export const wifiScaleBounds = (cells: readonly WifiSignalCell[], scale: WifiScale): WifiScaleBounds => {
  const sampled = scale === "relative" ? wifiSampleBounds(cells) : null;
  if (!sampled) return { min: -90, max: -35 };
  // Do not exaggerate a nearly uniform set of readings across the full ramp.
  const span = Math.max(5, sampled.max - sampled.min);
  const min = Math.max(-120, Math.min(-span, (sampled.max + sampled.min - span) / 2));
  return { min, max: min + span };
};

export const wifiSignalHue = (dbm: number, bounds: WifiScaleBounds): number =>
  Math.round(Math.min(1, Math.max(0, (dbm - bounds.min) / (bounds.max - bounds.min))) * 120);
