import type {
  HassProjection,
  PanelLike,
  ResourceStamp,
  WorkspaceState,
  Workflow,
} from "./contracts";
import {
  type AreaCircle,
  type HistoryFloor,
  type HistorySnapshot,
  type MapEntry,
  type PlanRoom,
  type SavedArea,
  type SavedPlan,
} from "./backend-contracts";
import { BackendError, MaticBackend } from "./backend";
import {
  canEditCoordinates,
  canReadFloorResources,
  canStartMotion,
  CoherenceMachine,
  WorkspaceStore,
} from "./state";
import { PreferenceStore, type MapPreferences } from "./preferences";

const resource = <T>(
  status: "idle" | "loading" | "ready" | "empty" | "error",
  value: T | null,
  problem: string | null = null,
) => ({ status, value, problem } as const);

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const problemCode = (error: unknown, fallback: string): string => {
  if (error instanceof BackendError) return error.code;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return fallback;
};

const entryFloorKey = (entry: MapEntry): string => [
  entry.selectedFloorOrdinal ?? "none",
  entry.mapFloorOrdinal ?? "none",
  entry.mapFloorCoherent ? "coherent" : "transition",
].join(":");

const entryMissionKey = (entry: MapEntry): string => [
  entry.mapFloorOrdinal ?? "none",
  entry.mapSessionVerified ? "verified" : "unverified",
  entry.mapSessionKey ?? "no-session",
].join(":");

const entryBoundaryKey = (entry: MapEntry): string => [
  entry.entryId,
  entry.selectedFloorOrdinal ?? "none",
  entry.mapFloorOrdinal ?? "none",
].join("|");

const entryIdentity = (entry: MapEntry): string => [
  entry.entryId,
  entryFloorKey(entry),
  entryMissionKey(entry),
  entry.mapRevision,
].join("|");

const entryManagedLock = (entry: MapEntry): boolean =>
  entry.runnerLocked
  || entry.stopSettlePending
  || entry.activePlan
  || entry.nativeReconciliationPending
  || entry.nativeSessionActive === true;

const sameCoherenceGeneration = (left: ResourceStamp, right: ResourceStamp): boolean =>
  left.entryKey === right.entryKey
  && left.generation === right.generation
  && left.floorKey === right.floorKey
  && left.missionKey === right.missionKey;

const LIVE_MAP_RECHECK_NOTICE = "Live map updates paused while the current map is rechecked.";
const RECONNECT_NOTICE = "Reconnecting. The last verified map remains read only.";
const POSE_POLL_INTERVAL_MS = 1_000;

const safeFloorName = (floor: HistoryFloor, fallbackOrdinal: number): string => {
  if (floor.label) return floor.label;
  if (floor.active) return "Current floor";
  return `Saved floor ${floor.ordinal ?? fallbackOrdinal}`;
};

export class EffectController {
  readonly #store: WorkspaceStore;
  readonly #coherence = new CoherenceMachine();
  readonly #backend: MaticBackend;
  readonly #preferences = new PreferenceStore();
  readonly #controllers = new Map<string, AbortController>();
  #projection: HassProjection | null = null;
  #panel: PanelLike | undefined;
  #catalogTimer: number | null = null;
  #poseTimer: number | null = null;
  #settleTimer: number | null = null;
  #catalogLoading = false;
  #poseLoading = false;
  #poseQueued = false;
  #entryIdentity = "";
  #deltaGeneration = 0;
  #preferenceUser = "";
  #disposed = false;
  #hostConnected = true;

  constructor(store: WorkspaceStore, backend: MaticBackend) {
    this.#store = store;
    this.#backend = backend;
  }

  sync(projection: HassProjection, panel: PanelLike | undefined): void {
    if (this.#disposed) return;
    const wasConnected = this.#hostConnected;
    this.#hostConnected = projection.host.connected;
    this.#projection = projection;
    this.#panel = panel;
    this.#store.patch({
      host: projection.host,
      activity: projection.activity,
      batteryPercent: projection.batteryPercent,
      robotLabel: projection.robotLabel,
      robots: projection.robots,
      locale: projection.language,
    });
    if (projection.userKey !== this.#preferenceUser) {
      this.#preferenceUser = projection.userKey;
      const preferences = this.#preferences.load(projection.userKey);
      this.#store.patch({
        view: preferences.view,
        appearance: preferences.appearance,
        labelsVisible: preferences.labels,
        quality: preferences.quality,
        cameras: preferences.cameras,
      });
    }
    if (!projection.host.administrator) {
      this.#stopPolling();
      this.#clearPrivate("access-required");
      return;
    }
    if (!projection.host.connected) {
      this.#stopPolling();
      const state = this.#store.value;
      const retainedScene = state.resources.scene.value;
      this.#store.patch({
        coherence: retainedScene ? "degraded" : "unavailable",
        resources: {
          ...state.resources,
          pose: resource("idle", null),
        },
        map: {
          ...state.map,
          available: retainedScene !== null,
          exactPose: false,
        },
        notice: retainedScene ? { tone: "warning", text: RECONNECT_NOTICE } : state.notice,
      });
      return;
    }
    if (projection.host.robotCount === 0) {
      this.#stopPolling();
      this.#clearPrivate("map-unavailable");
      return;
    }
    this.#startPolling();
    if (!wasConnected) {
      if (this.#store.value.notice?.text === RECONNECT_NOTICE) {
        this.#store.patch({ notice: null });
      }
      void this.refreshCatalog(true);
      return;
    }
    if (this.#store.value.resources.catalog.status === "idle"
      || (projection.entryKey && projection.entryKey !== this.#store.value.selection.entryId)) {
      void this.refreshCatalog(true);
    }
  }

  schedulePreferences(preferences: MapPreferences): void {
    this.#preferences.schedule(preferences);
  }

  #startPolling(): void {
    if (this.#catalogTimer === null) {
      this.#catalogTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") void this.refreshCatalog();
      }, 5_000);
    }
    if (this.#poseTimer === null) {
      this.#poseTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") void this.refreshPose();
      }, POSE_POLL_INTERVAL_MS);
    }
  }

  #stopPolling(): void {
    if (this.#catalogTimer !== null) window.clearInterval(this.#catalogTimer);
    if (this.#poseTimer !== null) window.clearInterval(this.#poseTimer);
    this.#catalogTimer = null;
    this.#poseTimer = null;
  }

  #controller(name: string): AbortController {
    this.#controllers.get(name)?.abort();
    const controller = new AbortController();
    this.#controllers.set(name, controller);
    return controller;
  }

  #release(name: string, controller: AbortController): void {
    if (this.#controllers.get(name) === controller) this.#controllers.delete(name);
  }

  #abortResources(except: readonly string[] = []): void {
    for (const [name, controller] of this.#controllers) {
      if (except.includes(name)) continue;
      controller.abort();
      this.#controllers.delete(name);
    }
  }

  #clearPrivate(problem: string): void {
    this.#abortResources();
    this.#coherence.invalidate();
    this.#entryIdentity = "";
    const state = this.#store.value;
    this.#store.patch({
      generation: this.#coherence.generation,
      coherence: state.host.administrator ? "unavailable" : "blocked",
      fullMap: false,
      precisionOpen: false,
      resources: {
        catalog: resource("error", null, problem),
        entry: null,
        scene: resource("idle", null),
        pose: resource("idle", null),
        history: resource("idle", null),
        plans: resource("idle", null),
        areas: resource("idle", null),
      },
      map: {
        available: false,
        complete: false,
        floorCoherent: false,
        sessionVerified: false,
        exactPose: false,
      },
      selection: {
        ...state.selection,
        entryId: null,
        floorId: "current",
        historyId: null,
      },
    });
  }

  async refreshCatalog(force = false): Promise<void> {
    if (this.#disposed || this.#catalogLoading || !this.#projection?.host.administrator) return;
    this.#catalogLoading = true;
    const controller = this.#controller("catalog");
    const previous = this.#store.value.resources.catalog.value;
    this.#store.patch({
      resources: {
        ...this.#store.value.resources,
        catalog: resource("loading", previous),
      },
    });
    try {
      const entries = await this.#backend.catalog(controller.signal);
      if (controller.signal.aborted || this.#disposed) return;
      const requested = this.#panel?.config?.entry_id;
      const requestedEntry = typeof requested === "string" ? requested : null;
      let selected = entries.find((entry) => entry.entryId === this.#projection?.entryKey)
        || entries.find((entry) => entry.entryId === requestedEntry)
        || entries[0]
        || null;
      const currentEntry = this.#store.value.resources.entry;
      if (selected
        && currentEntry
        && entryBoundaryKey(selected) === entryBoundaryKey(currentEntry)
        && entryFloorKey(selected) === entryFloorKey(currentEntry)
        && entryMissionKey(selected) === entryMissionKey(currentEntry)
        && selected.mapRevision < currentEntry.mapRevision) {
        // A catalog request can capture the retained scene revision while the
        // delta request beside it finishes a newer verified scene. Never let
        // that older response roll the live workspace backward and hide the
        // precise pose; the next catalog poll will observe the new cache.
        selected = { ...selected, mapRevision: currentEntry.mapRevision };
      }
      this.#store.patch({
        managedLock: selected ? entryManagedLock(selected) : false,
        resources: {
          ...this.#store.value.resources,
          catalog: resource(entries.length ? "ready" : "empty", entries),
          entry: selected,
        },
      });
      if (!selected) {
        this.#clearPrivate("no-loaded-robot");
        return;
      }
      if (this.#store.value.selection.floorId !== "current" && !force) return;
      const identity = entryIdentity(selected);
      if (!force && identity === this.#entryIdentity) {
        const state = this.#store.value;
        const coherent = selected.mapFloorCoherent && selected.mapSessionVerified;
        const degraded = selected.health === "problem" || selected.health === "limited";
        this.#store.patch({
          coherence: coherent ? (degraded ? "degraded" : "current") : "verifying",
          map: {
            ...state.map,
            available: coherent && state.resources.scene.value !== null,
            complete: selected.mapComplete && !selected.mapTruncated,
            floorCoherent: selected.mapFloorCoherent,
            sessionVerified: selected.mapSessionVerified,
            exactPose: coherent ? state.map.exactPose : false,
          },
          floor: {
            ...state.floor,
            classifiedCount: Math.max(1, selected.historyFloorCount),
          },
        });
        return;
      }
      this.#entryIdentity = identity;
      this.#beginLiveGeneration(selected);
    } catch (error) {
      if (isAbort(error)) return;
      this.#store.patch({
        coherence: this.#store.value.resources.scene.value ? "degraded" : "unavailable",
        resources: {
          ...this.#store.value.resources,
          catalog: resource("error", previous, problemCode(error, "catalog-unavailable")),
        },
      });
    } finally {
      this.#release("catalog", controller);
      this.#catalogLoading = false;
    }
  }

  #beginLiveGeneration(entry: MapEntry): void {
    const previousState = this.#store.value;
    const previousEntry = previousState.resources.entry;
    const sameResourceBoundary = Boolean(previousEntry
      && entryBoundaryKey(previousEntry) === entryBoundaryKey(entry));
    const coherent = entry.mapFloorCoherent && entry.mapSessionVerified;
    this.#abortResources(sameResourceBoundary
      ? ["catalog", "plans", "areas", "plan-mutation", "area-mutation"]
      : ["catalog"]);
    const retainedScene = sameResourceBoundary
      ? previousState.resources.scene.value
      : null;
    const previousPose = previousState.resources.pose.value;
    const retainedPose = sameResourceBoundary
      && coherent
      && entry.mapSessionKey !== null
      && previousPose?.position
      && previousPose.mapSessionKey === entry.mapSessionKey
      ? previousPose
      : null;
    const stamp = this.#coherence.begin(
      entry.entryId,
      entryFloorKey(entry),
      entryMissionKey(entry),
      entry.mapRevision,
    );
    const degraded = entry.health === "problem" || entry.health === "limited";
    const state = this.#store.value;
    this.#store.patch({
      managedLock: entryManagedLock(entry),
      generation: stamp.generation,
      coherence: coherent ? (degraded ? "degraded" : "current") : "verifying",
      dataMode: "live",
      resources: {
        ...state.resources,
        entry,
        scene: resource(coherent ? "loading" : "idle", retainedScene),
        pose: resource(coherent ? "loading" : "idle", retainedPose),
        history: resource("loading", state.resources.history.value),
        plans: sameResourceBoundary ? state.resources.plans : resource("idle", null),
        areas: sameResourceBoundary ? state.resources.areas : resource("idle", null),
      },
      map: {
        available: coherent && retainedScene !== null,
        complete: entry.mapComplete && !entry.mapTruncated,
        floorCoherent: entry.mapFloorCoherent,
        sessionVerified: entry.mapSessionVerified,
        exactPose: coherent && retainedPose !== null,
      },
      floor: {
        classifiedCount: Math.max(1, entry.historyFloorCount),
        displayName: entry.selectedFloorOrdinal ? `Floor ${entry.selectedFloorOrdinal}` : "Current floor",
        readOnly: false,
      },
      selection: {
        ...state.selection,
        entryId: entry.entryId,
        floorId: "current",
        historyId: null,
        roomIds: sameResourceBoundary ? state.selection.roomIds : [],
        planId: sameResourceBoundary ? state.selection.planId : null,
        areaId: sameResourceBoundary ? state.selection.areaId : null,
      },
    });
    void this.#loadHistory(entry, stamp);
    if (coherent) {
      void this.#loadLiveScene(entry, stamp);
      void this.#loadPose(entry, stamp);
    }
  }

  async #loadLiveScene(entry: MapEntry, stamp: ResourceStamp): Promise<void> {
    const controller = this.#controller("scene");
    try {
      const response = await this.#backend.scene(
        entry.sceneUrl,
        entry.mapRevision,
        entry.mapFloorCoherent,
        "live",
        controller.signal,
      );
      if (!this.#coherence.accepts(stamp)
        || response.revision !== stamp.revision
        || !response.floorCoherent
        || !response.scene) return;
      const state = this.#store.value;
      this.#store.patch({
        resources: {
          ...state.resources,
          scene: resource("ready", response.scene),
        },
        map: { ...state.map, available: true },
        notice: state.notice?.text === LIVE_MAP_RECHECK_NOTICE ? null : state.notice,
      });
      if (entry.deltaUrl) {
        const generation = ++this.#deltaGeneration;
        void this.#streamDeltas(entry, stamp, response.scene, generation);
      }
    } catch (error) {
      if (isAbort(error) || !this.#coherence.accepts(stamp)) return;
      if (error instanceof BackendError && error.code === "request-timeout") {
        const state = this.#store.value;
        this.#store.patch({
          resources: {
            ...state.resources,
            scene: resource("loading", state.resources.scene.value, "scene-building"),
          },
        });
        window.setTimeout(() => {
          if (this.#disposed
            || !this.#coherence.accepts(stamp)
            || this.#store.value.selection.floorId !== "current") return;
          void this.#loadLiveScene(entry, stamp);
        }, 250);
        return;
      }
      const state = this.#store.value;
      const pose = state.resources.pose.value;
      const retainsVerifiedPose = state.resources.scene.value !== null
        && entry.mapSessionKey !== null
        && pose?.position !== null
        && pose?.mapSessionKey === entry.mapSessionKey;
      this.#store.patch({
        coherence: "degraded",
        resources: {
          ...state.resources,
          scene: resource(
            "error",
            state.resources.scene.value,
            problemCode(error, "scene-unavailable"),
          ),
        },
        map: {
          ...state.map,
          available: state.resources.scene.value !== null,
          exactPose: retainsVerifiedPose,
        },
      });
    } finally {
      this.#release("scene", controller);
    }
  }

  async #streamDeltas(
    initialEntry: MapEntry,
    initialStamp: ResourceStamp,
    initialScene: NonNullable<WorkspaceState["resources"]["scene"]["value"]>,
    generation: number,
  ): Promise<void> {
    if (!initialEntry.deltaUrl || typeof DecompressionStream !== "function") return;
    const deltaUrl = initialEntry.deltaUrl;
    let entry = initialEntry;
    let stamp = initialStamp;
    let scene = initialScene;
    try {
      while (!this.#disposed
        && generation === this.#deltaGeneration
        && this.#coherence.accepts(stamp)
        && this.#store.value.selection.floorId === "current") {
        const controller = this.#controller("delta");
        try {
          const response = await this.#backend.sceneDelta(
            deltaUrl,
            scene,
            entry.mapFloorCoherent,
            controller.signal,
          );
          if (controller.signal.aborted
            || this.#disposed
            || generation !== this.#deltaGeneration
            || !this.#coherence.accepts(stamp)) return;
          if (!response.floorCoherent) {
            this.#store.patch({
              coherence: "verifying",
              map: {
                ...this.#store.value.map,
                available: false,
                floorCoherent: false,
                exactPose: false,
              },
              resources: {
                ...this.#store.value.resources,
                pose: resource("idle", null),
              },
            });
            this.#entryIdentity = "";
            void this.refreshCatalog(true);
            return;
          }
          if (response.notModified || !response.scene) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
            continue;
          }
          const advanced = this.#coherence.advance(stamp, response.revision);
          if (!advanced) return;
          stamp = advanced;
          scene = response.scene;
          entry = { ...entry, mapRevision: response.revision };
          this.#entryIdentity = entryIdentity(entry);
          const state = this.#store.value;
          this.#store.patch({
            resources: {
              ...state.resources,
              entry,
              scene: resource("ready", scene),
            },
            map: {
              ...state.map,
              available: true,
              floorCoherent: true,
            },
          });
          void this.#loadPose(entry, stamp);
        } finally {
          this.#release("delta", controller);
        }
      }
    } catch (error) {
      if (isAbort(error)
        || this.#disposed
        || generation !== this.#deltaGeneration
        || !this.#coherence.accepts(stamp)) return;
      this.#store.patch({
        coherence: "degraded",
        notice: {
          tone: "warning",
          text: LIVE_MAP_RECHECK_NOTICE,
        },
      });
      this.#entryIdentity = "";
      void this.refreshCatalog(true);
    }
  }

  async #loadHistory(entry: MapEntry, stamp: ResourceStamp): Promise<void> {
    const controller = this.#controller("history");
    try {
      const history = await this.#backend.history(entry.historyUrl, controller.signal);
      if (!this.#coherence.accepts(stamp) || history.entryId !== entry.entryId) return;
      const activeFloor = history.floors.find((floor) => floor.active) || history.floors[0];
      if (!activeFloor) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          history: resource("ready", history),
        },
        floor: {
          ...this.#store.value.floor,
          classifiedCount: history.floors.length,
          displayName: safeFloorName(activeFloor, 1),
        },
      });
    } catch (error) {
      if (isAbort(error) || !this.#coherence.accepts(stamp)) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          history: resource("error", null, problemCode(error, "history-unavailable")),
        },
      });
    } finally {
      this.#release("history", controller);
    }
  }

  async refreshPose(): Promise<void> {
    const entry = this.#store.value.resources.entry;
    const stamp = this.#coherence.current();
    if (!entry || !stamp || this.#store.value.selection.floorId !== "current"
      || !entry.mapFloorCoherent || !entry.mapSessionVerified) return;
    await this.#loadPose(entry, stamp);
  }

  async #loadPose(entry: MapEntry, stamp: ResourceStamp): Promise<void> {
    if (this.#poseLoading) {
      this.#poseQueued = true;
      return;
    }
    this.#poseLoading = true;
    const controller = this.#controller("pose");
    try {
      const pose = await this.#backend.pose(entry.poseUrl, controller.signal);
      const current = this.#coherence.current();
      const currentEntry = this.#store.value.resources.entry;
      if (!current
        || !sameCoherenceGeneration(stamp, current)
        || !currentEntry
        || !pose.floorCoherent) return;
      if (pose.mapSessionKey === null
        || pose.mapSessionKey !== currentEntry.mapSessionKey) {
        this.#store.patch({
          map: { ...this.#store.value.map, exactPose: false },
        });
        this.#entryIdentity = "";
        void this.refreshCatalog(true);
        return;
      }
      const state = this.#store.value;
      const previousPose = state.resources.pose.value;
      const canRetainVerifiedPose = Boolean(state.map.exactPose
        && previousPose?.position
        && previousPose.mapSessionKey === currentEntry.mapSessionKey);
      if (pose.position === null && canRetainVerifiedPose) {
        // A successful pose read can still briefly contain no coordinate while
        // the robot relocalizes or crosses an internal room boundary. Keep the
        // last verified point for the same floor/session instead of blinking
        // the marker off, then retry on the next one-second tick. A first load
        // without a point, a floor change, or a session change still clears it
        // through the identity checks above.
        this.#store.patch({
          resources: {
            ...state.resources,
            pose: resource("ready", previousPose),
          },
        });
        return;
      }
      this.#store.patch({
        resources: {
          ...state.resources,
          pose: resource("ready", pose),
        },
        map: {
          ...state.map,
          // A coordinator fallback is still an exact robot coordinate after
          // the endpoint has bound it to this verified floor and map session.
          // Freshness controls how quickly the point advances, not whether it
          // is safe to render.
          exactPose: pose.position !== null,
        },
      });
    } catch (error) {
      if (isAbort(error) || !this.#coherence.accepts(stamp)) return;
      const state = this.#store.value;
      const previousPose = state.resources.pose.value;
      const canRetainVerifiedPose = Boolean(state.map.exactPose
        && previousPose?.position
        && previousPose.mapSessionKey === state.resources.entry?.mapSessionKey);
      this.#store.patch({
        resources: {
          ...state.resources,
          pose: resource(
            "error",
            canRetainVerifiedPose ? previousPose : null,
            problemCode(error, "pose-unavailable"),
          ),
        },
        map: { ...state.map, exactPose: canRetainVerifiedPose },
      });
    } finally {
      this.#release("pose", controller);
      this.#poseLoading = false;
      if (this.#poseQueued && !this.#disposed) {
        this.#poseQueued = false;
        const latestEntry = this.#store.value.resources.entry;
        const latestStamp = this.#coherence.current();
        if (latestEntry && latestStamp) void this.#loadPose(latestEntry, latestStamp);
      }
    }
  }

  async selectFloor(floorId: string): Promise<void> {
    const history = this.#store.value.resources.history.value;
    const entry = this.#store.value.resources.entry;
    if (!history || !entry) return;
    const floor = history.floors.find((candidate) => candidate.id === floorId);
    if (!floor) return;
    if (floor.active) {
      this.#entryIdentity = "";
      this.#store.dispatch({ type: "set-floor", floorId: "current" });
      await this.refreshCatalog(true);
      return;
    }
    const snapshot = floor.snapshots.at(-1);
    this.#abortResources(["catalog"]);
    const stamp = this.#coherence.begin(
      entry.entryId,
      floor.id,
      snapshot?.id || floor.id,
      snapshot?.revision || 0,
    );
    this.#store.patch({
      generation: stamp.generation,
      coherence: "current",
      dataMode: "history",
      floor: {
        classifiedCount: history.floors.length,
        displayName: safeFloorName(floor, history.floors.indexOf(floor) + 1),
        readOnly: true,
      },
      selection: {
        ...this.#store.value.selection,
        floorId: floor.id,
        historyId: snapshot?.id || null,
      },
      resources: {
        ...this.#store.value.resources,
        scene: resource(snapshot ? "loading" : "empty", null),
        pose: resource("idle", null),
      },
      map: {
        available: false,
        complete: true,
        floorCoherent: true,
        sessionVerified: true,
        exactPose: false,
      },
    });
    if (snapshot) await this.#loadHistoryScene(snapshot, stamp);
  }

  async selectHistory(snapshotId: string | null): Promise<void> {
    const history = this.#store.value.resources.history.value;
    const entry = this.#store.value.resources.entry;
    if (!history || !entry) return;
    if (!snapshotId) {
      await this.selectFloor("current");
      return;
    }
    const floor = history.floors.find((candidate) =>
      candidate.snapshots.some((snapshot) => snapshot.id === snapshotId));
    const snapshot = floor?.snapshots.find((candidate) => candidate.id === snapshotId);
    if (!floor || !snapshot) return;
    const stamp = this.#coherence.begin(entry.entryId, floor.id, snapshot.id, snapshot.revision);
    this.#abortResources(["catalog"]);
    this.#store.patch({
      generation: stamp.generation,
      dataMode: "history",
      floor: {
        classifiedCount: history.floors.length,
        displayName: safeFloorName(floor, history.floors.indexOf(floor) + 1),
        readOnly: true,
      },
      selection: {
        ...this.#store.value.selection,
        floorId: floor.id,
        historyId: snapshot.id,
      },
      resources: {
        ...this.#store.value.resources,
        scene: resource("loading", null),
        pose: resource("idle", null),
      },
      map: { ...this.#store.value.map, available: false, exactPose: false },
    });
    await this.#loadHistoryScene(snapshot, stamp);
  }

  async #loadHistoryScene(snapshot: HistorySnapshot, stamp: ResourceStamp): Promise<void> {
    const controller = this.#controller("history-scene");
    try {
      const response = await this.#backend.scene(
        snapshot.sceneUrl,
        snapshot.revision,
        true,
        "history",
        controller.signal,
      );
      if (!this.#coherence.accepts(stamp) || !response.scene) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          scene: resource("ready", response.scene),
        },
        map: { ...this.#store.value.map, available: true, exactPose: false },
      });
    } catch (error) {
      if (isAbort(error) || !this.#coherence.accepts(stamp)) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          scene: resource("error", null, problemCode(error, "history-scene-unavailable")),
        },
      });
    } finally {
      this.#release("history-scene", controller);
    }
  }

  async openWorkflow(workflow: Workflow): Promise<void> {
    const previousWorkflow = this.#store.value.workflow;
    if (workflow === "draw" && previousWorkflow !== "draw" && previousWorkflow !== "areaReview") {
      this.selectArea(null);
    }
    this.#store.dispatch({ type: "open-workflow", workflow });
    if (workflow === "plan" || workflow === "rooms") await this.loadPlans();
    if (workflow === "draw" || workflow === "areaReview") await this.loadAreas();
  }

  async loadPlans(): Promise<void> {
    const entry = this.#store.value.resources.entry;
    if (!entry || !this.#coherence.current() || !canReadFloorResources(this.#store.value)) return;
    const boundary = entryBoundaryKey(entry);
    const controller = this.#controller("plans");
    this.#store.patch({
      resources: { ...this.#store.value.resources, plans: resource("loading", null) },
    });
    try {
      const plans = await this.#backend.plans(entry.plansUrl, controller.signal);
      const currentEntry = this.#store.value.resources.entry;
      if (!currentEntry || entryBoundaryKey(currentEntry) !== boundary) return;
      const planId = plans.selectedPlan || plans.plans[0]?.id || null;
      const plan = plans.plans.find((candidate) => candidate.id === planId);
      this.#store.patch({
        resources: { ...this.#store.value.resources, plans: resource("ready", plans) },
        selection: {
          ...this.#store.value.selection,
          planId,
        },
        planDraft: plan ? this.#draftForPlan(plan) : {
          ...this.#store.value.planDraft,
          id: null,
          name: "",
          rooms: [],
          dirty: false,
        },
      });
    } catch (error) {
      const currentEntry = this.#store.value.resources.entry;
      if (isAbort(error) || !currentEntry || entryBoundaryKey(currentEntry) !== boundary) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          plans: resource("error", null, problemCode(error, "plans-unavailable")),
        },
      });
    } finally {
      this.#release("plans", controller);
    }
  }

  selectPlan(planId: string | null): void {
    const plan = this.#store.value.resources.plans.value?.plans.find((candidate) => candidate.id === planId);
    this.#store.patch({
      selection: { ...this.#store.value.selection, planId },
      planDraft: plan ? this.#draftForPlan(plan) : {
        ...this.#store.value.planDraft,
        id: null,
        name: "",
        rooms: [],
        dirty: false,
      },
    });
  }

  #draftForPlan(plan: SavedPlan): WorkspaceState["planDraft"] {
    return {
      id: plan.id,
      name: plan.name,
      enabled: plan.enabled,
      runBehavior: plan.runBehavior,
      rooms: (plan.roomOrder.length
        ? plan.roomOrder.flatMap((roomId) => {
          const room = plan.rooms.find((candidate) => candidate.roomId === roomId);
          return room ? [room] : [];
        })
        : plan.rooms).map((room) => ({ ...room })),
      returnToBase: plan.returnToBase,
      finishCurrentRoom: plan.finishCurrentRoom,
      finishCurrentRoomThreshold: plan.finishCurrentRoomThreshold,
      dirty: false,
    };
  }

  async loadAreas(): Promise<void> {
    const entry = this.#store.value.resources.entry;
    if (!entry || !this.#coherence.current() || !canReadFloorResources(this.#store.value)) return;
    const boundary = entryBoundaryKey(entry);
    const controller = this.#controller("areas");
    this.#store.patch({
      resources: { ...this.#store.value.resources, areas: resource("loading", null) },
    });
    try {
      const areas = await this.#backend.areas(entry.areasUrl, controller.signal);
      const currentEntry = this.#store.value.resources.entry;
      if (!currentEntry
        || entryBoundaryKey(currentEntry) !== boundary
        || areas.sceneUrl !== currentEntry.sceneUrl) return;
      this.#store.patch({
        resources: { ...this.#store.value.resources, areas: resource("ready", areas) },
      });
      const selectedId = this.#store.value.selection.areaId;
      const current = this.#store.value;
      // A blank Draw draft is editable while the area catalog is loading. Do
      // not replace that draft when the response arrives, or an early stroke
      // would be silently discarded. Existing selections still reconcile to
      // the returned catalog, including a deleted saved area.
      if (selectedId !== null || (!current.draw.dirty && !current.areaDraft.dirty)) {
        this.selectArea(areas.areas.some((area) => area.id === selectedId) ? selectedId : null);
      }
    } catch (error) {
      const currentEntry = this.#store.value.resources.entry;
      if (isAbort(error) || !currentEntry || entryBoundaryKey(currentEntry) !== boundary) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          areas: resource("error", null, problemCode(error, "areas-unavailable")),
        },
      });
    } finally {
      this.#release("areas", controller);
    }
  }

  selectArea(areaId: string | null): void {
    const area = this.#store.value.resources.areas.value?.areas.find((candidate) => candidate.id === areaId);
    const state = this.#store.value;
    this.#store.patch({
      selection: { ...state.selection, areaId },
      areaDraft: area ? this.#draftForArea(area) : {
        id: null,
        name: "",
        cleaningMode: "vacuum",
        coverageSetting: "standard",
        status: "new",
        canRebind: false,
        dirty: false,
      },
      draw: {
        ...state.draw,
        circles: area?.circles || [],
        undo: [],
        redo: [],
        dirty: false,
        strokeCount: 0,
      },
    });
  }

  #draftForArea(area: SavedArea): WorkspaceState["areaDraft"] {
    return {
      id: area.id,
      name: area.name,
      cleaningMode: area.cleaningMode,
      coverageSetting: area.coverageSetting,
      status: area.status,
      canRebind: area.canRebind,
      dirty: false,
    };
  }

  async saveArea(): Promise<void> {
    const state = this.#store.value;
    const entry = state.resources.entry;
    const draft = state.areaDraft;
    if (!entry || !canEditCoordinates(state) || !draft.name.trim() || !state.draw.circles.length) return;
    const controller = this.#controller("area-mutation");
    this.#store.patch({ command: "pending", notice: { tone: "info", text: "Saving area…" } });
    try {
      const id = await this.#backend.saveArea(entry.areasUrl, {
        areaId: draft.id,
        name: draft.name.trim(),
        circles: state.draw.circles,
        cleaningMode: draft.cleaningMode,
        coverageSetting: draft.coverageSetting,
      }, controller.signal);
      this.#store.patch({ command: "idle", notice: { tone: "success", text: "Area saved" } });
      await this.loadAreas();
      this.selectArea(id);
    } catch (error) {
      if (isAbort(error)) return;
      this.#store.patch({ command: "failed", notice: { tone: "error", text: "Area could not be saved" } });
    } finally {
      this.#release("area-mutation", controller);
    }
  }

  async deleteArea(): Promise<void> {
    const entry = this.#store.value.resources.entry;
    const areaId = this.#store.value.selection.areaId;
    if (!entry || !areaId || !canEditCoordinates(this.#store.value)) return;
    const controller = this.#controller("area-mutation");
    try {
      await this.#backend.deleteArea(entry.areasUrl, areaId, controller.signal);
      this.#store.patch({ notice: { tone: "success", text: "Area deleted" } });
      await this.loadAreas();
    } catch (error) {
      if (!isAbort(error)) this.#store.patch({ notice: { tone: "error", text: "Area could not be deleted" } });
    } finally {
      this.#release("area-mutation", controller);
    }
  }

  async savePlan(): Promise<void> {
    const state = this.#store.value;
    const draft = state.planDraft;
    const plans = state.resources.plans.value;
    if (!plans || !draft.name.trim() || !draft.rooms.length || !canEditCoordinates(state)) return;
    const rooms: readonly PlanRoom[] = draft.rooms;
    await this.#serviceMutation("save_plan", {
      ...(draft.id ? { plan_id: draft.id } : {}),
      name: draft.name.trim(),
      enabled: draft.enabled,
      run_behavior: draft.runBehavior,
      rooms: rooms.map((room) => ({
        room: plans.rooms.find((candidate) => candidate.roomId === room.roomId)?.name,
        cleaning_mode: room.cleaningMode,
        coverage_setting: room.coverageSetting,
      })).filter((room) => room.room),
      return_to_base: draft.returnToBase,
      finish_current_room: draft.finishCurrentRoom,
      finish_current_room_threshold: draft.finishCurrentRoomThreshold,
      select: !draft.id || plans.selectedPlan === draft.id,
    }, "Plan saved", "Plan could not be saved");
    await this.loadPlans();
  }

  async deletePlan(): Promise<void> {
    const planId = this.#store.value.selection.planId;
    if (!planId) return;
    await this.#serviceMutation("delete_plan", { plan: planId }, "Plan deleted", "Plan could not be deleted");
    await this.loadPlans();
  }

  async executeAction(id: string): Promise<void> {
    switch (id) {
      case "stop":
        if (this.#store.value.resources.entry?.activePlan
          || this.#store.value.resources.entry?.runnerLocked) {
          await this.#motion("matic_robot", "stop_intelligent_cleaning", {});
        } else {
          await this.#motion("vacuum", "return_to_base", {});
        }
        return;
      case "resume":
        await this.#motion("vacuum", "start", {});
        return;
      case "run-plan": {
        const plan = this.#store.value.selection.planId
          || this.#store.value.resources.plans.value?.selectedPlan;
        if (plan) await this.#motion("matic_robot", "run_selected_plan", { plan });
        return;
      }
      case "clean-rooms": {
        const plans = this.#store.value.resources.plans.value;
        const selected = this.#store.value.selection.roomSettings;
        const rooms = selected.map((room) => ({
          room: plans?.rooms.find((candidate) => candidate.roomId === room.roomId)?.name,
          cleaning_mode: room.cleaningMode,
          coverage_setting: room.coverageSetting,
        })).filter((room) => room.room);
        if (rooms.length) await this.#motion("matic_robot", "clean_room_sequence", {
          rooms,
          return_to_base: true,
        });
        return;
      }
      case "run-area": {
        const area = this.#store.value.selection.areaId;
        if (area) await this.#motion("matic_robot", "clean_area", { area });
        return;
      }
      case "review-area":
        this.#store.dispatch({ type: "open-workflow", workflow: "areaReview" });
        return;
      case "save-area":
        await this.saveArea();
        return;
      case "save-plan":
        await this.savePlan();
        return;
      case "delete-plan":
        await this.deletePlan();
        return;
      case "delete-area":
        await this.deleteArea();
        return;
    }
  }

  async #serviceMutation(
    service: string,
    data: Readonly<Record<string, unknown>>,
    success: string,
    failure: string,
  ): Promise<void> {
    const entityId = this.#projection?.vacuumEntityId;
    if (!entityId || !canEditCoordinates(this.#store.value) || this.#store.value.command === "pending") return;
    this.#store.patch({ command: "pending", notice: { tone: "info", text: "Saving…" } });
    try {
      await this.#backend.service("matic_robot", service, data, entityId);
      this.#store.patch({ command: "idle", notice: { tone: "success", text: success } });
    } catch {
      this.#store.patch({ command: "failed", notice: { tone: "error", text: failure } });
    }
  }

  async #motion(domain: string, service: string, data: Readonly<Record<string, unknown>>): Promise<void> {
    const state = this.#store.value;
    const entityId = this.#projection?.vacuumEntityId;
    const stopping = service === "stop_intelligent_cleaning"
      || (domain === "vacuum" && service === "return_to_base");
    const stopAllowed = stopping
      && state.command === "idle"
      && (state.activity === "cleaning"
        || state.activity === "paused"
        || state.activity === "returning"
        || state.activity === "recharging");
    if (!entityId || (!stopAllowed && !canStartMotion(state))) return;
    this.#store.patch({ command: "pending", notice: null });
    try {
      await this.#backend.service(domain, service, data, entityId);
      this.#store.patch({ command: "settling" });
      if (this.#settleTimer !== null) window.clearTimeout(this.#settleTimer);
      this.#settleTimer = window.setTimeout(() => {
        this.#settleTimer = null;
        if (this.#store.value.command === "settling") this.#store.patch({ command: "idle" });
      }, 15_000);
    } catch {
      this.#store.patch({ command: "failed", notice: { tone: "error", text: "The robot did not accept that action" } });
    }
  }

  updateDraftCircles(
    circles: readonly AreaCircle[],
    record = true,
    previous?: readonly AreaCircle[],
  ): void {
    this.#store.dispatch({
      type: "set-draft-circles",
      circles,
      record,
      ...(previous ? { previous } : {}),
    });
    this.#store.dispatch({ type: "patch-area-draft", patch: { dirty: true } });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stopPolling();
    this.#abortResources();
    if (this.#settleTimer !== null) window.clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
    this.#preferences.dispose();
    this.#backend.dispose();
    this.#coherence.invalidate();
  }
}
