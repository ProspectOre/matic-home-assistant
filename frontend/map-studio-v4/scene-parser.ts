import {
  ContractError,
  SCENE_HEADER_BYTES,
  SCENE_MAX_BYTES,
  SCENE_MAX_POINTS,
  SCENE_POINT_STRIDE,
  type SceneMetadata,
} from "./backend-contracts";

export interface ParsedScene {
  readonly buffer: ArrayBuffer;
  readonly pointOffset: number;
  readonly floorCount: number;
  readonly surfaceCount: number;
  readonly total: number;
  readonly metadata: SceneMetadata;
}

interface WorkerResult {
  readonly id: number;
  readonly ok: boolean;
  readonly parsed?: ParsedScene;
  readonly problem?: string;
}

const parseTransfer = (buffer: ArrayBuffer): ParsedScene => {
  const HEADER = 24;
  const STRIDE = 8;
  const MAX_POINTS = 1_500_000;
  const MAX_BYTES = 16 * 1024 * 1024;
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

export const parseSceneBuffer = (buffer: ArrayBuffer): ParsedScene => {
  if (buffer.byteLength > SCENE_MAX_BYTES
    || buffer.byteLength < SCENE_HEADER_BYTES
    || SCENE_POINT_STRIDE !== 8
    || SCENE_MAX_POINTS !== 1_500_000) {
    throw new ContractError("invalid-scene");
  }
  try {
    return parseTransfer(buffer);
  } catch {
    throw new ContractError("invalid-scene");
  }
};

const workerSource = (): string => `
  const parseTransfer = ${parseTransfer.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`;

export class SceneParser {
  #worker: Worker | null = null;
  #workerUrl: string | null = null;
  #requestId = 0;
  readonly #pending = new Map<number, {
    readonly resolve: (value: ParsedScene) => void;
    readonly reject: (reason: unknown) => void;
  }>();

  constructor() {
    if (typeof Worker !== "function" || typeof URL?.createObjectURL !== "function") return;
    try {
      this.#workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
      this.#worker = new Worker(this.#workerUrl);
      this.#worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        const pending = this.#pending.get(event.data.id);
        if (!pending) return;
        this.#pending.delete(event.data.id);
        if (event.data.ok && event.data.parsed) pending.resolve(event.data.parsed);
        else pending.reject(new ContractError(event.data.problem || "invalid-scene"));
      };
      this.#worker.onerror = () => this.#failAll("scene-worker-failed");
    } catch {
      this.#worker = null;
      if (this.#workerUrl) URL.revokeObjectURL(this.#workerUrl);
      this.#workerUrl = null;
    }
  }

  async parse(buffer: ArrayBuffer, signal?: AbortSignal): Promise<ParsedScene> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!this.#worker) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return parseSceneBuffer(buffer);
    }
    const id = ++this.#requestId;
    return new Promise<ParsedScene>((resolve, reject) => {
      const abort = (): void => {
        this.#pending.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.#pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value);
        },
        reject: (reason) => {
          signal?.removeEventListener("abort", abort);
          reject(reason);
        },
      });
      this.#worker?.postMessage({ id, buffer }, [buffer]);
    });
  }

  #failAll(problem: string): void {
    for (const pending of this.#pending.values()) pending.reject(new ContractError(problem));
    this.#pending.clear();
    this.#worker?.terminate();
    this.#worker = null;
  }

  dispose(): void {
    this.#failAll("scene-parser-disposed");
    if (this.#workerUrl) URL.revokeObjectURL(this.#workerUrl);
    this.#workerUrl = null;
  }
}
