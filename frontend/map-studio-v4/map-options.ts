import { adoptStyles, html, nothing, type ReactiveControllerHost } from "lit";
import { shellStyles } from "./shell-styles";
import { shellWorkflowStyles } from "./workflow-styles";
import { formControls } from "./form-controls";
import type { WorkspaceIntent, WorkspaceState } from "./contracts";
import { icon, iconDone } from "./icons";
import { MenuController } from "./menu-controller";
import { topView } from "./renderer-controller";

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

  constructor(host: Host) {
    // Adopt the shared menu/switch rules without loading workflow behavior.
    adoptStyles(host.renderRoot as ShadowRoot, [...shellStyles, shellWorkflowStyles, formControls]);
    this.menu = new MenuController(host, ".overflow-wrap", ".overflow");
  }

  render({ state, narrow, t, intent, diagnostics }: MapOptionsContext) {
    const radio = (checked: boolean, label: string, select: () => void) => html`
      <button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(checked)} data-selected=${checked ? "true" : nothing} tabindex="-1" @click=${select}><span>${label}</span>${checked ? icon(iconDone) : nothing}</button>
    `;
    const detail = (quality: WorkspaceState["quality"], label: string) =>
      radio(state.quality === quality, label, () => intent({ type: "set-quality", quality }));
    return html`
      <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" role="menu" aria-label=${t("v4_map_options", "Map options")}>
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
        <div role="group" aria-labelledby="menu-detail">
          <p class="menu-heading" id="menu-detail" role="presentation">${t("map_quality_label", "Map detail")}</p>
          ${detail("auto", t("map_quality_auto", "Auto detail"))}
          ${detail("efficient", t("map_quality_efficient", "Efficient"))}
          ${detail("balanced", t("map_quality_balanced", "Balanced"))}
          ${detail("maximum", t("map_quality_maximum", "Maximum"))}
        </div>
        <button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${() => { this.menu.close(false); diagnostics(); }}>${t("v4_map_diagnostics", "Map diagnostics")}</button>
      </div>
    `;
  }
}
