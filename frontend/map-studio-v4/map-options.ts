import { html, nothing, type ReactiveControllerHost } from "lit";
import type { WorkspaceIntent, WorkspaceState } from "./contracts";
import { icon, iconDone } from "./icons";
import { MenuController } from "./menu-controller";
import { topView } from "./state";
import { switchStyles } from "./switch-styles";
import { MapZoom } from "./map-zoom";

// The row's second line explains an empty or failed layer and reads the colours.
const wifiNote = (layer: WorkspaceState["wifiSignal"], t: MapOptionsContext["t"]) => {
  if (!layer || layer.status === "loading") return nothing;
  const note = layer.status === "failed"
    ? t("v4_wifi_signal_failed", "Couldn't load the survey")
    : layer.cells.length
      ? t("v4_wifi_signal_legend", "Green is strong, red is weak")
      : layer.surveying
        ? t("v4_wifi_signal_waiting", "No samples yet · they arrive during cleaning")
        : t("v4_wifi_signal_off", "Turn on Wi-Fi survey in the robot's settings");
  return html`<small class="menu-note">${note}</small>`;
};

const floorTypesNote = (layer: WorkspaceState["floorTypes"], t: MapOptionsContext["t"]) => {
  if (!layer || layer.status === "loading") return nothing;
  const note = layer.status === "failed"
    ? t("v4_floor_types_failed", "Couldn't load carpet and vents")
    : layer.carpet.length || layer.vent.length
      ? t("v4_floor_types_legend", "Brown is carpet, blue is a vent")
      : t("v4_floor_types_empty", "None mapped yet · the robot finds them while cleaning");
  return html`<small class="menu-note">${note}</small>`;
};

type Host = ReactiveControllerHost & HTMLElement & { readonly renderRoot: ParentNode };

export type MapOptionsContext = {
  state: WorkspaceState;
  narrow: boolean;
  t: (key: string, fallback: string) => string;
  intent: (intent: WorkspaceIntent) => void;
  diagnostics: () => void;
};

/**
 * The ⋮ Map options menu (home-rooms.md §5 Display; design-system.md §5
 * Menus): the phone's Map display rows, the map detail choice and the
 * diagnostics action. The shell loads it on the first press, since the menu is off the
 * startup path. A display or detail row keeps the menu open so
 * the change shows on the map behind it; an action row closes it.
 */
export class MapOptions {
  readonly menu: MenuController;
  readonly #zoom: MapZoom;

  constructor(host: Host) {
    this.menu = new MenuController(host, ".overflow-wrap", ".overflow");
    this.#zoom = new MapZoom(host, this.menu);
  }

  get popupRole(): "menu" | "dialog" {
    return this.#zoom.open && this.menu.open ? "dialog" : "menu";
  }

  toggle(): void {
    this.#zoom.open = false;
    this.menu.toggle();
  }

  render({ state, narrow, t, intent, diagnostics }: MapOptionsContext) {
    const radio = (checked: boolean, label: string, select: () => void) => html`
      <button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(checked)} data-selected=${checked ? "true" : nothing} tabindex="-1" @click=${select}><span>${label}</span>${checked ? icon(iconDone) : nothing}</button>
    `;
    const detail = (quality: WorkspaceState["quality"], label: string) =>
      radio(state.quality === quality, label, () => intent({ type: "set-quality", quality }));
    return html`
      <style>
        ${switchStyles.cssText}
    .overflow-menu {
      position: absolute;
      z-index: 18;
      inset-block-start: calc(100% + var(--ms-space-1));
      inset-inline-end: 0;
      display: grid;
      gap: var(--ms-space-1);
      min-inline-size: 14rem;
      max-inline-size: calc(100vw - 2rem);
      max-block-size: calc(100dvh - 5rem - var(--ms-safe-top, 0px) - var(--ms-safe-bottom, 0px));
      overflow-y: auto;
      padding: var(--ms-space-1);
    }
    .overflow-menu .ms-row { justify-content: flex-start; }
    .overflow-menu [role="menuitemcheckbox"] { justify-content: space-between; gap: var(--ms-space-3); }
    .overflow-menu [role="group"] { display: grid; gap: var(--ms-space-1); }
    .overflow-menu [role="group"] + * { border-block-start: 1px solid var(--ms-line); padding-block-start: var(--ms-space-1); }
    .overflow-menu :is([data-wifi-signal], [data-floor-types]) > span:first-child { display: grid; text-align: start; }
    .menu-note { color: var(--ms-text-quiet); font-size: var(--ms-t-sm); }
    .menu-heading { margin: 0; padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }

      </style>
      ${this.#zoom.open ? this.#zoom.render(t) : html`<div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" role="menu" aria-label=${t("v4_map_options", "Map options")}>
        ${narrow ? html`
          <div role="group" aria-labelledby="menu-display">
            <p class="menu-heading" id="menu-display" role="presentation">${t("v4_map_display", "Map display")}</p>
            ${topView(state) === "top" ? html`
              ${radio(state.appearance === "photo", t("map_style_photo", "Photo"), () => intent({ type: "set-appearance", appearance: "photo" }))}
              ${radio(state.appearance === "rooms", t("v4_room_colours", "Room colors"), () => intent({ type: "set-appearance", appearance: "rooms" }))}
            ` : nothing}
            <button
              class="ms-row ms-row--menu"
              type="button"
              role="menuitemcheckbox"
              aria-checked=${String(state.labelsVisible)}
              tabindex="-1"
              @click=${() => intent({ type: "toggle-labels" })}
            ><span>${t("v4_room_names", "Room names")}</span><span class="ms-switch" aria-checked=${String(state.labelsVisible)} aria-hidden="true"></span></button>
          </div>
        ` : nothing}
        ${state.resources.entry?.wifiHeatmapUrl ? html`
          <button
            class="ms-row ms-row--menu"
            type="button"
            role="menuitemcheckbox"
            aria-checked=${String(Boolean(state.wifiSignal))}
            tabindex="-1"
            data-wifi-signal
            @click=${() => intent({ type: "toggle-wifi-signal" })}
          ><span>${t("v4_wifi_signal", "Wi-Fi signal")}${wifiNote(state.wifiSignal, t)}</span><span class="ms-switch" aria-checked=${String(Boolean(state.wifiSignal))} aria-hidden="true"></span></button>
        ` : nothing}
        ${state.resources.entry?.floorTypesUrl ? html`
          <button
            class="ms-row ms-row--menu"
            type="button"
            role="menuitemcheckbox"
            aria-checked=${String(Boolean(state.floorTypes))}
            tabindex="-1"
            data-floor-types
            @click=${() => intent({ type: "toggle-floor-types" })}
          ><span>${t("v4_floor_types", "Carpet and vents")}${floorTypesNote(state.floorTypes, t)}</span><span class="ms-switch" aria-checked=${String(Boolean(state.floorTypes))} aria-hidden="true"></span></button>
        ` : nothing}
        <div role="group" aria-labelledby="menu-detail">
          <p class="menu-heading" id="menu-detail" role="presentation">${t("map_quality_label", "Map detail")}</p>
          ${detail("auto", t("map_quality_auto", "Auto detail"))}
          ${detail("efficient", t("map_quality_efficient", "Efficient"))}
          ${detail("balanced", t("map_quality_balanced", "Balanced"))}
          ${detail("maximum", t("map_quality_maximum", "Maximum"))}
        </div>
        ${state.dataMode === "live" ? html`<button
          class="ms-row ms-row--menu"
          type="button"
          role="menuitemcheckbox"
          aria-checked=${String(state.trail?.id === "live")}
          tabindex="-1"
          @click=${() => intent({ type: "show-trail", trail: state.trail?.id === "live" ? null : "live" })}
        ><span>${t("v4_robot_trail", "Robot trail")}</span><span class="ms-switch" aria-checked=${String(state.trail?.id === "live")} aria-hidden="true"></span></button>` : nothing}
        ${this.#zoom.available() ? html`<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" aria-haspopup="dialog" @click=${() => this.#zoom.show()}>${t("v4_map_zoom", "Map zoom")}</button>` : nothing}
        <button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${() => { this.menu.close(false); diagnostics(); }}>${t("v4_map_diagnostics", "Map diagnostics")}</button>
      </div>`}
    `;
  }
}
