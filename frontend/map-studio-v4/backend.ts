import type { AreaOutline } from "./area-outline";
import { MAX_ROOM_SEQUENCE_SIZE, type HassLike } from "./contracts";
import {
  CATALOG_URL,
  ContractError,
  DELTA_HEADER_BYTES,
  DELTA_MAX_BYTES,
  SCENE_MAX_BYTES,
  isPrivatePath,
  parseAreasCatalog,
  parseCatalog,
  parseHistoryCatalog,
  parseManualRoomSequencePreview,
  parsePlansCatalog,
  parsePose,
  type AreaCircle,
  type AreasCatalog,
  type CleaningMode,
  type CoverageSetting,
  type HistoryCatalog,
  type MapEntry,
  type ManualRoomSequencePreview,
  type PlansCatalog,
  type PoseModel,
  type SceneModel,
} from "./backend-contracts";
import { SceneParser } from "./scene-parser";
import {
  BackendRequestDiagnosticsStore,
  type BackendRequestDiagnostics,
  type BackendRequestOperation,
  type BackendRequestOutcome,
} from "./request-diagnostics";

const REQUEST_TIMEOUTS = {
  catalog: 10_000,
  scene: 60_000,
  delta: 35_000,
  pose: 10_000,
  history: 15_000,
  workflow: 15_000,
  mutation: 20_000,
  roomPreview: 15_000,
} as const;
const MAX_OUTSTANDING_ROOM_PREVIEW_WIRES = 2;
const roomPreviewWireCountByConnection = new WeakMap<object, number>();
const COVERAGE_GUARD_RECOVERY: Readonly<Record<string, string>> = {
  coverage_identity_unavailable: "Could not verify the current cleaning task. Check the robot status, then try again.",
  coverage_activity_unavailable: "Could not verify whether the robot is cleaning. Check the robot status, then try again.",
  coverage_native_session_active: "The robot already has a cleaning task. Wait for it to finish before starting another cleaning task.",
  coverage_identity_changed: "The cleaning task changed during setup. Check the robot status, then try again.",
};

const safeCoverageGuardError = (
  error: unknown,
  localize: ((key: string) => string) | undefined,
): BackendError | null => {
  if (!error || typeof error !== "object") return null;
  const translated = error as { translation_domain?: unknown; translation_key?: unknown };
  if (translated.translation_domain !== "matic_robot"
    || typeof translated.translation_key !== "string"
    || !Object.hasOwn(COVERAGE_GUARD_RECOVERY, translated.translation_key)) return null;
  const key = translated.translation_key;
  let recovery = COVERAGE_GUARD_RECOVERY[key];
  try {
    const localized = localize?.(`component.matic_robot.exceptions.${key}.message`);
    if (localized && localized !== `component.matic_robot.exceptions.${key}.message`) recovery = localized;
  } catch {
    // Fixed English copy remains safe if Home Assistant localization fails.
  }
  return new BackendError(key, null, recovery);
};

export class BackendError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly recoveryMessage: string | null;

  constructor(code: string, status: number | null = null, recoveryMessage: string | null = null) {
    super(recoveryMessage ?? code);
    this.name = "BackendError";
    this.code = code;
    this.status = status;
    this.recoveryMessage = recoveryMessage;
  }
}

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
  readonly #parser = new SceneParser();
  readonly #roomPreviewWireInFlight = new WeakMap<object, Promise<void>>();
  readonly #serviceWaits = new Set<() => void>();
  readonly #requestDiagnostics = new BackendRequestDiagnosticsStore();
  #disposed = false;

  constructor(getHass: () => HassLike | undefined) {
    this.#getHass = getHass;
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
    if (!isPrivatePath(path)) throw new BackendError("invalid-private-path");
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
    const timeout = window.setTimeout(() => {
      timedOut = true;
      abort();
    }, timeoutMs);
    try {
      const hass = this.#getHass();
      // Home Assistant's fetchWithAuth wrapper merges plain header records when it
      // injects the bearer token. Passing a native Headers instance works with the
      // browser fetch API but can bypass that merge and produce an unauthenticated
      // request for binary scene and delta resources.
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
        const conflict = response.headers.get("X-Matic-Plans-Conflict");
        throw new BackendError(
          conflict === "map-rechecking" ? "map-rechecking" : "request-failed",
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

  async scene(
    path: string,
    expectedRevision: number,
    expectedFloorCoherent: boolean,
    source: "live" | "history",
    signal?: AbortSignal,
    etag?: string | null,
  ): Promise<SceneResponse> {
    const headers = new Headers({ Accept: "application/vnd.matic.slam-scene" });
    if (source === "live") headers.set("X-Matic-Prefer-Cached", "1");
    if (etag) headers.set("If-None-Match", etag);
    return this.#request("scene", path, { headers }, REQUEST_TIMEOUTS.scene, signal, async (response, operationSignal) => {
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
      const parsed = await this.#parser.parse(
        await this.#readBody(response, operationSignal, SCENE_MAX_BYTES, "invalid-scene-size"),
        operationSignal,
      );
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
    });
  }

  async sceneDelta(
    path: string,
    base: SceneModel,
    expectedFloorCoherent: boolean,
    signal?: AbortSignal,
  ): Promise<SceneResponse> {
    const separator = path.includes("?") ? "&" : "?";
    return this.#request(
      "sceneDelta",
      `${path}${separator}since=${encodeURIComponent(base.revision)}`,
      { headers: { Accept: "application/vnd.matic.slam-delta, application/vnd.matic.slam-scene" } },
      REQUEST_TIMEOUTS.delta,
      signal,
      async (response, operationSignal) => {
        const revision = responseRevision(response, base.revision);
        const floorCoherent = floorHeader(response, expectedFloorCoherent);
        if (response.status === 204) {
          if (revision !== base.revision) throw new ContractError("invalid-scene-delta-revision");
          return { scene: null, floorCoherent, revision, notModified: true };
        }
        if (!response.ok) throw new BackendError("delta-request-failed", response.status);
        if (revision <= base.revision) throw new ContractError("invalid-scene-delta-revision");
        const contentType = response.headers.get("Content-Type")?.split(";", 1)[0];
        if (contentType !== "application/vnd.matic.slam-delta"
          && contentType !== "application/vnd.matic.slam-scene") {
          throw new ContractError("invalid-scene-delta-content-type");
        }
        const deltaPayload = contentType === "application/vnd.matic.slam-delta";
        const maxResponseBytes = deltaPayload ? DELTA_HEADER_BYTES + DELTA_MAX_BYTES : SCENE_MAX_BYTES;
        const declaredLength = Number(response.headers.get("Content-Length"));
        if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
          throw new ContractError(deltaPayload ? "invalid-scene-delta-size" : "invalid-scene-size");
        }
        const payload = await this.#readBody(
          response,
          operationSignal,
          maxResponseBytes,
          deltaPayload ? "invalid-scene-delta-size" : "invalid-scene-size",
        );
        if (deltaPayload) {
          const baseHeader = Number(response.headers.get("X-Matic-Base-Revision"));
          if (!Number.isSafeInteger(baseHeader) || baseHeader !== base.revision) {
            throw new ContractError("invalid-scene-delta-base");
          }
          const decoded = await this.#parser.decodeDelta(payload, base, operationSignal);
          if (decoded.revision !== revision) throw new ContractError("invalid-scene-delta-revision");
          return {
            scene: {
              ...decoded.parsed,
              revision,
              etag: response.headers.get("ETag"),
              source: "live",
              ...(decoded.deltaHint ? { deltaHint: decoded.deltaHint } : {}),
            },
            floorCoherent,
            revision,
            notModified: false,
          };
        }
        const parsed = await this.#parser.parse(payload, operationSignal);
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
      },
    );
  }

  async pose(path: string, signal?: AbortSignal): Promise<PoseModel> {
    return parsePose(await this.#json("pose", path, REQUEST_TIMEOUTS.pose, signal));
  }

  async history(path: string, signal?: AbortSignal): Promise<HistoryCatalog> {
    return parseHistoryCatalog(await this.#json("history", path, REQUEST_TIMEOUTS.history, signal));
  }

  async plans(path: string, signal?: AbortSignal): Promise<PlansCatalog> {
    return parsePlansCatalog(await this.#json("plans", path, REQUEST_TIMEOUTS.workflow, signal));
  }

  async areas(path: string, signal?: AbortSignal): Promise<AreasCatalog> {
    return parseAreasCatalog(await this.#json("areas", path, REQUEST_TIMEOUTS.workflow, signal));
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
    if (!connection?.sendMessagePromise) throw new BackendError("preview-unavailable");

    let timeout: number | null = null;
    let rejectAbort: (reason: DOMException) => void = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const previous = this.#roomPreviewWireInFlight.get(connection);
    let releaseTurn!: () => void;
    const turn = new Promise<void>((resolve) => { releaseTurn = resolve; });
    this.#roomPreviewWireInFlight.set(connection, turn);
    let turnReleased = false;
    const release = (): void => {
      if (turnReleased) return;
      turnReleased = true;
      releaseTurn();
      if (this.#roomPreviewWireInFlight.get(connection) === turn) {
        this.#roomPreviewWireInFlight.delete(connection);
      }
    };
    let wireStarted = false;
    const abort = (): void => {
      rejectAbort(new DOMException("Aborted", "AbortError"));
      if (wireStarted) {
        release();
        if (timeout !== null) window.clearTimeout(timeout);
        timeout = null;
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    // The deadline includes time spent in the FIFO queue. A queued timeout
    // rejects that caller immediately, but only an active wire turn can release
    // itself here; queued turns release after their predecessor in finally.
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = window.setTimeout(() => {
        timeout = null;
        reject(new BackendError("preview-timeout"));
      }, REQUEST_TIMEOUTS.roomPreview);
    });
    void deadline.catch(() => {
      if (wireStarted) release();
    });
    try {
      if (previous) {
        await Promise.race([previous, interrupted, deadline]);
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      }
      const outstandingWires = roomPreviewWireCountByConnection.get(connection) ?? 0;
      if (outstandingWires >= MAX_OUTSTANDING_ROOM_PREVIEW_WIRES) {
        throw new BackendError("preview-unavailable");
      }
      const wire = connection.sendMessagePromise<unknown>({
          type: "call_service",
          domain: "matic_robot",
          service: "preview_room_sequence",
          target: { entity_id: entityId },
          service_data: {
            rooms: rooms.map((room) => ({
              room: room.room,
              cleaning_mode: room.cleaning_mode,
              coverage_setting: room.coverage_setting,
            })),
            use_room_schedule: true,
            override_room_schedule: overrideRoomSchedule,
          },
          return_response: true,
        });
      roomPreviewWireCountByConnection.set(connection, outstandingWires + 1);
      wireStarted = true;
      let wireCountReleased = false;
      const settleWire = (): void => {
        if (!wireCountReleased) {
          wireCountReleased = true;
          const remainingWires = (roomPreviewWireCountByConnection.get(connection) ?? 1) - 1;
          if (remainingWires === 0) roomPreviewWireCountByConnection.delete(connection);
          else roomPreviewWireCountByConnection.set(connection, remainingWires);
        }
        release();
        if (timeout !== null) window.clearTimeout(timeout);
        timeout = null;
      };
      void wire.then(settleWire, settleWire);
      const response = await Promise.race([
        wire,
        interrupted,
        deadline,
      ]);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (!response || typeof response !== "object" || Array.isArray(response)
        || !("response" in response)) {
        throw new ContractError("invalid-room-sequence-preview-envelope");
      }
      return parseManualRoomSequencePreview((response as { response: unknown }).response);
    } finally {
      if (!wireStarted) {
        if (previous) void previous.then(release, release);
        else release();
        if (timeout !== null) window.clearTimeout(timeout);
        timeout = null;
      }
      signal?.removeEventListener("abort", abort);
    }
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

  async deleteArea(path: string, areaId: string, signal?: AbortSignal): Promise<void> {
    await this.#request(
      "areaDelete",
      `${path}?area_id=${encodeURIComponent(areaId)}`,
      { method: "DELETE", headers: { Accept: "application/json" } },
      REQUEST_TIMEOUTS.mutation,
      signal,
      async (response) => {
        if (!response.ok) throw new BackendError("area-delete-failed", response.status);
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
    let timeout: number | null = null;
    let cancelWait: (() => void) | null = null;
    try {
      const request = options.returnResponse
        ? hass.callService(domain, service, data, { entity_id: entityId }, true, true)
        : hass.callService(domain, service, data, { entity_id: entityId });
      if (!options.returnResponse && !options.acknowledgementTimeout) return await request;
      return await Promise.race([
        request,
        new Promise<never>((_resolve, reject) => {
          cancelWait = () => {
            if (timeout !== null) window.clearTimeout(timeout);
            timeout = null;
            reject(new DOMException("Aborted", "AbortError"));
          };
          this.#serviceWaits.add(cancelWait);
          timeout = window.setTimeout(() => reject(new BackendError("mutation-timeout")), REQUEST_TIMEOUTS.mutation);
        }),
      ]);
    } catch (error) {
      throw safeCoverageGuardError(error, hass.localize) ?? error;
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
      if (cancelWait) this.#serviceWaits.delete(cancelWait);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#requestDiagnostics.dispose();
    for (const cancelWait of this.#serviceWaits) cancelWait();
    this.#serviceWaits.clear();
    this.#parser.dispose();
  }
}
