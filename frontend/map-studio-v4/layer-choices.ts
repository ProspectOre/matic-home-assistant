import type { LayerChoice, WorkspaceIntent, WorkspaceState } from "./contracts";
import type { WorkspaceStore } from "./state";

// Layer choices live in this browser's map preferences (preferences.ts), keyed
// by robot entry, beside the view and cameras they are shown with. A robot
// with none saved starts with every layer off.
const NONE: LayerChoice = { trail: false, wifi: false, floorTypes: false };
const MAX_ROBOTS = 16;

export const parseLayerChoices = (value: unknown): Readonly<Record<string, LayerChoice>> => {
  if (!value || typeof value !== "object") return {};
  const choices = Object.entries(value).filter(([entryId, raw]) => entryId.length <= 128 && raw && typeof raw === "object")
    .map(([entryId, { trail, wifi, floorTypes }]) => [entryId, { trail: trail === true, wifi: wifi === true, floorTypes: floorTypes === true }]);
  return Object.fromEntries(choices.slice(-MAX_ROBOTS));
};

const shownLayers = (state: WorkspaceState): LayerChoice => ({
  trail: state.trail?.id === "live", wifi: Boolean(state.wifiSignal), floorTypes: Boolean(state.floorTypes),
});

/**
 * The choices once this intent has turned a layer on or off for the open
 * robot, or null when it changes none. Showing a past run's trail leaves the
 * live trail's choice alone.
 */
export const rememberLayer = (
  state: WorkspaceState,
  intent: WorkspaceIntent,
): Readonly<Record<string, LayerChoice>> | null => {
  const entryId = state.selection.entryId;
  if (!entryId) return null;
  const shown = shownLayers(state);
  const change: Partial<LayerChoice> | null = intent.type === "toggle-wifi-signal" ? { wifi: !shown.wifi }
    : intent.type === "toggle-floor-types" ? { floorTypes: !shown.floorTypes }
      : intent.type === "show-trail" && (intent.trail === "live" || (intent.trail === null && shown.trail))
        ? { trail: intent.trail === "live" } : null;
  if (!change) return null;
  const { [entryId]: saved, ...others } = state.layerChoices;
  // The open robot moves to the end, so the least recently changed ones drop first.
  return Object.fromEntries([...Object.entries(others).slice(1 - MAX_ROBOTS), [entryId, { ...NONE, ...saved, ...change }]]);
};

/**
 * Puts back a robot's saved layers once its map is in, and again whenever the
 * user or robot changes, through the same intents the layer switches send.
 */
export class LayerRestore {
  #restored = "";
  readonly #unsubscribe: () => void;

  constructor(store: WorkspaceStore, route: (intent: WorkspaceIntent) => void) {
    this.#unsubscribe = store.subscribe((state) => {
      const entry = state.resources.entry;
      if (!state.owner || !state.optionalUiReady || !state.map.available
        || !entry || entry.entryId !== state.selection.entryId) return;
      const key = `${state.owner.userKey}\n${entry.entryId}`;
      if (key === this.#restored) return;
      this.#restored = key;
      const saved = state.layerChoices[entry.entryId] ?? NONE;
      const shown = shownLayers(state);
      if (saved.wifi !== shown.wifi && (shown.wifi || entry.wifiHeatmapUrl)) route({ type: "toggle-wifi-signal" });
      if (saved.floorTypes !== shown.floorTypes && (shown.floorTypes || entry.floorTypesUrl)) route({ type: "toggle-floor-types" });
      if (saved.trail !== shown.trail && state.dataMode === "live") route({ type: "show-trail", trail: saved.trail ? "live" : null });
    });
  }

  dispose(): void {
    this.#unsubscribe();
  }
}
