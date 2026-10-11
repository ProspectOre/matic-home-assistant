import type {
  CadenceReason,
  NextRunPreviewRoom,
  RoomCadencePolicy,
  RoomCadenceProgress,
  SavedPlan,
} from "../backend-contracts";
import { syntheticMockupEstimateSeconds, syntheticMockupPlans } from "../synthetic-fixtures";
import { listOf, num, t } from "./copy";
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

/**
 * Picker line 3 (plan.md §3, §6): due work, or "Needs attention" for any
 * blocker but `plan_disabled`; nothing for a paused plan. Mop, deep vacuum
 * and both due are three whole strings; nothing is joined in code.
 */
export const planAttention = (plan: SavedPlan, variants: Variants, focusId: string): string | null => {
  if (!plan.enabled) return null;
  const blocker = plan.nextRunPreview?.blocker ?? null;
  if (blocker && blocker !== "plan_disabled") return t("v4_plan_row_blocked");
  const rooms = previewRooms(plan, variants, focusId);
  const mop = rooms.filter((room) => room.cadenceReasons.includes("mop_due")).map((room) => room.name);
  const deep = rooms.filter((room) => room.cadenceReasons.includes("coverage_due")).map((room) => room.name);
  if (mop.length && deep.length) return t("v4_plan_row_both_due", { mop: listOf(mop), deep: listOf(deep) });
  if (mop.length) return t("v4_plan_row_mop_due", { rooms: listOf(mop) });
  if (deep.length) return t("v4_plan_row_deep_due", { rooms: listOf(deep) });
  return null;
};

/**
 * Run's summary (plan.md §3, §6): "{count} rooms", or the estimate string
 * when the plan.md §9 field exists and the preview is runnable. The order
 * is not repeated here: the caption or the numbers carry it.
 */
export const runSummary = (plan: SavedPlan, runnable: boolean): string => {
  const count = num(plan.rooms.length);
  const seconds = syntheticMockupEstimateSeconds[plan.id] ?? null;
  if (!runnable || seconds === null || plan.nextRunPreview?.blocker) return t("v4_plan_summary_rooms", { count });
  return t("v4_plan_summary_rooms_estimate", { count, minutes: num(Math.round(seconds / 60)) });
};

/** The due toggle off moves each due schedule two cleans away. */
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
      ? { mopDue: false, mopProgress: Math.max(0, mopEvery - 3), nextMopIn: 2 }
      : {}),
    ...(progress.coverageDue && coverageEvery !== null
      ? { coverageDue: false, coverageProgress: Math.max(0, coverageEvery - 3), nextCoverageIn: 2 }
      : {}),
    reasons: withDue(progress.reasons, false),
  };
};

/** room-schedule.md §6 status line for one schedule. */
export const statusLine = (
  every: number | null,
  counted: number,
  due: boolean,
  remaining: number | null,
): string | null => {
  if (every === null) return null;
  if (every === 1) return t("v4_cadence_status_every");
  if (due) return t("v4_cadence_status_due", { counted: num(counted), every: num(every) });
  return t("v4_cadence_status", {
    counted: num(counted),
    every: num(every),
    remaining: num(remaining ?? Math.max(1, every - 1 - counted)),
  });
};
