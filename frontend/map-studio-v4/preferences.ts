import type { CameraPreference, MapAppearance, MapQuality, MapView } from "./contracts";

export type { CameraPreference, MapAppearance, MapQuality, MapView } from "./contracts";

export interface MapPreferences {
  readonly version: 4;
  readonly view: MapView;
  readonly appearance: MapAppearance;
  readonly labels: boolean;
  readonly quality: MapQuality;
  readonly cameras: Readonly<Partial<Record<MapView, CameraPreference>>>;
}

const defaults = (): MapPreferences => ({
  version: 4,
  view: "top",
  appearance: "photo",
  labels: true,
  quality: "auto",
  cameras: {},
});

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const identityFor = (userKey: string): string => {
  const safe = userKey.replaceAll(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
  return safe || "local-user";
};

export const preferencesKey = (userKey: string, version = 4): string =>
  `matic-map-studio:v${version}:${identityFor(userKey)}`;

const cameraPreference = (value: unknown): CameraPreference | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const keys = ["yaw", "pitch", "zoom", "targetX", "targetZ"] as const;
  if (!keys.every((key) => typeof raw[key] === "number" && Number.isFinite(raw[key]))) {
    return null;
  }
  return {
    yaw: clamp(raw.yaw as number, -Math.PI, Math.PI),
    pitch: clamp(raw.pitch as number, 0.18, Math.PI / 2 - 0.018),
    zoom: clamp(raw.zoom as number, 0.01, 100),
    targetX: clamp(raw.targetX as number, -10_000, 10_000),
    targetZ: clamp(raw.targetZ as number, -10_000, 10_000),
  };
};

export const parsePreferences = (value: unknown): MapPreferences => {
  const fallback = defaults();
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const rawView = raw.view === "three" || raw.view === "top" || raw.view === "rooms"
    ? raw.view
    : fallback.view;
  const view: MapView = rawView === "rooms" ? "top" : rawView;
  const quality: MapQuality = raw.quality === "auto"
    || raw.quality === "efficient"
    || raw.quality === "balanced"
    || raw.quality === "maximum"
    ? raw.quality
    : fallback.quality;
  const rawCameras = raw.cameras && typeof raw.cameras === "object"
    ? raw.cameras as Record<string, unknown>
    : {};
  const cameras: Partial<Record<MapView, CameraPreference>> = {};
  for (const name of ["three", "top"] as const) {
    const parsed = cameraPreference(rawCameras[name]);
    if (parsed) cameras[name] = parsed;
  }
  return {
    version: 4,
    view,
    appearance: raw.appearance === "rooms" || raw.appearance === "photo"
      ? raw.appearance
      : fallback.appearance,
    labels: typeof raw.labels === "boolean" ? raw.labels : fallback.labels,
    quality,
    cameras,
  };
};

export class PreferenceStore {
  #userKey = "local-user";
  #saveTimer: number | null = null;

  load(userKey: string): MapPreferences {
    this.#userKey = identityFor(userKey);
    try {
      const current = window.localStorage.getItem(preferencesKey(this.#userKey));
      if (current) return parsePreferences(JSON.parse(current));
      for (const legacyVersion of [3, 2]) {
        const legacy = window.localStorage.getItem(preferencesKey(this.#userKey, legacyVersion));
        if (legacy) return parsePreferences(JSON.parse(legacy));
      }
    } catch {
      // Hardened browsers can deny storage; safe defaults keep the map usable.
    }
    return defaults();
  }

  schedule(value: MapPreferences): void {
    if (this.#saveTimer !== null) window.clearTimeout(this.#saveTimer);
    this.#saveTimer = window.setTimeout(() => {
      this.#saveTimer = null;
      try {
        window.localStorage.setItem(preferencesKey(this.#userKey), JSON.stringify(value));
      } catch {
        // A full or denied store never changes map safety or availability.
      }
    }, 250);
  }

  dispose(): void {
    if (this.#saveTimer !== null) window.clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
  }
}

export const FRONTEND_PREFERENCE_KEY = "matic-map-studio:preferred-frontend";

export const preferredFrontend = (): "v4" | "v3" => {
  try {
    return window.localStorage.getItem(FRONTEND_PREFERENCE_KEY) === "v3" ? "v3" : "v4";
  } catch {
    return "v4";
  }
};

export const setPreferredFrontend = (value: "v4" | "v3"): boolean => {
  try {
    window.localStorage.setItem(FRONTEND_PREFERENCE_KEY, value);
    return true;
  } catch {
    return false;
  }
};
