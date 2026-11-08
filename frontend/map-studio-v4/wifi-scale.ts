import type { WifiScale, WifiSignalCell } from "./contracts";

export interface WifiScaleBounds {
  readonly min: number;
  readonly max: number;
}

/** Shared by the sampled-cell renderer and the signal legend. */
export const WIFI_COLOR_STOPS = [
  { offset: 0, color: "#AE527D" },
  { offset: 0.25, color: "#DF9C55" },
  { offset: 0.5, color: "#E5CF84" },
  { offset: 0.75, color: "#6FC1AA" },
  { offset: 1, color: "#2584A4" },
] as const;
const WIFI_RGB_STOPS = WIFI_COLOR_STOPS.map(({ offset, color }) => ({
  offset,
  rgb: [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)] as const,
}));

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

export const wifiSignalColor = (dbm: number, bounds: WifiScaleBounds): readonly [number, number, number] => {
  const ratio = Math.min(1, Math.max(0, (dbm - bounds.min) / (bounds.max - bounds.min)));
  const upperIndex = WIFI_RGB_STOPS.findIndex((stop) => stop.offset >= ratio);
  const upper = WIFI_RGB_STOPS[Math.max(1, upperIndex)]!;
  const lower = WIFI_RGB_STOPS[Math.max(0, upperIndex - 1)]!;
  const amount = (ratio - lower.offset) / (upper.offset - lower.offset);
  return lower.rgb.map((channel, index) => Math.round(channel + (upper.rgb[index]! - channel) * amount)) as [number, number, number];
};
