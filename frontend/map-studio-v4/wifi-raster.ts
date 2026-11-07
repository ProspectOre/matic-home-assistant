import type { SceneFloorSupport } from "./backend-contracts";
import type { ProjectMeters } from "./renderer-layers";
import type { WifiScale, WifiSignalLayer } from "./contracts";
import { wifiScaleBounds, wifiSignalColor } from "./wifi-scale";

const MAX_RASTER_CELLS = 4 * 1024 * 1024;
const PATCH_SIDE = 64;
const MAX_CELL_FOOTPRINT_METERS = 1.2;
const MIN_CELL_FOOTPRINT_METERS = 0.05;
const NEIGHBOR_SUBDIVISIONS = 8;
const MAX_NEIGHBOR_CANDIDATE_CHECKS = 6_000_000;
const MAX_RASTER_WORK_CELLS = 6_000_000;

export interface WifiRaster {
  readonly canvas: HTMLCanvasElement;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly patches: readonly (readonly [number, number])[];
}

interface Bounds {
  readonly min: number;
  readonly max: number;
}

interface RasterSample {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly dbm: number;
  readonly footprintLeft: number;
  readonly footprintTop: number;
  readonly footprintWidth: number;
  readonly footprintHeight: number;
  readonly reachable: Uint8Array;
}

const reaches = (sample: RasterSample, x: number, y: number): boolean => {
  const localX = x - sample.footprintLeft;
  const localY = y - sample.footprintTop;
  return localX >= 0 && localY >= 0 && localX < sample.footprintWidth && localY < sample.footprintHeight
    && sample.reachable[localY * sample.footprintWidth + localX] === 1;
};

const cache = new WeakMap<WifiSignalLayer, WeakMap<SceneFloorSupport, Map<WifiScale, WifiRaster | null>>>();

const occupiedAt = (support: SceneFloorSupport, x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x >= support.spanCells[0] || y >= support.spanCells[1]) return false;
  const index = y * support.spanCells[0] + x;
  return Boolean(support.mask[index >>> 3]! & (1 << (index & 7)));
};

// Keep interpolation local and conservative: if a wall or unsupported pixel
// lies between two measurements, do not blend their colors across it.
const connectedAlongFloor = (
  support: SceneFloorSupport,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean => {
  let x = fromX;
  let y = fromY;
  const dx = Math.abs(toX - fromX);
  const sx = fromX < toX ? 1 : -1;
  const dy = -Math.abs(toY - fromY);
  const sy = fromY < toY ? 1 : -1;
  let error = dx + dy;
  while (true) {
    if (!occupiedAt(support, x, y)) return false;
    if (x === toX && y === toY) return true;
    const twiceError = 2 * error;
    const stepX = twiceError >= dy;
    const stepY = twiceError <= dx;
    // A diagonal line touches both corner-adjacent cells. Require both to be
    // floor so a pair of readings cannot interpolate through a wall corner.
    if (stepX && stepY && (!occupiedAt(support, x + sx, y) || !occupiedAt(support, x, y + sy))) return false;
    if (stepX) {
      error += dy;
      x += sx;
    }
    if (stepY) {
      error += dx;
      y += sy;
    }
  }
};

export const buildWifiRaster = (
  layer: WifiSignalLayer,
  support: SceneFloorSupport,
  scale: WifiScale,
): WifiRaster | null => {
  let bySupport = cache.get(layer);
  if (!bySupport) {
    bySupport = new WeakMap();
    cache.set(layer, bySupport);
  }
  let byScale = bySupport.get(support);
  if (!byScale) {
    byScale = new Map();
    bySupport.set(support, byScale);
  }
  if (byScale.has(scale)) return byScale.get(scale)!;

  const metersPerCell = support.metersPerCell;
  const grouped = new Map<string, { x: number; y: number; size: number; dbmSum: number; count: number }>();
  for (const cell of layer.cells) {
    const x = cell.x / metersPerCell - support.originCells[0] - 0.5;
    const y = cell.y / metersPerCell - support.originCells[1] - 0.5;
    const size = Math.min(MAX_CELL_FOOTPRINT_METERS, cell.size) / metersPerCell;
    const centerX = Math.floor(x + 0.5);
    const centerY = Math.floor(y + 0.5);
    if (!occupiedAt(support, centerX, centerY)) continue;
    const key = `${centerX}:${centerY}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.dbmSum += cell.dbm;
      existing.count += 1;
      existing.size = Math.max(existing.size, size);
    } else grouped.set(key, { x, y, size, dbmSum: cell.dbm, count: 1 });
  }
  // Collapse repeated observations in a floor bin before allocating neighbor
  // work. This bounds duplicate-heavy surveys by distinct map cells.
  const samples = [...grouped.values()]
    .map(({ x, y, size, dbmSum, count }) => ({ x, y, size, dbm: dbmSum / count }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.size - b.size || a.dbm - b.dbm);
  if (!samples.length) {
    byScale.set(scale, null);
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sample of samples) {
    minX = Math.min(minX, sample.x - sample.size / 2);
    minY = Math.min(minY, sample.y - sample.size / 2);
    maxX = Math.max(maxX, sample.x + sample.size / 2);
    maxY = Math.max(maxY, sample.y + sample.size / 2);
  }
  const left = Math.max(0, Math.floor(minX));
  const top = Math.max(0, Math.floor(minY));
  const right = Math.min(support.spanCells[0], Math.ceil(maxX));
  const bottom = Math.min(support.spanCells[1], Math.ceil(maxY));
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1 || width * height > MAX_RASTER_CELLS) {
    byScale.set(scale, null);
    return null;
  }

  const weightedSignal = new Float32Array(width * height);
  const weights = new Float32Array(width * height);
  const patches = new Set<number>();
  const work = samples.reduce((sum, sample) => sum + (Math.ceil(sample.size) + 2) ** 2, 0);
  if (work > MAX_RASTER_WORK_CELLS) {
    // Large overlapping surveys use one floor-constrained flood fill. Reserve
    // every measured center first, then assign each pixel once within its
    // owner's original footprint. This keeps the readings and wall clipping
    // with bounded memory/work, at the cost of neighbor color blending.
    const owners = new Int32Array(width * height);
    const queue = new Int32Array(width * height);
    let read = 0;
    let write = 0;
    for (const [sampleIndex, sample] of samples.entries()) {
      const x = Math.round(sample.x) - left;
      const y = Math.round(sample.y) - top;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = y * width + x;
      owners[index] = sampleIndex + 1;
      queue[write++] = index;
    }
    while (read < write) {
      const index = queue[read++]!;
      const owner = owners[index]!;
      const sample = samples[owner - 1]!;
      const x = index % width;
      const y = Math.floor(index / width);
      weightedSignal[index] = sample.dbm;
      weights[index] = 1;
      patches.add(Math.floor(y / PATCH_SIDE) * Math.ceil(width / PATCH_SIDE) + Math.floor(x / PATCH_SIDE));
      const visit = (nextX: number, nextY: number): void => {
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) return;
        const next = nextY * width + nextX;
        if (owners[next] || Math.abs(nextX + left - sample.x) > sample.size / 2
          || Math.abs(nextY + top - sample.y) > sample.size / 2
          || !occupiedAt(support, nextX + left, nextY + top)) return;
        owners[next] = owner;
        queue[write++] = next;
      };
      visit(x - 1, y);
      visit(x + 1, y);
      visit(x, y - 1);
      visit(x, y + 1);
    }
  } else {
    const rasterSamples: RasterSample[] = samples.map((sample) => {
      const halfSize = sample.size / 2;
      const footprintLeft = Math.max(left, Math.ceil(sample.x - halfSize));
      const footprintTop = Math.max(top, Math.ceil(sample.y - halfSize));
      const footprintRight = Math.min(right - 1, Math.floor(sample.x + halfSize));
      const footprintBottom = Math.min(bottom - 1, Math.floor(sample.y + halfSize));
      const footprintWidth = Math.max(0, footprintRight - footprintLeft + 1);
      const footprintHeight = Math.max(0, footprintBottom - footprintTop + 1);
      const reachable = new Uint8Array(footprintWidth * footprintHeight);
      const queue = new Int32Array(reachable.length);
      const startX = Math.round(sample.x);
      const startY = Math.round(sample.y);
      const startLocalX = startX - footprintLeft;
      const startLocalY = startY - footprintTop;
      if (startLocalX >= 0 && startLocalY >= 0 && startLocalX < footprintWidth && startLocalY < footprintHeight
        && occupiedAt(support, startX, startY)) {
        let read = 0;
        let write = 0;
        const start = startLocalY * footprintWidth + startLocalX;
        reachable[start] = 1;
        queue[write++] = start;
        const visit = (nextX: number, nextY: number): void => {
          if (nextX < 0 || nextY < 0 || nextX >= footprintWidth || nextY >= footprintHeight) return;
          const next = nextY * footprintWidth + nextX;
          if (reachable[next] || !occupiedAt(support, footprintLeft + nextX, footprintTop + nextY)) return;
          reachable[next] = 1;
          queue[write++] = next;
        };
        while (read < write) {
          const current = queue[read++]!;
          const localX = current % footprintWidth;
          const localY = Math.floor(current / footprintWidth);
          visit(localX - 1, localY);
          visit(localX + 1, localY);
          visit(localX, localY - 1);
          visit(localX, localY + 1);
        }
      }
      return { ...sample, footprintLeft, footprintTop, footprintWidth, footprintHeight, reachable };
    });
    const neighborBinSide = Math.max(1, Math.ceil((MAX_CELL_FOOTPRINT_METERS / metersPerCell) * 2 + 2));
    // Keep a spatially distributed set of neighbor candidates for each footprint
    // class. A legacy coarse reading therefore cannot evict a dense set of newer
    // one-foot readings from the same large lookup bin.
    const bins = new Map<string, Map<number, Map<number, number>>>();
    const candidateDistanceToSlot = (index: number, binX: number, binY: number, slot: number): number => {
      const sample = samples[index]!;
      const slotX = slot % NEIGHBOR_SUBDIVISIONS;
      const slotY = Math.floor(slot / NEIGHBOR_SUBDIVISIONS);
      const targetX = binX * neighborBinSide
        + (slotX + 0.5) * neighborBinSide / NEIGHBOR_SUBDIVISIONS;
      const targetY = binY * neighborBinSide
        + (slotY + 0.5) * neighborBinSide / NEIGHBOR_SUBDIVISIONS;
      return (sample.x - targetX) ** 2 + (sample.y - targetY) ** 2;
    };
    const shouldReplaceRepresentative = (
      candidateIndex: number,
      existingIndex: number,
      binX: number,
      binY: number,
      slot: number,
    ): boolean => {
      const candidateDistance = candidateDistanceToSlot(candidateIndex, binX, binY, slot);
      const existingDistance = candidateDistanceToSlot(existingIndex, binX, binY, slot);
      if (candidateDistance !== existingDistance) return candidateDistance < existingDistance;
      const candidate = samples[candidateIndex]!;
      const existing = samples[existingIndex]!;
      return candidate.y < existing.y || (candidate.y === existing.y && candidate.x < existing.x);
    };
    for (const [index, sample] of samples.entries()) {
      const bx = Math.floor(sample.x / neighborBinSide);
      const by = Math.floor(sample.y / neighborBinSide);
      const key = `${bx}:${by}`;
      let resolutionBins = bins.get(key);
      if (!resolutionBins) {
        resolutionBins = new Map();
        bins.set(key, resolutionBins);
      }
      const footprintMeters = sample.size * metersPerCell;
      const resolutionClass = Math.min(
        Math.floor(Math.log2(footprintMeters / MIN_CELL_FOOTPRINT_METERS)),
        Math.ceil(Math.log2(MAX_CELL_FOOTPRINT_METERS / MIN_CELL_FOOTPRINT_METERS)),
      );
      let representatives = resolutionBins.get(resolutionClass);
      if (!representatives) {
        representatives = new Map();
        resolutionBins.set(resolutionClass, representatives);
      }
      const localX = sample.x - bx * neighborBinSide;
      const localY = sample.y - by * neighborBinSide;
      const slotX = Math.min(
        NEIGHBOR_SUBDIVISIONS - 1,
        Math.floor(localX / neighborBinSide * NEIGHBOR_SUBDIVISIONS),
      );
      const slotY = Math.min(
        NEIGHBOR_SUBDIVISIONS - 1,
        Math.floor(localY / neighborBinSide * NEIGHBOR_SUBDIVISIONS),
      );
      const slot = slotY * NEIGHBOR_SUBDIVISIONS + slotX;
      const existing = representatives.get(slot);
      if (existing === undefined
        || shouldReplaceRepresentative(index, existing, bx, by, slot)) {
        representatives.set(slot, index);
      }
    }
    const neighborCandidates = (key: string): Iterable<number> => {
      const resolutionBins = bins.get(key);
      return resolutionBins
        ? [...resolutionBins.values()].flatMap((representatives) => [...representatives.values()])
        : [];
    };
    const neighborLists: number[][] = [];
    let candidateChecks = 0;
    let candidateBudgetExceeded = false;
    neighborSearch: for (const [index, sample] of samples.entries()) {
      const bx = Math.floor(sample.x / neighborBinSide);
      const by = Math.floor(sample.y / neighborBinSide);
      const candidates: { index: number; distance: number }[] = [];
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        for (const other of neighborCandidates(`${bx + dx}:${by + dy}`)) {
          if (++candidateChecks > MAX_NEIGHBOR_CANDIDATE_CHECKS) {
            candidateBudgetExceeded = true;
            break neighborSearch;
          }
          if (index === other) continue;
          const candidate = samples[other]!;
          const reach = (sample.size + candidate.size) / 2 + 1;
          if (Math.abs(sample.x - candidate.x) > reach || Math.abs(sample.y - candidate.y) > reach) continue;
          if (!connectedAlongFloor(support, Math.round(sample.x), Math.round(sample.y), Math.round(candidate.x), Math.round(candidate.y))) continue;
          const distance = Math.hypot(sample.x - candidate.x, sample.y - candidate.y);
          if (candidates.length < 12) candidates.push({ index: other, distance });
          else {
            let farthest = 0;
            for (let at = 1; at < candidates.length; at += 1) if (candidates[at]!.distance > candidates[farthest]!.distance) farthest = at;
            if (distance < candidates[farthest]!.distance) candidates[farthest] = { index: other, distance };
          }
        }
      }
      neighborLists.push(candidates.sort((a, b) => a.distance - b.distance || a.index - b.index).map((item) => item.index));
    }
    // Extremely dense, large surveys still retain each sample's own coverage.
    // Drop only neighbor blending once its bounded search budget is spent.
    const neighbours = candidateBudgetExceeded ? samples.map(() => []) : neighborLists;
    for (const [sampleIndex, sample] of rasterSamples.entries()) {
      const minX = sample.footprintLeft;
      const maxX = sample.footprintLeft + sample.footprintWidth - 1;
      const minY = sample.footprintTop;
      const maxY = sample.footprintTop + sample.footprintHeight - 1;
      const blend = [sampleIndex, ...(neighbours[sampleIndex] ?? [])];
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if (!reaches(sample, x, y)) continue;
          const index = (y - top) * width + x - left;
          for (const neighborIndex of blend) {
            const neighbor = rasterSamples[neighborIndex]!;
            const distanceMeters = Math.hypot(x - neighbor.x, y - neighbor.y) * metersPerCell;
            const influenceMeters = (sample.size + neighbor.size) / 2 * metersPerCell + metersPerCell;
            if (distanceMeters > influenceMeters) continue;
            const weight = 1 / (distanceMeters ** 2 + 0.15 ** 2);
            weightedSignal[index] = weightedSignal[index]! + neighbor.dbm * weight;
            weights[index] = weights[index]! + weight;
          }
          patches.add(Math.floor((y - top) / PATCH_SIDE) * Math.ceil(width / PATCH_SIDE)
            + Math.floor((x - left) / PATCH_SIDE));
        }
      }
    }
  }

  const bounds = wifiScaleBounds(layer.cells, scale) as Bounds;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    byScale.set(scale, null);
    return null;
  }
  const image = context.createImageData(width, height);
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index]!;
    if (weight <= 0) continue;
    const average = weightedSignal[index]! / weight;
    const [red, green, blue] = wifiSignalColor(average, bounds);
    const offset = index * 4;
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 166;
  }
  context.putImageData(image, 0, 0);
  const columns = Math.ceil(width / PATCH_SIDE);
  const raster: WifiRaster = {
    canvas,
    left,
    top,
    width,
    height,
    patches: [...patches].sort((a, b) => a - b).map((index) => [index % columns, Math.floor(index / columns)]),
  };
  byScale.set(scale, raster);
  return raster;
};

export const drawWifiRaster = (
  context: CanvasRenderingContext2D,
  raster: WifiRaster,
  support: SceneFloorSupport,
  project: ProjectMeters,
  perspective: boolean,
): void => {
  const cell = support.metersPerCell;
  const worldX = (raster.left + support.originCells[0]) * cell;
  const worldY = (raster.top + support.originCells[1]) * cell;
  const drawPatch = (x: number, y: number, width: number, height: number): void => {
    const x0 = worldX + x * cell;
    const y0 = worldY + y * cell;
    const topLeft = project(x0, y0, 0.1, false);
    const topRight = project(x0 + width * cell, y0, 0.1, false);
    const bottomLeft = project(x0, y0 + height * cell, 0.1, false);
    if (!topLeft || !topRight || !bottomLeft) return;
    const a = (topRight.x - topLeft.x) / width;
    const b = (topRight.y - topLeft.y) / width;
    const c = (bottomLeft.x - topLeft.x) / height;
    const d = (bottomLeft.y - topLeft.y) / height;
    const e = topLeft.x - a * x - c * y;
    const f = topLeft.y - b * x - d * y;
    const base = context.getTransform();
    context.save();
    context.setTransform(
      base.a * a + base.c * b,
      base.b * a + base.d * b,
      base.a * c + base.c * d,
      base.b * c + base.d * d,
      base.a * e + base.c * f + base.e,
      base.b * e + base.d * f + base.f,
    );
    // The source raster already contains support-mask alpha at map resolution.
    // Nearest sampling keeps exterior and wall pixels fully transparent after
    // projection instead of bleeding their neighbors across a masked edge.
    context.imageSmoothingEnabled = false;
    context.drawImage(raster.canvas, x, y, width, height, x, y, width, height);
    context.restore();
  };

  if (!perspective) {
    drawPatch(0, 0, raster.width, raster.height);
    return;
  }
  for (const [tileX, tileY] of raster.patches) {
    const x = tileX * PATCH_SIDE;
    const y = tileY * PATCH_SIDE;
    drawPatch(x, y, Math.min(PATCH_SIDE, raster.width - x), Math.min(PATCH_SIDE, raster.height - y));
  }
};
