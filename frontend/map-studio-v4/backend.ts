import type { AreaOutline } from "./area-outline";
import { MAX_ROOM_SEQUENCE_SIZE, type FloorTypesLayer, type HassLike, type WifiSignalLayer } from "./contracts";
import {
  CATALOG_URL,
  ContractError,
  MANIFEST_MAX_BYTES,
  PAGE_POINT_BYTES,
  PAGES_PER_REQUEST,
  SCENE_MAX_BYTES,
  isPrivatePath,
  parseCatalog,
  type AreaCircle,
  type AreasCatalog,
  type CleaningMode,
  type CoverageSetting,
  type HistoryCatalog,
  type MapEntry,
  type ManualRoomSequencePreview,
  type PlansCatalog,
  type SceneModel,
} from "./backend-contracts";
import { SceneParser as SceneParserImplementation, manifestPages, type PageBatch, type SceneParser } from "./scene-parser";
import {
  BackendRequestDiagnosticsStore,
  type BackendRequestDiagnostics,
  type BackendRequestOperation,
  type BackendRequestOutcome,
} from "./request-diagnostics";

// The integration rejects robot pictures over 8 MB (client/history.py).
const REQUEST_TIMEOUTS = {
  catalog: 10_000,
  scene: 60_000,
  history: 15_000,
  runs: 25_000,
  workflow: 15_000,
  // A first read of the robot's semantic pages can take most of a minute.
  floorTypes: 50_000,
  mutation: 20_000,
} as const;

export class BackendError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly completion?: Promise<unknown>;

  constructor(code: string, status: number | null = null) {
    super(code);
    this.name = "BackendError";
    this.code = code;
    this.status = status;
  }
}

export const isAccessDeniedError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  const status = value.status ?? value.statusCode;
  return status === 401 || status === 403 || value.code === "unauthorized"
    || value.code === "not_authorized" || value.code === "auth_invalid";
};

interface SceneResponse {
  readonly scene: SceneModel | null;
  readonly floorCoherent: boolean;
  readonly revision: number;
  readonly notModified: boolean;
}

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
  readonly #parser: SceneParser = new SceneParserImplementation();
  readonly #roomPreviewWireInFlight = new WeakMap<object, Promise<void>>();
  readonly #serviceWaits = new Set<() => void>();
  readonly #requestDiagnostics = new BackendRequestDiagnosticsStore();
  #accessDeniedHandler: (() => void) | null = null;
  #accessDeniedRegistration = 0;
  #disposed = false;

  constructor(getHass: () => HassLike | undefined) {
    this.#getHass = getHass;
  }

  setAccessDeniedHandler(handler: () => void): void {
    this.#accessDeniedHandler = handler;
    this.#accessDeniedRegistration += 1;
  }

  #accessFailureHandler(): (error: unknown) => void {
    const backend = new WeakRef(this);
    const registration = this.#accessDeniedRegistration;
    const hass = this.#getHass();
    const userId = hass?.user?.id;
    const connection = hass?.connection;
    return (error) => {
      const owner = backend.deref();
      if (!owner || !isAccessDeniedError(error) || owner.#disposed
        || owner.#accessDeniedRegistration !== registration) return;
      const current = owner.#getHass();
      if (owner.#accessDeniedHandler && current?.user?.id === userId && current?.connection === connection) {
        owner.#accessDeniedHandler();
      }
    };
  }

  #sceneParser(): Promise<SceneParser> {
    if (this.#disposed) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return Promise.resolve(this.#parser);
  }

  /**
   * Returns a frozen aggregate of operations admitted to #request and already settled.
   * Durations include consume/body decoding; transforms after #request resolves are excluded.
   */
  requestDiagnostics(): BackendRequestDiagnostics {
    return this.#requestDiagnostics.snapshot();
  }

  async #readBody(
    response: Response,
    signal: AbortSignal,
    maxBytes = Number.POSITIVE_INFINITY,
    sizeError = "invalid-response-size",
  ): Promise<ArrayBuffer> {
    const reader = response.body?.getReader();
    if (!reader) return new ArrayBuffer(0);
    const cancel = (): void => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      if (signal.aborted) {
        cancel();
        throw new DOMException("Aborted", "AbortError");
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (chunk.done) break;
        if (length + chunk.value.byteLength > maxBytes) {
          void reader.cancel().catch(() => {});
          throw new ContractError(sizeError);
        }
        chunks.push(chunk.value);
        length += chunk.value.byteLength;
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes.buffer;
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
  }

  async #request<T>(
    operation: BackendRequestOperation,
    path: string,
    init: RequestInit,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    // The query (page addresses, a revision) is built here, not taken from the server.
    if (!isPrivatePath(path.split("?", 1)[0])) throw new BackendError("invalid-private-path");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const started = performance.now();
    let outcome: BackendRequestOutcome = "failed";
    const controller = new AbortController();
    let rejectAbort: (reason: DOMException) => void = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const abort = (): void => {
      controller.abort();
      rejectAbort(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const requestFailed = this.#accessFailureHandler();
    let receivedResponse = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      abort();
    }, timeoutMs);
    try {
      const hass = this.#getHass();
      // Home Assistant's fetchWithAuth wrapper merges plain header records when it
      // injects the bearer token. Passing a native Headers instance works with the
      // browser fetch API but can bypass that merge and produce an unauthenticated
      // request for binary scene and page resources.
      const headers = new Headers(init.headers);
      const requestInit: RequestInit = {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        headers: Object.fromEntries(headers.entries()),
        signal: controller.signal,
      };
      const execute = async (): Promise<T> => {
        let response: Response;
        if (typeof hass?.fetchWithAuth === "function") {
          response = await hass.fetchWithAuth(path, requestInit);
        } else {
          const token = hass?.auth?.accessToken || hass?.auth?.data?.access_token;
          if (token) headers.set("Authorization", `Bearer ${token}`);
          const url = typeof hass?.hassUrl === "function" ? hass.hassUrl(path) : path;
          response = await fetch(url, { ...requestInit, headers });
        }
        try {
          receivedResponse = true;
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
          requestFailed(response);
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
          return await consume(response, controller.signal);
        } finally {
          // Release unread error responses and headers delivered after abort.
          if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
        }
      };
      // Keep the deadline alive through body consumption and decoding, not
      // merely until response headers arrive. Cancellation also settles when
      // a host wrapper fails to propagate the supplied fetch signal.
      const result = await Promise.race([execute(), interrupted]);
      outcome = "completed";
      return result;
    } catch (error) {
      if (timedOut && !signal?.aborted) {
        outcome = "timedOut";
        throw new BackendError("request-timeout");
      }
      if (controller.signal.aborted) {
        outcome = "aborted";
        throw new DOMException("Aborted", "AbortError");
      }
      if (!receivedResponse) requestFailed(error);
      throw error;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      this.#requestDiagnostics.record(operation, outcome, performance.now() - started);
    }
  }

  async #json(
    operation: BackendRequestOperation,
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
    init: RequestInit = {},
  ): Promise<unknown> {
    return this.#request(operation, path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers || {}),
      },
    }, timeoutMs, signal, async (response, operationSignal) => {
      if (!response.ok) {
        const conflict = operation === "areas"
          ? response.headers.get("X-Matic-Areas-Conflict")
          : operation === "plans" ? response.headers.get("X-Matic-Plans-Conflict") : null;
        throw new BackendError(
          response.status === 409 && conflict === "map-rechecking" ? "map-rechecking" : "request-failed",
          response.status,
        );
      }
      try {
        return JSON.parse(new TextDecoder().decode(await this.#readBody(response, operationSignal)));
      } catch {
        throw new ContractError("invalid-json-response");
      }
    });
  }

  async catalog(signal?: AbortSignal): Promise<readonly MapEntry[]> {
    return parseCatalog(await this.#json("catalog", CATALOG_URL, REQUEST_TIMEOUTS.catalog, signal));
  }

  /**
   * Reads a saved scene, or a live manifest and the pages `base` lacks. With
   * `since`, the server holds the request until the revision moves on and
   * answers 204 when it does not.
   */
  async scene(
    path: string,
    expectedRevision: number,
    expectedFloorCoherent: boolean,
    source: "live" | "history",
    signal?: AbortSignal,
    follow: { readonly since?: number; readonly base?: SceneModel | null } = {},
  ): Promise<SceneResponse> {
    const parser = this.#sceneParser();
    void parser.catch(() => {});
    const headers = new Headers({ Accept: "application/vnd.matic.slam-manifest, application/vnd.matic.slam-scene" });
    if (source === "live" && follow.since === undefined) headers.set("X-Matic-Prefer-Cached", "1");
    const query = follow.since === undefined ? "" : `?since=${encodeURIComponent(follow.since)}`;
    return this.#request("scene", `${path}${query}`, { headers }, REQUEST_TIMEOUTS.scene, signal, async (response, operationSignal) => {
      const revision = responseRevision(response, expectedRevision);
      const floorCoherent = floorHeader(response, expectedFloorCoherent);
      if (response.status === 204 || response.status === 304) {
        return { scene: null, floorCoherent, revision, notModified: true };
      }
      if (!response.ok) throw new BackendError("scene-request-failed", response.status);
      const contentType = response.headers.get("Content-Type")?.split(";", 1)[0];
      const etag = response.headers.get("ETag");
      if (contentType === "application/vnd.matic.slam-manifest") {
        const manifest = await this.#readBody(response, operationSignal, MANIFEST_MAX_BYTES, "invalid-scene-manifest");
        const base = follow.base?.manifest ? follow.base : null;
        const batches = await this.#scenePages(path, manifest, base, operationSignal);
        const { parsed, deltaHint } = await (await parser).assemble(manifest, batches, base, operationSignal);
        return {
          scene: { ...parsed, revision, etag, source, manifest, ...(deltaHint ? { deltaHint } : {}) },
          floorCoherent,
          revision,
          notModified: false,
        };
      }
      if (contentType !== "application/vnd.matic.slam-scene") {
        throw new ContractError("invalid-scene-content-type");
      }
      const parsed = await (await parser).parse(
        await this.#readBody(response, operationSignal, SCENE_MAX_BYTES, "invalid-scene-size"),
        operationSignal,
      );
      return {
        scene: { ...parsed, revision, etag, source },
        floorCoherent,
        revision,
        notModified: false,
      };
    });
  }

  /** Fetches, four requests at a time, the pages of `manifest` that `base` lacks. */
  async #scenePages(
    path: string,
    manifest: ArrayBuffer,
    base: SceneModel | null,
    signal: AbortSignal,
  ): Promise<PageBatch[]> {
    const known = new Set(base?.manifest ? manifestPages(base.manifest).map((page) => page.id) : []);
    const wanted = new Map<string, number>();
    for (const page of manifestPages(manifest)) {
      const bytes = (page.floor + page.surface) * PAGE_POINT_BYTES;
      if (bytes > 0 && !known.has(page.id)) wanted.set(page.id, bytes);
    }
    const ids = [...wanted.keys()];
    const groups: string[][] = [];
    for (let start = 0; start < ids.length; start += PAGES_PER_REQUEST) groups.push(ids.slice(start, start + PAGES_PER_REQUEST));
    const batches: PageBatch[] = [];
    for (let start = 0; start < groups.length; start += 4) {
      batches.push(...await Promise.all(groups.slice(start, start + 4).map((group) => this.#request(
        "scenePages",
        `${path}/pages?ids=${group.join(",")}`,
        { headers: { Accept: "application/octet-stream" } },
        REQUEST_TIMEOUTS.scene,
        signal,
        async (response, operationSignal) => {
          if (!response.ok) throw new BackendError("scene-pages-request-failed", response.status);
          const length = group.reduce((sum, id) => sum + (wanted.get(id) ?? 0), 0);
          const body = await this.#readBody(response, operationSignal, length, "invalid-scene-pages");
          if (body.byteLength !== length) throw new ContractError("invalid-scene-pages");
          return { ids: group, body };
        },
      ))));
    }
    return batches;
  }

  async history(path: string, signal?: AbortSignal): Promise<HistoryCatalog> {
    const [{ parseHistoryCatalog }, value] = await Promise.all([
      import("./history-catalog"),
      this.#json("history", path, REQUEST_TIMEOUTS.history, signal),
    ]);
    return parseHistoryCatalog(value);
  }

  async archiveRequest(entryId: string, operation: "manage" | "export" | "import", body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const { decodeArchiveResponse } = await import("./archive-request");
    const path = `/api/matic_robot/slam_history/${encodeURIComponent(entryId)}/${operation}`;
    return this.#request("history", path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, 60_000, signal, (response, operationSignal) => decodeArchiveResponse(
      response, operationSignal,
      (target, activeSignal, maxBytes, invalidCode) => this.#readBody(target, activeSignal, maxBytes, invalidCode),
      (code, status) => new BackendError(code, status),
    ));
  }

  async setDailyRoomLimit(entryId: string, floorToken: string, roomId: string, limit: number | null, signal?: AbortSignal): Promise<void> {
    const { dailyLimitRequest } = await import("./daily-limit-request");
    const { path, init } = dailyLimitRequest(entryId, floorToken, roomId, limit,
      () => new ContractError("invalid-daily-limit"));
    await this.#json("plans", path, REQUEST_TIMEOUTS.mutation, signal, init);
  }

  /** Cleaning history, or one trail; run-history-data.ts decodes it. */
  async runs(entryId: string, trail: string | null, signal?: AbortSignal): Promise<unknown> {
    const query = trail ? `?trail=${encodeURIComponent(trail)}` : "";
    return this.#json("runs", `/api/matic_robot/runs/${encodeURIComponent(entryId)}${query}`, REQUEST_TIMEOUTS.runs, signal);
  }

  /** The robot's WebP map of one clean, named by its robot history id. */
  async runThumbnail(entryId: string, id: string, signal?: AbortSignal): Promise<Blob> {
    const { runThumbnailResponse } = await import("./run-history-transport");
    const path = `/api/matic_robot/run_thumbnail/${encodeURIComponent(entryId)}/${encodeURIComponent(id)}`;
    return this.#request("runs", path, { headers: { Accept: "image/webp" } }, REQUEST_TIMEOUTS.runs, signal,
      (response, operationSignal) => runThumbnailResponse(response, operationSignal,
        (target, activeSignal, maxBytes, invalidCode) => this.#readBody(target, activeSignal, maxBytes, invalidCode),
        (code, status) => new BackendError(code, status), (code) => new ContractError(code)));
  }

  async plans(path: string, signal?: AbortSignal): Promise<PlansCatalog> {
    const [{ parsePlansCatalog }, value] = await Promise.all([
      import("./plan-catalog"),
      this.#json("plans", path, REQUEST_TIMEOUTS.workflow, signal),
    ]);
    return parsePlansCatalog(value);
  }

  async areas(path: string, signal?: AbortSignal): Promise<AreasCatalog> {
    const [{ parseAreasCatalog }, { areaCatalogHelpers }, geometry, value] = await Promise.all([
      import("./area-catalog"),
      import("./plan-catalog"),
      import("./area-outline"),
      this.#json("areas", path, REQUEST_TIMEOUTS.workflow, signal),
    ]);
    return parseAreasCatalog(value, areaCatalogHelpers, geometry);
  }

  async wifiSignal(path: string, signal?: AbortSignal): Promise<WifiSignalLayer> {
    const [{ parseWifiSignal }, value] = await Promise.all([
      import("./wifi-signal"),
      this.#json("wifiSignal", path, REQUEST_TIMEOUTS.workflow, signal),
    ]);
    return parseWifiSignal(value);
  }

  async floorTypes(path: string, signal?: AbortSignal): Promise<FloorTypesLayer> {
    const [{ parseFloorTypes }, value] = await Promise.all([
      import("./floor-types"),
      this.#json("carpetVents", path, REQUEST_TIMEOUTS.floorTypes, signal),
    ]);
    return parseFloorTypes(value);
  }

  async previewRoomSequence(
    entityId: string,
    rooms: readonly {
      readonly room: string;
      readonly cleaning_mode: CleaningMode;
      readonly coverage_setting: CoverageSetting;
    }[],
    overrideRoomSchedule: boolean,
    signal?: AbortSignal,
  ): Promise<ManualRoomSequencePreview> {
    if (!entityId || entityId.length > 255 || rooms.length < 1 || rooms.length > MAX_ROOM_SEQUENCE_SIZE) {
      throw new ContractError("invalid-room-sequence-preview-request");
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const connection = this.#getHass()?.connection;
    const requestFailed = this.#accessFailureHandler();
    if (!connection?.sendMessagePromise) throw new BackendError("preview-unavailable");

    const [{ requestRoomPreview }, { roomPreviewHelpers }] = await Promise.all([
      import("./room-preview"),
      import("./plan-catalog"),
    ]);
    if (this.#disposed || signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return requestRoomPreview(connection, this.#roomPreviewWireInFlight, entityId, rooms, overrideRoomSchedule, signal,
      { BackendError, requestFailed, ...roomPreviewHelpers });
  }

  async saveArea(
    path: string,
    value: {
      readonly areaId: string | null;
      readonly name: string;
      readonly circles: readonly AreaCircle[];
      readonly outline?: AreaOutline | null;
      readonly cleaningMode: CleaningMode;
      readonly coverageSetting: CoverageSetting;
    },
    signal?: AbortSignal,
  ): Promise<string> {
    const payload = await this.#json("areaSave", path, REQUEST_TIMEOUTS.mutation, signal, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(value.areaId ? { area_id: value.areaId } : {}),
        name: value.name,
        circles: value.circles,
        ...(value.outline?.closed ? { outline: value.outline.points } : {}),
        cleaning_mode: value.cleaningMode,
        coverage_setting: value.coverageSetting,
      }),
    });
    if (!payload || typeof payload !== "object" || typeof (payload as { id?: unknown }).id !== "string") {
      throw new ContractError("invalid-area-save-response");
    }
    return (payload as { id: string }).id;
  }

  /**
   * Deletes one area. A 409 deleted nothing: its untrusted body names the plans
   * the area would leave empty, and the caller validates and reports them.
   */
  async deleteArea(path: string, areaId: string, signal?: AbortSignal): Promise<unknown> {
    return this.#request(
      "areaDelete",
      `${path}?area_id=${encodeURIComponent(areaId)}`,
      { method: "DELETE", headers: { Accept: "application/json" } },
      REQUEST_TIMEOUTS.mutation,
      signal,
      async (response): Promise<unknown> => {
        if (response.status === 409) return response.json();
        if (!response.ok) throw new BackendError("area-delete-failed", response.status);
        return undefined;
      },
    );
  }

  async service(
    domain: string,
    service: string,
    data: Readonly<Record<string, unknown>>,
    entityId: string,
    options: { returnResponse?: boolean; acknowledgementTimeout?: "mutation" } = {},
  ): Promise<unknown> {
    const hass = this.#getHass();
    if (this.#disposed || typeof hass?.callService !== "function") throw new BackendError("service-unavailable");
    const requestFailed = this.#accessFailureHandler();
    let denialReported = false;
    const reportDenial = (error: unknown): void => {
      if (denialReported || !isAccessDeniedError(error)) return;
      denialReported = true;
      requestFailed(error);
    };
    let timeout: number | null = null;
    let cancelWait: (() => void) | null = null;
    try {
      const request = options.returnResponse
        ? hass.callService(domain, service, data, { entity_id: entityId }, true, true)
        : hass.callService(domain, service, data, { entity_id: entityId });
      // An acknowledgement deadline cannot cancel HA's RPC; keep its access
      // refusal bound to this request owner even after the caller times out.
      void request.catch(reportDenial);
      if (!options.returnResponse && !options.acknowledgementTimeout) return request;
      return await Promise.race([
        request,
        new Promise<never>((_resolve, reject) => {
          cancelWait = () => {
            if (timeout !== null) window.clearTimeout(timeout);
            timeout = null;
            reject(Object.assign(new DOMException("Aborted", "AbortError"), { completion: request }));
          };
          this.#serviceWaits.add(cancelWait);
          timeout = window.setTimeout(() => reject(Object.assign(new BackendError("mutation-timeout"), { completion: request })), REQUEST_TIMEOUTS.mutation);
        }),
      ]);
    } catch (error) {
      reportDenial(error);
      throw error;
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
      if (cancelWait) this.#serviceWaits.delete(cancelWait);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#accessDeniedHandler = null;
    this.#accessDeniedRegistration += 1;
    this.#requestDiagnostics.dispose();
    for (const cancelWait of this.#serviceWaits) cancelWait();
    this.#serviceWaits.clear();
    this.#parser.dispose();
  }
}
