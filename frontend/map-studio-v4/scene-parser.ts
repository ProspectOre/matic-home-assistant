import {
  ContractError,
  MANIFEST_HEADER_BYTES,
  MANIFEST_MAX_BYTES,
  MANIFEST_PAGE_BYTES,
  PAGE_POINT_BYTES,
  SCENE_HEADER_BYTES,
  SCENE_MAX_PAGES,
  SCENE_MAX_BYTES,
  SCENE_MAX_POINTS,
  SCENE_POINT_STRIDE,
  SCENE_DIRTY_BLOCK_BYTES,
  type SceneDeltaHint,
  type SceneMetadata,
  type SceneModel,
  type SceneTileIndex,
  type Unchecked,
} from "./backend-contracts";
import type * as wire from "./backend-schema";

export interface ParsedScene {
  readonly buffer: ArrayBuffer;
  readonly pointOffset: number;
  readonly floorCount: number;
  readonly surfaceCount: number;
  readonly total: number;
  readonly metadata: SceneMetadata;
  readonly tileIndex?: SceneTileIndex;
}

export interface AssembledScene {
  readonly parsed: ParsedScene;
  readonly deltaHint?: SceneDeltaHint;
}

/** One page of a manifest: its position in pages, its point counts and address. */
export interface ManifestPage {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly surface: number;
  readonly id: string;
}

/** Fetched page points, back to back in the order of `ids`. */
export interface PageBatch {
  readonly ids: readonly string[];
  readonly body: ArrayBuffer;
}

/** The scene a new manifest may take unchanged pages from. */
interface AssemblyBase {
  readonly buffer: ArrayBuffer;
  readonly manifest: ArrayBuffer;
  readonly revision: number;
}

interface WorkerResult {
  readonly id: number;
  readonly ok: boolean;
  readonly parsed?: ParsedScene;
  readonly deltaHint?: SceneDeltaHint;
  readonly problem?: string;
}

type CodecMessage =
  | { readonly kind: "parse"; readonly buffer: ArrayBuffer }
  | { readonly kind: "assemble"; readonly manifest: ArrayBuffer; readonly batches: readonly PageBatch[] };

interface CodecRun {
  readonly id: number;
  readonly message: CodecMessage;
  readonly signal?: AbortSignal;
  readonly fallback: (signal: AbortSignal) => Promise<WorkerResult>;
  readonly base?: AssemblyBase;
  readonly settle: (result?: WorkerResult, error?: unknown) => void;
  readonly abort: () => void;
  settled: boolean;
  worker: Worker | null;
}

const createSceneCodec = (limits: Readonly<{
  manifestHeaderBytes: number;
  manifestMaxBytes: number;
  manifestPageBytes: number;
  pagePointBytes: number;
  sceneHeaderBytes: number;
  sceneMaxBytes: number;
  sceneMaxPages: number;
  sceneMaxPoints: number;
  scenePointStride: number;
  dirtyBlockBytes: typeof SCENE_DIRTY_BLOCK_BYTES;
}>) => {
// This factory is serialized into a Worker. Keep every runtime dependency of
// its codecs inside the factory or in the explicit limits argument.
const parseTransfer = (buffer: ArrayBuffer): ParsedScene => {
  const HEADER = limits.sceneHeaderBytes;
  const STRIDE = limits.scenePointStride;
  const MAX_POINTS = limits.sceneMaxPoints;
  const MAX_BYTES = limits.sceneMaxBytes;
  const fail = (): never => { throw new Error("invalid-scene"); };
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER || buffer.byteLength > MAX_BYTES) fail();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer, 0, 8);
  const magic = String.fromCharCode(...bytes);
  const version = view.getUint16(8, true);
  const stride = view.getUint16(10, true);
  const metadataBytes = view.getUint32(12, true);
  const floorCount = view.getUint32(16, true);
  const surfaceCount = view.getUint32(20, true);
  const total = floorCount + surfaceCount;
  const pointOffset = HEADER + metadataBytes;
  if (
    magic !== "MATIC3D\u0000"
    || version !== 1
    || stride !== STRIDE
    || metadataBytes > 1024 * 1024
    || total < 1
    || total > MAX_POINTS
    || pointOffset + total * stride !== buffer.byteLength
  ) fail();
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(buffer, HEADER, metadataBytes),
    ));
  } catch {
    fail();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
  const payload = raw as Unchecked<wire.SceneMetadata>;
  const meters = payload.meters_per_cell;
  const origin = payload.origin_cells;
  const span = payload.span_cells;
  if (
    typeof meters !== "number"
    || !Number.isFinite(meters)
    || meters < 0.001
    || meters > 0.1
    || !Array.isArray(origin)
    || origin.length !== 2
    || !origin.every((value) => typeof value === "number" && Number.isFinite(value))
    || !Array.isArray(span)
    || span.length !== 2
    || !span.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_536)
  ) fail();
  const rawRooms = Array.isArray(payload.rooms) ? payload.rooms.slice(0, 256) : [];
  const roomIds = new Set<string>();
  const rooms = rawRooms.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const room = candidate as Unchecked<wire.SceneRoom>;
    const name = typeof room.name === "string" ? room.name.trim() : "";
    if (!name || new TextEncoder().encode(name).length > 256 || /[\u0000-\u001f\u007f]/u.test(name)) return [];
    if (!Array.isArray(room.boundary) || room.boundary.length < 3 || room.boundary.length > 8192) return [];
    const boundary = room.boundary.flatMap((point) => {
      if (!Array.isArray(point) || point.length !== 2) return [];
      const [x, y] = point;
      return typeof x === "number" && Number.isFinite(x)
        && typeof y === "number" && Number.isFinite(y)
        ? [[x, y] as const]
        : [];
    });
    const center = room.center;
    if (boundary.length < 3 || !Array.isArray(center) || center.length !== 2) return [];
    const [centerX, centerY] = center;
    if (typeof centerX !== "number" || !Number.isFinite(centerX)
      || typeof centerY !== "number" || !Number.isFinite(centerY)) return [];
    const id = typeof room.room_id === "string" && /^room_[a-f0-9]{16}$/u.test(room.room_id)
      && !roomIds.has(room.room_id) ? room.room_id : `scene-room-${index + 1}`;
    roomIds.add(id);
    return [{
      id,
      name,
      boundary,
      center: [centerX, centerY] as const,
    }];
  });
  const sampleStep = typeof payload.sample_step === "number" && Number.isInteger(payload.sample_step)
    ? Math.max(1, Math.min(MAX_POINTS, payload.sample_step))
    : 1;
  const originValues = origin as number[];
  const spanValues = span as number[];
  const sceneOrigin = [originValues[0] as number, originValues[1] as number] as const;
  const sceneSpan = [spanValues[0] as number, spanValues[1] as number] as const;
  const tileIndex = buildTileIndex(buffer, pointOffset, floorCount, total, sceneSpan);
  return {
    buffer,
    pointOffset,
    floorCount,
    surfaceCount,
    total,
    metadata: {
      metersPerCell: meters as number,
      origin: sceneOrigin,
      span: sceneSpan,
      sampleStep,
      rooms,
    },
    ...(tileIndex ? { tileIndex } : {}),
  };
};

const buildTileIndex = (
  buffer: ArrayBuffer,
  pointOffset: number,
  floorCount: number,
  total: number,
  span: readonly [number, number],
): SceneTileIndex | undefined => {
  // Run count and scratch storage are both hard-bounded. This index is only an
  // accelerator: an unusual point order simply leaves the original cloud intact.
  const MAX_RUNS = 8_192;
  const values: number[] = [];
  const seen = new Set<number>();
  const points = new DataView(buffer, pointOffset, total * limits.scenePointStride);
  let floorRuns = 0;
  for (let range = 0; range < 2; range += 1) {
    const start = range === 0 ? 0 : floorCount;
    const end = range === 0 ? floorCount : total;
    seen.clear();
    let runStart = start;
    let runTile = -1;
    let runHeight = 0;
    const finishRun = (runEnd: number): boolean => {
      if (runTile < 0) return true;
      if (values.length >= MAX_RUNS * 5) return false;
      values.push(runStart, runEnd, runTile % 2048, Math.floor(runTile / 2048), runHeight);
      return true;
    };
    for (let index = start; index < end; index += 1) {
      const offset = index * limits.scenePointStride;
      const x = points.getUint16(offset, true);
      const y = points.getUint16(offset + 2, true);
      const height = points.getUint8(offset + 4);
      if (x >= span[0] || y >= span[1]) return undefined;
      const tileX = x >>> 5;
      const tileY = y >>> 5;
      const tile = tileY * 2048 + tileX;
      if (tile !== runTile) {
        if (!finishRun(index) || seen.has(tile)) return undefined;
        if (runTile >= 0) seen.add(runTile);
        runStart = index;
        runTile = tile;
        runHeight = height;
      } else if (height > runHeight) runHeight = height;
    }
    if (!finishRun(end)) return undefined;
    if (range === 0) floorRuns = values.length / 5;
  }
  return values.length > 0
    ? { runs: Uint32Array.from(values), floorRuns }
    : undefined;
};

const readManifest = (buffer: ArrayBuffer): { metadata: Uint8Array; pages: ManifestPage[] } => {
  const fail = (): never => { throw new Error("invalid-scene-manifest"); };
  const HEADER = limits.manifestHeaderBytes;
  const RECORD = limits.manifestPageBytes;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER || buffer.byteLength > limits.manifestMaxBytes) fail();
  const view = new DataView(buffer);
  const metadataBytes = view.getUint32(12, true);
  const count = view.getUint32(16, true);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 8)) !== "MATICMF\u0000"
    || view.getUint16(8, true) !== 1
    || view.getUint16(10, true) !== RECORD
    || metadataBytes > 1024 * 1024
    || count < 1 || count > limits.sceneMaxPages
    || HEADER + metadataBytes + count * RECORD !== buffer.byteLength) fail();
  const pages: ManifestPage[] = [];
  for (let offset = HEADER + metadataBytes; offset < buffer.byteLength; offset += RECORD) {
    let id = "";
    for (const byte of new Uint8Array(buffer, offset + 16, 12)) id += byte.toString(16).padStart(2, "0");
    pages.push({
      x: view.getInt32(offset, true),
      y: view.getInt32(offset + 4, true),
      floor: view.getUint32(offset + 8, true),
      surface: view.getUint32(offset + 12, true),
      id,
    });
  }
  return { metadata: new Uint8Array(buffer, HEADER, metadataBytes), pages };
};

// Builds the scene buffer a saved map carries: header, metadata, every page's
// floor points, then every page's surface points, in manifest order.
const assembleTransfer = (
  manifest: ArrayBuffer,
  batches: readonly PageBatch[],
  base?: AssemblyBase,
): AssembledScene => {
  const fail = (): never => { throw new Error("invalid-scene-pages"); };
  const STRIDE = limits.scenePointStride;
  const LOCAL = limits.pagePointBytes;
  const { metadata, pages } = readManifest(manifest);
  const frame = (bytes: Uint8Array): [number, number, number, number] => {
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail();
    }
    const { origin_cells: origin, span_cells: span } = (raw ?? {}) as Record<string, unknown>;
    const values = [Array.isArray(origin) ? origin : [], Array.isArray(span) ? span : []].flat();
    if (values.length !== 4 || !values.every((value) => Number.isSafeInteger(value))) fail();
    return values as [number, number, number, number];
  };
  const [originX, originY, spanX, spanY] = frame(metadata);
  const fetched = new Map<string, Uint8Array>();
  const lengths = new Map(pages.map((page) => [page.id, (page.floor + page.surface) * LOCAL]));
  for (const batch of batches) {
    let offset = 0;
    for (const id of batch.ids) {
      const length = lengths.get(id) ?? fail();
      if (offset + length > batch.body.byteLength) fail();
      fetched.set(id, new Uint8Array(batch.body, offset, length));
      offset += length;
    }
    if (offset !== batch.body.byteLength) fail();
  }
  const reused = new Map<string, { floorStart: number; surfaceStart: number; shiftX: number; shiftY: number }>();
  let baseView: DataView | null = null;
  if (base) {
    const parsedBase = readManifest(base.manifest);
    const [baseX, baseY] = frame(parsedBase.metadata);
    baseView = new DataView(base.buffer);
    const basePoints = limits.sceneHeaderBytes + baseView.getUint32(12, true);
    let floorStart = basePoints;
    let surfaceStart = basePoints + baseView.getUint32(16, true) * STRIDE;
    if (surfaceStart + baseView.getUint32(20, true) * STRIDE !== base.buffer.byteLength) fail();
    for (const page of parsedBase.pages) {
      reused.set(page.id, { floorStart, surfaceStart, shiftX: page.x * 32 - baseX, shiftY: page.y * 32 - baseY });
      floorStart += page.floor * STRIDE;
      surfaceStart += page.surface * STRIDE;
    }
  }
  const floorCount = pages.reduce((sum, page) => sum + page.floor, 0);
  const total = floorCount + pages.reduce((sum, page) => sum + page.surface, 0);
  if (total < 1 || total > limits.sceneMaxPoints) fail();
  const pointOffset = limits.sceneHeaderBytes + metadata.byteLength;
  const buffer = new ArrayBuffer(pointOffset + total * STRIDE);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes.set([77, 65, 84, 73, 67, 51, 68, 0]);
  view.setUint16(8, 1, true);
  view.setUint16(10, STRIDE, true);
  view.setUint32(12, metadata.byteLength, true);
  view.setUint32(16, floorCount, true);
  view.setUint32(20, total - floorCount, true);
  bytes.set(metadata, limits.sceneHeaderBytes);
  let floorOut = pointOffset;
  let surfaceOut = pointOffset + floorCount * STRIDE;
  const write = (out: number, x: number, y: number, source: Uint8Array, at: number): void => {
    if (x < 0 || x >= spanX || y < 0 || y >= spanY) fail();
    view.setUint16(out, x, true);
    view.setUint16(out + 2, y, true);
    bytes.set(source.subarray(at, at + 4), out + 4);
  };
  for (const page of pages) {
    const shiftX = page.x * 32 - originX;
    const shiftY = page.y * 32 - originY;
    const local = fetched.get(page.id);
    if (local) {
      for (let index = 0; index < page.floor + page.surface; index += 1) {
        const at = index * LOCAL;
        if ((local[at] ?? 32) >= 32 || (local[at + 1] ?? 32) >= 32) fail();
        const out = index < page.floor ? floorOut + index * STRIDE : surfaceOut + (index - page.floor) * STRIDE;
        write(out, (local[at] ?? 0) + shiftX, (local[at + 1] ?? 0) + shiftY, local, at + 2);
      }
    } else if (page.floor + page.surface > 0) {
      const source = reused.get(page.id) ?? fail();
      const sourceBytes = new Uint8Array(base!.buffer);
      for (const [from, to, count] of [
        [source.floorStart, floorOut, page.floor],
        [source.surfaceStart, surfaceOut, page.surface],
      ] as const) {
        if (shiftX === source.shiftX && shiftY === source.shiftY) {
          bytes.set(sourceBytes.subarray(from, from + count * STRIDE), to);
          continue;
        }
        for (let index = 0; index < count; index += 1) {
          const at = from + index * STRIDE;
          write(
            to + index * STRIDE,
            baseView!.getUint16(at, true) - source.shiftX + shiftX,
            baseView!.getUint16(at + 2, true) - source.shiftY + shiftY,
            sourceBytes,
            at + 4,
          );
        }
      }
    }
    floorOut += page.floor * STRIDE;
    surfaceOut += page.surface * STRIDE;
  }
  const parsed = parseTransfer(buffer);
  if (!base || base.buffer.byteLength !== buffer.byteLength
    || new DataView(base.buffer).getUint32(12, true) !== metadata.byteLength
    || new DataView(base.buffer).getUint32(16, true) !== floorCount) return { parsed };
  // The renderer re-uploads only the blocks a same-layout revision changed.
  const previous = new Uint8Array(base.buffer);
  const dirtyBlocks: number[] = [];
  for (let start = pointOffset; start < buffer.byteLength; start += limits.dirtyBlockBytes) {
    const end = Math.min(buffer.byteLength, start + limits.dirtyBlockBytes);
    for (let index = start; index < end; index += 1) {
      if (bytes[index] !== previous[index]) {
        dirtyBlocks.push((start - pointOffset) / limits.dirtyBlockBytes);
        break;
      }
    }
  }
  return {
    parsed,
    deltaHint: { baseRevision: base.revision, blockBytes: limits.dirtyBlockBytes, dirtyBlocks },
  };
};

return { parseTransfer, readManifest, assembleTransfer };
};

const CODEC_LIMITS = Object.freeze({
  manifestHeaderBytes: MANIFEST_HEADER_BYTES,
  manifestMaxBytes: MANIFEST_MAX_BYTES,
  manifestPageBytes: MANIFEST_PAGE_BYTES,
  pagePointBytes: PAGE_POINT_BYTES,
  sceneHeaderBytes: SCENE_HEADER_BYTES,
  sceneMaxBytes: SCENE_MAX_BYTES,
  sceneMaxPages: SCENE_MAX_PAGES,
  sceneMaxPoints: SCENE_MAX_POINTS,
  scenePointStride: SCENE_POINT_STRIDE,
  dirtyBlockBytes: SCENE_DIRTY_BLOCK_BYTES,
});
const sceneCodec = createSceneCodec(CODEC_LIMITS);

export const parseSceneBuffer = (buffer: ArrayBuffer): ParsedScene => {
  try {
    return sceneCodec.parseTransfer(buffer);
  } catch {
    throw new ContractError("invalid-scene");
  }
};

/** The pages a live manifest lists, read on the calling thread. */
export const manifestPages = (buffer: ArrayBuffer): readonly ManifestPage[] => {
  try {
    return sceneCodec.readManifest(buffer).pages;
  } catch {
    throw new ContractError("invalid-scene-manifest");
  }
};

const workerSource = (): string => `
  const { parseTransfer, assembleTransfer } = (${createSceneCodec.toString()})(Object.freeze(${JSON.stringify(CODEC_LIMITS)}));
  self.onmessage = (event) => {
    const { id, kind, buffer, manifest, batches, base } = event.data;
    try {
      const result = kind === "parse" ? { parsed: parseTransfer(buffer) } : assembleTransfer(manifest, batches, base);
      self.postMessage({ id, ok: true, ...result }, [
        result.parsed.buffer,
        ...(result.parsed.tileIndex ? [result.parsed.tileIndex.runs.buffer] : []),
      ]);
    } catch (error) {
      const problem = error instanceof Error && error.message.startsWith("invalid-scene")
        ? error.message
        : "invalid-scene";
      self.postMessage({ id, ok: false, problem });
    }
  };
`;

export class SceneParser {
  #worker: Worker | null = null;
  #workerUrl: string | null = null;
  #workerBroken = false;
  #disposed = false;
  #requestId = 0;
  #active: CodecRun | null = null;
  // One waiter bounds retained response buffers while covering concurrent live/history reads.
  #queued: CodecRun | null = null;
  #fallbackAbort: AbortController | null = null;

  constructor() {
    if (typeof Worker !== "function" || typeof URL?.createObjectURL !== "function") return;
    try {
      this.#workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
      this.#startWorker();
    } catch {
      this.#worker = null;
      if (this.#workerUrl) URL.revokeObjectURL(this.#workerUrl);
      this.#workerUrl = null;
    }
  }

  async parse(buffer: ArrayBuffer, signal?: AbortSignal): Promise<ParsedScene> {
    this.#ensureAvailable(signal);
    if (buffer.byteLength > SCENE_MAX_BYTES || buffer.byteLength < SCENE_HEADER_BYTES) {
      throw new ContractError("invalid-scene");
    }
    const result = await this.#run(
      { kind: "parse", buffer },
      signal,
      async (operationSignal) => {
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
        this.#ensureAvailable(operationSignal);
        return { id: 0, ok: true, parsed: parseSceneBuffer(buffer) };
      },
    );
    if (!result.parsed) throw new ContractError("invalid-scene");
    return result.parsed;
  }

  /** Builds a live scene from its manifest, fetched pages and the scene before it. */
  async assemble(
    manifest: ArrayBuffer,
    batches: readonly PageBatch[],
    base: SceneModel | null,
    signal?: AbortSignal,
  ): Promise<AssembledScene> {
    this.#ensureAvailable(signal);
    const assemblyBase = base?.manifest
      ? { buffer: base.buffer, manifest: base.manifest, revision: base.revision }
      : undefined;
    let result: WorkerResult;
    try {
      result = await this.#run(
        { kind: "assemble", manifest, batches },
        signal,
        async (operationSignal) => {
          await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
          this.#ensureAvailable(operationSignal);
          return { id: 0, ok: true, ...sceneCodec.assembleTransfer(manifest, batches, assemblyBase) };
        },
        assemblyBase,
      );
    } catch (error) {
      if (error instanceof ContractError
        || signal?.aborted || error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ContractError(error instanceof Error && error.message.startsWith("invalid-scene")
        ? error.message : "invalid-scene-pages");
    }
    if (!result.parsed) throw new ContractError("invalid-scene-pages");
    return { parsed: result.parsed, ...(result.deltaHint ? { deltaHint: result.deltaHint } : {}) };
  }

  #ensureAvailable(signal?: AbortSignal): void {
    if (this.#disposed) throw new ContractError("scene-parser-disposed");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }

  #startWorker(): void {
    if (!this.#workerUrl || this.#workerBroken || this.#disposed) return;
    try {
      const worker = new Worker(this.#workerUrl);
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        const active = this.#active;
        if (this.#worker !== worker || !active || active.worker !== worker || event.data.id !== active.id) return;
        if (event.data.ok) this.#finishActive(active, event.data);
        else this.#finishActive(active, undefined, new ContractError(event.data.problem || "invalid-scene"));
      };
      worker.onerror = () => this.#workerFailed(worker);
      worker.onmessageerror = () => this.#workerFailed(worker);
      this.#worker = worker;
    } catch {
      this.#worker = null;
      this.#workerBroken = true;
    }
  }

  async #run(
    message: CodecMessage,
    signal: AbortSignal | undefined,
    fallback: (signal: AbortSignal) => Promise<WorkerResult>,
    base?: AssemblyBase,
  ): Promise<WorkerResult> {
    this.#ensureAvailable(signal);
    return new Promise<WorkerResult>((resolve, reject) => {
      let request!: CodecRun;
      const cleanup = (): void => signal?.removeEventListener("abort", request.abort);
      const settle = (result?: WorkerResult, error?: unknown): void => {
        if (request.settled) return;
        request.settled = true;
        cleanup();
        if (error !== undefined) reject(error);
        else if (result) resolve(result);
        else reject(new ContractError("invalid-scene"));
      };
      request = {
        id: ++this.#requestId,
        message,
        ...(signal ? { signal } : {}),
        fallback,
        ...(base ? { base } : {}),
        settle,
        abort: () => this.#abortRun(request),
        settled: false,
        worker: null,
      };
      signal?.addEventListener("abort", request.abort, { once: true });
      if (signal?.aborted || this.#disposed) {
        settle(undefined, signal?.aborted
          ? new DOMException("Aborted", "AbortError")
          : new ContractError("scene-parser-disposed"));
      } else if (!this.#active) {
        this.#active = request;
        this.#dispatch(request);
      } else if (!this.#queued) {
        this.#queued = request;
      } else {
        settle(undefined, new ContractError("scene-parser-busy"));
      }
    });
  }

  #dispatch(request: CodecRun): void {
    if (this.#active !== request) return;
    if (this.#disposed) {
      this.#finishActive(request, undefined, new ContractError("scene-parser-disposed"));
      return;
    }
    if (request.signal?.aborted) {
      this.#finishActive(request, undefined, new DOMException("Aborted", "AbortError"));
      return;
    }
    if (!this.#worker && !this.#workerBroken) this.#startWorker();
    const worker = this.#worker;
    if (worker) {
      request.worker = worker;
      try {
        let data: unknown;
        let transfer: Transferable[];
        if (request.message.kind === "parse") {
          data = { id: request.id, kind: request.message.kind, buffer: request.message.buffer };
          transfer = [request.message.buffer];
        } else {
          // The displayed scene and its manifest stay usable here; the worker
          // gets copies of them and takes the fetched pages.
          const workerBase = request.base && { ...request.base, buffer: request.base.buffer.slice(0) };
          const { manifest, batches } = request.message;
          data = { id: request.id, kind: request.message.kind, manifest, batches, base: workerBase };
          transfer = [...batches.map((batch) => batch.body), ...(workerBase ? [workerBase.buffer] : [])];
        }
        worker.postMessage(data, transfer);
      } catch {
        this.#workerFailed(worker);
      }
      return;
    }

    const fallbackController = new AbortController();
    this.#fallbackAbort = fallbackController;
    void Promise.resolve()
      .then(() => request.fallback(fallbackController.signal))
      .then(
        (result) => this.#finishActive(request, result),
        (error: unknown) => this.#finishActive(request, undefined, error),
      );
  }

  #abortRun(request: CodecRun): void {
    const aborted = new DOMException("Aborted", "AbortError");
    if (this.#queued === request) {
      this.#queued = null;
      request.settle(undefined, aborted);
      return;
    }
    if (this.#active !== request) return;
    if (request.worker) {
      this.#terminateWorker();
      this.#finishActive(request, undefined, aborted);
    } else {
      this.#fallbackAbort?.abort();
    }
  }

  #finishActive(request: CodecRun, result?: WorkerResult, error?: unknown): void {
    if (this.#active !== request) {
      request.settle(undefined, new ContractError("scene-parser-disposed"));
      return;
    }
    const finalError = request.signal?.aborted
      ? new DOMException("Aborted", "AbortError")
      : error;
    request.settle(result, finalError);
    this.#active = null;
    this.#fallbackAbort = null;
    request.worker = null;
    if (!this.#disposed) this.#pump();
  }

  #pump(): void {
    if (this.#disposed || this.#active || !this.#queued) return;
    const next = this.#queued;
    this.#queued = null;
    if (next.signal?.aborted) {
      next.settle(undefined, new DOMException("Aborted", "AbortError"));
      this.#pump();
      return;
    }
    this.#active = next;
    this.#dispatch(next);
  }

  #workerFailed(worker: Worker): void {
    if (this.#worker !== worker) return;
    this.#workerBroken = true;
    this.#terminateWorker();
    const active = this.#active;
    if (active?.worker === worker) {
      this.#finishActive(active, undefined, new ContractError("scene-worker-failed"));
    } else {
      this.#pump();
    }
  }

  #terminateWorker(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const queued = this.#queued;
    this.#queued = null;
    queued?.settle(undefined, new ContractError("scene-parser-disposed"));
    const active = this.#active;
    this.#terminateWorker();
    this.#fallbackAbort?.abort();
    this.#fallbackAbort = null;
    if (active) {
      active.worker = null;
      active.settle(undefined, new ContractError("scene-parser-disposed"));
    }
    this.#active = null;
    if (this.#workerUrl) URL.revokeObjectURL(this.#workerUrl);
    this.#workerUrl = null;
  }
}
