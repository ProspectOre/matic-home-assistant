// Loaded only when Rooms needs a preview. Runtime helpers keep shared startup
// modules in their existing chunks instead of creating another import graph.
import type { HassProjection, WorkspaceState, WorkspaceNotice } from "./contracts";
import type { ManualRoomSequencePreview, PlanRoom } from "./backend-contracts";
import type { MaticBackend } from "./backend";
import type { WorkspaceStore } from "./state";
import type { ResourceRequests } from "./resource-requests";

export interface RoomPreviewHelpers {
  readonly notice: typeof import("./contracts").notice;
  readonly entryFloorKey: typeof import("./backend-contracts").entryFloorKey;
  readonly entryMissionKey: typeof import("./backend-contracts").entryMissionKey;
  readonly admittedManualRoomPreview: typeof import("./state").admittedManualRoomPreview;
  readonly manualRoomPreviewKey: typeof import("./state").manualRoomPreviewKey;
  readonly canStartMotion: typeof import("./state").canStartMotion;
  readonly resource: typeof import("./resource-state").resource;
  readonly isAbort: typeof import("./resource-state").isAbort;
  readonly problemCode: typeof import("./resource-state").problemCode;
}

interface RoomPreviewCallbacks {
  readonly projection: () => HassProjection | null;
  readonly disposed: () => boolean;
  readonly dispatchMotion: (domain: string, service: string, data: Readonly<Record<string, unknown>>) => Promise<void>;
}



interface ManualPreviewCapture {
  readonly key: string;
  readonly generation: number;
  readonly retryRevision: number;
  readonly floorKey: string;
  readonly missionKey: string;
  readonly entryId: string;
  readonly entityId: string;
  readonly rooms: readonly { readonly room: string; readonly cleaning_mode: PlanRoom["cleaningMode"]; readonly coverage_setting: PlanRoom["coverageSetting"] }[];
  readonly overrideRoomSchedule: boolean;
}

const manualPreviewValue = (preview: ManualRoomSequencePreview): string => JSON.stringify({
  ...preview,
  previewToken: undefined,
});

/** Owns room-preview requests and the preflight that admits a room command. */
export class RoomPreviewController {
  readonly #store: WorkspaceStore;
  readonly #backend: Pick<MaticBackend, "previewRoomSequence">;
  readonly #requests: ResourceRequests;
  readonly #callbacks: RoomPreviewCallbacks;
  readonly #helpers: RoomPreviewHelpers;
  readonly #notices: Readonly<Record<"roomPreviewBlocked" | "roomPreviewChanged" | "roomPreviewFailed", WorkspaceNotice>>;
  #manualPreviewRequestIdentity = "";
  #manualPreviewPreflight = false;

  constructor(store: WorkspaceStore, backend: Pick<MaticBackend, "previewRoomSequence">, requests: ResourceRequests, callbacks: RoomPreviewCallbacks, helpers: RoomPreviewHelpers) {
    this.#store = store;
    this.#backend = backend;
    this.#requests = requests;
    this.#callbacks = callbacks;
    this.#helpers = helpers;
    const { notice } = helpers;
    this.#notices = {
      roomPreviewBlocked: notice("warning", "v4_notice_room_preview_blocked", "A room can't use these settings, so check the note above the rooms."),
      roomPreviewChanged: notice("info", "v4_notice_room_preview_changed", "The room settings changed, so check them and start again."),
      roomPreviewFailed: notice("warning", "v4_notice_room_preview_failed", "Home Assistant couldn't check the room settings, so try starting again."),
    };
  }

  #manualPreviewCapture(state: WorkspaceState): ManualPreviewCapture | null {
    const key = this.#helpers.manualRoomPreviewKey(state);
    const entry = state.resources.entry;
    const entityId = this.#callbacks.projection()?.vacuumEntityId;
    if (!key || !entry || !entityId || !state.selection.entryId || state.workflow !== "rooms"
      || state.dataMode !== "live" || state.floor.readOnly || state.coherence !== "current"
      || !state.host.connected || !state.host.administrator || !state.host.robotConnected
      || state.command !== "idle" || state.resources.plans.status !== "ready") return null;
    const rooms = state.selection.roomIds.map((roomId) => {
      const settings = state.selection.roomSettings.find((room) => room.roomId === roomId);
      return settings ? {
        room: roomId,
        cleaning_mode: settings.cleaningMode,
        coverage_setting: settings.coverageSetting,
      } : null;
    });
    if (rooms.some((room) => room === null)) return null;
    return {
      key,
      generation: state.generation,
      retryRevision: state.manualRoomPreviewRetry,
      floorKey: this.#helpers.entryFloorKey(entry),
      missionKey: this.#helpers.entryMissionKey(entry),
      entryId: state.selection.entryId,
      entityId,
      rooms: rooms as ManualPreviewCapture["rooms"],
      overrideRoomSchedule: !state.selection.useRoomSchedule,
    };
  }

  #manualPreviewIdentity(capture: ManualPreviewCapture): string {
    return JSON.stringify([capture.key, capture.generation, capture.retryRevision, capture.floorKey, capture.missionKey, capture.entryId, capture.entityId]);
  }

  #manualPreviewCaptureCurrent(capture: ManualPreviewCapture): boolean {
    const current = this.#manualPreviewCapture(this.#store.value);
    return !this.#callbacks.disposed() && current !== null
      && this.#manualPreviewIdentity(current) === this.#manualPreviewIdentity(capture);
  }

  reconcile(): void {
    if (this.#callbacks.disposed()) return;
    // The store listener fires in the constructor, before sync supplies the
    // owning HA projection. Preserve seeded gallery state until that boundary.
    if (!this.#callbacks.projection()) return;
    const state = this.#store.value;
    const capture = this.#manualPreviewCapture(state);
    if (!capture) {
      this.#requests.cancel("room-preview");
      this.#manualPreviewRequestIdentity = "";
      if (state.manualRoomPreview.status !== "idle" || state.manualRoomPreview.value !== null) {
        this.#store.dispatch({ type: "result", manualRoomPreview: this.#helpers.resource("idle", null) });
      }
      return;
    }
    const identity = this.#manualPreviewIdentity(capture);
    const admitted = this.#helpers.admittedManualRoomPreview(state);
    if (admitted && admitted.key === capture.key && admitted.generation === capture.generation
      && admitted.floorKey === capture.floorKey && admitted.missionKey === capture.missionKey
      && admitted.preview.entryId === capture.entryId) {
      this.#manualPreviewRequestIdentity = identity;
      return;
    }
    if (this.#manualPreviewRequestIdentity === identity) return;
    this.#requests.current("room-preview")?.abort();
    this.#manualPreviewRequestIdentity = identity;
    const controller = this.#requests.begin("room-preview");
    this.#store.dispatch({ type: "result", manualRoomPreview: this.#helpers.resource("loading", null) });
    void this.#loadManualRoomPreview(capture, controller);
  }

  async #loadManualRoomPreview(capture: ManualPreviewCapture, controller: AbortController): Promise<ManualRoomSequencePreview | null> {
    try {
      const preview = await this.#backend.previewRoomSequence(
        capture.entityId,
        capture.rooms,
        capture.overrideRoomSchedule,
        controller.signal,
      );
      if (!this.#manualPreviewCaptureCurrent(capture) || controller.signal.aborted
        || preview.entryId !== capture.entryId) return null;
      this.#store.dispatch({ type: "result", manualRoomPreview: this.#helpers.resource("ready", {
        key: capture.key,
        generation: capture.generation,
        floorKey: capture.floorKey,
        missionKey: capture.missionKey,
        preview,
      }) });
      return preview;
    } catch (error) {
      if (this.#helpers.isAbort(error) || controller.signal.aborted || !this.#manualPreviewCaptureCurrent(capture)) return null;
      this.#store.dispatch({ type: "result", manualRoomPreview: this.#helpers.resource("error", null, this.#helpers.problemCode(error, "preview-unavailable")) });
      return null;
    } finally {
      this.#requests.release("room-preview", controller);
    }
  }

  async clean(): Promise<void> {
    if (this.#manualPreviewPreflight) return;
    const initial = this.#store.value;
    const capture = this.#manualPreviewCapture(initial);
    const admitted = this.#helpers.admittedManualRoomPreview(initial);
    if (!capture || !admitted
      || admitted.key !== capture.key || admitted.generation !== capture.generation
      || admitted.floorKey !== capture.floorKey || admitted.missionKey !== capture.missionKey
      || admitted.preview.entryId !== capture.entryId || admitted.preview.blocker
      || admitted.preview.rooms.length === 0) return;

    this.#manualPreviewPreflight = true;
    const controller = this.#requests.begin("room-preview");
    this.#manualPreviewRequestIdentity = this.#manualPreviewIdentity(capture);
    this.#store.dispatch({ type: "result", manualRoomPreview: this.#helpers.resource("loading", null), notice: null });
    try {
      const latestPreview = await this.#backend.previewRoomSequence(
        capture.entityId,
        capture.rooms,
        capture.overrideRoomSchedule,
        controller.signal,
      );
      if (controller.signal.aborted || !this.#manualPreviewCaptureCurrent(capture)
        || latestPreview.entryId !== capture.entryId) return;
      const latestAdmission = {
        key: capture.key,
        generation: capture.generation,
        floorKey: capture.floorKey,
        missionKey: capture.missionKey,
        preview: latestPreview,
      } as const;
      if (latestPreview.blocker || latestPreview.rooms.length === 0) {
        this.#store.dispatch({
          type: "result",
          manualRoomPreview: this.#helpers.resource("ready", latestAdmission),
          notice: this.#notices.roomPreviewBlocked,
        });
        return;
      }
      if (manualPreviewValue(admitted.preview) !== manualPreviewValue(latestPreview)) {
        this.#store.dispatch({
          type: "result",
          manualRoomPreview: this.#helpers.resource("ready", latestAdmission),
          notice: this.#notices.roomPreviewChanged,
        });
        return;
      }
      this.#store.dispatch({ type: "result", manualRoomPreview: this.#helpers.resource("ready", latestAdmission), notice: null });
      if (!this.#manualPreviewCaptureCurrent(capture) || !this.#helpers.canStartMotion(this.#store.value)) return;
      await this.#callbacks.dispatchMotion("matic_robot", "clean_room_sequence", {
        rooms: capture.rooms,
        use_room_schedule: true,
        override_room_schedule: capture.overrideRoomSchedule,
        return_to_base: true,
        preview_token: latestPreview.previewToken,
      });
    } catch (error) {
      if (!this.#helpers.isAbort(error) && !controller.signal.aborted && this.#manualPreviewCaptureCurrent(capture)) {
        this.#store.dispatch({
          type: "result",
          manualRoomPreview: this.#helpers.resource("error", null, this.#helpers.problemCode(error, "preview-unavailable")),
          notice: this.#notices.roomPreviewFailed,
        });
      }
    } finally {
      this.#requests.release("room-preview", controller);
      this.#manualPreviewPreflight = false;
      this.reconcile();
    }
  }
}
