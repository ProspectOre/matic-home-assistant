import { SCENE_HEADER_BYTES, SCENE_MAX_BYTES, type HistoryComparisonFrame, type HistorySnapshot, type SceneComparisonCoverage, type SceneModel } from "./backend-contracts";

const MAX_COVERAGE_CELLS = 4 * 1024 * 1024;
const MAX_COVERAGE_MASK_BYTES = 384 * 1024;

const comparisonCoverage = (
  value: unknown,
  origin: readonly [number, number],
  metersPerCell: number,
  span: readonly [number, number],
): SceneComparisonCoverage | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const rawOrigin = raw.origin_cells;
  const rawSpan = raw.span_cells;
  const cells = span[0] * span[1];
  const encodedMask = raw.mask_zlib_base64;
  if (raw.version !== 1 || raw.status !== "verified" || raw.encoding !== "zlib-bitset-little-v1"
    || raw.diff_eligible !== true || !Array.isArray(rawOrigin) || rawOrigin.length !== 2
    || !Array.isArray(rawSpan) || rawSpan.length !== 2
    || !origin.every(Number.isSafeInteger) || !span.every((value) => Number.isSafeInteger(value) && value >= 1 && value <= 65_536)
    || rawOrigin[0] !== origin[0] || rawOrigin[1] !== origin[1]
    || rawSpan[0] !== span[0] || rawSpan[1] !== span[1]
    || raw.meters_per_cell !== metersPerCell || !Number.isSafeInteger(cells) || cells > MAX_COVERAGE_CELLS
    || !Number.isSafeInteger(raw.observed_cells) || Number(raw.observed_cells) < 1
    || Number(raw.observed_cells) > cells
    || typeof raw.mask_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(raw.mask_sha256)
    || typeof encodedMask !== "string" || encodedMask.length === 0 || encodedMask.length % 4 !== 0
    || encodedMask.length > Math.ceil(MAX_COVERAGE_MASK_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encodedMask)) return undefined;
  return {
    version: 1,
    status: "verified",
    encoding: "zlib-bitset-little-v1",
    originCells: origin,
    metersPerCell,
    spanCells: span,
    observedCells: Number(raw.observed_cells),
    maskSha256: raw.mask_sha256,
    maskZlibBase64: encodedMask,
    diffEligible: true,
  };
};

/** Read comparison-only metadata without retaining unknown fields or copying point data. */
export const enrichComparisonScene = (scene: SceneModel): SceneModel => {
  const { coverage: _previousCoverage, ...metadata } = scene.metadata;
  let coverage: SceneComparisonCoverage | undefined;
  try {
    const buffer = scene.buffer;
    if (buffer instanceof ArrayBuffer && buffer.byteLength >= SCENE_HEADER_BYTES && buffer.byteLength <= SCENE_MAX_BYTES) {
      const metadataBytes = new DataView(buffer).getUint32(12, true);
      if (metadataBytes <= 1024 * 1024 && SCENE_HEADER_BYTES + metadataBytes === scene.pointOffset
        && scene.pointOffset <= buffer.byteLength) {
        const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
          new Uint8Array(buffer, SCENE_HEADER_BYTES, metadataBytes),
        ));
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          coverage = comparisonCoverage((payload as Record<string, unknown>).coverage,
            metadata.origin, metadata.metersPerCell, metadata.span);
        }
      }
    }
  } catch { /* Missing or malformed comparison data never changes the rendered map. */ }
  return { ...scene, metadata: { ...metadata, ...(coverage ? { coverage } : {}) } };
};

export type ComparisonDecision =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: "same-record" | "different-group" | "frame-unverified" | "coverage-unverified" };

type ComparableRecord = Pick<HistorySnapshot, "id" | "comparisonGroup" | "imported" | "frame">;

export const framesRegistered = (first: ComparableRecord, second: ComparableRecord): boolean => {
  const left = first.frame, right = second.frame;
  return Boolean(first.comparisonGroup && first.comparisonGroup === second.comparisonGroup
    && !first.imported && !second.imported && left && right
    && left.formatVersion === right.formatVersion
    && left.coordinateVersion === right.coordinateVersion
    && left.metersPerCell === right.metersPerCell);
};

export interface ComparisonCamera {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly orthographic: boolean;
}

/** Translate a camera between maps in the same verified coordinate frame. */
export const synchronizedCamera = (
  camera: ComparisonCamera,
  source: Pick<SceneModel["metadata"], "metersPerCell" | "origin" | "span">,
  target: Pick<SceneModel["metadata"], "metersPerCell" | "origin" | "span">,
  zoom: number,
  registered: boolean,
  targetFitDistance: number,
): ComparisonCamera | null => {
  if (!registered || !Number.isFinite(zoom) || zoom <= 0
    || !Number.isFinite(targetFitDistance) || targetFitDistance <= 0
    || source.metersPerCell !== target.metersPerCell) return null;
  const meters = source.metersPerCell;
  const absoluteX = ((source.span[0] - 1) / 2 + source.origin[0]) * meters - camera.targetX;
  const absoluteY = ((source.span[1] - 1) / 2 + source.origin[1]) * meters + camera.targetZ;
  return {
    ...camera,
    targetX: ((target.span[0] - 1) / 2 + target.origin[0]) * meters - absoluteX,
    targetZ: absoluteY - ((target.span[1] - 1) / 2 + target.origin[1]) * meters,
    distance: targetFitDistance / Math.max(0.01, Math.min(100, zoom)),
  };
};

export const comparisonDecision = (first: ComparableRecord, second: ComparableRecord): ComparisonDecision => {
  if (first.id === second.id) return { eligible: false, reason: "same-record" };
  if (!first.comparisonGroup || first.comparisonGroup !== second.comparisonGroup
    || first.imported || second.imported) return { eligible: false, reason: "different-group" };
  const left = first.frame, right = second.frame;
  if (!left || !right || !framesRegistered(first, second) || !compatibleFrame(left, right)) {
    return { eligible: false, reason: "frame-unverified" };
  }
  if (!left.coverage.diffEligible || !right.coverage.diffEligible
    || left.coverage.status !== "verified" || right.coverage.status !== "verified"
    || left.coverage.observedCells < 1 || right.coverage.observedCells < 1
    || !left.coverage.maskSha256 || !right.coverage.maskSha256) {
    return { eligible: false, reason: "coverage-unverified" };
  }
  return { eligible: true };
};

const compatibleFrame = (
  left: HistoryComparisonFrame | null | undefined,
  right: HistoryComparisonFrame | null | undefined,
): boolean => Boolean(left && right
  && left.formatVersion === right.formatVersion
  && left.coordinateVersion === right.coordinateVersion
  && left.metersPerCell === right.metersPerCell
  && left.diffEligible && right.diffEligible);

const decodeBase64 = (value: string): Uint8Array => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
    || value.length > Math.ceil(384 * 1024 / 3) * 4) throw new Error("invalid-coverage-mask");
  const binary = atob(value);
  if (binary.length > 384 * 1024) throw new Error("invalid-coverage-mask");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const digestHex = (bytes: Uint8Array): Promise<string> => crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)
  .then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));

/** Validate and decode a bounded coverage bitset; malformed/legacy data cannot claim Unknown as absence. */
export const decodeCoverageMask = async (
  coverage: SceneComparisonCoverage,
): Promise<Uint8Array> => {
  if (coverage.version !== 1 || coverage.encoding !== "zlib-bitset-little-v1"
    || coverage.status !== "verified" || !coverage.diffEligible) throw new Error("coverage-unverified");
  const cells = coverage.spanCells[0] * coverage.spanCells[1];
  if (!Number.isSafeInteger(cells) || cells < 1 || cells > 4 * 1024 * 1024
    || coverage.observedCells < 1 || coverage.observedCells > cells) throw new Error("coverage-bounds");
  const compressed = decodeBase64(coverage.maskZlibBase64);
  if (await digestHex(compressed) !== coverage.maskSha256) throw new Error("coverage-digest");
  if (typeof DecompressionStream === "undefined") throw new Error("coverage-decoder-unavailable");
  const reader = new Blob([new Uint8Array(compressed).buffer]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  const expected = Math.ceil(cells / 8);
  const output = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expected) throw new Error("coverage-size");
      output.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expected) throw new Error("coverage-size");
  let observed = 0;
  for (const byte of output) observed += byte.toString(2).replaceAll("0", "").length;
  if (observed !== coverage.observedCells) throw new Error("coverage-count");
  const remainder = cells & 7;
  if (remainder && (output.at(-1)! >>> remainder) !== 0) throw new Error("coverage-padding");
  return output;
};

export type CellClassification = "changed" | "unchanged" | "unknown";

export interface ComparisonGrid {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;
  readonly changed: number;
  readonly unchanged: number;
  readonly unknown: number;
}

const bit = (mask: Uint8Array, index: number): boolean =>
  (mask[index >>> 3]! & (1 << (index & 7))) !== 0;

const occupiedCells = (scene: SceneModel): Uint8Array => {
  const width = scene.metadata.span[0];
  const cellCount = width * scene.metadata.span[1];
  if (!Number.isSafeInteger(cellCount) || cellCount < 1 || cellCount > 4 * 1024 * 1024) throw new Error("scene-grid-too-large");
  const points = new DataView(scene.buffer, scene.pointOffset, scene.floorCount * 8);
  const occupied = new Uint8Array(Math.ceil(cellCount / 8));
  for (let index = 0; index < scene.floorCount; index += 1) {
    const offset = index * 8;
    const x = points.getUint16(offset, true);
    const y = points.getUint16(offset + 2, true);
    if (x < scene.metadata.span[0] && y < scene.metadata.span[1]) {
      const cell = y * width + x;
      const bucket = cell >>> 3;
      occupied[bucket] = (occupied[bucket] ?? 0) | (1 << (cell & 7));
    }
  }
  return occupied;
};

/**
 * Compare only cells observed by both admitted masks. Origins may differ by
 * integer cells; classification is projected into their shared world grid.
 */
export const classifyStructuralGrid = (
  first: SceneModel,
  second: SceneModel,
  firstMask: Uint8Array,
  secondMask: Uint8Array,
): ComparisonGrid => {
  const a = first.metadata.coverage;
  const b = second.metadata.coverage;
  if (!a || !b || a.status !== "verified" || b.status !== "verified"
    || a.metersPerCell !== b.metersPerCell || a.encoding !== b.encoding
    || first.metadata.metersPerCell !== second.metadata.metersPerCell) throw new Error("incompatible-grid");
  const ax = a.originCells[0], ay = a.originCells[1];
  const bx = b.originCells[0], by = b.originCells[1];
  const minX = Math.min(ax, bx), minY = Math.min(ay, by);
  const maxX = Math.max(ax + a.spanCells[0], bx + b.spanCells[0]);
  const maxY = Math.max(ay + a.spanCells[1], by + b.spanCells[1]);
  const width = maxX - minX, height = maxY - minY;
  if (width * height > 4 * 1024 * 1024) throw new Error("comparison-grid-too-large");
  const firstOccupied = occupiedCells(first);
  const secondOccupied = occupiedCells(second);
  const cells = new Uint8Array(width * height);
  let changed = 0, unchanged = 0, unknown = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const worldX = minX + x, worldY = minY + y;
    const localAX = worldX - ax, localAY = worldY - ay;
    const localBX = worldX - bx, localBY = worldY - by;
    const inA = localAX >= 0 && localAY >= 0 && localAX < a.spanCells[0] && localAY < a.spanCells[1];
    const inB = localBX >= 0 && localBY >= 0 && localBX < b.spanCells[0] && localBY < b.spanCells[1];
    const aIndex = localAY * a.spanCells[0] + localAX;
    const bIndex = localBY * b.spanCells[0] + localBX;
    const observed = inA && inB && bit(firstMask, aIndex) && bit(secondMask, bIndex);
    const firstCell = localAY * first.metadata.span[0] + localAX;
    const secondCell = localBY * second.metadata.span[0] + localBX;
    const firstHas = inA && bit(firstOccupied, firstCell);
    const secondHas = inB && bit(secondOccupied, secondCell);
    if (!observed) { cells[y * width + x] = 0; unknown += 1; }
    else if (firstHas !== secondHas) { cells[y * width + x] = 2; changed += 1; }
    else { cells[y * width + x] = 1; unchanged += 1; }
  }
  return { minX, minY, width, height, cells, changed, unchanged, unknown };
};
