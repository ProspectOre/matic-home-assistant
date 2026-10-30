// Cleaning history and trail reads, loaded with the first of them. The
// backend (run_history.py) names outcomes and endings from its own records;
// an unknown value from a newer backend reads as unknown here.
// Runtime helpers arrive from effects so this module adds no startup edge.
import type { MaticBackend } from "./backend";
import type { MapEntry, PoseModel } from "./backend-contracts";
import type { RobotActivity, WorkspaceNotice } from "./contracts";
import type { WorkspaceStore } from "./state";

export type RunOutcome = "running" | "finished" | "not_finished" | "unknown";
export type RunEnding =
  | "running" | "finished" | "stopped" | "smart_stop" | "replaced" | "low_battery"
  | "robot_problem" | "taken_over" | "home_assistant" | "interrupted" | "unknown";
export type RunItemResult =
  | "completed" | "partial" | "stopped" | "interrupted" | "problem"
  | "unconfirmed" | "running" | "not_started" | "unknown";

export interface RunItem {
  readonly name: string;
  readonly result: RunItemResult;
}

export interface RunRecord {
  readonly id: string;
  /** `robot`: started from the Matic app or the robot, read from the robot's own history. */
  readonly source: "home_assistant" | "robot";
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly planName: string | null;
  readonly outcome: RunOutcome;
  readonly ending: RunEnding;
  readonly rooms: readonly RunItem[];
  readonly areas: readonly RunItem[];
  /** A trail recorded on the map shown now; null when none matches it. */
  readonly trail: string | null;
}

export interface RunHistory {
  readonly entryId: string;
  readonly mapSessionKey: string | null;
  /** False when the robot's own history could not be read this time. */
  readonly robotHistory: boolean;
  readonly runs: readonly RunRecord[];
}

export type TrailPoint = readonly [number, number];

export interface RunTrail {
  readonly id: string;
  readonly mapSessionKey: string;
  readonly segments: readonly (readonly TrailPoint[])[];
}

const OUTCOMES: readonly RunOutcome[] = ["running", "finished", "not_finished", "unknown"];
const ENDINGS: readonly RunEnding[] = [
  "running", "finished", "stopped", "smart_stop", "replaced", "low_battery",
  "robot_problem", "taken_over", "home_assistant", "interrupted", "unknown",
];
const RESULTS: readonly RunItemResult[] = [
  "completed", "partial", "stopped", "interrupted", "problem",
  "unconfirmed", "running", "not_started", "unknown",
];
const MAX_RUNS = 200;
const MAX_ITEMS = 64;
const MAX_SEGMENTS = 8;
const MAX_POINTS = 4_000;

const fail = (code: string): never => {
  throw new Error(code);
};

const record = (value: unknown, code: string): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail(code);

const text = (value: unknown, max: number, code: string): string =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : fail(code);

const optionalText = (value: unknown, max: number, code: string): string | null =>
  value === null || value === undefined ? null : text(value, max, code);

const time = (value: unknown): string | null =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;

const member = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? value as T : fallback;

const items = (value: unknown): RunItem[] => {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return fail("invalid-run-items");
  return value.map((candidate) => {
    const item = record(candidate, "invalid-run-item");
    return { name: text(item.name, 128, "invalid-run-item"), result: member(item.result, RESULTS, "unknown") };
  });
};

export const parseRunHistory = (value: unknown): RunHistory => {
  const payload = record(value, "invalid-runs");
  if (!Array.isArray(payload.runs) || payload.runs.length > MAX_RUNS) return fail("invalid-runs");
  return {
    entryId: text(payload.entry_id, 128, "invalid-runs"),
    mapSessionKey: optionalText(payload.map_session_key, 128, "invalid-runs"),
    robotHistory: payload.robot_history === true,
    runs: payload.runs.map((candidate) => {
      const run = record(candidate, "invalid-run");
      return {
        id: text(run.id, 128, "invalid-run"),
        source: run.source === "robot" ? "robot" : "home_assistant",
        startedAt: time(run.started_at),
        endedAt: time(run.ended_at),
        planName: optionalText(run.plan_name, 128, "invalid-run"),
        outcome: member(run.outcome, OUTCOMES, "unknown"),
        ending: member(run.ending, ENDINGS, "unknown"),
        rooms: items(run.rooms),
        areas: items(run.areas),
        trail: optionalText(run.trail, 64, "invalid-run"),
      } satisfies RunRecord;
    }),
  };
};

const coordinate = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000 ? value : fail("invalid-trail");

export const parseRunTrail = (value: unknown): RunTrail => {
  const payload = record(value, "invalid-trail");
  const segments = payload.segments;
  if (!Array.isArray(segments) || segments.length > MAX_SEGMENTS) return fail("invalid-trail");
  return {
    id: text(payload.trail, 64, "invalid-trail"),
    mapSessionKey: text(payload.map_session_key, 128, "invalid-trail"),
    segments: segments.map((segment) => {
      if (!Array.isArray(segment) || segment.length > MAX_POINTS) return fail("invalid-trail");
      return segment.map((point) => {
        if (!Array.isArray(point) || point.length !== 2) return fail("invalid-trail");
        return [coordinate(point[0]), coordinate(point[1])] as const;
      });
    }),
  };
};

const resource = <T>(status: "loading" | "ready" | "error", value: T | null, problem: string | null = null) =>
  ({ status, value, problem } as const);

/**
 * Reads the history list, or with `trail` one trail to draw. The run in
 * progress may have no trail yet; it then starts empty and grows with each
 * verified live pose (effects.ts).
 */
export const readRuns = async (
  store: WorkspaceStore,
  backend: MaticBackend,
  entry: MapEntry,
  trail: string | null,
  signal: AbortSignal,
  unavailable: WorkspaceNotice,
): Promise<void> => {
  const show = (runs: ReturnType<typeof resource<RunHistory>>): void => {
    store.patch({ resources: { ...store.value.resources, runs } });
  };
  if (!trail) show(resource("loading", store.value.resources.runs.value));
  try {
    const value = await backend.runs(entry.entryId, trail, signal);
    if (signal.aborted) return;
    if (trail) store.patch({ trail: parseRunTrail(value) });
    else show(resource("ready", parseRunHistory(value)));
  } catch (error) {
    if (signal.aborted) return;
    const failure = error as { readonly code?: unknown; readonly status?: unknown };
    if (!trail) {
      show(resource("error", store.value.resources.runs.value,
        typeof failure.code === "string" ? failure.code : "runs-unavailable"));
      return;
    }
    const key = store.value.resources.entry?.mapSessionKey;
    store.patch(trail === "live" && key && failure.status === 404
      ? { trail: { id: trail, mapSessionKey: key, segments: [[]] } }
      : { trail: null, notice: unavailable });
  }
};

const WORKING: readonly RobotActivity[] = ["starting", "cleaning", "paused", "returning", "stopping"];
// The run each store's live trail last grew for; null while no run is active.
const trailRuns = new WeakMap<WorkspaceStore, string | null>();

/**
 * Adds a verified live pose to the run-in-progress trail, keeping points at
 * least 15 cm apart. As in run_history.py, a managed run is its own trail
 * and a robot-started task lasts while the robot works; poses between runs
 * are not drawn, and a new run starts an empty trail.
 */
export const extendLiveTrail = (store: WorkspaceStore, pose: PoseModel): void => {
  const state = store.value;
  const managed = state.lastRun?.outcome === "running" ? `run:${state.lastRun.runId}` : null;
  const run = managed ?? (WORKING.includes(state.activity) ? "robot" : null);
  const previous = trailRuns.get(store);
  trailRuns.set(store, run);
  let trail = state.trail;
  if (!run || !pose.position || !pose.mapSessionKey || trail?.id !== "live") return;
  // A new run, or a new verified map whose frame the old points do not share.
  if ((previous !== undefined && previous !== run) || trail.mapSessionKey !== pose.mapSessionKey) {
    trail = { id: "live", mapSessionKey: pose.mapSessionKey, segments: [[]] };
  }
  const segment = trail.segments.at(-1) ?? [];
  const last = segment.at(-1);
  const [x, y] = pose.position;
  if (last && Math.hypot(x - last[0], y - last[1]) < 0.15) return;
  store.patch({ trail: { ...trail, segments: [...trail.segments.slice(0, -1), [...segment, [x, y] as const].slice(-MAX_POINTS)] } });
};

/**
 * Rereads an open Cleaning history when the run it reports starts, ends or is
 * credited late, and outside a managed run when a robot-started task starts
 * or ends, since those come from the robot's own history. Returns the
 * unsubscribe for the controller that owns `reload`.
 */
export const watchRuns = (store: WorkspaceStore, reload: () => void): (() => void) => {
  let shown: string | undefined;
  return store.subscribe((state) => {
    const run = state.lastRun;
    const managed = run ? `${run.runId}:${run.outcome}:${run.completedRoomCount}` : "";
    const key = run?.outcome === "running" ? managed : `${managed}:${WORKING.includes(state.activity)}`;
    if (shown !== undefined && key !== shown && state.workflow === "runs") reload();
    shown = key;
  });
};
