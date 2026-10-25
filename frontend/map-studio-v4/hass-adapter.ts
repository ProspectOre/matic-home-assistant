import type {
  HassEntityLike,
  HassLike,
  HassProjection,
  PanelLike,
  RobotActivity,
} from "./contracts";

const activityForVacuum = (
  state: string,
  attributes: Readonly<Record<string, unknown>> | undefined,
): RobotActivity => {
  if (attributes?.recharge_and_resume === true && attributes?.charging === true) {
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

const boundedBattery = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100, value)));
};

const maticEntryKey = (entity: HassEntityLike): string | null => {
  const key = entity.attributes?.matic_entry_id;
  return typeof key === "string" && key.length > 0 ? key : null;
};

const managedRunSummary = (value: unknown, activePlan: unknown) => {
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
  return Object.freeze({ runId: run.run_id, outcome: run.outcome === "running" ? "running" as const : run.outcome === "unverified" ? "unverified" as const : "partial" as const,
    completedRoomCount: completedRoomCount as number, roomCount: roomCount as number });
};

const safeUserKey = (value: unknown): string => {
  const key = String(value || "local-user")
    .replaceAll(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 128);
  return key || "local-user";
};

const safeRobotLabel = (value: unknown): string => {
  if (typeof value !== "string") return "Robot";
  const label = value.trim();
  return label
    && Array.from(label).length <= 128
    && !/[\u0000-\u001f\u007f]/u.test(label)
    ? label
    : "Robot";
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
    const panelEntry = panel?.config?.entry_id;
    const configuredEntry = typeof panelEntry === "string" ? panelEntry : null;
    const requestedEntry = preferredEntry || configuredEntry;
    let selectedVacuum: HassEntityLike | null = null;
    let selectedVacuumEntityId: string | null = null;
    let selectedEntryKey: string | null = requestedEntry;
    const robots = new Map<string, { readonly entryId: string; readonly label: string }>();
    const histories = new Map<string, Readonly<Record<string, unknown>>>();

    for (const [entityId, entity] of Object.entries(states)) {
      const entryKey = maticEntryKey(entity);
      if (!entryKey) continue;
      if (entityId.startsWith("sensor.") && entity.attributes?.last_run !== undefined) {
        histories.set(entryKey, entity.attributes);
      }
      if (!entityId.startsWith("vacuum.")) continue;
      robots.set(entryKey, { entryId: entryKey, label: safeRobotLabel(entity.attributes?.friendly_name) });
      if (requestedEntry ? entryKey === requestedEntry : !selectedVacuum) {
        selectedVacuum = entity;
        selectedVacuumEntityId = entityId;
        selectedEntryKey = entryKey;
      }
    }

    const settings = selectedVacuum ? Object.entries(states).filter(([id, entity]) =>
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
    const batteryPercent = boundedBattery(selectedVacuum?.attributes?.battery_level);
    const area = selectedVacuum?.attributes?.current_area;
    const currentArea = typeof area === "string" && area.trim() ? area : null;
    const language = hass?.selectedLanguage || hass?.language || "en";
    const dateLanguage = hass?.locale?.language || language;
    const timeZone = hass?.locale?.time_zone === "server" ? hass.config?.time_zone : undefined;
    // Kept while unchanged, so the shell's `dates` property does not churn.
    const previousDates = this.#projection?.dates;
    const dates = previousDates?.language === dateLanguage && previousDates.timeZone === timeZone
      ? previousDates
      : { language: dateLanguage, timeZone };
    const userKey = safeUserKey(hass?.user?.id);
    const robotLabel = safeRobotLabel(selectedVacuum?.attributes?.friendly_name);
    const robotChoices = [...robots.values()].sort((left, right) =>
      left.label.localeCompare(right.label, language, { sensitivity: "base" }));
    const history = histories.get(selectedEntryKey ?? "");
    const lastRun = managedRunSummary(history?.last_run, history?.active_plan);
    const signature = [
      host.connected,
      host.administrator,
      host.robotConnected,
      host.robotCount,
      activity,
      batteryPercent ?? "none",
      currentArea ?? "",
      language,
      dateLanguage,
      timeZone ?? "browser",
      userKey,
      selectedVacuumEntityId ?? "none",
      selectedEntryKey ?? "none",
      robotLabel,
      robotChoices.map((robot) => `${robot.entryId}:${robot.label}`).join(","),
      deepMop?.entityId ?? "",
      deepMop?.enabled ?? "unknown",
      lastRun ? `${lastRun.runId}:${lastRun.outcome}:${lastRun.completedRoomCount}:${lastRun.roomCount}` : "no-last-run",
    ].join("|");

    if (signature === this.#signature && this.#projection) {
      return this.#projection;
    }
    this.#signature = signature;
    this.#projection = {
      deepMop,
      host,
      activity,
      batteryPercent,
      currentArea,
      language,
      dates,
      userKey,
      vacuumEntityId: selectedVacuumEntityId,
      entryKey: selectedEntryKey,
      robotLabel,
      robots: robotChoices,
      lastRun,
    };
    return this.#projection;
  }
}
