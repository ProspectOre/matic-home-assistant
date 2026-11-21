import type {
  HassEntityLike,
  HassLike,
  HassProjection,
  PanelLike,
  RobotActivity,
  RobotChoice,
  RobotRunStatus,
  ScheduledRun,
} from "./contracts";

const activityForVacuum = (
  state: string,
  attributes: Readonly<Record<string, unknown>> | undefined,
): RobotActivity => {
  if (attributes?.recharge_and_resume === true) {
    return "recharging";
  }
  switch (state) {
    case "cleaning":
      return "cleaning";
    case "paused":
      return "paused";
    case "returning":
      return "returning";
    case "docked":
      return "docked";
    case "idle":
      return "idle";
    case "error":
      return "problem";
    default:
      return "unknown";
  }
};

const SCHEDULE_TEXT_MAX = 1024;

const scheduleText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() && value.length <= SCHEDULE_TEXT_MAX ? value.trim() : null;

// The robot schedules calendar names its next run that hasn't started yet.
const scheduledRun = (value: unknown): ScheduledRun | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const run = value as Record<string, unknown>;
  const name = scheduleText(run.name);
  const startsAt = run.start;
  if (!name || typeof startsAt !== "string" || !Number.isFinite(Date.parse(startsAt))) return null;
  return { name, startsAt, detail: scheduleText(run.description) };
};

const boundedPercent = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100, value)));
};

// Seconds in each unit Home Assistant may show a duration sensor in.
const DURATION_SECONDS: Readonly<Record<string, number>> = { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400 };

const durationSeconds = (sensor: HassEntityLike | undefined): number | null => {
  const value = Number(sensor?.state);
  const unit = sensor?.attributes?.unit_of_measurement;
  const scale = typeof unit === "string" ? DURATION_SECONDS[unit] : undefined;
  return Number.isFinite(value) && value >= 0 && scale !== undefined ? Math.round(value * scale) : null;
};

// The Cleaning phase, Run progress and Time remaining sensors.
const robotRunStatus = (metrics: ReadonlyMap<string, HassEntityLike>): RobotRunStatus | null => {
  const value = metrics.get("cleaning_phase")?.state;
  const phase = value === "interior" || value === "edges" || value === "toekicks" ? value : null;
  const percent = boundedPercent(Number(metrics.get("run_progress")?.state));
  const remainingSeconds = durationSeconds(metrics.get("time_remaining"));
  return phase || percent !== null || remainingSeconds !== null ? { phase, percent, remainingSeconds } : null;
};

// One sensor per `matic_metric` for the entry; a key two sensors share is dropped.
const entryMetrics = (
  entities: readonly (readonly [string, HassEntityLike])[],
  entryKey: string | null,
): ReadonlyMap<string, HassEntityLike> => {
  const found = new Map<string, HassEntityLike | null>();
  if (entryKey === null) return new Map();
  for (const [id, entity] of entities) {
    const key = entity.attributes?.matic_metric;
    if (!id.startsWith("sensor.") || typeof key !== "string" || maticEntryKey(entity) !== entryKey) continue;
    found.set(key, found.has(key) ? null : entity);
  }
  return new Map([...found].filter((item): item is [string, HassEntityLike] => item[1] !== null));
};

const maticEntryKey = (entity: HassEntityLike): string | null => {
  const key = entity.attributes?.matic_entry_id;
  return typeof key === "string" && key.length > 0 ? key : null;
};

const managedRunSummary = (value: unknown, activePlan: unknown, timing: HassEntityLike | undefined) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const run = value as Record<string, unknown>;
  if (typeof run.run_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(run.run_id)) return null;
  const roomCount = run.room_count;
  const completedRoomCount = run.completed_room_count;
  if (!Number.isSafeInteger(roomCount) || !Number.isSafeInteger(completedRoomCount)
    || (roomCount as number) < 0 || (completedRoomCount as number) < 0
    || (completedRoomCount as number) > (roomCount as number)) return null;
  if (run.outcome === "running") {
    if (!activePlan || typeof activePlan !== "object" || Array.isArray(activePlan)
      || (activePlan as Record<string, unknown>).run_id !== run.run_id || roomCount === 0) return null;
  } else if (run.outcome !== "unverified" && run.outcome !== "stopped_docked" && run.outcome !== "failed" && run.outcome !== "cancelled" && run.outcome !== "recharge_suspended") return null;
  const metric = timing?.attributes;
  const percent = timing && /^\d{1,3}$/u.test(timing.state) ? Number(timing.state) : NaN;
  const estimate = run.outcome === "running" && metric?.run_id === run.run_id
    && metric?.room_id === (activePlan as Record<string, unknown>).room_id
    && metric?.status === "running" && typeof metric.room_id === "string"
    && typeof metric.room === "string" && metric.room
    && percent <= 100
    ? { roomId: metric.room_id, room: metric.room, percent } : undefined;
  return Object.freeze({ runId: run.run_id, outcome: run.outcome === "running" ? "running" as const : run.outcome === "unverified" ? "unverified" as const : "partial" as const, ...(estimate ? { estimate } : {}),
    completedRoomCount: completedRoomCount as number, roomCount: roomCount as number });
};

const smartStopStatus = (value: unknown, activePlan: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !activePlan || typeof activePlan !== "object" || Array.isArray(activePlan)) return null;
  const run = value as Record<string, unknown>;
  const active = activePlan as Record<string, unknown>;
  if (run.outcome !== "running" || active.smart_stop_pending !== true
    || typeof run.run_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(run.run_id)
    || active.run_id !== run.run_id) return null;
  const phase = active.smart_stop_phase;
  if (phase !== "finishing_room" && phase !== "finishing_area" && phase !== "verifying_completion" && phase !== "returning_to_dock") return null;
  const kind = phase === "finishing_area" || typeof active.area_id === "string" ? "area" as const : "room" as const;
  const rawTarget = kind === "area" ? active.area : active.room;
  const target = typeof rawTarget === "string" && rawTarget.trim()
    && Array.from(rawTarget).length <= 128 && !/[\u0000-\u001f\u007f]/u.test(rawTarget)
    ? rawTarget.trim() : null;
  return Object.freeze({ runId: run.run_id, target, kind, phase });
};

const safeUserKey = (value: unknown): string => {
  const key = String(value || "local-user")
    .replaceAll(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 128);
  return key || "local-user";
};

const safeLabel = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const label = value.trim();
  return label && Array.from(label).length <= 128 && !/[\u0000-\u001f\u007f]/u.test(label) ? label : null;
};

// Home Assistant's name for a state: its friendly name, else its object id with spaces.
const stateName = (hass: HassLike | undefined, entityId: string): string =>
  safeLabel(hass?.states?.[entityId]?.attributes?.friendly_name)
  ?? entityId.slice(entityId.indexOf(".") + 1).replaceAll("_", " ");

/**
 * Robots that share a name are told apart by their area, else their device's
 * name, else their entity id: the first that differs for every robot of that
 * name. It goes ahead of the name, so a narrow picker still shows it.
 */
const robotChoices = (hass: HassLike | undefined, robots: ReadonlyMap<string, string>, language: string): RobotChoice[] => {
  const fold = (text: string) => text.toLocaleLowerCase(language);
  const named = Array.from(robots, ([entryId, entityId]) => {
    const registered = hass?.entities?.[entityId];
    const device = registered?.device_id ? hass?.devices?.[registered.device_id] : undefined;
    const areaId = registered?.area_id || device?.area_id;
    return {
      entryId,
      entityId,
      name: stateName(hass, entityId),
      area: areaId ? safeLabel(hass?.areas?.[areaId]?.name) : null,
      device: safeLabel(device?.name_by_user) ?? safeLabel(device?.name),
    };
  });
  return named.map((robot) => {
    const group = named.filter((member) => fold(member.name) === fold(robot.name));
    if (group.length === 1) return { entryId: robot.entryId, name: robot.name, label: robot.name };
    const key = (["area", "device"] as const).find((field) => {
      const labels = group.map((member) => member[field]);
      return labels.every((label) => label && fold(label) !== fold(robot.name))
        && new Set(labels.map((label) => fold(label!))).size === group.length;
    });
    return { entryId: robot.entryId, name: robot.name, label: `${(key && robot[key]) || robot.entityId} · ${robot.name}` };
  }).sort((left, right) => left.name.localeCompare(right.name, language, { sensitivity: "base" })
    || left.label.localeCompare(right.label, language, { sensitivity: "base" }))
    .map(({ entryId, label }) => ({ entryId, label }));
};

export class HassAdapter {
  #signature = "";
  #projection: HassProjection | null = null;

  project(
    hass: HassLike | undefined,
    panel: PanelLike | undefined,
    preferredEntry: string | null = null,
  ): HassProjection {
    const states = hass?.states ?? {};
    const entities = Object.entries(states);
    const panelEntry = panel?.config?.entry_id;
    const configuredEntry = typeof panelEntry === "string" ? panelEntry : null;
    const requestedEntry = preferredEntry || configuredEntry;
    let selectedVacuum: HassEntityLike | null = null;
    let selectedVacuumEntityId: string | null = null;
    let selectedEntryKey: string | null = requestedEntry;
    const robots = new Map<string, string>();
    const histories = new Map<string, Readonly<Record<string, unknown>>>();
    const schedules = new Map<string, ScheduledRun | null>();

    for (const [entityId, entity] of entities) {
      const entryKey = maticEntryKey(entity);
      if (!entryKey) continue;
      if (entityId.startsWith("sensor.") && entity.attributes?.last_run !== undefined) {
        histories.set(entryKey, entity.attributes);
      }
      if (entityId.startsWith("calendar.") && entity.attributes?.matic_next_run !== undefined) {
        schedules.set(entryKey, scheduledRun(entity.attributes.matic_next_run));
      }
      if (!entityId.startsWith("vacuum.")) continue;
      robots.set(entryKey, entityId);
      if (requestedEntry ? entryKey === requestedEntry : !selectedVacuum) {
        selectedVacuum = entity;
        selectedVacuumEntityId = entityId;
        selectedEntryKey = entryKey;
      }
    }

    const settings = selectedVacuum ? entities.filter(([id, entity]) =>
      id.startsWith("switch.") && maticEntryKey(entity) === selectedEntryKey
      && entity.attributes?.matic_setting === "deep_mop") : [];
    const setting = settings.length === 1 ? settings[0] : undefined;
    const deepMop = setting ? {
      entityId: setting[0],
      enabled: setting[1].state === "on" ? true : setting[1].state === "off" ? false : null,
    } : null;
    const host = {
      connected: hass?.connected !== false,
      administrator: hass?.user?.is_admin === true,
      robotConnected: selectedVacuum !== null
        && selectedVacuum.state !== "unavailable"
        && selectedVacuum.state !== "unknown",
      robotCount: robots.size,
    } as const;
    const activity = selectedVacuum
      ? activityForVacuum(selectedVacuum.state, selectedVacuum.attributes)
      : "unknown";
    const batteryPercent = boundedPercent(selectedVacuum?.attributes?.battery_level);
    const metrics = entryMetrics(entities, selectedEntryKey);
    const area = selectedVacuum ? metrics.get("current_area")?.state : undefined;
    const currentArea = area && area.trim() && area !== "unknown" && area !== "unavailable" ? area : null;
    const robotRun = selectedVacuum ? robotRunStatus(metrics) : null;
    const language = hass?.selectedLanguage || hass?.language || "en";
    const dateLanguage = hass?.locale?.language || language;
    const timeZone = hass?.locale?.time_zone === "server" ? hass.config?.time_zone : undefined;
    // Kept while unchanged, so the shell's `dates` property does not churn.
    const previousDates = this.#projection?.dates;
    const dates = previousDates?.language === dateLanguage && previousDates.timeZone === timeZone
      ? previousDates
      : { language: dateLanguage, timeZone };
    const userKey = safeUserKey(hass?.user?.id);
    const choices = robotChoices(hass, robots, language);
    const robotLabel = choices.find((choice) => choice.entryId === selectedEntryKey && selectedVacuum)?.label ?? "Robot";
    const history = histories.get(selectedEntryKey ?? "");
    const lastRun = managedRunSummary(history?.last_run, history?.active_plan, metrics.get("current_room_estimated_progress"));
    const projection: HassProjection = {
      deepMop,
      host,
      activity,
      batteryPercent,
      currentArea,
      robotRun,
      language,
      imperial: hass?.config?.unit_system?.length === "mi",
      dates,
      userKey,
      vacuumEntityId: selectedVacuumEntityId,
      entryKey: selectedEntryKey,
      robotLabel,
      robots: choices,
      lastRun,
      smartStop: smartStopStatus(history?.last_run, history?.active_plan),
      nextSchedule: schedules.get(selectedEntryKey ?? "") ?? null,
    };
    const signature = JSON.stringify(projection);
    if (signature === this.#signature && this.#projection) return this.#projection;
    this.#signature = signature;
    this.#projection = projection;
    return projection;
  }
}
