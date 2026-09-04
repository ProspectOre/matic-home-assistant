import { html, type TemplateResult } from "lit";

import type { WorkspaceIntent, WorkspaceState } from "./contracts";
import { icon, iconBrush, iconErase, iconMoveMap, iconPaint, iconRedo, iconUndo } from "./icons";

// The six drawing tools, rendered by whichever surface owns them: the map's
// dock at desktop width, the sheet's peek row on a phone. One template so the
// two surfaces cannot drift apart, and a plain template rather than a custom
// element so the map's gesture handler still recognises the buttons.
//
// "Done editing" is deliberately not here. It is the workflow's primary action
// and lives in the action bar under the name "Name and save".
export type DrawToolsLayout = "row" | "grid";

export interface DrawToolsHandlers {
  readonly intent: (intent: WorkspaceIntent) => void;
  readonly openBrush: () => void;
  readonly t: (key: string, fallback: string) => string;
}

const TOOLS = ["paint", "erase", "pan"] as const;

export const renderDrawTools = (
  state: WorkspaceState,
  handlers: DrawToolsHandlers,
  layout: DrawToolsLayout,
): TemplateResult => {
  const { draw } = state;
  const brush = `${draw.brushMeters.toFixed(2)} m`;
  return html`
    <div
      class=${`draw-tools draw-tools--${layout} ms-segment`}
      role="toolbar"
      aria-label=${handlers.t("v4_draw_tools", "Draw area tools")}
      data-map-control
    >
      ${TOOLS.map((tool) => html`
        <button
          class="ms-btn"
          type="button"
          aria-pressed=${String(draw.tool === tool)}
          data-tool=${tool}
          @click=${() => handlers.intent({ type: "set-draw-tool", tool })}
        >${icon(tool === "paint" ? iconPaint : tool === "erase" ? iconErase : iconMoveMap)}<span class="ms-btn__label">${
          tool === "paint" ? handlers.t("area_paint", "Paint")
          : tool === "erase" ? handlers.t("area_erase", "Erase")
          : handlers.t("move_map", "Move map")
        }</span></button>
      `)}
      <button
        class="ms-btn"
        type="button"
        ?disabled=${draw.strokeCount === 0}
        @click=${() => handlers.intent({ type: "undo-draft" })}
      >${icon(iconUndo)}<span class="ms-btn__label">${handlers.t("undo", "Undo")}</span></button>
      <button
        class="ms-btn"
        type="button"
        ?disabled=${draw.redo.length === 0}
        @click=${() => handlers.intent({ type: "redo-draft" })}
      >${icon(iconRedo)}<span class="ms-btn__label">${handlers.t("redo", "Redo")}</span></button>
      <button
        class="ms-btn draw-brush"
        type="button"
        aria-label=${handlers.t("v4_brush_button", "Brush width, {brush}. Opens brush settings.").replace("{brush}", brush)}
        aria-expanded=${String(state.precisionOpen)}
        aria-haspopup="dialog"
        @click=${handlers.openBrush}
      >${icon(iconBrush)}<span class="ms-btn__label">${handlers.t("v4_brush", "Brush {brush}").replace("{brush}", brush)}</span></button>
    </div>
  `;
};
