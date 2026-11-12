import { html, nothing } from "lit";
import type {
  CadenceReason,
  CleaningMode,
  CoverageSetting,
  PlanRoom,
  PlansCatalog,
  RoomCadencePolicy,
  RoomCadenceProgress,
} from "./backend-contracts";
import type { CadenceResetMode, WorkspaceIntent, WorkspaceState } from "./contracts";
import { formatNumber, type Translate } from "./plan-copy";
import { roomBlockReason } from "./workflow-actions";
import { icon, iconChevronRight, iconNoticeWarning, iconOverflow } from "./icons";
import type { MenuController } from "./menu-controller";
import { MOP_INTERVAL_MIN, snapInterval, stepper } from "./stepper";

export { INTERVAL_MAX, INTERVAL_MIN, MOP_INTERVAL_MIN, snapInterval, stepInterval } from "./stepper";

export const MODES: readonly CleaningMode[] = ["vacuum", "mop", "vacuum_and_mop"];
export const COVERAGES: readonly CoverageSetting[] = ["quick", "standard", "heavy_duty"];

export const modeLabel = (t: Translate, mode: CleaningMode): string =>
  mode === "vacuum" ? t("vacuum", "Vacuum") : mode === "mop" ? t("mop", "Mop") : t("vacuum_and_mop", "Vacuum + mop");

export const coverageLabel = (t: Translate, value: CoverageSetting): string =>
  value === "quick" ? t("quick", "Quick") : value === "standard" ? t("standard", "Optimal") : t("heavy_duty", "Heavy duty");

export const coverageNeedsVacuum = (t: Translate): string =>
  t("v4_cadence_coverage_requires_vacuum", "The vacuum rotation needs a cleaning mode that includes vacuuming, so change the mode or turn the rotation off.");

/** A room schedule's state in one or two sentences, most urgent first. */
/**
 * A Rooms row's third line (home-rooms.md R20): the schedule problem that
 * keeps the row's schedule from applying, or null for due work alone.
 */
export const cadenceProblem = (t: Translate, reasons: readonly CadenceReason[]): string | null => {
  if (reasons.includes("coverage_requires_vacuum")) return coverageNeedsVacuum(t);
  if (reasons.includes("identity_changed") || reasons.includes("room_not_on_current_map")) {
    return t("v4_cadence_identity_blocked", "This room's schedule was set up on a different map, so it can't run. Review the room's schedule before cleaning.");
  }
  if (reasons.includes("shared_schedule_unavailable")) {
    return t("v4_cadence_shared_unavailable", "The shared room schedule is unavailable. Review its settings before cleaning.");
  }
  if (reasons.includes("mop_progress_unverified") || reasons.includes("coverage_progress_unverified")) {
    const unverified: string[] = [];
    if (reasons.includes("mop_progress_unverified")) {
      unverified.push(t("v4_cadence_mop_progress_unverified", "Can't run this schedule until you reset its mopping progress, which Home Assistant can't confirm."));
    }
    if (reasons.includes("coverage_progress_unverified")) {
      unverified.push(t("v4_cadence_coverage_progress_unverified", "Can't run this schedule until you reset its vacuum rotation progress, which Home Assistant can't confirm."));
    }
    return unverified.join(" ");
  }
  if (reasons.includes("cadence_progress_unverified")) {
    return t("v4_cadence_progress_unverified", "Can't run this schedule until you reset its progress, which Home Assistant can't confirm.");
  }
  if (reasons.includes("invalid_cadence_policy")) {
    return t("v4_cadence_policy_invalid", "The room schedule needs review before it can be applied.");
  }
  return null;
};

// ---- The schedule model (room-schedule.md §3-§6) ----------------------------

export type ScheduleKind = "mop" | "coverage";
/** A room with no schedule yet counts across all plans (room-schedule.md §5 Scope). */
const OFF: RoomCadencePolicy = {
  scope: "shared",
  mopEveryN: null,
  coverageEveryN: null,
  periodicCoverageSetting: null,
  doMopNext: false,
  doCoverageNext: false,
};

export const hasSchedule = (policy: RoomCadencePolicy | null | undefined): boolean =>
  Boolean(policy && (policy.mopEveryN !== null || policy.coverageEveryN !== null));

export interface ScheduleInput {
  /** The draft room. */
  readonly room: PlanRoom;
  /** That room in the saved plan. */
  readonly saved: PlanRoom | undefined;
  readonly catalogRoom: PlansCatalog["rooms"][number] | undefined;
  /** The room's name, for {room}. */
  readonly name: string;
  /** The level chosen while the rotation is Off, held by the view (never a draft patch). */
  readonly offLevel: CoverageSetting | null;
}

export interface ScheduleRow {
  readonly every: number | null;
  /** The label line, which also names the field. */
  readonly label: string;
  /** The status line; null shows none. */
  readonly status: string | null;
  /** A reason that replaces the status line. */
  readonly reason: string | null;
  /** A mode conflict: the stepper is held by `reason`. */
  readonly blocked: boolean;
  /** Progress Home Assistant can't confirm: Reset shows under the reason. */
  readonly unverified: boolean;
}

export interface NextClean {
  readonly label: string;
  readonly on: boolean;
  /** The label names mopping: the work brought forward while on, else the work it can bring forward. */
  readonly mop: boolean;
  readonly coverage: boolean;
  /** The row whose mode conflict holds the switch, as it holds that row's stepper; else null. */
  readonly blocked: ScheduleKind | null;
}

export interface ScheduleModel {
  /** The draft cadence, or Off counted across all plans. */
  readonly policy: RoomCadencePolicy;
  /** The rotation's level as shown. */
  readonly level: CoverageSetting;
  readonly mop: ScheduleRow;
  readonly coverage: ScheduleRow;
  /** A rotation on a mop-only room, which only "Turn off" can fix. */
  readonly legacyCoverage: boolean;
  /** The reason under the heading for a schedule from another map or one that needs fixing. */
  readonly roomReason: string | null;
  readonly sharedHint: boolean;
  /** Joining a shared schedule: both rows read-only until Save. */
  readonly joinPending: boolean;
  /** The saved room already uses the shared schedule. */
  readonly participating: boolean;
  readonly next: NextClean | null;
  readonly explanation: string | null;
  readonly scope: "shared" | "plan";
  /**
   * Which progress the room menu can reset: only saved progress. `both`: a
   * shared schedule's unverified counting, reset under the room's reason.
   */
  readonly resettable: { readonly mop: boolean; readonly coverage: boolean; readonly both: boolean };
  /** Why "Across all plans" can't be chosen: a shared schedule this room's mode can't use. */
  readonly sharedReason: string | null;
}

const ROTATION: Record<CoverageSetting, (t: Translate, count: string | null, one: boolean) => string> = {
  quick: (t, count, one) => count === null
    ? t("v4_cadence_coverage_quick_off", "Quick vacuum")
    : one
      ? t("v4_cadence_coverage_quick_one", "Quick vacuum every clean")
      : t("v4_cadence_coverage_quick", "Quick vacuum every {count} cleans", { count }),
  standard: (t, count, one) => count === null
    ? t("v4_cadence_coverage_optimal_off", "Optimal vacuum")
    : one
      ? t("v4_cadence_coverage_optimal_one", "Optimal vacuum every clean")
      : t("v4_cadence_coverage_optimal", "Optimal vacuum every {count} cleans", { count }),
  heavy_duty: (t, count, one) => count === null
    ? t("v4_cadence_coverage_heavy_off", "Heavy duty vacuum")
    : one
      ? t("v4_cadence_coverage_heavy_one", "Heavy duty vacuum every clean")
      : t("v4_cadence_coverage_heavy", "Heavy duty vacuum every {count} cleans", { count }),
};

const NEXT: Record<CoverageSetting, (t: Translate, mop: boolean) => string> = {
  quick: (t, mop) => mop
    ? t("v4_cadence_next_mop_quick", "Mop and quick vacuum on the next clean")
    : t("v4_cadence_next_quick", "Quick vacuum on the next clean"),
  standard: (t, mop) => mop
    ? t("v4_cadence_next_mop_optimal", "Mop and optimal vacuum on the next clean")
    : t("v4_cadence_next_optimal", "Optimal vacuum on the next clean"),
  heavy_duty: (t, mop) => mop
    ? t("v4_cadence_next_mop_heavy", "Mop and heavy duty vacuum on the next clean")
    : t("v4_cadence_next_heavy", "Heavy duty vacuum on the next clean"),
};

const mopLabel = (t: Translate, locale: string, every: number | null): string =>
  every === null
    ? t("v4_cadence_mop_off", "Occasional mopping")
    : every === 1
      ? t("v4_cadence_mop_interval_one", "Mop every clean")
      : t("v4_cadence_mop_interval", "Mop every {count} cleans", { count: formatNumber(locale, every) });

const rotationLabel = (t: Translate, locale: string, level: CoverageSetting, every: number | null): string =>
  ROTATION[level](t, every === null ? null : formatNumber(locale, every), every === 1);

/** The reasons that hold the whole block, shown under its heading (plan.md R3 text). */
const ROOM_REASONS: readonly CadenceReason[] = [
  "cadence_progress_unverified", "identity_changed", "room_not_on_current_map", "shared_schedule_unavailable", "invalid_cadence_policy",
];

interface Facts {
  readonly policy: RoomCadencePolicy;
  readonly shared: RoomCadencePolicy | undefined;
  readonly sharedExists: boolean;
  readonly participating: boolean;
  readonly joinPending: boolean;
  readonly progress: RoomCadenceProgress | undefined;
  readonly reasons: readonly CadenceReason[];
  readonly savedPolicy: RoomCadencePolicy | undefined;
  /** The saved room's own counters, kept while a private schedule is off (plans.py cadence_progress). */
  readonly savedProgress: RoomCadenceProgress | undefined;
  /** This room's cleaning mode can use the shared schedule (cadence.py:45-46, 66-70). */
  readonly sharedFits: boolean;
  /** A shared schedule the catalog reports only by its reasons (invalid or unavailable, slam_scene.py). */
  readonly sharedBroken: boolean;
}

const facts = ({ room, saved, catalogRoom }: ScheduleInput): Facts => {
  const policy = room.cadence ?? OFF;
  const shared = catalogRoom?.sharedCadence;
  // The catalog gives a broken shared schedule its reasons but no policy.
  const sharedBroken = shared === undefined && (catalogRoom?.sharedCadenceReasons?.length ?? 0) > 0;
  const sharedExists = shared !== undefined || sharedBroken;
  const participating = saved?.cadence?.scope === "shared";
  const joinPending = shared !== undefined && !participating && room.cadence?.scope === "shared";
  return {
    policy,
    shared,
    sharedExists,
    participating,
    joinPending,
    progress: joinPending ? catalogRoom?.sharedCadenceProgress : room.cadenceProgress,
    reasons: joinPending ? catalogRoom?.sharedCadenceReasons ?? [] : room.cadenceReasons ?? [],
    savedPolicy: saved?.cadence,
    savedProgress: saved?.cadenceProgress,
    sharedFits: !shared
      || ((shared.mopEveryN === null || room.cleaningMode === "vacuum") && (shared.coverageEveryN === null || room.cleaningMode !== "mop")),
    sharedBroken,
  };
};

const FIELDS = {
  mop: { every: "mopEveryN", flag: "doMopNext", next: "nextMopIn", count: "mopProgress" },
  coverage: { every: "coverageEveryN", flag: "doCoverageNext", next: "nextCoverageIn", count: "coverageProgress" },
} as const;

/** The next-clean flag the server's progress counted: the shared one while joining, else the saved one. */
const countedFlag = (f: Facts, kind: ScheduleKind): boolean =>
  Boolean((f.joinPending ? f.shared : f.savedPolicy)?.[FIELDS[kind].flag]);

/**
 * Saving starts fresh progress: leaving a shared schedule resets this plan's
 * own (plans.py reset_private_progress), and a new shared one starts at zero.
 * A join keeps the shared progress instead.
 */
const scopeChanged = (f: Facts): boolean =>
  !f.joinPending && f.savedPolicy !== undefined && f.savedPolicy.scope !== f.policy.scope;

/**
 * The server's `next_*_in` as Save will leave it. Its value stands while the
 * draft keeps what it counted (a join reads the shared count as counted);
 * once the draft turns the row on, changes how often, moves its flag or its
 * scope, the count the save keeps decides (cadence.py:94-131): due with the
 * flag or at interval - 1 cleans, else the rest of the interval.
 */
const nextIn = (f: Facts, kind: ScheduleKind): number | null => {
  const { every, flag, next, count } = FIELDS[kind];
  const interval = f.policy[every];
  if (!f.progress || interval === null) return null;
  const recount = !f.joinPending
    && (scopeChanged(f) || interval !== (f.savedPolicy?.[every] ?? null) || f.policy[flag] !== countedFlag(f, kind));
  if (!recount) return f.progress[next];
  const done = scopeChanged(f) ? 0 : f.progress[count];
  return f.policy[flag] || done >= interval - 1 ? 1 : interval - done;
};

/** How often changed from a saved value (a join is not an edit). */
const edited = (f: Facts, kind: ScheduleKind): boolean => {
  const field = FIELDS[kind].every;
  const before = f.savedPolicy?.[field] ?? null;
  return !f.joinPending && before !== null && f.policy[field] !== null && f.policy[field] !== before;
};

/**
 * The work the switch can bring forward: on, not every clean, and not due
 * next clean once saved (`nextIn`, so fresh progress after a scope change
 * is never due). A saved flag keeps naming its work after the switch is
 * turned off, so the switch stays to be turned back on.
 */
const named = (f: Facts, kind: ScheduleKind): boolean => {
  const every = f.policy[FIELDS[kind].every];
  return every !== null && every > 1 && (countedFlag(f, kind) || nextIn(f, kind) !== 1);
};

/**
 * The rows a mode conflict holds (room-schedule.md §4 S10): a new mop
 * schedule needs Vacuum, and a rotation needs a mode that includes vacuuming.
 * Progress Home Assistant can't confirm shows its own reason instead.
 */
const modeBlocked = ({ room }: ScheduleInput, f: Facts): { readonly mop: boolean; readonly coverage: boolean } => ({
  mop: !f.reasons.includes("mop_progress_unverified") && room.cleaningMode !== "vacuum" && f.policy.mopEveryN === null,
  coverage: !f.reasons.includes("coverage_progress_unverified") && room.cleaningMode === "mop",
});

const statusLine = (t: Translate, locale: string, f: Facts, kind: ScheduleKind): string | null => {
  const every = f.policy[FIELDS[kind].every];
  const due = nextIn(f, kind);
  if (every === null) return t("v4_cadence_status_off", "Not scheduled");
  if (every === 1) return t("v4_cadence_status_every", "Due every clean");
  // Due next clean (the flag, or the count the save keeps) wins over "Keeps the progress so far".
  if (f.policy[FIELDS[kind].flag] || due === 1) return t("v4_cadence_status_next", "Due next clean");
  if (edited(f, kind)) return t("v4_cadence_status_edited", "Keeps the progress so far");
  if (scopeChanged(f) || due === null) return null;
  return t("v4_cadence_status_in", "Due in {count} cleans", { count: formatNumber(locale, due) });
};

const explanation = (t: Translate, f: Facts, name: string): string | null => {
  const { policy, participating } = f;
  const scheduled = hasSchedule(policy);
  if (f.joinPending) {
    return t("v4_cadence_shared_join_effect", "Saving shares this room's progress with every plan that uses it, picking up any progress already counted.");
  }
  if (participating && policy.scope === "plan") {
    return t("v4_cadence_shared_leave_effect", "Saving starts new progress for this plan only, and other plans keep the shared schedule.");
  }
  if (!participating && policy.scope === "shared" && scheduled) {
    return t("v4_cadence_new_shared_effect", "Starts counting from zero, across plans that use these settings.");
  }
  // A paused private schedule keeps its counters, so a row turned back on
  // resumes them (cadence.py:93-99); only a row with none starts from zero.
  const resumes = (["mop", "coverage"] as const).some((kind) =>
    policy[FIELDS[kind].every] !== null && (f.savedProgress?.[FIELDS[kind].count] ?? 0) > 0);
  if (policy.scope === "plan" && scheduled && !hasSchedule(f.savedPolicy) && !resumes) {
    return t("v4_cadence_new_private_effect", "Starts counting completed cleans in this plan only, from zero.");
  }
  if (f.savedPolicy && (policy.mopEveryN !== f.savedPolicy.mopEveryN || policy.coverageEveryN !== f.savedPolicy.coverageEveryN)) {
    return t("v4_cadence_existing_effect", "Changing how often keeps your progress. Turning this off pauses counting.");
  }
  return participating
    ? t("v4_cadence_shared_edit_effect", "Changes apply to every plan using {room}'s smart cleaning settings.", { room: name })
    : null;
};

export const scheduleModel = (t: Translate, locale: string, input: ScheduleInput): ScheduleModel => {
  const f = facts(input);
  const { policy, reasons } = f;
  const { room, saved, name } = input;
  const coverageOn = policy.coverageEveryN !== null;
  const level = (coverageOn ? null : input.offLevel) ?? policy.periodicCoverageSetting ?? "heavy_duty";
  const has = (reason: CadenceReason): boolean => reasons.includes(reason);
  const mopUnverified = has("mop_progress_unverified");
  const { mop: mopBlocked, coverage: coverageBlocked } = modeBlocked(input, f);
  const coverageUnverified = has("coverage_progress_unverified");
  const legacyCoverage = !coverageUnverified && room.cleaningMode === "mop" && coverageOn;
  const block = roomBlockReason(reasons.filter((reason) => ROOM_REASONS.includes(reason)), name);
  const on = policy.doMopNext || policy.doCoverageNext;
  // While on, the label names the work brought forward (its flags), so a row
  // edited afterwards never joins a checked label it wouldn't do; off, it
  // names the work it can bring forward.
  const labelMop = on ? policy.doMopNext : named(f, "mop");
  const labelCoverage = on ? policy.doCoverageNext : named(f, "coverage");
  const savedHas = (count: number | undefined, flag: boolean | undefined, reason: CadenceReason): boolean =>
    saved !== undefined && ((count ?? 0) > 0 || Boolean(flag) || Boolean(saved.cadenceReasons?.includes(reason)));
  return {
    policy,
    level,
    mop: {
      every: policy.mopEveryN,
      label: mopLabel(t, locale, policy.mopEveryN),
      status: statusLine(t, locale, f, "mop"),
      reason: mopUnverified
        ? t("v4_cadence_mop_progress_unverified", "Can't run this schedule until you reset its mopping progress, which Home Assistant can't confirm.")
        : mopBlocked ? t("v4_cadence_mop_requires_vacuum", "This mode already mops every clean. Choose Vacuum above for occasional mopping.") : null,
      blocked: mopBlocked,
      unverified: mopUnverified,
    },
    coverage: {
      every: policy.coverageEveryN,
      label: rotationLabel(t, locale, level, policy.coverageEveryN),
      status: statusLine(t, locale, f, "coverage"),
      reason: coverageUnverified
        ? t("v4_cadence_coverage_progress_unverified", "Can't run this schedule until you reset its vacuum rotation progress, which Home Assistant can't confirm.")
        : legacyCoverage
          ? coverageNeedsVacuum(t)
          : coverageBlocked
            ? t("v4_cadence_coverage_available_modes", "Can't add a vacuum rotation until this room's cleaning mode includes vacuuming.")
            : null,
      blocked: coverageBlocked,
      unverified: coverageUnverified,
    },
    legacyCoverage,
    roomReason: block ? t(block.reasonKey, block.reason, block.reasonPlaceholders) : null,
    sharedHint: f.shared !== undefined && f.sharedFits && !f.participating && policy.scope === "shared" && !hasSchedule(policy),
    joinPending: f.joinPending,
    participating: f.participating,
    next: labelMop || labelCoverage
      ? {
        label: labelCoverage ? NEXT[level](t, labelMop) : t("v4_cadence_next_mop", "Mop on the next clean"),
        on,
        mop: labelMop,
        coverage: labelCoverage,
        blocked: labelMop && mopBlocked ? "mop" : labelCoverage && coverageBlocked ? "coverage" : null,
      }
      : null,
    explanation: explanation(t, f, name),
    scope: !hasSchedule(policy) && f.shared?.mopEveryN === 1 && !f.joinPending && !f.participating
      ? "plan" : policy.scope,
    resettable: {
      mop: savedHas(saved?.cadenceProgress?.mopProgress, saved?.cadence?.doMopNext, "mop_progress_unverified"),
      coverage: savedHas(saved?.cadenceProgress?.coverageProgress, saved?.cadence?.doCoverageNext, "coverage_progress_unverified"),
      both: Boolean(saved?.cadenceReasons?.includes("cadence_progress_unverified")),
    },
    sharedReason: !unjoinable(f)
      ? null
      : f.sharedBroken
        ? t("v4_cadence_shared_broken_reason", "Can't count across all plans until you fix this room's shared schedule in a plan that uses it.")
        : t("v4_cadence_shared_mode_reason", "Can't count across all plans until this room's cleaning mode works with its shared schedule."),
  };
};

/** Joining copies the shared schedule exactly, as the backend adopts it on save. */
const joined = (f: Facts): RoomCadencePolicy | null =>
  f.shared && f.sharedFits && !f.participating ? { ...f.shared, scope: "shared" } : null;

/**
 * A shared schedule this room's mode can't use, or one the catalog reports as
 * broken, would fail the save once the backend adopts it (plans.py:2384-2398),
 * so the room counts in this plan only.
 */
const unjoinable = (f: Facts): boolean => f.sharedExists && (!f.sharedFits || f.sharedBroken) && !f.participating;

/** The room's next cadence for a new "how often", or null when nothing may change. */
export const withInterval = (input: ScheduleInput, kind: ScheduleKind, every: number | null): RoomCadencePolicy | null => {
  const f = facts(input);
  const { policy } = f;
  if (f.joinPending) return null;
  if (kind === "mop" && every !== null) every = snapInterval(String(every), false, policy.mopEveryN, MOP_INTERVAL_MIN);
  if (every !== null && !hasSchedule(policy) && policy.scope === "shared") {
    // Enabling occasional work must not silently join an every-clean mop
    // policy. An explicit Advanced scope choice can still join it unchanged.
    if (f.shared?.mopEveryN === 1) {
      return withInterval({ ...input, room: { ...input.room, cadence: { ...policy, scope: "plan" } } }, kind, every);
    }
    const join = joined(f);
    if (join) return join;
    if (unjoinable(f)) return withInterval({ ...input, room: { ...input.room, cadence: { ...policy, scope: "plan" } } }, kind, every);
  }
  // Off has nothing to bring forward and every clean is always due, and the
  // switch names neither, so either clears the row's next-clean flag.
  const keepFlag = every !== null && every > 1;
  if (kind === "mop") {
    return { ...policy, mopEveryN: every, doMopNext: keepFlag && policy.doMopNext };
  }
  if (every === null) return { ...policy, coverageEveryN: null, doCoverageNext: false };
  return policy.coverageEveryN === null
    ? { ...policy, coverageEveryN: every, periodicCoverageSetting: input.offLevel ?? policy.periodicCoverageSetting ?? "heavy_duty" }
    : { ...policy, coverageEveryN: every, doCoverageNext: keepFlag && policy.doCoverageNext };
};

/** A new rotation level: a draft change only while the rotation is on. */
export const withLevel = (input: ScheduleInput, level: CoverageSetting): RoomCadencePolicy | null => {
  const f = facts(input);
  return f.joinPending || f.policy.coverageEveryN === null ? null : { ...f.policy, periodicCoverageSetting: level };
};

/** The next-clean switch: on flags the work its label names, off clears both. */
export const withNextClean = (input: ScheduleInput, on: boolean): RoomCadencePolicy | null => {
  const f = facts(input);
  if (f.joinPending) return null;
  const mop = named(f, "mop");
  const coverage = named(f, "coverage");
  if (!mop && !coverage && !f.policy.doMopNext && !f.policy.doCoverageNext) return null;
  const blocked = modeBlocked(input, f);
  // Work its row holds for a mode conflict can't be brought forward (cadence.py:45-46, 66-70).
  if (on && ((mop && blocked.mop) || (coverage && blocked.coverage))) return null;
  return on
    ? { ...f.policy, doMopNext: mop, doCoverageNext: coverage }
    : { ...f.policy, doMopNext: false, doCoverageNext: false };
};

/**
 * "Count cleans": back to all plans joins a shared schedule the plan doesn't
 * use yet, and null while this room's mode can't use it.
 */
export const withScope = (input: ScheduleInput, scope: "shared" | "plan"): RoomCadencePolicy | null => {
  const f = facts(input);
  if (scope === "shared" && unjoinable(f)) return null;
  return (scope === "shared" ? joined(f) : null) ?? { ...f.policy, scope };
};

/** "Turn off" for a rotation on a mop-only room. */
export const withoutLegacyCoverage = (policy: RoomCadencePolicy): RoomCadencePolicy => ({
  ...policy,
  scope: "plan",
  coverageEveryN: null,
  periodicCoverageSetting: null,
  doCoverageNext: false,
});

/** Why Reset can't run now, or null: it needs a clean draft, an idle robot and a live map. */
export const resetBlock = (t: Translate, state: WorkspaceState): string | null =>
  state.planDraft.dirty
    ? t("v4_reason_reset_unsaved", "Can't reset until you save or cancel your changes.")
    : state.command !== "idle" || state.managedLock || (state.activity !== "idle" && state.activity !== "docked") || state.dataMode !== "live"
      ? t("v4_reason_reset_busy", "Can't reset until the robot is idle and the map is live.")
      : null;

/** What the schedule block needs from the Edit view that shows it. */
export interface ScheduleContext {
  readonly t: Translate;
  readonly state: WorkspaceState;
  readonly intent: (intent: WorkspaceIntent) => void;
  /** The shared reason's id while every Edit control is held (plan.md §4 E5), else null. */
  readonly held: string | null;
  /** The rotation level chosen while it is Off, for this room (view state). */
  readonly offLevel: CoverageSetting | null;
  /** Remembers a level chosen while Off; null forgets it once the draft carries the choice. */
  readonly setOffLevel: (level: CoverageSetting | null) => void;
  /** The room's "More for {room}" menu. */
  readonly menu: MenuController;
}

/** The room schedule's inputs from the draft, the saved plan and the catalog. */
export const scheduleInput = (state: WorkspaceState, room: PlanRoom, name: string, offLevel: CoverageSetting | null): ScheduleInput => {
  const catalog = state.resources.plans.value;
  const draftId = state.planDraft.id;
  return {
    room,
    saved: draftId ? catalog?.plans.find((plan) => plan.id === draftId)?.rooms.find((candidate) => candidate.roomId === room.roomId) : undefined,
    catalogRoom: catalog?.rooms.find((candidate) => candidate.roomId === room.roomId),
    name,
    offLevel,
  };
};

/** Stands in for {room} in visible text, so the name can render in <bdi>. */
const ROOM_MARK = "\u0000";

/** A sentence with the room it names isolated in <bdi> (room-schedule.md §8). */
const withRoom = (text: string, name: string) => {
  const [before, ...after] = text.split(ROOM_MARK);
  return after.length ? html`${before}<bdi>${name}</bdi>${after.join(name)}` : text;
};

/** The Schedule block in an open Edit row (room-schedule.md §3). */
export const scheduleBlock = (context: ScheduleContext, room: PlanRoom, index: number, name: string) => {
  const { t, state, held } = context;
  const draft = state.planDraft;
  const input = scheduleInput(state, room, name, context.offLevel);
  // Visible sentences carry a mark for the room, replaced by <bdi>{room}</bdi>.
  const model = scheduleModel(t, state.locale, { ...input, name: ROOM_MARK });
  const reasonLine = (id: string | null, text: unknown, tag: "small" | "p" = "small") => tag === "p"
    ? html`<p class="sched-status sched-reason" id=${id ?? nothing}>${icon(iconNoticeWarning)}<span>${text}</span></p>`
    : html`<small class="sched-status sched-reason" id=${id ?? nothing}>${icon(iconNoticeWarning)}<span>${text}</span></small>`;
  const { policy, next } = model;
  const sharedDeleteToken = /^[0-9a-f]{64}$/u.test(input.catalogRoom?.sharedDeleteToken ?? "")
    ? input.catalogRoom?.sharedDeleteToken ?? null
    : null;
  const canDeleteShared = Boolean(sharedDeleteToken && draft.id
    && draft.rooms.some((candidate) => candidate.roomId === room.roomId));
  const patch = (cadence: RoomCadencePolicy | null): void => {
    if (!cadence || held) return;
    const rooms = draft.rooms.map((candidate, at) => at === index ? { ...candidate, cadence } : candidate);
    context.intent({ type: "patch-plan-draft", patch: { rooms } });
  };
  const gate = { disabled: held ? "true" : nothing, described: held ?? nothing };
  const ids = (...list: (string | null)[]): string | null => list.filter(Boolean).join(" ") || null;
  const line = (id: string, row: ScheduleRow) => row.reason
    ? reasonLine(id, row.reason)
    : row.status ? html`<small class="sched-status" id=${id}>${row.status}</small>` : nothing;
  // Reset (room-schedule.md §5): a clean draft, an idle robot and a live map,
  // else held with its reason. No launcher mark: focus returns to the room.
  const block = resetBlock(t, state);
  const deleteBlock = !block ? null : state.planDraft.dirty
    ? t("v4_reason_delete_schedule_unsaved", "Save or cancel your changes before deleting this schedule.")
    : t("v4_reason_delete_schedule_busy", "Wait until the robot is idle and the map is live before deleting this schedule.");
  const resetOff = Boolean(held || block);
  const resetButton = (kind: CadenceResetMode, className: string, reasonId: string, role: "menuitem" | null = null) => html`<button
    class=${className}
    type="button"
    role=${role ?? nothing}
    tabindex=${role ? "-1" : nothing}
    aria-label=${kind === "both"
      ? t("v4_reset_cadence_button_named", "Reset schedule progress for {room}", { room: name })
      : kind === "mop"
        ? t("v4_reset_mop_cadence_button_named", "Reset mopping progress for {room}", { room: name })
        : t("v4_reset_coverage_cadence_button_named", "Reset vacuum rotation progress for {room}", { room: name })}
    aria-disabled=${resetOff ? "true" : nothing}
    aria-describedby=${(held ?? (block ? reasonId : null)) ?? nothing}
    @click=${() => {
      if (resetOff || !draft.id) return;
      context.menu.close(false);
      context.intent({ type: "request-room-cadence-reset", planId: draft.id, roomId: room.roomId, mode: kind });
    }}
  >${kind === "both"
    ? t("v4_reset_cadence_button", "Reset schedule progress")
    : kind === "mop" ? t("v4_reset_mop_cadence_button", "Reset mopping") : t("v4_reset_coverage_cadence_button", "Reset vacuum rotation")}</button>`;
  const more = t("v4_room_more_named", "More for {room}", { room: name });
  const { menu } = context;
  const overflow = draft.id && (model.resettable.mop || model.resettable.coverage || canDeleteShared) ? html`<div class="room-more" @keydown=${menu.keydown} @focusout=${menu.focusout}>
    <button
      class="ms-btn ms-btn--icon"
      type="button"
      aria-label=${more}
      title=${more}
      aria-haspopup="menu"
      aria-expanded=${String(menu.open)}
      data-dialog-launcher=${canDeleteShared ? "confirmDeleteSchedule" : nothing}
      aria-disabled=${gate.disabled}
      aria-describedby=${gate.described}
      @click=${() => { if (!held) menu.toggle(); }}
    >${icon(iconOverflow)}</button>
    ${menu.open && !held ? html`<div class="menu ms-surface ms-surface--overlay" @mousedown=${(event: Event) => event.preventDefault()}>
      <div role="menu" aria-label=${more}>
        ${model.resettable.mop ? resetButton("mop", "ms-row ms-row--menu", "reset-reason", "menuitem") : nothing}
        ${model.resettable.coverage ? resetButton("coverage", "ms-row ms-row--menu", "reset-reason", "menuitem") : nothing}
        ${canDeleteShared ? html`
          ${(model.resettable.mop || model.resettable.coverage) ? html`<div class="room-more-divider" role="separator"></div>` : nothing}
          <button
            class="ms-row ms-row--menu ms-row--danger"
            type="button"
            role="menuitem"
            tabindex="-1"
            aria-disabled=${resetOff ? "true" : nothing}
            aria-describedby=${(held ?? (deleteBlock ? "delete-schedule-reason" : null)) ?? nothing}
            @click=${() => {
              if (resetOff || !draft.id || !sharedDeleteToken) return;
              context.menu.close(false);
              context.intent({
                type: "request-schedule-delete",
                planId: draft.id,
                roomId: room.roomId,
                expectedToken: sharedDeleteToken,
              });
            }}
          >${t("v4_delete_shared_schedule", "Delete shared schedule")}</button>
        ` : nothing}
      </div>
      ${block ? html`<div class="reason">${reasonLine("reset-reason", block, "p")}</div>` : nothing}
      ${canDeleteShared && deleteBlock ? html`<div class="reason">${reasonLine("delete-schedule-reason", deleteBlock, "p")}</div>` : nothing}
    </div>` : nothing}
  </div>` : nothing;
  const row = (kind: ScheduleKind, data: ScheduleRow, level: unknown) => {
    const id = `sched-${kind}`;
    const lineId = data.reason || data.status ? `${id}-status` : null;
    return html`<div class="sched-row">
      <label class="sched-label" id=${`${id}-label`} for=${id}>${data.label}</label>
      <div class="sched-controls">
        ${level}
        ${stepper({
          id,
          labelId: `${id}-label`,
          label: data.label,
          value: data.every,
          minimum: kind === "mop" ? MOP_INTERVAL_MIN : 1,
          describedBy: ids(lineId, policy.mopEveryN === 1 && kind === "mop" ? "sched-mop-guide" : null, held),
          heldBy: held ?? (data.blocked ? lineId : null),
          readonly: model.joinPending,
          t,
          commit: (every) => patch(withInterval(input, kind, every)),
        })}
      </div>
      ${line(`${id}-status`, data)}
      ${kind === "mop" ? html`<small class="sched-status" id="sched-mop-guide">${policy.mopEveryN === 1
        ? t("v4_cadence_mop_legacy_hint", "This saved setting mops every clean. Choose 2 or more for occasional mopping, or turn it off and select Vacuum + mop above.")
        : t("v4_cadence_mop_smart_hint", "Every 2 cleans or more. For mopping on every clean, turn this off and choose Vacuum + mop above.")}</small>` : nothing}
      ${data.unverified && draft.id ? html`${resetButton(kind, "ms-btn ms-btn--secondary", `${id}-reset-reason`)}
        ${block ? reasonLine(`${id}-reset-reason`, block, "p") : nothing}` : nothing}
    </div>`;
  };
  const levelHeld = held ?? (model.coverage.blocked ? "sched-coverage-status" : null);
  const level = model.joinPending ? nothing : html`<select
    class="ms-select sched-level"
    aria-label=${t("v4_cadence_level_named", "Vacuum level for {room}", { room: name })}
    aria-disabled=${levelHeld ? "true" : nothing}
    aria-describedby=${levelHeld ?? nothing}
    .value=${model.level}
    @change=${(event: Event) => {
      const select = event.currentTarget as HTMLSelectElement;
      if (levelHeld) {
        select.value = model.level;
        return;
      }
      // While on, the draft carries the choice and an older one remembered
      // from Off is forgotten, so turning off shows the latest level.
      const chosen = select.value as CoverageSetting;
      const next = withLevel(input, chosen);
      context.setOffLevel(next ? null : chosen);
      if (next) patch(next);
    }}
  >${COVERAGES.map((option) => html`<option value=${option} ?selected=${option === model.level}>${coverageLabel(t, option)}</option>`)}</select>`;
  return html`<section class="schedule" role="group" aria-label=${t("v4_room_cadence_named", "Smart cleaning for {room}", { room: name })}>
    <div class="schedule-head"><h3>${t("v4_room_schedule", "Smart cleaning")}</h3>${overflow}</div>
    <p class="schedule-note">${t("v4_cadence_smart_intro", "Add mopping or vary vacuum coverage automatically, based on completed cleans.")}</p>
    ${model.roomReason ? reasonLine(null, withRoom(model.roomReason, name), "p") : nothing}
    ${model.resettable.both && draft.id ? html`${resetButton("both", "ms-btn ms-btn--secondary", "sched-reset-reason")}
      ${block ? reasonLine("sched-reset-reason", block, "p") : nothing}` : nothing}
    ${model.sharedHint ? html`<p class="schedule-note">${withRoom(input.catalogRoom?.sharedCadence?.mopEveryN === 1
      ? t("v4_cadence_shared_every_clean_hint", "{room}'s shared setting mops every clean. New smart cleaning stays in this plan; use Advanced to join the existing setting.", { room: ROOM_MARK })
      : t("v4_cadence_shared_available", "{room} has a shared schedule, and turning on a row uses it.", { room: ROOM_MARK }), name)}</p>` : nothing}
    ${row("mop", model.mop, nothing)}
    ${row("coverage", model.coverage, level)}
    ${model.legacyCoverage ? html`<button
      type="button"
      class="ms-btn ms-btn--secondary sched-off"
      aria-label=${t("v4_cadence_turn_off_named", "Turn off the vacuum rotation in {room}", { room: name })}
      aria-disabled=${gate.disabled}
      aria-describedby=${gate.described}
      @click=${() => patch(withoutLegacyCoverage(policy))}
    >${t("v4_cadence_clear_room_coverage", "Turn off")}</button>` : nothing}
    ${next ? html`<div class="switch-row">
      <span class="switch-copy">
        <span id="sched-next-label">${next.label}</span>
        <small id="sched-next-hint">${t("v4_cadence_next_hint", "Do it once on the next clean, then resume the usual pattern.")}</small>
      </span>
      <button
        class="ms-switch"
        type="button"
        role="switch"
        aria-checked=${String(next.on)}
        aria-labelledby="sched-next-label"
        aria-describedby=${ids("sched-next-hint", held ?? (model.joinPending ? "sched-join" : next.blocked ? `sched-${next.blocked}-status` : null)) ?? nothing}
        aria-disabled=${held || model.joinPending || next.blocked ? "true" : nothing}
        @click=${() => { if (!next.blocked) patch(withNextClean(input, !next.on)); }}
      ></button>
    </div>` : nothing}
    ${model.joinPending ? html`<p class="schedule-note" id="sched-join">${withRoom(t("v4_cadence_join_pending", "Uses {room}'s shared schedule; change it after you save, or choose \"In this plan only\" under Advanced.", { room: ROOM_MARK }), name)}</p>` : nothing}
    ${model.explanation ? html`<p class="schedule-note">${withRoom(model.explanation, name)}</p>` : nothing}
    <details class="advanced">
      <summary>${t("v4_advanced", "Advanced")}${icon(iconChevronRight)}</summary>
      <fieldset class="scope">
        <legend>${t("v4_cadence_scope", "Count completed cleans")}</legend>
        ${([["shared", t("v4_cadence_shared", "Across all plans (recommended)")], ["plan", t("v4_cadence_this_plan", "In this plan only")]] as const).map(([scope, label]) => {
          const off = held ?? (scope === "shared" && model.sharedReason ? "sched-scope-reason" : null);
          return html`<label class="scope-row"><input
            type="radio"
            name="sched-scope"
            value=${scope}
            .checked=${model.scope === scope}
            aria-disabled=${off ? "true" : nothing}
            aria-describedby=${off ?? nothing}
            @change=${(event: Event) => {
              // A held choice shows the draft's scope again and changes nothing.
              const next = off ? null : withScope(input, scope);
              if (next) patch(next);
              else (event.currentTarget as HTMLElement).closest("fieldset")?.querySelectorAll<HTMLInputElement>("input").forEach((radio) => { radio.checked = radio.value === model.scope; });
            }}
          ><span>${label}</span></label>`;
        })}
        ${model.sharedReason ? reasonLine("sched-scope-reason", model.sharedReason, "p") : nothing}
      </fieldset>
      <p class="schedule-note">${t("v4_cadence_description", "Only cleans the robot confirms count toward these schedules, and due work stays due until a clean is confirmed.")}</p>
    </details>
  </section>`;
};

/**
 * A room's cleaning mode and vacuum coverage as one whole string
 * (home-rooms.md §6 `v4_room_setting_*`); mop alone has no coverage.
 */
export const settingLabel = (t: Translate, room: Pick<PlanRoom, "cleaningMode" | "coverageSetting">): string => {
  if (room.cleaningMode === "mop") return t("v4_room_setting_mop", "Mop");
  if (room.cleaningMode === "vacuum") {
    return room.coverageSetting === "quick"
      ? t("v4_room_setting_vacuum_quick", "Vacuum · Quick")
      : room.coverageSetting === "standard"
        ? t("v4_room_setting_vacuum_standard", "Vacuum · Optimal")
        : t("v4_room_setting_vacuum_heavy_duty", "Vacuum · Heavy duty");
  }
  return room.coverageSetting === "quick"
    ? t("v4_room_setting_vacuum_and_mop_quick", "Vacuum + mop · Quick")
    : room.coverageSetting === "standard"
      ? t("v4_room_setting_vacuum_and_mop_standard", "Vacuum + mop · Optimal")
      : t("v4_room_setting_vacuum_and_mop_heavy_duty", "Vacuum + mop · Heavy duty");
};

type Schedule = (t: Translate, mop: string, cov: string) => string;

/** Edit row line 3 (plan.md §6 `v4_room_schedules_*`), by kind and which counts are one. */
const SCHEDULES: Readonly<Record<string, Schedule>> = {
  mop: (t, mop) => t("v4_room_schedules_mop", "Mop every {mop} cleans", { mop }),
  mop_one: (t) => t("v4_room_schedules_mop_one", "Mop every clean"),
  quick: (t, _, cov) => t("v4_room_schedules_quick", "Quick vacuum every {cov} cleans", { cov }),
  quick_one: (t) => t("v4_room_schedules_quick_one", "Quick vacuum every clean"),
  optimal: (t, _, cov) => t("v4_room_schedules_optimal", "Optimal vacuum every {cov} cleans", { cov }),
  optimal_one: (t) => t("v4_room_schedules_optimal_one", "Optimal vacuum every clean"),
  heavy: (t, _, cov) => t("v4_room_schedules_heavy", "Heavy duty vacuum every {cov} cleans", { cov }),
  heavy_one: (t) => t("v4_room_schedules_heavy_one", "Heavy duty vacuum every clean"),
  mop_quick: (t, mop, cov) => t("v4_room_schedules_mop_quick", "Mop every {mop} cleans · Quick vacuum every {cov} cleans", { mop, cov }),
  mop_quick_one_mop: (t, _, cov) => t("v4_room_schedules_mop_quick_one_mop", "Mop every clean · Quick vacuum every {cov} cleans", { cov }),
  mop_quick_one_cov: (t, mop) => t("v4_room_schedules_mop_quick_one_cov", "Mop every {mop} cleans · Quick vacuum every clean", { mop }),
  mop_quick_one_both: (t) => t("v4_room_schedules_mop_quick_one_both", "Mop every clean · Quick vacuum every clean"),
  mop_optimal: (t, mop, cov) => t("v4_room_schedules_mop_optimal", "Mop every {mop} cleans · Optimal vacuum every {cov} cleans", { mop, cov }),
  mop_optimal_one_mop: (t, _, cov) => t("v4_room_schedules_mop_optimal_one_mop", "Mop every clean · Optimal vacuum every {cov} cleans", { cov }),
  mop_optimal_one_cov: (t, mop) => t("v4_room_schedules_mop_optimal_one_cov", "Mop every {mop} cleans · Optimal vacuum every clean", { mop }),
  mop_optimal_one_both: (t) => t("v4_room_schedules_mop_optimal_one_both", "Mop every clean · Optimal vacuum every clean"),
  mop_heavy: (t, mop, cov) => t("v4_room_schedules_mop_heavy", "Mop every {mop} cleans · Heavy duty vacuum every {cov} cleans", { mop, cov }),
  mop_heavy_one_mop: (t, _, cov) => t("v4_room_schedules_mop_heavy_one_mop", "Mop every clean · Heavy duty vacuum every {cov} cleans", { cov }),
  mop_heavy_one_cov: (t, mop) => t("v4_room_schedules_mop_heavy_one_cov", "Mop every {mop} cleans · Heavy duty vacuum every clean", { mop }),
  mop_heavy_one_both: (t) => t("v4_room_schedules_mop_heavy_one_both", "Mop every clean · Heavy duty vacuum every clean"),
};

/** A room's schedule as one line, or null while no schedule is on. */
export const scheduleLine = (t: Translate, locale: string, cadence: RoomCadencePolicy | null | undefined): string | null => {
  const mop = cadence?.mopEveryN ?? null;
  const cov = cadence?.coverageEveryN ?? null;
  if (mop === null && cov === null) return null;
  const setting = cadence?.periodicCoverageSetting;
  const level = setting === "quick" ? "quick" : setting === "heavy_duty" ? "heavy" : "optimal";
  const name = mop === null
    ? `${level}${cov === 1 ? "_one" : ""}`
    : cov === null
      ? `mop${mop === 1 ? "_one" : ""}`
      : `mop_${level}${mop === 1 && cov === 1 ? "_one_both" : mop === 1 ? "_one_mop" : cov === 1 ? "_one_cov" : ""}`;
  const line = SCHEDULES[name];
  return line ? line(t, mop === null ? "" : formatNumber(locale, mop), cov === null ? "" : formatNumber(locale, cov)) : null;
};
