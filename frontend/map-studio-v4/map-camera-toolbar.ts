import { html, nothing } from "lit";
import { mdiCrosshairsGps, mdiVideoOutline } from "@mdi/js";
import type { NoticePlaceholders, WorkspaceIntent, WorkspaceState } from "./contracts";
import { icon, iconFit } from "./icons";
import { canFollowRobot, forcesTop, topView } from "./state";

export function renderCameraToolbar(
  state: WorkspaceState,
  intent: (value: WorkspaceIntent) => void,
  t: (key: string, fallback: string) => string,
  fitMap: () => void,
) {
  const view = topView(state);
  const areaReview = state.workflow === "areaReview";
  const editing = state.workflow === "draw" || areaReview;
  const following = (mode: "follow" | "ride") => {
    const active = state.followMode === mode;
    const ready = canFollowRobot(state, mode);
    const label = mode === "follow" ? t("v4_layer_follow", "Follow") : t("v4_layer_ride", "Ride along");
    return html`<button type="button" class="ms-btn"
      ?data-follow-robot=${mode === "follow"} ?data-ride-along=${mode === "ride"}
      aria-pressed=${String(active)} ?disabled=${!active && !ready}
      title=${ready ? label : t("v4_follow_needs_live_pose", "Following needs a live position; Ride along also needs the robot's heading.")}
      @click=${() => intent({type: "set-follow-mode", mode: active ? "off" : mode})}>${icon(mode === "follow" ? mdiCrosshairsGps : mdiVideoOutline)}${label}</button>`;
  };
  return html`
    <div class="toolbar-view">
      ${!editing ? html`<div class="view-switch ms-segment" role="group" aria-label=${t("map_view_label", "Map view")}>
        <button type="button" class="ms-btn" aria-pressed=${String(view === "top")}
          @click=${() => intent({type: "set-view", view: "top"})}>${t("map_view_top", "2D")}</button>
        <button type="button" class="ms-btn" aria-pressed=${String(view === "three")} ?disabled=${forcesTop(state)}
          @click=${() => intent({type: "set-view", view: "three"})}>${t("map_view_3d", "3D")}</button>
      </div>` : nothing}
      ${!areaReview && view === "top" ? html`<div class="appearance-switch ms-segment" role="group" aria-label=${t("map_style_label", "Map style")}>
        <button type="button" class="ms-btn" aria-pressed=${String(state.appearance === "photo")}
          @click=${() => intent({type: "set-appearance", appearance: "photo"})}>${t("map_style_photo", "Photo")}</button>
        <button type="button" class="ms-btn" aria-pressed=${String(state.appearance === "rooms")}
          @click=${() => intent({type: "set-appearance", appearance: "rooms"})}>${t("v4_room_colours", "Room colors")}</button>
      </div>` : nothing}
      ${state.workflow === "draw" ? html`<button class="ms-btn ms-btn--icon" type="button"
        aria-label=${t("v4_fit_map_hint", "Fit the whole map on screen")} title=${t("v4_fit_map", "Fit map")}
        @click=${fitMap}>${icon(iconFit)}</button>` : nothing}
    </div>
    ${!editing && state.dataMode === "live" ? html`<div class="tracking-switch ms-segment" role="group" aria-label=${t("v4_robot_tracking", "Robot tracking")}>
      ${following("follow")}${following("ride")}
    </div>` : nothing}
  `;
}

export function renderFloorSwitcher(
  state: WorkspaceState,
  intent: (value: WorkspaceIntent) => void,
  t: (key: string, fallback: string, variables?: NoticePlaceholders) => string,
) {
  const historyFloors = state.resources.history.value?.floors || [];
  const floorChoices = historyFloors.length
    ? historyFloors.map((floor, index) => ({
      id: floor.active ? "current" : floor.id,
      label: `${floor.label || (floor.active
        ? t("v4_current_floor", "Current floor")
        : t("v4_saved_floor", "Saved floor {number}", { number: floor.ordinal ?? index + 1 }))}${
        !floor.active && floor.snapshots.length === 0
          ? ` · ${t("v4_floor_not_captured", "No saved map for this floor yet")}`
          : ""
      }`,
      disabled: !floor.active && floor.snapshots.length === 0,
    }))
    : [{ id: state.selection.floorId, label: state.floor.displayName, disabled: false }];
  return html`
    <select
      class="ms-select context-switcher floor-switcher"
      data-map-control
      name="map-floor"
      aria-label=${t("v4_choose_floor", "Choose floor")}
      ?disabled=${floorChoices.length <= 1}
      .value=${state.selection.floorId}
      @change=${(event: Event) => intent({
        type: "set-floor",
        floorId: (event.currentTarget as HTMLSelectElement).value,
      })}
    >${floorChoices.map((floor) => html`
      <option value=${floor.id} ?selected=${floor.id === state.selection.floorId} ?disabled=${floor.disabled}>${floor.label}</option>
    `)}</select>
  `;
}
