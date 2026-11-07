import { css, html, nothing } from "lit";
import { mdiAirFilter, mdiFormatText, mdiMapMarkerPath, mdiRobotVacuum, mdiRug, mdiWaterOutline, mdiWifi } from "@mdi/js";
import { icon } from "./icons";
import type { WorkspaceIntent, WorkspaceState } from "./contracts";
import { WIFI_COLOR_STOPS, wifiSampleBounds, wifiScaleBounds } from "./wifi-scale";

export { renderCameraToolbar, renderFloorSwitcher } from "./map-camera-toolbar";

export type MapLayerLocalize = (key: string, fallback: string) => string;

/** Styles for the map's permanently visible layer controls. */
export const layerToolbarStyles = css`
    .toolbar-context .floor-switcher { border-width: 0; border-inline-start: 1px solid var(--ms-line); border-radius: 0; background-color: transparent; font-weight: var(--ms-w-medium); }
    .toolbar-context .floor-switcher, .toolbar-context .floor-switcher:disabled { color: var(--ms-bar-text); opacity: 1; }
    .floor-switcher option { color: var(--ms-text); background-color: var(--ms-surface-card); }

    .toolbar-row .ms-segment .ms-btn { position: relative; z-index: 0; border: 0; background: transparent; border-radius: var(--ms-radius-sm); }
    .toolbar-row .ms-segment .ms-btn::before { position: absolute; inset: 5px 0; z-index: -1; content: ""; border-radius: 6px; }
    .toolbar-row .ms-segment .ms-btn[aria-pressed="true"]::before { background: var(--ms-surface-card); box-shadow: 0 1px 3px color-mix(in srgb, var(--ms-text) 22%, transparent); }
    .toolbar-row .ms-segment .ms-btn[aria-pressed="true"] { color: var(--ms-text); font-weight: 650; }
    .toolbar-row .ms-segment .ms-btn:disabled { border: none; color: var(--ms-text-quiet); }
    .toolbar-row .tracking-switch .ms-btn { gap: 5px; }
    .toolbar-row .tracking-switch .ms-btn:not([aria-pressed="true"]) { color: var(--ms-bar-text); }
    .toolbar-row .tracking-switch .ms-btn:disabled .ms-icon { opacity: .55; }
    .toolbar-row .tracking-switch .ms-icon { width: 17px; height: 17px; }
    .toolbar-row .tracking-switch .ms-btn[aria-pressed="true"]::before { background: var(--ms-surface-sunken); }
    @media (forced-colors: active) { .toolbar-row .ms-segment .ms-btn[aria-pressed="true"]::before { border: 2px solid Highlight; } }

    .toolbar-row :is(.ms-btn,select) { min-block-size: 44px; min-inline-size: 44px; }
    .toolbar-row .ms-segment { display: inline-flex; gap: 1px; padding: 0 3px; background-color: var(--ms-surface-sunken); border-radius: var(--ms-radius-sm); }
    .toolbar-row .ms-segment .ms-btn { padding-inline: var(--ms-space-2); }
    .toolbar-row .tracking-switch { background-color: transparent; }
    .toolbar-actions { margin-inline-start: auto; }
    .tracking-switch { margin-inline-start: auto; }
    .tracking-switch + .toolbar-actions { margin-inline-start: 0; }
    .toolbar-row .ms-btn:focus-visible { outline: 2px solid var(--ms-resolved-indicator, currentColor); outline-offset: -3px; }
    /* Fixed grid tracks for the two rows keep a long floor name from stealing
       width from the view and tracking controls in the row below it. */
    @container (max-width: 46rem) {
      .app-bar { padding-inline: max(6px, var(--ms-safe-left)) max(6px, var(--ms-safe-right)); }
      .toolbar-row { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); align-content: start; gap: 0; padding-block: 0; }
      .toolbar-context { grid-column: 1 / 8; grid-row: 1; gap: 0; }
      .toolbar-context .title { margin-inline: 4px 6px; }
      .toolbar-context .floor-switcher { flex: 0 1 5.25rem; max-inline-size: 5.25rem; padding-inline: 6px 18px; background-position: calc(100% - 10px) 50%, calc(100% - 5px) 50%; }
      .toolbar-row .toolbar-actions { grid-column: 8 / -1; grid-row: 1; justify-self: end; margin: 0; gap: 0; }
      .toolbar-row .toolbar-view { grid-column: 1 / 9; grid-row: 2; gap: 2px; flex-wrap: nowrap; }
      .toolbar-row .tracking-switch { grid-column: 9 / -1; grid-row: 2; justify-self: end; margin: 0; }
      .toolbar-row .ms-segment { padding: 0; gap: 1px; }
      .toolbar-row .ms-segment .ms-btn { min-inline-size: 44px; padding-inline: 3px; white-space: normal; line-height: 1.1; }
      .toolbar-row .tracking-switch .ms-btn { flex-direction: column; gap: 0; font-size: var(--ms-t-xs); font-weight: var(--ms-w-medium); }
      .toolbar-row .tracking-switch .ms-icon { inline-size: 16px; block-size: 16px; }
      .toolbar-row .view-switch { flex: none; }
      .toolbar-row .appearance-switch .ms-btn { font-size: var(--ms-t-xs); }
      .toolbar-row .tracking-switch { background: transparent; }
      .toolbar-row:has(.robot-switcher) .toolbar-context { display: contents; }
      .toolbar-row:has(.robot-switcher) .title { grid-column: 1 / 8; grid-row: 1; }
      .toolbar-row:has(.robot-switcher) .robot-switcher { grid-column: 1 / 8; grid-row: 2; justify-self: stretch; inline-size: 100%; max-inline-size: none; }
      .toolbar-row:has(.robot-switcher) .floor-switcher { grid-column: 8 / -1; grid-row: 2; inline-size: 100%; max-inline-size: none; }
      .toolbar-row:has(.robot-switcher) :is(.toolbar-view,.tracking-switch) { grid-row: 3; }
    }
    @container (min-width: 46.01rem) {
      .toolbar-context .robot-switcher { max-inline-size: clamp(9rem, 17cqw, 16rem); }
    }

  .map-layer-toolbar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0 2px;
    min-inline-size: 0; padding-block: 2px; border-block-start: 1px solid var(--ms-line);
    background-color: var(--ms-surface-card); color: var(--ms-text);
  }
  .map-layer-toolbar__button, .map-layer-toolbar__scale {
    position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    min-inline-size: 44px; min-block-size: 44px; padding: 0 12px; border: 0;
    background: transparent; color: var(--ms-text-quiet); font: inherit; font-size: var(--ms-t-sm);
    font-weight: var(--ms-w-medium); line-height: 1.12; text-align: center; cursor: pointer;
    isolation: isolate;
  }
  .map-layer-toolbar__button::before, .map-layer-toolbar__scale::before {
    content: ""; position: absolute; inset: 4px 0; z-index: -1;
    border: 1px solid transparent; border-radius: var(--ms-radius-sm);
  }
  .map-layer-toolbar__button .ms-icon { inline-size: 18px; block-size: 18px; flex: none; }
  .map-layer-toolbar__button[aria-pressed="true"]:not([aria-disabled="true"]) {
    color: var(--ms-text); font-weight: 650;
  }
  .map-layer-toolbar__button[aria-pressed="true"]:not([aria-disabled="true"])::before {
    background: color-mix(in srgb, var(--layer-ink, var(--ms-resolved-indicator, var(--ms-accent))) 12%, var(--ms-surface-card));
    border-color: var(--layer-ink, var(--ms-resolved-indicator, var(--ms-accent)));
  }
  .map-layer-toolbar__button[aria-pressed="true"]:not([aria-disabled="true"]) svg { color: var(--layer-ink, var(--ms-resolved-indicator, var(--ms-accent))); }
  [data-map-layer="vacuum"] { --layer-ink: light-dark(#1168a6, #7bbefa); }
  [data-map-layer="mop"] { --layer-ink: light-dark(#087766, #7bdaca); }
  [data-map-layer="carpet"] { --layer-ink: light-dark(#925a26, #e2b286); }
  [data-map-layer="vents"] { --layer-ink: light-dark(#39758d, #93cde1); }
  .map-layer-toolbar__button[aria-disabled="true"] { color: var(--ms-text-quiet); cursor: default; }
  .map-layer-toolbar__button[aria-disabled="true"] .ms-icon { opacity: .55; }
  .map-layer-toolbar__button:not([aria-disabled="true"]):hover::before,
  .map-layer-toolbar__scale:hover::before { background: color-mix(in srgb, currentColor 8%, transparent); }
  .map-layer-toolbar :is(button:focus-visible) { outline: 2px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: -2px; border-radius: var(--ms-radius-sm); }
  .map-layer-toolbar__hint { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .map-layer-toolbar__button:is(:hover, :focus) .map-layer-toolbar__hint {
    inset-block-start: calc(100% - 2px); inset-inline-start: 0; z-index: 4;
    width: max-content; max-width: min(200px, 70vw); height: auto; clip-path: none;
    white-space: normal; padding: 7px 10px; border-radius: var(--ms-radius-sm);
    background: var(--ms-text); color: var(--ms-surface-card); font-weight: var(--ms-w-regular); box-shadow: var(--ms-shadow-2);
  }
  .map-layer-toolbar__button:is(:hover, :focus) { z-index: 2; }
  .map-layer-toolbar__wifi-options { flex-basis: 100%; display: flex; align-items: center; flex-wrap: wrap; gap: 0 1rem; border-top: 1px solid var(--ms-line); }
  .wifi-legend { flex: 0 1 15rem; min-inline-size: 11rem; display: grid; grid-template-columns: auto minmax(2rem, 1fr) auto; align-items: center; gap: 6px; margin-inline: 6px; font-size: var(--ms-t-xs); color: var(--ms-text-quiet); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .map-layer-toolbar__ramp { block-size: 5px; border-radius: 3px; background: var(--wifi-ramp); }
  .map-layer-toolbar__scales { display: inline-flex; align-items: center; flex-wrap: wrap; }
  .map-layer-toolbar__scale[aria-pressed="true"]::before { background: var(--ms-surface-sunken); border-color: var(--ms-line); }
  .map-layer-toolbar__wifi-range { font-size: var(--ms-t-xs); color: var(--ms-text-quiet); }
  .map-layer-toolbar__note { flex-basis: 100%; font-size: var(--ms-t-xs); color: var(--ms-text-quiet); padding: 2px 8px; }
  @container (min-width: 41.01rem) {
    .map-layer-toolbar__button[data-map-layer="carpet"] { margin-inline-start: 8px; }
    .map-layer-toolbar__button[data-map-layer="carpet"]::after { position: absolute; content: ""; inset-inline-start: -5px; inset-block: 12px; border-inline-start: 1px solid var(--ms-line); }
  }
  @container (max-width: 41rem) {
    .map-layer-toolbar { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 0; }
    .map-layer-toolbar__button { grid-column: span 3; padding: 0 3px; gap: 4px; }
    .map-layer-toolbar__button:nth-child(n+5) { grid-column: span 4; }
    .map-layer-toolbar__button:nth-child(4n) .map-layer-toolbar__hint { inset-inline: auto 0; }
    .map-layer-toolbar__wifi-options, .map-layer-toolbar__wifi-range, .map-layer-toolbar__note { grid-column: 1 / -1; }
    .map-layer-toolbar__wifi-options { gap: 0 4px; }
    .wifi-legend { flex: 1 1 100%; margin-block-start: 5px; }
    .map-layer-toolbar__wifi-range { flex: 1 1 9rem; padding: 0 5px 3px; }
    .map-layer-toolbar__scale { padding-inline: 5px; font-size: var(--ms-t-xs); }
  }
  @media (forced-colors: active) {
    .map-layer-toolbar :is(button[aria-pressed="true"])::before { border: 2px solid Highlight; }
  }
`;

const wifiRamp = "linear-gradient(90deg, " + WIFI_COLOR_STOPS.map(({color, offset}) => `${color} ${offset * 100}%`).join(", ") + ")";

const layerIcons = { wifi: mdiWifi, trail: mdiMapMarkerPath, vacuum: mdiRobotVacuum,
  mop: mdiWaterOutline, carpet: mdiRug, vents: mdiAirFilter, labels: mdiFormatText };
const dbm = (value: number): string => `${Math.round(value * 10) / 10} dBm`;

const wifiHint = (state: WorkspaceState, t: MapLayerLocalize): string => {
  const layer = state.wifiSignal;
  if (!layer) return t("v4_layer_wifi_hidden", "Layer hidden. Turn it on to view sampled readings.");
  if (layer.status === "loading") return t("v4_layer_loading", "Loading…");
  if (layer.status === "failed") return t("v4_layer_failed", "Unavailable");
  if (!layer.cells.length) return layer.surveying
    ? t("v4_layer_wifi_collecting", "Waiting for the first reading during a run.")
    : t("v4_layer_wifi_waiting", "No samples yet. Enable the survey in robot settings.");
  if (!state.resources.scene.value?.metadata.floorSupport)
    return t("v4_layer_wifi_floor_unknown", "Readings are saved. Waiting for the floor outline before drawing them.");
  return t("v4_layer_sampled", "Sampled");
};

const floorTypeHint = (state: WorkspaceState, kind: "carpet" | "vent", t: MapLayerLocalize): string => {
  const layer = state.floorTypes;
  if (!layer) return t("v4_layer_material_off", "Show detected areas");
  if (layer.status === "loading") return t("v4_layer_loading", "Loading…");
  if (layer.status === "failed") return t("v4_layer_failed", "Unavailable");
  const outlines = kind === "carpet" ? layer.carpet : layer.vent;
  if (layer.truncated) return t("v4_floor_types_truncated_short", "Response capped");
  if (outlines.length) return layer.partial
    ? t("v4_layer_partial", "Partial map")
    : t("v4_layer_detected", "Detected");
  return layer.partial
    ? t("v4_layer_partial", "Partial map")
    : t("v4_layer_no_detection", "No detections");
};

const layerButton = (
  id: keyof typeof layerIcons,
  label: string,
  hint: string,
  pressed: boolean,
  action: () => void,
  available = true,
) => html`
  <button class="map-layer-toolbar__button" type="button" data-map-layer=${id}
    aria-label=${label}
    aria-pressed=${String(pressed)} aria-disabled=${String(!available)}
    title=${hint || label}
    data-detail=${hint || nothing}
    aria-describedby=${hint ? `map-layer-${id}-hint` : nothing}
    @click=${(event: Event) => { if (available) action(); else (event.currentTarget as HTMLButtonElement).focus(); }}>
    ${icon(layerIcons[id])}<span class="map-layer-toolbar__label">${label}</span>
    ${hint ? html`<span class="map-layer-toolbar__hint" id=${`map-layer-${id}-hint`}>${hint}</span>` : nothing}
  </button>
`;

/** Render persistent, direct-access controls for the map's seven visible layers. */
export function renderLayerToolbar(
  state: WorkspaceState,
  intent: (intent: WorkspaceIntent) => void,
  t: MapLayerLocalize,
) {
  const currentFloorAvailable = state.dataMode === "live" && !state.floor.readOnly
    && state.selection.floorId === "current";
  const wifiAvailable = currentFloorAvailable && Boolean(state.resources.entry?.wifiHeatmapUrl);
  const floorsAvailable = currentFloorAvailable && Boolean(state.resources.entry?.floorTypesUrl);
  const coverageAvailable = currentFloorAvailable && Boolean(state.resources.entry?.coverageUrl);
  const wifiOn = Boolean(state.wifiSignal);
  const wifi = state.wifiSignal?.status === "ready" ? state.wifiSignal : null;
  const sampledBounds = wifi?.cells.length ? wifiSampleBounds(wifi.cells) : null;
  const bounds = state.wifiScale === "absolute" || sampledBounds ? wifiScaleBounds(wifi?.cells ?? [], state.wifiScale) : null;
  const floor = state.floorTypes?.status === "ready" ? state.floorTypes : null;
  const labels = t("v4_layer_room_names", "Room names");
  return html`
    <div class="map-layer-toolbar" role="group" aria-label=${t("v4_map_layers_button", "Layers")}>
      ${layerButton("wifi", t("v4_layer_wifi", "Wi-Fi"), !currentFloorAvailable
        ? t("v4_layer_current_floor_only", "Available on the current live floor.")
        : wifiAvailable ? wifiHint(state, t) : t("v4_layer_wifi_unavailable", "Wi-Fi survey data is unavailable for this map."), wifiOn,
        () => intent({ type: "toggle-wifi-signal" }), wifiAvailable)}
      ${layerButton("trail", t("v4_layer_trail", "Trail"), !currentFloorAvailable
        ? t("v4_layer_current_floor_only", "Available on the current live floor.")
        : state.trail?.id === "live"
        ? t("v4_robot_trail_hint", "The sampled path can have gaps.")
        : t("v4_layer_trail_hint", "Show the path recorded during this clean."), state.trail?.id === "live",
      () => intent({ type: "show-trail", trail: state.trail?.id === "live" ? null : "live" }), currentFloorAvailable)}
      ${layerButton("vacuum", t("v4_layer_vacuum", "Vacuum"), !currentFloorAvailable
        ? t("v4_layer_current_floor_only", "Available on the current live floor.")
        : !coverageAvailable ? t("v4_layer_coverage_unavailable", "Cleaning coverage is unavailable for this map.")
        : state.liveCoverage?.ownershipUnverified
          ? t("v4_coverage_unverified_short", "Waiting for this clean")
          : state.liveCoverage?.coverageBasis === "observed_changes"
            ? t("v4_coverage_observed_short", "Observed cells")
            : t("v4_layer_vacuum_hint", "Observed vacuum coverage during this clean."), Boolean(state.coverageModes & 1),
      () => intent({ type: "toggle-cleaning-coverage", mode: "vacuum" }), coverageAvailable)}
      ${layerButton("mop", t("v4_layer_mop", "Mop"), !currentFloorAvailable
        ? t("v4_layer_current_floor_only", "Available on the current live floor.")
        : !coverageAvailable ? t("v4_layer_coverage_unavailable", "Cleaning coverage is unavailable for this map.")
        : state.liveCoverage?.ownershipUnverified
          ? t("v4_coverage_unverified_short", "Waiting for this clean")
          : state.liveCoverage?.coverageBasis === "observed_changes"
            ? t("v4_coverage_observed_short", "Observed cells")
            : t("v4_layer_mop_hint", "Observed mop coverage during this clean."), Boolean(state.coverageModes & 2),
      () => intent({ type: "toggle-cleaning-coverage", mode: "mop" }), coverageAvailable)}
      ${layerButton("carpet", t("v4_layer_carpet", "Carpet"), !currentFloorAvailable
        ? t("v4_layer_current_floor_only", "Available on the current live floor.")
        : floorsAvailable ? floorTypeHint(state, "carpet", t) : t("v4_layer_floor_types_unavailable", "Carpet and vent data is unavailable for this map."), Boolean(state.floorTypeModes & 1),
      () => intent({ type: "toggle-floor-type", item: "carpet" }), floorsAvailable)}
      ${layerButton("vents", t("v4_layer_vents", "Vents"), !currentFloorAvailable
        ? t("v4_layer_current_floor_only", "Available on the current live floor.")
        : floorsAvailable ? floorTypeHint(state, "vent", t) : t("v4_layer_floor_types_unavailable", "Carpet and vent data is unavailable for this map."), Boolean(state.floorTypeModes & 2),
      () => intent({ type: "toggle-floor-type", item: "vent" }), floorsAvailable)}
      ${layerButton("labels", labels, "", state.labelsVisible,
        () => intent({ type: "toggle-labels" }))}
      ${wifiOn && wifiAvailable ? html`
        <div class="map-layer-toolbar__wifi-options" role="group" aria-label=${t("v4_wifi_scale_heading", "Wi-Fi colors")}>
          ${bounds ? html`<div class="wifi-legend" title=${t("v4_layer_wifi_detail", "Smoothed between nearby readings. Blank areas are unmeasured.")}>
            <span>${dbm(bounds.min)}</span><span class="map-layer-toolbar__ramp" style=${`--wifi-ramp:${wifiRamp}`} aria-hidden="true"></span><span>${dbm(bounds.max)}</span>
          </div>` : nothing}
          <div class="map-layer-toolbar__scales">
            <button class="map-layer-toolbar__scale" type="button" data-wifi-scale="absolute"
              aria-pressed=${String(state.wifiScale === "absolute")}
              @click=${() => intent({ type: "set-wifi-scale", scale: "absolute" })}>${t("v4_wifi_scale_absolute", "Signal strength")}</button>
            <button class="map-layer-toolbar__scale" type="button" data-wifi-scale="relative"
              aria-pressed=${String(state.wifiScale === "relative")}
              @click=${() => intent({ type: "set-wifi-scale", scale: "relative" })}>${t("v4_wifi_scale_relative", "Compare sampled spots")}</button>
          </div>
          ${sampledBounds ? html`<span class="map-layer-toolbar__wifi-range">${t("v4_wifi_sampled_range", "Sampled range")}: ${dbm(sampledBounds.min)} – ${dbm(sampledBounds.max)}</span>` : nothing}
          ${!sampledBounds || !state.resources.scene.value?.metadata.floorSupport
            ? html`<span class="map-layer-toolbar__note" role="status">${wifiHint(state, t)}</span>` : nothing}
        </div>` : nothing}
      ${currentFloorAvailable && state.liveCoverage?.ownershipUnverified ? html`<span class="map-layer-toolbar__note" role="status">${t("v4_coverage_unverified", "Live coverage is hidden until tracking can identify this clean.")}</span>`
        : currentFloorAvailable && state.liveCoverage?.coverageBasis === "observed_changes" ? html`<span class="map-layer-toolbar__note" role="status">${t("v4_coverage_observed_changes", "Partial coverage. Showing changes observed since live tracking began.")}</span>`
          : nothing}
      ${floorsAvailable && floor?.truncated ? html`<span class="map-layer-toolbar__note" role="status">${t("v4_floor_types_truncated", "Some detections may be missing because this map response reached its limit.")}</span>`
        : floorsAvailable && floor?.partial ? html`<span class="map-layer-toolbar__note" role="status">${t("v4_floor_types_partial", "Map shows observed detections. Full floor coverage is unknown.")}</span>` : nothing}
    </div>
  `;
}
