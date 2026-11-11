import type { WifiSignalCell } from "./contracts";
import type { Channel } from "./theme-probe";

export type WifiBand = "strong" | "good" | "weak" | "dead";

/**
 * Strongest first, each from its lowest whole dBm. Okabe and Ito's colours,
 * which stay apart under the common kinds of colour blindness.
 */
export const WIFI_BANDS: readonly { readonly band: WifiBand; readonly from: number; readonly colour: Channel }[] = [
  { band: "strong", from: -55, colour: [0, 114, 178] },
  { band: "good", from: -67, colour: [0, 158, 115] },
  { band: "weak", from: -80, colour: [230, 159, 0] },
  { band: "dead", from: -Infinity, colour: [213, 94, 0] },
];

/** The band of a reading as it is shown, in whole dBm. */
export const wifiBand = (dbm: number): (typeof WIFI_BANDS)[number] =>
  WIFI_BANDS.find(({ from }) => Math.round(dbm) >= from)!;

/** How far from a reading the map estimates the signal. */
export const WIFI_REACH_METERS = 1.5;

/** A reading's weight at a distance: 1 on the cell, easing to 0 at the reach. */
export const wifiKernel = (distance: number): number =>
  distance >= WIFI_REACH_METERS ? 0 : (1 - (distance / WIFI_REACH_METERS) ** 2) ** 2;

const DAY_SECONDS = 86_400;

/**
 * How much a cell counts, from 0.1 to 1: a cell read once counts 0.4 and one
 * read five times or more counts fully; the weight halves every 30 days
 * since its newest reading, down to a quarter.
 */
export const wifiConfidence = (cell: WifiSignalCell, nowSeconds: number): number =>
  (0.4 + 0.6 * Math.min(1, (cell.samples - 1) / 4))
  * Math.max(0.25, 0.5 ** (Math.max(0, nowSeconds - cell.updatedAt) / DAY_SECONDS / 30));
