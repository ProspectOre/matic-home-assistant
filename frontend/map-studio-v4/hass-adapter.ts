import type {
  HassEntityLike,
  HassLike,
  HassProjection,
  PanelLike,
  RobotActivity,
} from "./contracts";

const activityForVacuum = (state: string): RobotActivity => {
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

const safeUserKey = (value: unknown): string => {
  const key = String(value || "local-user")
    .replaceAll(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 128);
  return key || "local-user";
};

const safeRobotLabel = (value: unknown): string => {
  if (typeof value !== "string") return "Matic robot";
  const label = value.trim();
  return label
    && Array.from(label).length <= 128
    && !/[\u0000-\u001f\u007f]/u.test(label)
    ? label
    : "Matic robot";
};

export class HassAdapter {
  #signature = "";
  #projection: HassProjection | null = null;

  project(hass: HassLike | undefined, panel: PanelLike | undefined): HassProjection {
    const states = hass?.states ?? {};
    const panelEntry = panel?.config?.entry_id;
    const requestedEntry = typeof panelEntry === "string" ? panelEntry : null;
    const entryKeys = new Set<string>();
    let selectedVacuum: HassEntityLike | null = null;
    let selectedVacuumEntityId: string | null = null;
    let selectedEntryKey: string | null = null;

    for (const [entityId, entity] of Object.entries(states)) {
      const entryKey = maticEntryKey(entity);
      if (!entryKey) continue;
      entryKeys.add(entryKey);
      if (!entityId.startsWith("vacuum.")) continue;
      if (!selectedVacuum || (requestedEntry && entryKey === requestedEntry)) {
        selectedVacuum = entity;
        selectedVacuumEntityId = entityId;
        selectedEntryKey = entryKey;
      }
    }

    const host = {
      connected: hass?.connected !== false,
      administrator: hass?.user?.is_admin === true,
      robotConnected: selectedVacuum !== null
        && selectedVacuum.state !== "unavailable"
        && selectedVacuum.state !== "unknown",
      robotCount: entryKeys.size,
    } as const;
    const activity = selectedVacuum
      ? activityForVacuum(selectedVacuum.state)
      : "unknown";
    const batteryPercent = boundedBattery(selectedVacuum?.attributes?.battery_level);
    const language = hass?.selectedLanguage || hass?.language || "en";
    const userKey = safeUserKey(hass?.user?.id);
    const robotLabel = safeRobotLabel(selectedVacuum?.attributes?.friendly_name);
    const signature = [
      host.connected,
      host.administrator,
      host.robotConnected,
      host.robotCount,
      activity,
      batteryPercent ?? "none",
      language,
      userKey,
      selectedVacuumEntityId ?? "none",
      selectedEntryKey ?? "none",
      robotLabel,
    ].join("|");

    if (signature === this.#signature && this.#projection) {
      return this.#projection;
    }
    this.#signature = signature;
    this.#projection = {
      host,
      activity,
      batteryPercent,
      language,
      userKey,
      vacuumEntityId: selectedVacuumEntityId,
      entryKey: selectedEntryKey,
      robotLabel,
    };
    return this.#projection;
  }
}
