import type {
  CadenceReason,
  NextRunPreviewRoom,
  RoomCadencePolicy,
  RoomCadenceProgress,
  SavedPlan,
} from "../backend-contracts";
import { syntheticMockupEstimateSeconds, syntheticMockupPlans } from "../synthetic-fixtures";
import { ROTATION_LEVEL, listOf, num, t, type CopyKey, type RotationLevel } from "./copy";
import type { Variants } from "./frame";

// Derived views of the synthetic plan catalog. The toggles map onto it as:
// "due" off clears the due reasons and runs each room at its own settings;
// the order toggle replaces the runBehavior of the plan on screen (Daily
// clean on home and the picker).

export const CATALOG = syntheticMockupPlans();
export const DEFAULT_PLAN_ID = "daily";

export const roomName = (roomId: string): string =>
  CATALOG.rooms.find((room) => room.roomId === roomId)?.name ?? roomId;

export const planById = (id: string): SavedPlan => {
  const plan = CATALOG.plans.find((candidate) => candidate.id === id);
  if (!plan) throw new Error(`unknown synthetic plan ${id}`);
  return plan;
};

const DUE_REASONS: ReadonlySet<CadenceReason> = new Set<CadenceReason>(["mop_due", "coverage_due"]);

export const withDue = (reasons: readonly CadenceReason[], due: boolean): readonly CadenceReason[] =>
  due ? reasons : reasons.filter((reason) => !DUE_REASONS.has(reason));

export const orderFor = (plan: SavedPlan, variants: Variants, focusId: string): SavedPlan["runBehavior"] =>
  plan.id === focusId ? variants.order : plan.runBehavior;

/** `nextRunPreview.rooms` with the due toggle applied, in server order. */
export const previewRooms = (plan: SavedPlan, variants: Variants, focusId: string): readonly NextRunPreviewRoom[] => {
  const rooms = (plan.nextRunPreview?.rooms ?? []).map((room): NextRunPreviewRoom => {
    if (variants.due || !room.cadenceReasons.some((reason) => DUE_REASONS.has(reason))) return room;
    const own = plan.rooms.find((candidate) => candidate.roomId === room.roomId);
    return {
      ...room,
      cleaningMode: own?.cleaningMode ?? room.cleaningMode,
      coverageSetting: own?.coverageSetting ?? room.coverageSetting,
      cadenceReasons: withDue(room.cadenceReasons, false),
    };
  });
  if (orderFor(plan, variants, focusId) !== "ordered") return rooms;
  return [...rooms].sort((a, b) => plan.roomOrder.indexOf(a.roomId) - plan.roomOrder.indexOf(b.roomId));
};

/** Picker line 2 and the home card detail (plan.md §3, §6): one whole string per order. */
export const planLine = (plan: SavedPlan, order: SavedPlan["runBehavior"]): string =>
  t(order === "ordered" ? "v4_plan_row_ordered" : "v4_plan_row_rotation", { count: num(plan.rooms.length) });

type DueKind = "mop" | RotationLevel;

const DUE_KEYS: Readonly<Record<DueKind, CopyKey>> = {
  mop: "v4_due_mop",
  quick: "v4_due_quick",
  optimal: "v4_due_optimal",
  heavy: "v4_due_heavy",
};

/**
 * The due lines (plan.md §6 `v4_due_*`): one whole string per due kind, in
 * the order mop, quick, optimal, heavy duty. A room's rotation level is the
 * preview room's effective `coverageSetting` (backend-contracts.ts:180-181).
 */
export const dueLines = (rooms: readonly NextRunPreviewRoom[]): readonly string[] => {
  const names: Record<DueKind, string[]> = { mop: [], quick: [], optimal: [], heavy: [] };
  for (const room of rooms) {
    if (room.cadenceReasons.includes("mop_due")) names.mop.push(room.name);
    if (room.cadenceReasons.includes("coverage_due")) names[ROTATION_LEVEL[room.coverageSetting]].push(room.name);
  }
  return (Object.keys(DUE_KEYS) as DueKind[])
    .filter((kind) => names[kind].length > 0)
    .map((kind) => t(DUE_KEYS[kind], { rooms: listOf(names[kind]) }));
};

/**
 * Picker line 3 and the home card's line 3 (plan.md §3): the due lines, or
 * "Needs attention" for any blocker but `plan_disabled`; nothing for a
 * paused plan.
 */
export const planLine3 = (plan: SavedPlan, variants: Variants, focusId: string): { readonly due: readonly string[] } | { readonly blocked: string } | null => {
  if (!plan.enabled) return null;
  const blocker = plan.nextRunPreview?.blocker ?? null;
  if (blocker && blocker !== "plan_disabled") return { blocked: t("v4_plan_row_blocked") };
  const due = dueLines(previewRooms(plan, variants, focusId));
  return due.length ? { due } : null;
};

/**
 * Run's summary (plan.md §3, §6): "{count} rooms", or the estimate string
 * when the plan.md §9 field exists and the preview is runnable. The order
 * is not repeated here: the rotation hint or the numbers carry it.
 */
export const runSummary = (plan: SavedPlan, runnable: boolean): string => {
  const count = num(plan.rooms.length);
  const seconds = syntheticMockupEstimateSeconds[plan.id] ?? null;
  if (!runnable || seconds === null || plan.nextRunPreview?.blocker) return t("v4_plan_summary_rooms", { count });
  return t("v4_plan_summary_rooms_estimate", { count, minutes: num(Math.round(seconds / 60)) });
};

/**
 * The due toggle off moves each due schedule two cleans away: count
 * every − 2, so cadence.py:118-131 gives next_*_in = 2.
 */
export const progressFor = (
  progress: RoomCadenceProgress | undefined,
  cadence: RoomCadencePolicy | undefined,
  due: boolean,
): RoomCadenceProgress | undefined => {
  if (!progress || due) return progress;
  const mopEvery = cadence?.mopEveryN ?? null;
  const coverageEvery = cadence?.coverageEveryN ?? null;
  return {
    ...progress,
    ...(progress.mopDue && mopEvery !== null
      ? { mopDue: false, mopProgress: Math.max(0, mopEvery - 2), nextMopIn: 2 }
      : {}),
    ...(progress.coverageDue && coverageEvery !== null
      ? { coverageDue: false, coverageProgress: Math.max(0, coverageEvery - 2), nextCoverageIn: 2 }
      : {}),
    reasons: withDue(progress.reasons, false),
  };
};

/**
 * room-schedule.md §5 next-clean switch: a schedule is named only while it is
 * on and not already "Due next clean" (server next_*_in > 1). A schedule at
 * every clean is never named (its next_*_in is always 1, cadence.py:118-123),
 * and a new one with no progress yet counts as not due.
 */
export const canBringForward = (every: number | null, nextIn: number | null): boolean =>
  every !== null && every > 1 && (nextIn ?? 2) > 1;

/**
 * room-schedule.md §5 status line, when it happens and nothing else:
 * "Due every clean" at interval 1, which wins over "Due next clean"; else
 * "Due next clean" when the server's next_*_in is 1 or the next-clean switch
 * forces it, else "Due in {count} cleans" with that server value.
 */
export const statusLine = (every: number | null, nextIn: number | null, forced: boolean): string | null => {
  if (every === null) return t("v4_cadence_status_off");
  if (every === 1) return t("v4_cadence_status_every");
  if (forced) return t("v4_cadence_status_next");
  if (nextIn === null) return null;
  return nextIn <= 1 ? t("v4_cadence_status_next") : t("v4_cadence_status_in", { count: num(nextIn) });
};
