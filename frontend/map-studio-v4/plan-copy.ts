import type { CleaningMode, CoverageSetting, NextRunPreviewRoom, PlanRoom, SavedPlan } from "./backend-contracts";
import type { PlanDraft, PlanDraftArea } from "./contracts";
import { formatList } from "./localize";

// Shared by the shell's home plan card and the plan views, so only what the
// card needs lives here (home-rooms.md R1); the rest is in plan-cadence.ts.

/** The views' translate: key, fallback and the values for its placeholders. */
export type Translate = (key: string, fallback: string, placeholders?: Readonly<Record<string, string | number>>) => string;

/** A count as the language writes it (plan.md §8). */
export const formatNumber = (locale: string, value: number): string => new Intl.NumberFormat(locale).format(value);

/** A saved custom area in a plan, read from the entries the plans list sent. */
export interface PlanAreaEntry {
  readonly areaId: string;
  readonly name: string;
  readonly cleaningMode: CleaningMode;
  readonly coverageSetting: CoverageSetting;
}

const AREA_MODES: readonly unknown[] = ["vacuum", "mop", "vacuum_and_mop"];
const AREA_COVERAGES: readonly unknown[] = ["quick", "standard", "heavy_duty"];

/**
 * A saved plan's entries in run order: a custom area, or null for the plan's
 * next room. Map Studio edits rooms only, so its areas come from the entries
 * as sent; one it can't read is left out.
 */
const planEntrySlots = (entries: unknown): (PlanAreaEntry | null)[] =>
  (Array.isArray(entries) ? entries : []).flatMap((value: unknown) => {
    const entry = (value ?? {}) as Record<string, unknown>;
    if (entry.kind !== "area") return [null];
    const { area_id: areaId, name, cleaning_mode: cleaningMode, coverage_setting: coverageSetting } = entry;
    return typeof areaId === "string" && AREA_MODES.includes(cleaningMode) && AREA_COVERAGES.includes(coverageSetting)
      ? [{ areaId, name: typeof name === "string" && name ? name : areaId, cleaningMode, coverageSetting } as PlanAreaEntry]
      : [];
  });

/** A saved plan's custom areas, in run order. */
export const planAreas = (plan: SavedPlan): PlanAreaEntry[] =>
  planEntrySlots(plan.entries).filter((slot): slot is PlanAreaEntry => slot !== null);

/** The plan's rooms with its custom areas back in their places; rooms beyond the saved ones go last. */
export const withPlanAreas = <T>(plan: SavedPlan, rooms: readonly T[], area: (entry: PlanAreaEntry) => T): T[] => {
  const queue = [...rooms];
  return [...planEntrySlots(plan.entries).flatMap((slot) => slot ? [area(slot)] : queue.splice(0, 1)), ...queue];
};

/** One step of a plan draft's run: a room with its settings, or a custom area. */
export type DraftStep =
  | { readonly room: PlanRoom; readonly area?: undefined }
  | { readonly room?: undefined; readonly area: PlanDraftArea };

/**
 * A draft's run order: its rooms, with each custom area after its slot's
 * rooms. The `save_plan` request sends the same order (catalog-writes.ts).
 */
export const draftSteps = ({ rooms, areas }: Pick<PlanDraft, "rooms" | "areas">): DraftStep[] =>
  [...rooms, null].flatMap((room, at): DraftStep[] => [
    ...areas.filter((area) => Math.min(area.slot, rooms.length) === at).map((area) => ({ area })),
    ...room ? [{ room }] : [],
  ]);

/** A run order back as the draft's rooms and areas, each area after the rooms before it. */
export const fromSteps = (steps: readonly DraftStep[]): Pick<PlanDraft, "rooms" | "areas"> => {
  const rooms: PlanRoom[] = [];
  const areas: PlanDraftArea[] = [];
  for (const { room, area } of steps) {
    if (room) rooms.push(room);
    else areas.push({ ...area, slot: rooms.length });
  }
  return { rooms, areas };
};

/** The names of the saved plans that clean a custom area, quoted, in the catalog's order. */
export const plansWithArea = (plans: readonly SavedPlan[] | undefined, areaId: string): string[] =>
  (plans ?? []).filter((plan) => planAreas(plan).some((area) => area.areaId === areaId)).map((plan) => `"${plan.name}"`);

/** "2 rooms · 1 custom area": a plan's rooms (none when it has only areas) and its custom areas. */
export const roomsAndAreas = (t: Translate, locale: string, rooms: number, areas: number): string => [
  ...rooms || !areas ? [rooms === 1
    ? t("v4_plan_summary_rooms_one", "1 room")
    : t("v4_plan_summary_rooms", "{count} rooms", { count: formatNumber(locale, rooms) })] : [],
  ...areas ? [areas === 1
    ? t("v4_plan_summary_areas_one", "1 custom area")
    : t("v4_plan_summary_areas", "{count} custom areas", { count: formatNumber(locale, areas) })] : [],
].join(" · ");

/**
 * The due lines (plan.md §6 `v4_due_*`): one whole string per due kind, in
 * the order mop, quick, optimal, heavy duty. A rotation's level is the
 * preview room's own vacuum coverage.
 */
export const dueLines = (t: Translate, locale: string, rooms: readonly NextRunPreviewRoom[]): string[] => {
  const due = (match: (room: NextRunPreviewRoom) => boolean): string | null => {
    const names = rooms.filter(match).map((room) => room.name);
    return names.length ? formatList(locale, names) : null;
  };
  const rotation = (level: PlanRoom["coverageSetting"]) => due((room) =>
    room.cadenceReasons.includes("coverage_due") && room.coverageSetting === level);
  const mop = due((room) => room.cadenceReasons.includes("mop_due"));
  const quick = rotation("quick");
  const optimal = rotation("standard");
  const heavy = rotation("heavy_duty");
  return [
    mop && t("v4_due_mop", "Mop due in {rooms}", { rooms: mop }),
    quick && t("v4_due_quick", "Quick vacuum due in {rooms}", { rooms: quick }),
    optimal && t("v4_due_optimal", "Optimal vacuum due in {rooms}", { rooms: optimal }),
    heavy && t("v4_due_heavy", "Heavy duty vacuum due in {rooms}", { rooms: heavy }),
  ].filter((line): line is string => Boolean(line));
};

/** A plan row's second line: room count and run order (plan.md §6 `v4_plan_row_*`). */
export const planRowLine2 = (t: Translate, locale: string, plan: SavedPlan): string => {
  const count = plan.rooms.length;
  const ordered = plan.runBehavior === "ordered";
  const areas = planAreas(plan).length;
  if (areas) {
    return `${roomsAndAreas(t, locale, count, areas)} · ${ordered
      ? t("v4_plan_order_ordered_hint", "Top to bottom, as listed")
      : t("v4_plan_order_intelligent_hint", "Longest-waiting first")}`;
  }
  if (count === 1) {
    return ordered
      ? t("v4_plan_row_ordered_one", "1 room · Top to bottom, as listed")
      : t("v4_plan_row_rotation_one", "1 room · Smart Order");
  }
  return ordered
    ? t("v4_plan_row_ordered", "{count} rooms · Top to bottom, as listed", { count: formatNumber(locale, count) })
    : t("v4_plan_row_rotation", "{count} rooms · Smart Order", { count: formatNumber(locale, count) });
};

export type PlanRowLine3 = { readonly blocked: string } | { readonly due: readonly string[] } | null;

/**
 * A plan row's third line: the due work, or the one blocked line. A paused
 * plan shows only its chip (plan.md R2), so it has none.
 */
export const planRowLine3 = (t: Translate, locale: string, plan: SavedPlan): PlanRowLine3 => {
  if (!plan.enabled) return null;
  const blocker = plan.nextRunPreview?.blocker;
  if (blocker && blocker !== "plan_disabled") return { blocked: t("v4_plan_row_blocked", "Needs attention before it can run") };
  const due = dueLines(t, locale, plan.nextRunPreview?.rooms ?? []);
  return due.length ? { due } : null;
};
