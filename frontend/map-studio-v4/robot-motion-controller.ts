import { type MaticBackend } from "./backend";
import { notice, type HassProjection, type WorkspaceNotice } from "./contracts";
import {
  canResumeMotion,
  canStartMotion,
  canStopMotion,
  type WorkspaceStore,
} from "./state";

interface MotionCallbacks {
  readonly projection: () => HassProjection | null;
  readonly disposed: () => boolean;
  readonly refreshCatalog: () => void;
  readonly failureNotice: (error: unknown) => Promise<WorkspaceNotice>;
}

const STOP_UNCONFIRMED = notice(
  "error",
  "v4_notice_stop_unconfirmed",
  "Home Assistant can't confirm the robot stopped, so press Stop again if it's still moving.",
);
/** Owns command admission, supersession, and the transient motion indicator. */
export class RobotMotionController {
  readonly #store: WorkspaceStore;
  readonly #backend: MaticBackend;
  readonly #callbacks: MotionCallbacks;
  #revision = 0;
  #settleTimer: number | null = null;

  constructor(store: WorkspaceStore, backend: MaticBackend, callbacks: MotionCallbacks) {
    this.#store = store;
    this.#backend = backend;
    this.#callbacks = callbacks;
  }

  invalidate(): void {
    this.#revision += 1;
    this.#clearSettleTimer();
  }

  dispose(): void {
    this.invalidate();
  }

  #clearSettleTimer(): void {
    if (this.#settleTimer !== null) window.clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
  }

  async dispatch(domain: string, service: string, data: Readonly<Record<string, unknown>>): Promise<void> {
    const state = this.#store.value;
    const projection = this.#callbacks.projection();
    const entityId = projection?.vacuumEntityId;
    const stopping = service === "stop_intelligent_cleaning"
      || (domain === "vacuum" && service === "return_to_base");
    const resuming = domain === "vacuum" && service === "send_command" && data.command === "resume";
    if (!projection || !entityId || state.selection.entryId !== projection.entryKey
      || (stopping ? !canStopMotion(state) : resuming ? !canResumeMotion(state) : !canStartMotion(state))) return;
    // HA may keep a room-sequence service call open for the whole run. Stop
    // must be reachable before that call acknowledges, even while the last
    // vacuum state still says docked. A newer Stop owns all subsequent UI
    // updates; a late start response must never replace its outcome.
    const revision = ++this.#revision;
    const entryKey = projection.entryKey;
    const current = (): boolean => !this.#callbacks.disposed()
      && revision === this.#revision && entryKey === this.#callbacks.projection()?.entryKey;
    const settlingCommand = stopping ? "settling" : "starting";
    if (this.#settleTimer !== null) window.clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
    this.#store.patch({ command: settlingCommand, notice: null });
    try {
      await this.#backend.service(domain, service, data, entityId);
      if (!current()) return;
      if (stopping && data.stop_now !== true && this.#store.value.smartStop) {
        // The backend has confirmed that this run will finish its current
        // entry; the user can now choose the explicit immediate override.
        this.#store.patch({ command: "idle" });
        return;
      }
      if (domain === "matic_robot" && (service === "clean_room_sequence" || service === "run_selected_plan")) {
        // These services return when their managed run ends, not when its
        // initial command is accepted. Do not show a new Starting interval.
        this.#store.patch({ command: "idle" });
        void this.#callbacks.refreshCatalog();
        return;
      }
      this.#store.patch({ command: settlingCommand });
      if (this.#settleTimer !== null) window.clearTimeout(this.#settleTimer);
      this.#settleTimer = window.setTimeout(() => {
        this.#settleTimer = null;
        if (current() && this.#store.value.command === settlingCommand) this.#store.patch({ command: "idle" });
      }, 15_000);
    } catch (error) {
      if (!current()) return;
      let failureNotice: WorkspaceNotice;
      if (stopping) {
        failureNotice = STOP_UNCONFIRMED;
      } else {
        const writes = await this.#callbacks.failureNotice(error);
        if (!current()) return;
        failureNotice = writes;
      }
      if (!current()) return;
      this.#store.patch({
        command: "failed",
        notice: failureNotice,
      });
    }
  }
}
