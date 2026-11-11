import type { SceneModel } from "./backend-contracts";
import type { WifiSignalCell } from "./contracts";
import { pointInPolygon } from "./renderer-math";
import { WIFI_REACH_METERS, wifiConfidence, wifiKernel } from "./wifi-scale";

type Metadata = SceneModel["metadata"];

/** The estimate drawn over the floor, in map metres. */
export interface WifiSurface {
  /** The outer corner of texel (0, 0) and the side of a texel. */
  readonly x: number;
  readonly y: number;
  readonly texel: number;
  readonly width: number;
  readonly height: number;
  /**
   * Per texel, rows from the lowest y: the mean dBm times the opacity, then
   * the opacity. Premultiplied, so filtering between texels stays a weighted mean.
   */
  readonly values: Float32Array<ArrayBuffer>;
  /** Closed outlines around the dead band, as [x, y] pairs. */
  readonly deadZones: readonly (readonly (readonly [number, number])[])[];
}

export interface WifiReading {
  readonly dbm: number;
  readonly samples: number;
  readonly updatedAt: number;
}

const TEXEL_METERS = 0.1;
const MAX_TEXELS = 512;
const MAX_ALPHA = 0.75;
// The dead band is outlined only where readings carry this much weight.
const OUTLINE_WEIGHT = 0.25;
// Readings below this round down into the dead band.
const DEAD_EDGE = -80.5;

/**
 * Interpolates the cells once into a texture: each texel is the weighted mean
 * of the readings within reach in the same room, and its opacity follows
 * their total weight, so sparse, old and distant readings fade. Nothing is
 * drawn outside the room outlines; without rooms nothing is clipped.
 */
export const wifiSurface = (cells: readonly WifiSignalCell[], metadata: Metadata, nowSeconds: number): WifiSurface | null => {
  if (!cells.length) return null;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { x, y } of cells) {
    [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
  }
  // One texel of margin past the reach keeps the border uncovered for the outlines.
  const texel = Math.max(TEXEL_METERS, (Math.max(maxX - minX, maxY - minY) + 2 * WIFI_REACH_METERS) / (MAX_TEXELS - 2));
  const x0 = minX - WIFI_REACH_METERS - texel;
  const y0 = minY - WIFI_REACH_METERS - texel;
  const width = Math.ceil((maxX + WIFI_REACH_METERS + texel - x0) / texel);
  const height = Math.ceil((maxY + WIFI_REACH_METERS + texel - y0) / texel);
  const room = roomMask(metadata, x0, y0, texel, width, height);
  const weight = new Float32Array(width * height);
  const sum = new Float32Array(width * height);
  const reach = Math.ceil(WIFI_REACH_METERS / texel);
  for (const cell of cells) {
    const column = Math.floor((cell.x - x0) / texel);
    const row = Math.floor((cell.y - y0) / texel);
    // The reading's own room, not its texel's: a texel centre can lie across a wall.
    const home = roomAt(metadata, cell.x, cell.y);
    if (!home) continue;
    const confidence = wifiConfidence(cell, nowSeconds);
    for (let j = Math.max(0, row - reach); j <= Math.min(height - 1, row + reach); j += 1) {
      for (let i = Math.max(0, column - reach); i <= Math.min(width - 1, column + reach); i += 1) {
        const index = j * width + i;
        const k = room[index] === home
          ? wifiKernel(Math.hypot(x0 + (i + 0.5) * texel - cell.x, y0 + (j + 0.5) * texel - cell.y)) * confidence : 0;
        weight[index] = weight[index]! + k;
        sum[index] = sum[index]! + k * cell.dbm;
      }
    }
  }
  const values = new Float32Array(width * height * 2);
  // The mean where readings carry enough weight to outline; NaN elsewhere.
  const outlined = new Float32Array(width * height).fill(NaN);
  for (let index = 0; index < weight.length; index += 1) {
    if (!weight[index]) continue;
    const dbm = sum[index]! / weight[index]!;
    const alpha = Math.min(1, weight[index]!) * MAX_ALPHA;
    values.set([dbm * alpha, alpha], index * 2);
    if (weight[index]! >= OUTLINE_WEIGHT) outlined[index] = dbm;
  }
  const deadZones = outlines(outlined, width, height)
    .map((ring) => ring.map(([i, j]) => [x0 + (i + 0.5) * texel, y0 + (j + 0.5) * texel] as const));
  return { x: x0, y: y0, texel, width, height, values, deadZones };
};

/** The estimate at a map point, with the readings it rests on; null where nothing is in reach. */
export const wifiReadingAt = (cells: readonly WifiSignalCell[], metadata: Metadata, point: { readonly x: number; readonly y: number },
  nowSeconds: number): WifiReading | null => {
  const home = roomAt(metadata, point.x, point.y);
  if (!home) return null;
  let weight = 0, sum = 0, samples = 0, updatedAt = 0;
  for (const cell of cells) {
    const reach = wifiKernel(Math.hypot(cell.x - point.x, cell.y - point.y));
    if (!reach || roomAt(metadata, cell.x, cell.y) !== home) continue;
    const k = reach * wifiConfidence(cell, nowSeconds);
    weight += k;
    sum += k * cell.dbm;
    samples += cell.samples;
    updatedAt = Math.max(updatedAt, cell.updatedAt);
  }
  return weight ? { dbm: sum / weight, samples, updatedAt } : null;
};

/** The room at a map point, numbered as in the mask. */
const roomAt = ({ rooms, metersPerCell: meters, origin }: Metadata, x: number, y: number): number => rooms.length
  ? rooms.findIndex((room) => pointInPolygon(x / meters - origin[0], y / meters - origin[1], room.boundary)) + 1 : 1;

/** Each texel's room, numbered from 1; 0 is outside every room. The first room listed wins an overlap. */
const roomMask = (metadata: Metadata, x0: number, y0: number, texel: number, width: number, height: number): Uint16Array => {
  const mask = new Uint16Array(width * height);
  const { rooms, metersPerCell: meters, origin } = metadata;
  if (!rooms.length) return mask.fill(1);
  rooms.forEach((room, index) => {
    const ring = room.boundary.map(([x, y]) => [(x + origin[0]) * meters, (y + origin[1]) * meters] as const);
    const [low, high] = ring.reduce(([least, most], [, y]) => [Math.min(least, y), Math.max(most, y)], [Infinity, -Infinity]);
    const top = Math.min(height - 1, Math.floor((high - y0) / texel));
    for (let j = Math.max(0, Math.ceil((low - y0) / texel - 1)); j <= top; j += 1) {
      const y = y0 + (j + 0.5) * texel;
      const crossings: number[] = [];
      ring.forEach(([ax, ay], vertex) => {
        const [bx, by] = ring[(vertex + 1) % ring.length]!;
        if ((ay <= y) !== (by <= y)) crossings.push(ax + (y - ay) / (by - ay) * (bx - ax));
      });
      crossings.sort((a, b) => a - b);
      for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
        const first = Math.max(0, Math.ceil((crossings[pair]! - x0) / texel - 0.5));
        const last = Math.min(width - 1, Math.floor((crossings[pair + 1]! - x0) / texel - 0.5));
        for (let i = first; i <= last; i += 1) if (!mask[j * width + i]) mask[j * width + i] = index + 1;
      }
    }
  });
  return mask;
};

/**
 * Marching squares over texel centres: closed rings, in texel units, around
 * the texels below the dead edge. A crossing between two means sits where the
 * mean meets the edge, so the outline follows the colour boundary; next to a
 * NaN it sits halfway. Within a square each edge leaving the set joins the
 * previous edge entering it, so a saddle keeps its two corners apart.
 */
const outlines = (dbm: Float32Array, width: number, height: number): [number, number][][] => {
  // An edge key is its lower or left corner's index, doubled, plus 1 for a vertical edge.
  const next = new Map<number, number>();
  for (let j = 0; j + 1 < height; j += 1) {
    for (let i = 0; i + 1 < width; i += 1) {
      const corners = [j * width + i, j * width + i + 1, (j + 1) * width + i + 1, (j + 1) * width + i];
      const set = corners.map((index) => dbm[index]! < DEAD_EDGE);
      if (set.every((value) => value === set[0])) continue;
      const edges = [corners[0]! * 2, corners[1]! * 2 + 1, corners[3]! * 2, corners[0]! * 2 + 1];
      for (let k = 0; k < 4; k += 1) {
        if (!set[k] || set[(k + 1) % 4]) continue;
        for (let back = 1; back < 4; back += 1) {
          const m = (k - back + 4) % 4;
          if (!set[m] && set[(m + 1) % 4]) {
            next.set(edges[k]!, edges[m]!);
            break;
          }
        }
      }
    }
  }
  const point = (key: number): [number, number] => {
    const corner = key >> 1;
    const [i, j] = [corner % width, Math.floor(corner / width)];
    const along = (DEAD_EDGE - dbm[corner]!) / (dbm[corner + (key & 1 ? width : 1)]! - dbm[corner]!);
    const t = Number.isNaN(along) ? 0.5 : along;
    return key & 1 ? [i, j + t] : [i + t, j];
  };
  const rings: [number, number][][] = [];
  for (const start of next.keys()) {
    const ring: [number, number][] = [];
    for (let key: number | undefined = start; key !== undefined && next.has(key);) {
      const following: number | undefined = next.get(key);
      next.delete(key);
      const [here, before, after] = [point(key), ring.at(-1), following === undefined ? undefined : point(following)];
      // Keep only the corners of a straight run.
      if (!before || !after || (here[0] - before[0]) * (after[1] - here[1]) !== (here[1] - before[1]) * (after[0] - here[0])) ring.push(here);
      key = following;
    }
    rings.push(ring);
  }
  return rings;
};
