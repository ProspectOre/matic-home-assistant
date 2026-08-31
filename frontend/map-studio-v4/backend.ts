import type { HassLike } from "./contracts";
import {
  CATALOG_URL,
  ContractError,
  SCENE_HEADER_BYTES,
  isPrivatePath,
  parseAreasCatalog,
  parseCatalog,
  parseHistoryCatalog,
  parsePlansCatalog,
  parsePose,
  type AreaCircle,
  type AreasCatalog,
  type CleaningMode,
  type CoverageSetting,
  type HistoryCatalog,
  type MapEntry,
  type PlansCatalog,
  type PoseModel,
  type SceneModel,
} from "./backend-contracts";
import { SceneParser } from "./scene-parser";

const REQUEST_TIMEOUTS = {
  catalog: 10_000,
  scene: 60_000,
  delta: 35_000,
  pose: 10_000,
  history: 15_000,
  workflow: 15_000,
  mutation: 20_000,
} as const;

export class BackendError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(code: string, status: number | null = null) {
    super(code);
    this.name = "BackendError";
    this.code = code;
    this.status = status;
  }
}

interface SceneResponse {
  readonly scene: SceneModel | null;
  readonly floorCoherent: boolean;
  readonly revision: number;
  readonly notModified: boolean;
}

const DELTA_HEADER_BYTES = 36;
const DELTA_MAX_BYTES = 16 * 1024 * 1024;

const safeRevision = (value: bigint, code: string): number => {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new ContractError(code);
  return revision;
};

const responseRevision = (response: Response, fallback: number): number => {
  const raw = response.headers.get("X-Matic-Revision");
  if (raw === null) return fallback;
  const revision = Number(raw);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new ContractError("invalid-scene-revision");
  return revision;
};

const floorHeader = (response: Response, fallback: boolean): boolean => {
  const raw = response.headers.get("X-Matic-Floor-Coherent");
  if (raw === null) return fallback;
  if (raw === "1") return true;
  if (raw === "0") return false;
  throw new ContractError("invalid-scene-floor-header");
};

export class MaticBackend {
  readonly #getHass: () => HassLike | undefined;
  readonly #parser = new SceneParser();

  constructor(getHass: () => HassLike | undefined) {
    this.#getHass = getHass;
  }

  async #request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (!isPrivatePath(path)) throw new BackendError("invalid-private-path");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const hass = this.#getHass();
      const requestInit: RequestInit = {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      };
      if (typeof hass?.fetchWithAuth === "function") {
        return await hass.fetchWithAuth(path, requestInit);
      }
      const token = hass?.auth?.accessToken || hass?.auth?.data?.access_token;
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const url = typeof hass?.hassUrl === "function" ? hass.hassUrl(path) : path;
      return await fetch(url, { ...requestInit, headers });
    } catch (error) {
      if (timedOut && !signal?.aborted) throw new BackendError("request-timeout");
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      throw error;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async #json(
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.#request(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers || {}),
      },
    }, timeoutMs, signal);
    if (!response.ok) throw new BackendError("request-failed", response.status);
    try {
      return await response.json();
    } catch {
      throw new ContractError("invalid-json-response");
    }
  }

  async catalog(signal?: AbortSignal): Promise<readonly MapEntry[]> {
    return parseCatalog(await this.#json(CATALOG_URL, REQUEST_TIMEOUTS.catalog, signal));
  }

  async scene(
    path: string,
    expectedRevision: number,
    expectedFloorCoherent: boolean,
    source: "live" | "history",
    signal?: AbortSignal,
    etag?: string | null,
  ): Promise<SceneResponse> {
    const headers = new Headers({ Accept: "application/vnd.matic.slam-scene" });
    if (etag) headers.set("If-None-Match", etag);
    const response = await this.#request(path, { headers }, REQUEST_TIMEOUTS.scene, signal);
    const revision = responseRevision(response, expectedRevision);
    const floorCoherent = floorHeader(response, expectedFloorCoherent);
    if (response.status === 304) {
      return { scene: null, floorCoherent, revision, notModified: true };
    }
    if (!response.ok) throw new BackendError("scene-request-failed", response.status);
    const contentType = response.headers.get("Content-Type")?.split(";", 1)[0];
    if (contentType !== "application/vnd.matic.slam-scene") {
      throw new ContractError("invalid-scene-content-type");
    }
    const parsed = await this.#parser.parse(await response.arrayBuffer(), signal);
    return {
      scene: {
        ...parsed,
        revision,
        etag: response.headers.get("ETag"),
        source,
      },
      floorCoherent,
      revision,
      notModified: false,
    };
  }

  async #inflateDelta(
    compressed: Uint8Array<ArrayBuffer>,
    expectedLength: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (!Number.isSafeInteger(expectedLength)
      || expectedLength < 1
      || expectedLength > DELTA_MAX_BYTES
      || typeof DecompressionStream !== "function") {
      throw new ContractError("invalid-scene-delta");
    }
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
    const reader = stream.getReader();
    const difference = new Uint8Array(expectedLength);
    let offset = 0;
    const abort = (): void => { void reader.cancel(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || offset + value.byteLength > expectedLength) {
          throw new ContractError("invalid-scene-delta");
        }
        difference.set(value, offset);
        offset += value.byteLength;
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      reader.releaseLock();
    }
    if (offset !== expectedLength) throw new ContractError("invalid-scene-delta");
    return difference;
  }

  async #applySceneDelta(
    payload: ArrayBuffer,
    base: SceneModel,
    signal?: AbortSignal,
  ): Promise<{ readonly parsed: SceneModel; readonly revision: number }> {
    if (payload.byteLength < DELTA_HEADER_BYTES
      || payload.byteLength > DELTA_HEADER_BYTES + DELTA_MAX_BYTES
      || base.buffer.byteLength > DELTA_MAX_BYTES) {
      throw new ContractError("invalid-scene-delta");
    }
    const view = new DataView(payload);
    const magic = new TextDecoder().decode(new Uint8Array(payload, 0, 8));
    const version = view.getUint16(8, true);
    const flags = view.getUint16(10, true);
    const baseRevision = safeRevision(view.getBigUint64(12, true), "invalid-scene-delta");
    const revision = safeRevision(view.getBigUint64(20, true), "invalid-scene-delta");
    const sceneLength = view.getUint32(28, true);
    const compressedLength = view.getUint32(32, true);
    if (magic !== "MATICDLT"
      || version !== 1
      || flags !== 1
      || baseRevision !== base.revision
      || revision <= base.revision
      || sceneLength < SCENE_HEADER_BYTES
      || sceneLength > DELTA_MAX_BYTES
      || compressedLength > DELTA_MAX_BYTES
      || compressedLength + DELTA_HEADER_BYTES !== payload.byteLength) {
      throw new ContractError("invalid-scene-delta");
    }
    const compressed = new Uint8Array(payload, DELTA_HEADER_BYTES, compressedLength);
    const baseBytes = new Uint8Array(base.buffer);
    const difference = await this.#inflateDelta(
      compressed,
      Math.max(baseBytes.byteLength, sceneLength),
      signal,
    );
    const result = difference.slice();
    const chunkBytes = 1024 * 1024;
    for (let start = 0; start < baseBytes.byteLength; start += chunkBytes) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const end = Math.min(baseBytes.byteLength, start + chunkBytes);
      for (let index = start; index < end; index += 1) {
        result[index] = (result[index] ?? 0) ^ (baseBytes[index] ?? 0);
      }
      if (end < baseBytes.byteLength) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }
    const sceneBuffer = result.slice(0, sceneLength).buffer;
    const parsed = await this.#parser.parse(sceneBuffer, signal);
    return {
      parsed: { ...parsed, revision, etag: null, source: "live" },
      revision,
    };
  }

  async sceneDelta(
    path: string,
    base: SceneModel,
    expectedFloorCoherent: boolean,
    signal?: AbortSignal,
  ): Promise<SceneResponse> {
    const separator = path.includes("?") ? "&" : "?";
    const response = await this.#request(
      `${path}${separator}since=${encodeURIComponent(base.revision)}`,
      { headers: { Accept: "application/vnd.matic.slam-delta, application/vnd.matic.slam-scene" } },
      REQUEST_TIMEOUTS.delta,
      signal,
    );
    const revision = responseRevision(response, base.revision);
    const floorCoherent = floorHeader(response, expectedFloorCoherent);
    if (response.status === 204) {
      if (revision !== base.revision) throw new ContractError("invalid-scene-delta-revision");
      return { scene: null, floorCoherent, revision, notModified: true };
    }
    if (!response.ok) throw new BackendError("delta-request-failed", response.status);
    if (revision <= base.revision) throw new ContractError("invalid-scene-delta-revision");
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > DELTA_HEADER_BYTES + DELTA_MAX_BYTES) {
      throw new ContractError("invalid-scene-delta-size");
    }
    const contentType = response.headers.get("Content-Type")?.split(";", 1)[0];
    const payload = await response.arrayBuffer();
    if (contentType === "application/vnd.matic.slam-delta") {
      const baseHeader = Number(response.headers.get("X-Matic-Base-Revision"));
      if (!Number.isSafeInteger(baseHeader) || baseHeader !== base.revision) {
        throw new ContractError("invalid-scene-delta-base");
      }
      const decoded = await this.#applySceneDelta(payload, base, signal);
      if (decoded.revision !== revision) throw new ContractError("invalid-scene-delta-revision");
      return {
        scene: { ...decoded.parsed, etag: response.headers.get("ETag") },
        floorCoherent,
        revision,
        notModified: false,
      };
    }
    if (contentType !== "application/vnd.matic.slam-scene") {
      throw new ContractError("invalid-scene-delta-content-type");
    }
    const parsed = await this.#parser.parse(payload, signal);
    return {
      scene: {
        ...parsed,
        revision,
        etag: response.headers.get("ETag"),
        source: "live",
      },
      floorCoherent,
      revision,
      notModified: false,
    };
  }

  async pose(path: string, signal?: AbortSignal): Promise<PoseModel> {
    return parsePose(await this.#json(path, REQUEST_TIMEOUTS.pose, signal));
  }

  async history(path: string, signal?: AbortSignal): Promise<HistoryCatalog> {
    return parseHistoryCatalog(await this.#json(path, REQUEST_TIMEOUTS.history, signal));
  }

  async plans(path: string, signal?: AbortSignal): Promise<PlansCatalog> {
    return parsePlansCatalog(await this.#json(path, REQUEST_TIMEOUTS.workflow, signal));
  }

  async areas(path: string, signal?: AbortSignal): Promise<AreasCatalog> {
    return parseAreasCatalog(await this.#json(path, REQUEST_TIMEOUTS.workflow, signal));
  }

  async saveArea(
    path: string,
    value: {
      readonly areaId: string | null;
      readonly name: string;
      readonly circles: readonly AreaCircle[];
      readonly cleaningMode: CleaningMode;
      readonly coverageSetting: CoverageSetting;
    },
    signal?: AbortSignal,
  ): Promise<string> {
    const payload = await this.#json(path, REQUEST_TIMEOUTS.mutation, signal, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(value.areaId ? { area_id: value.areaId } : {}),
        name: value.name,
        circles: value.circles,
        cleaning_mode: value.cleaningMode,
        coverage_setting: value.coverageSetting,
      }),
    });
    if (!payload || typeof payload !== "object" || typeof (payload as { id?: unknown }).id !== "string") {
      throw new ContractError("invalid-area-save-response");
    }
    return (payload as { id: string }).id;
  }

  async deleteArea(path: string, areaId: string, signal?: AbortSignal): Promise<void> {
    const response = await this.#request(
      `${path}?area_id=${encodeURIComponent(areaId)}`,
      { method: "DELETE", headers: { Accept: "application/json" } },
      REQUEST_TIMEOUTS.mutation,
      signal,
    );
    if (!response.ok) throw new BackendError("area-delete-failed", response.status);
  }

  async service(
    domain: string,
    service: string,
    data: Readonly<Record<string, unknown>>,
    entityId: string,
  ): Promise<void> {
    const hass = this.#getHass();
    if (typeof hass?.callService !== "function") throw new BackendError("service-unavailable");
    await hass.callService(domain, service, data, { entity_id: entityId });
  }

  dispose(): void {
    this.#parser.dispose();
  }
}
