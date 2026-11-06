import { html, nothing, type ReactiveControllerHost } from "lit";
import type { WorkspaceIntent, WorkspaceState } from "./contracts";
import { icon, iconDone } from "./icons";
import { MenuController } from "./menu-controller";
import { MapZoom } from "./map-zoom";

type Host = ReactiveControllerHost & HTMLElement & { readonly renderRoot: ParentNode };

export type MapOptionsContext = {
  state: WorkspaceState;
  t: (key: string, fallback: string) => string;
  intent: (intent: WorkspaceIntent) => void;
  diagnostics: () => void;
  navigation: (() => void) | undefined;
};

/** Advanced map detail, numeric zoom and diagnostics. */
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

  render({ state, t, intent, diagnostics, navigation }: MapOptionsContext) {
    const radio = (checked: boolean, label: string, select: () => void) => html`
      <button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(checked)} data-selected=${checked ? "true" : nothing} tabindex="-1" @click=${select}><span>${label}</span>${checked ? icon(iconDone) : nothing}</button>
    `;
    const detail = (quality: WorkspaceState["quality"], label: string) =>
      radio(state.quality === quality, label, () => intent({ type: "set-quality", quality }));
    return html`
      <style>
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
    .menu-heading { margin: 0; padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
    @container (max-width: 46rem) {
      .toolbar-actions .overflow-wrap { position: static; }
      .toolbar-actions .overflow-menu {
        inset-block-start: calc(var(--ms-safe-top) + 44px);
        inset-inline-end: 6px;
        max-inline-size: calc(100% - 12px);
      }
    }
      </style>
      ${this.#zoom.open ? this.#zoom.render(t) : html`<div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" role="menu" tabindex="0" aria-label=${t("v4_map_options", "Map options")}>
        <div role="group" aria-labelledby="menu-detail">
          <p class="menu-heading" id="menu-detail" role="presentation">${t("map_quality_label", "Map detail")}</p>
          ${detail("auto", t("map_quality_auto", "Auto detail"))}
          ${detail("efficient", t("map_quality_efficient", "Efficient"))}
          ${detail("balanced", t("map_quality_balanced", "Balanced"))}
          ${detail("maximum", t("map_quality_maximum", "Maximum"))}
        </div>
        ${this.#zoom.available() ? html`<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" aria-haspopup="dialog" @click=${() => this.#zoom.show()}>${t("v4_map_zoom", "Map zoom")}</button>` : nothing}
        ${navigation ? html`<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1"
          @click=${() => { this.menu.close(false); navigation(); }}>${t("v4_open_navigation", "Open Home Assistant sidebar")}</button>` : nothing}
        <button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${() => { this.menu.close(false); diagnostics(); }}>${t("v4_map_diagnostics", "Map diagnostics")}</button>
      </div>`}
    `;
  }
}
