import { mdiMapMarkerPath, mdiRug, mdiWifi } from "@mdi/js";
import { html, nothing, type TemplateResult } from "lit";
import type { SceneModel } from "./backend-contracts";
import type { NoticePlaceholders, WorkspaceIntent, WorkspaceState } from "./contracts";
import { icon } from "./icons";
import type { MapPoint } from "./renderer-camera";
import { CARPET, VENT } from "./overlay-shapes";
import { trailVisible } from "./renderer-overlays";
import { wifiLegend } from "./wifi-legend";

type Translate = (key: string, fallback: string, placeholders?: NoticePlaceholders) => string;

export interface MapLayersContext {
  readonly state: WorkspaceState;
  readonly t: Translate;
}

interface MapKeyContext extends MapLayersContext {
  /** A trail point is ringed for inspection (map-inspect.ts). */
  readonly marked: boolean;
}

/**
 * The live map's switchable layers as one-tap toggles beside Fit map. Each
 * sends the intent its Map options row sends, so both stay in step and the
 * choice is saved for the robot (layer-choices.ts).
 */
export const layerToggles = ({ state, t, intent }: MapLayersContext & { readonly intent: (intent: WorkspaceIntent) => void }) => {
  if (state.dataMode !== "live" || state.selection.floorId !== "current") return nothing;
  const entry = state.resources.entry;
  const trail = state.trail?.id === "live";
  const toggle = (layer: string, path: string, label: string, on: boolean, next: WorkspaceIntent) => html`
    <button class="ms-btn ms-btn--icon" type="button" data-quick-layer=${layer} aria-pressed=${String(on)}
      aria-label=${label} title=${label} @click=${() => intent(next)}>${icon(path)}</button>`;
  return html`
    ${toggle("trail", mdiMapMarkerPath, t("v4_robot_trail", "Robot trail"), trail, { type: "show-trail", trail: trail ? null : "live" })}
    ${entry?.wifiHeatmapUrl ? toggle("wifi", mdiWifi, t("v4_wifi_signal", "Wi-Fi signal"), Boolean(state.wifiSignal), { type: "toggle-wifi-signal" }) : nothing}
    ${entry?.floorTypesUrl ? toggle("floor-types", mdiRug, t("v4_floor_types", "Carpet and vents"), Boolean(state.floorTypes), { type: "toggle-floor-types" }) : nothing}
  `;
};

const rgb = (colour: readonly number[], alpha = 1): string => `rgb(${colour.join(" ")} / ${alpha})`;

/** Keys for what the live map draws besides rooms, in the overlay's colours (overlay-shapes.ts). */
const mapKey = ({ state, t, marked }: MapKeyContext) => {
  if (state.dataMode !== "live" || state.selection.floorId !== "current") return nothing;
  const floorTypes = !state.floor.readOnly && state.floorTypes?.status === "ready" ? state.floorTypes : null;
  const zones = state.resources.areas.value?.zones ?? [];
  const rows = [
    floorTypes?.carpet.length ? ["carpet", `background:${rgb(CARPET, .35)};border:1.25px solid ${rgb(CARPET)}`, t("v4_key_carpet", "Carpet")] : null,
    floorTypes?.vent.length ? ["vent", `background:${rgb(VENT, .35)};border:1.25px solid ${rgb(VENT)}`, t("v4_key_vent", "Floor vent")] : null,
    zones.some(({ kind }) => kind === "no_go") ? ["no-go", "", t("v4_key_no_go", "No-go zone")] : null,
    zones.some(({ kind }) => kind !== "no_go") ? ["zone", "", t("v4_key_robot_zone", "Robot zone, purpose unknown")] : null,
    trailVisible(state) ? ["trail", "", t("v4_robot_trail", "Robot trail")] : null,
    trailVisible(state) ? ["direction", "", t("v4_key_direction", "Direction of travel")] : null,
    marked ? ["marked", "", t("v4_key_marked", "Point you're inspecting")] : null,
  ].filter((row): row is string[] => row !== null);
  if (!rows.length) return nothing;
  return html`<details class="map-key ms-surface ms-surface--floating" open>
    <summary>${t("v4_map_key", "Map key")}</summary>
    <ul>${rows.map(([key, style, label]) => html`<li data-key=${key}><span class="key-swatch" style=${style}></span><span>${label}</span></li>`)}</ul>
  </details>`;
};

export interface MapLegendsContext extends MapKeyContext {
  readonly scene: SceneModel | null;
  /** The map point the user last tapped, if any. */
  readonly spot: MapPoint | null;
  /** The details card for what the user tapped (map-inspect.ts). */
  readonly inspect: TemplateResult | typeof nothing;
}

/** The details card, map key and Wi-Fi legend, stacked in the map's lower start corner. */
export const mapLegends = (context: MapLegendsContext) => {
  const { state, scene, spot, t, inspect } = context;
  const key = mapKey(context);
  const wifi = scene && state.dataMode === "live" && !state.floor.readOnly && state.selection.floorId === "current"
    && state.wifiSignal?.status === "ready"
    ? wifiLegend({ layer: state.wifiSignal, scene, spot, locale: state.locale, t }) : nothing;
  if (key === nothing && wifi === nothing && inspect === nothing) return nothing;
  return html`
    <style>
      .map-legends { position: absolute; z-index: 4; inset-inline-start: max(0.75rem, var(--ms-safe-left, 0px)); inset-block-end: calc(4.5rem + var(--map-sheet-offset, 0px)); display: flex; flex-direction: column; align-items: start; gap: var(--ms-space-2); inline-size: min(17rem, calc(100% - 1.5rem)); max-block-size: calc(100% - 9rem - var(--map-sheet-offset, 0px)); overflow-y: auto; pointer-events: none; }
      .map-legends > * { pointer-events: auto; max-inline-size: 100%; box-sizing: border-box; }
      .map-key { padding: var(--ms-space-2) var(--ms-space-3); font-size: var(--ms-t-sm); }
      .map-key > summary { font-weight: var(--ms-w-bold); cursor: pointer; }
      .map-key ul { display: grid; gap: var(--ms-space-1); margin: var(--ms-space-1) 0 0; padding: 0; list-style: none; }
      .map-key li { display: flex; align-items: center; gap: var(--ms-space-2); }
      .key-swatch { flex: none; box-sizing: border-box; inline-size: 1.25rem; block-size: 0.625rem; border-radius: 0.125rem; }
      [data-key=no-go] .key-swatch { background: color-mix(in srgb, var(--ms-text) 22%, transparent); border: 1.5px solid var(--ms-text); }
      [data-key=zone] .key-swatch { border: 1.5px dashed var(--ms-text); }
      [data-key=trail] .key-swatch { block-size: 0.25rem; border-radius: 0.125rem; background: var(--ms-resolved-indicator, var(--ms-accent)); box-shadow: 0 0 0 1px var(--ms-resolved-on-indicator, var(--ms-on-accent)); }
      [data-key=direction] .key-swatch { inline-size: 0.625rem; margin-inline: 0.3125rem; border: solid var(--ms-resolved-indicator, var(--ms-accent)); border-width: 2px 2px 0 0; transform: rotate(45deg); }
      [data-key=marked] .key-swatch { inline-size: 0.875rem; block-size: 0.875rem; margin-inline: 0.1875rem; border: 2.5px solid var(--ms-text); border-radius: 50%; box-shadow: 0 0 0 1px var(--ms-surface-card, Canvas); }
      @media (forced-colors: active) { .key-swatch { forced-color-adjust: none; } }
    </style>
    <div class="map-legends">${inspect}${key}${wifi}</div>
  `;
};
