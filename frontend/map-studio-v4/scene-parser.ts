import {
  ContractError,
  DELTA_HEADER_BYTES,
  DELTA_MAX_BYTES,
  SCENE_HEADER_BYTES,
  SCENE_MAX_BYTES,
  SCENE_MAX_POINTS,
  SCENE_POINT_STRIDE,
  SCENE_DELTA_DIRTY_BLOCK_BYTES,
  type SceneDeltaHint,
  type SceneMetadata,
  type SceneModel,
} from "./backend-contracts";

const XOR_CHUNK_BYTES = 1024 * 1024;

export interface ParsedScene {
  readonly buffer: ArrayBuffer;
  readonly pointOffset: number;
  readonly floorCount: number;
  readonly surfaceCount: number;
  readonly total: number;
  readonly metadata: SceneMetadata;
}

export interface DecodedSceneDelta {
  readonly parsed: ParsedScene;
  readonly revision: number;
  readonly deltaHint?: SceneDeltaHint;
}

interface WorkerResult {
  readonly id: number;
  readonly ok: boolean;
  readonly parsed?: ParsedScene;
  readonly revision?: number;
  readonly deltaHint?: SceneDeltaHint;
  readonly problem?: string;
}

interface DeltaBase {
  readonly buffer: ArrayBuffer;
  readonly revision: number;
  readonly pointOffset: number;
  readonly floorCount: number;
  readonly surfaceCount: number;
}

const createSceneCodec = (limits: Readonly<{
  deltaHeaderBytes: number;
  deltaMaxBytes: number;
  sceneHeaderBytes: number;
  sceneMaxBytes: number;
  sceneMaxPoints: number;
  scenePointStride: number;
  dirtyBlockBytes: typeof SCENE_DELTA_DIRTY_BLOCK_BYTES;
  xorChunkBytes: number;
}>) => {
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
  const payload = raw as Record<string, unknown>;
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
    || !span.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 65_536)
  ) fail();
  const rawRooms = Array.isArray(payload.rooms) ? payload.rooms.slice(0, 128) : [];
  const rooms = rawRooms.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const room = candidate as Record<string, unknown>;
    const name = typeof room.name === "string" ? room.name.trim() : "";
    if (!name || Array.from(name).length > 128 || /[\u0000-\u001f\u007f]/u.test(name)) return [];
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
    return [{
      id: `scene-room-${index + 1}`,
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
  return {
    buffer,
    pointOffset,
    floorCount,
    surfaceCount,
    total,
    metadata: {
      metersPerCell: meters as number,
      origin: [originValues[0] as number, originValues[1] as number],
      span: [spanValues[0] as number, spanValues[1] as number],
      sampleStep,
      rooms,
    },
  };
};

const decodeDeltaTransfer = async (
  payload: ArrayBuffer,
  base: DeltaBase,
  signal?: AbortSignal,
): Promise<DecodedSceneDelta> => {
  const fail = (code = "invalid-scene-delta"): never => { throw new Error(code); };
  const checkAbort = (): void => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };
  if (!(payload instanceof ArrayBuffer) || payload.byteLength < limits.deltaHeaderBytes
    || payload.byteLength > limits.deltaHeaderBytes + limits.deltaMaxBytes
    || !(base.buffer instanceof ArrayBuffer) || base.buffer.byteLength < limits.sceneHeaderBytes
    || base.buffer.byteLength > limits.deltaMaxBytes
    || !Number.isSafeInteger(base.revision) || base.revision < 0) fail("invalid-scene-delta-size");

  const view = new DataView(payload);
  const magic = String.fromCharCode(...new Uint8Array(payload, 0, 8));
  const version = view.getUint16(8, true);
  const flags = view.getUint16(10, true);
  const baseRevisionBig = view.getBigUint64(12, true);
  const revisionBig = view.getBigUint64(20, true);
  const sceneLength = view.getUint32(28, true);
  const compressedLength = view.getUint32(32, true);
  const baseRevision = Number(baseRevisionBig);
  const revision = Number(revisionBig);
  if (magic !== "MATICDLT"
    || version !== 1
    || flags !== 1
    || !Number.isSafeInteger(baseRevision)
    || !Number.isSafeInteger(revision)
    || baseRevision !== base.revision
    || revision <= base.revision
    || sceneLength < limits.sceneHeaderBytes
    || sceneLength > limits.deltaMaxBytes
    || compressedLength < 1
    || compressedLength > limits.deltaMaxBytes
    || compressedLength + limits.deltaHeaderBytes !== payload.byteLength) fail();
  if (typeof DecompressionStream !== "function") fail("scene-delta-decompression-unavailable");
  checkAbort();

  const compressed = new Uint8Array(payload, limits.deltaHeaderBytes, compressedLength);
  const expectedLength = Math.max(base.buffer.byteLength, sceneLength);
  if (expectedLength > limits.deltaMaxBytes) fail("invalid-scene-delta-size");
  const difference = new Uint8Array(expectedLength);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  let inflatedBytes = 0;
  let abort: (() => void) | null = null;
  try {
    abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener("abort", abort, { once: true });
    while (true) {
      checkAbort();
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || inflatedBytes + value.byteLength > expectedLength) fail();
      difference.set(value, inflatedBytes);
      inflatedBytes += value.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (signal?.aborted || error instanceof DOMException && error.name === "AbortError") {
      throw new DOMException("Aborted", "AbortError");
    }
    if (error instanceof Error && error.message === "invalid-scene-delta") throw error;
    fail();
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  checkAbort();
  if (inflatedBytes !== expectedLength) fail();

  const baseBytes = new Uint8Array(base.buffer);
  const headerView = new DataView(difference.buffer, difference.byteOffset, difference.byteLength);
  const headerBytes = Math.min(limits.sceneHeaderBytes, baseBytes.byteLength);
  for (let index = 0; index < headerBytes; index += 1) {
    difference[index] = (difference[index] ?? 0) ^ (baseBytes[index] ?? 0);
  }
  const newMetadataBytes = headerView.getUint32(12, true);
  const newFloorCount = headerView.getUint32(16, true);
  const newSurfaceCount = headerView.getUint32(20, true);
  const newPointOffset = limits.sceneHeaderBytes + newMetadataBytes;
  const newTotal = newFloorCount + newSurfaceCount;
  const samePointLayout = newPointOffset === base.pointOffset
    && newFloorCount === base.floorCount
    && newSurfaceCount === base.surfaceCount;
  const pointEnd = newPointOffset + newTotal * limits.scenePointStride;
  const canHint = samePointLayout && pointEnd === sceneLength
    && newTotal <= limits.sceneMaxPoints;
  const dirtyBlocks: number[] = [];
  let activeBlock = -1;
  let blockChanged = false;
  const finishBlock = (): void => {
    if (blockChanged && activeBlock >= 0) dirtyBlocks.push(activeBlock);
    blockChanged = false;
  };

  for (let start = headerBytes; start < baseBytes.byteLength; start += limits.xorChunkBytes) {
    checkAbort();
    const end = Math.min(baseBytes.byteLength, start + limits.xorChunkBytes);
    for (let index = start; index < end; index += 1) {
      const previous = baseBytes[index] ?? 0;
      const next = (difference[index] ?? 0) ^ previous;
      difference[index] = next;
      if (!canHint || index < base.pointOffset || index >= pointEnd) continue;
      const block = Math.floor((index - base.pointOffset) / limits.dirtyBlockBytes);
      if (block !== activeBlock) {
        finishBlock();
        activeBlock = block;
      }
      if (next !== previous) blockChanged = true;
    }
    if (end < baseBytes.byteLength) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }
  finishBlock();

  checkAbort();
  const sceneBuffer = sceneLength === difference.byteLength
    ? difference.buffer
    : difference.slice(0, sceneLength).buffer;
  const parsed = parseTransfer(sceneBuffer);
  return {
    parsed,
    revision,
    ...(canHint ? {
      deltaHint: {
        baseRevision,
        blockBytes: limits.dirtyBlockBytes,
        dirtyBlocks,
      },
    } : {}),
  };
};

return { parseTransfer, decodeDeltaTransfer };
};

const CODEC_LIMITS = Object.freeze({
  deltaHeaderBytes: DELTA_HEADER_BYTES,
  deltaMaxBytes: DELTA_MAX_BYTES,
  sceneHeaderBytes: SCENE_HEADER_BYTES,
  sceneMaxBytes: SCENE_MAX_BYTES,
  sceneMaxPoints: SCENE_MAX_POINTS,
  scenePointStride: SCENE_POINT_STRIDE,
  dirtyBlockBytes: SCENE_DELTA_DIRTY_BLOCK_BYTES,
  xorChunkBytes: XOR_CHUNK_BYTES,
});
const sceneCodec = createSceneCodec(CODEC_LIMITS);

export const parseSceneBuffer = (buffer: ArrayBuffer): ParsedScene => {
  try {
    return sceneCodec.parseTransfer(buffer);
  } catch {
    throw new ContractError("invalid-scene");
  }
};

const workerSource = (): string => `
  const { parseTransfer, decodeDeltaTransfer } = (${createSceneCodec.toString()})(Object.freeze(${JSON.stringify(CODEC_LIMITS)}));
  self.onmessage = async (event) => {
    const { id, kind, buffer, payload, base } = event.data;
    try {
      if (kind === "parse") {
        const parsed = parseTransfer(buffer);
        self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
        return;
      }
      const decoded = await decodeDeltaTransfer(payload, base);
      self.postMessage({ id, ok: true, ...decoded }, [decoded.parsed.buffer]);
    } catch (error) {
      const problem = error instanceof Error && error.message.startsWith("invalid-scene")
        ? error.message
        : error instanceof Error && error.message === "scene-delta-decompression-unavailable"
          ? error.message
          : "invalid-scene-delta";
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
  #pending: {
    readonly id: number;
    readonly resolve: (result: WorkerResult) => void;
    readonly reject: (reason: unknown) => void;
    readonly cleanup: () => void;
  } | null = null;
  #fallbackActive = false;
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
      [buffer],
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

  async decodeDelta(
    payload: ArrayBuffer,
    base: SceneModel,
    signal?: AbortSignal,
  ): Promise<DecodedSceneDelta> {
    this.#ensureAvailable(signal);
    this.#ensureIdle();
    if (payload.byteLength > DELTA_HEADER_BYTES + DELTA_MAX_BYTES
      || base.buffer.byteLength > DELTA_MAX_BYTES) throw new ContractError("invalid-scene-delta-size");
    const baseInfo: DeltaBase = {
      buffer: base.buffer,
      revision: base.revision,
      pointOffset: base.pointOffset,
      floorCount: base.floorCount,
      surfaceCount: base.surfaceCount,
    };
    if (!this.#worker && !this.#workerBroken) this.#startWorker();
    const workerBase: DeltaBase = this.#worker
      ? { ...baseInfo, buffer: base.buffer.slice(0) }
      : baseInfo;
    let result: WorkerResult;
    try {
      result = await this.#run(
        { kind: "delta", payload },
        this.#worker ? [payload, workerBase.buffer] : [],
        signal,
        async (operationSignal) => {
          await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
          this.#ensureAvailable(operationSignal);
          return sceneCodec.decodeDeltaTransfer(payload, baseInfo, operationSignal)
            .then((decoded) => ({ id: 0, ok: true, ...decoded }));
        },
        workerBase,
      );
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (signal?.aborted || error instanceof DOMException && error.name === "AbortError") {
        throw new DOMException("Aborted", "AbortError");
      }
      if (error instanceof Error
        && (error.message.startsWith("invalid-scene") || error.message === "scene-delta-decompression-unavailable")) {
        throw new ContractError(error.message);
      }
      throw new ContractError("invalid-scene-delta");
    }
    if (!result.parsed || result.revision === undefined) throw new ContractError("invalid-scene-delta");
    return {
      parsed: result.parsed,
      revision: result.revision,
      ...(result.deltaHint ? { deltaHint: result.deltaHint } : {}),
    };
  }

  #ensureAvailable(signal?: AbortSignal): void {
    if (this.#disposed) throw new ContractError("scene-parser-disposed");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }

  #ensureIdle(): void {
    if (this.#pending || this.#fallbackActive) throw new ContractError("scene-parser-busy");
  }

  #startWorker(): void {
    if (!this.#workerUrl || this.#workerBroken || this.#disposed) return;
    try {
      const worker = new Worker(this.#workerUrl);
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        const pending = this.#pending;
        if (!pending || event.data.id !== pending.id) return;
        this.#pending = null;
        pending.cleanup();
        if (event.data.ok) pending.resolve(event.data);
        else pending.reject(new ContractError(event.data.problem || "invalid-scene"));
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
    message: { readonly kind: "parse"; readonly buffer: ArrayBuffer }
      | { readonly kind: "delta"; readonly payload: ArrayBuffer },
    transfer: Transferable[],
    signal: AbortSignal | undefined,
    fallback: (signal: AbortSignal) => Promise<WorkerResult>,
    base?: DeltaBase,
  ): Promise<WorkerResult> {
    this.#ensureAvailable(signal);
    this.#ensureIdle();
    if (!this.#worker && !this.#workerBroken) this.#startWorker();
    if (!this.#worker) {
      this.#fallbackActive = true;
      const fallbackController = new AbortController();
      this.#fallbackAbort = fallbackController;
      const abortFallback = (): void => fallbackController.abort();
      signal?.addEventListener("abort", abortFallback, { once: true });
      try {
        return await fallback(fallbackController.signal);
      } finally {
        signal?.removeEventListener("abort", abortFallback);
        this.#fallbackAbort = null;
        this.#fallbackActive = false;
      }
    }

    const id = ++this.#requestId;
    const worker = this.#worker;
    return new Promise<WorkerResult>((resolve, reject) => {
      const cleanup = (): void => signal?.removeEventListener("abort", abort);
      const abort = (): void => {
        const pending = this.#pending;
        if (!pending || pending.id !== id) return;
        this.#pending = null;
        cleanup();
        this.#terminateWorker();
        reject(new DOMException("Aborted", "AbortError"));
      };
      this.#pending = { id, resolve, reject, cleanup };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        if (signal?.aborted) {
          abort();
          return;
        }
        const data = message.kind === "parse"
          ? { id, kind: message.kind, buffer: message.buffer }
          : { id, kind: message.kind, payload: message.payload, base };
        worker.postMessage(data, transfer);
      } catch (error) {
        this.#pending = null;
        cleanup();
        this.#workerFailed(worker);
        reject(error);
      }
    });
  }

  #workerFailed(worker: Worker): void {
    if (this.#worker !== worker) return;
    const pending = this.#pending;
    this.#pending = null;
    this.#workerBroken = true;
    this.#terminateWorker();
    pending?.cleanup();
    pending?.reject(new ContractError("scene-worker-failed"));
  }

  #terminateWorker(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const pending = this.#pending;
    this.#pending = null;
    this.#fallbackAbort?.abort();
    this.#fallbackAbort = null;
    pending?.cleanup();
    pending?.reject(new ContractError("scene-parser-disposed"));
    this.#terminateWorker();
    if (this.#workerUrl) URL.revokeObjectURL(this.#workerUrl);
    this.#workerUrl = null;
  }
}
