import { html, type ReactiveControllerHost } from "lit";

import { ref } from "lit/directives/ref.js";

import type { DrawTool, WorkspaceState } from "./contracts";
import { topView } from "./state";

// Focus once when the Close button enters the document, after Lit commits.
// A stable ref avoids stealing focus when live map state rerenders Help.
const focusClose = (element: Element | undefined): void => {
  if (element instanceof HTMLElement) queueMicrotask(() => {
    if (element.isConnected) element.focus();
  });
};

export interface MapHelpContext {
  readonly state: WorkspaceState;
  /** `(any-pointer: coarse)` matched when the popover opened. */
  readonly coarse: boolean;
  readonly t: (key: string, fallback: string) => string;
  readonly close: () => void;
}

/** Attach dismissal only once the Help chunk is requested, with host lifecycle cleanup. */
export const watchHelpDismissal = (
  host: HTMLElement & ReactiveControllerHost,
  open: () => boolean,
  launcher: () => HTMLElement | null,
  close: () => void,
): void => {
  let start: { x: number; y: number } | null = null;
  const down = (event: PointerEvent): void => {
    start = open() ? { x: event.clientX, y: event.clientY } : null;
  };
  const click = (event: MouseEvent): void => {
    if (!open() || event.detail === 0) return;
    const origin = start;
    start = null;
    // A browser may emit click after a drag; that is not an outside tap.
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) return;
    const path = event.composedPath();
    const button = launcher();
    if ((button && path.includes(button))
      || path.some((node) => node instanceof HTMLElement && node.id === "navigation-help")) return;
    // Keep the new target's focus and action; this is a non-modal popover.
    close();
  };
  host.addController({
    hostConnected() {
      host.ownerDocument.addEventListener("pointerdown", down, true);
      host.ownerDocument.addEventListener("click", click);
    },
    hostDisconnected() {
      host.ownerDocument.removeEventListener("pointerdown", down, true);
      host.ownerDocument.removeEventListener("click", click);
      start = null;
    },
  });
};

const drawPointerHelp = (tool: DrawTool, coarse: boolean, t: MapHelpContext["t"]): string => {
  if (tool === "outline") return coarse
    ? t("v4_touch_points_help", "Tap to add points · two fingers to move or zoom")
    : t("v4_mouse_points_help", "Click to add points · right-drag or Space-drag to move · wheel to zoom");
  if (tool === "erase") return coarse
    ? t("v4_touch_erase_help", "Drag to erase · two fingers to move or zoom")
    : t("v4_mouse_erase_help", "Drag to erase · right-drag or Space-drag to move · wheel to zoom");
  if (tool === "pan") return coarse
    ? t("v4_touch_draw_pan_help", "Drag to move the map · two fingers to move or zoom")
    : t("v4_mouse_top_help", "Drag to move the map · wheel to zoom");
  return coarse
    ? t("v4_touch_draw_help", "Drag to paint · two fingers to move or zoom")
    : t("v4_mouse_draw_help", "Drag to paint · right-drag or Space-drag to move · wheel to zoom");
};

/**
 * The one "How to move the map" popover (map-surfaces.md §5 Help): a
 * non-modal dialog the canvas renders in its rail beside the "?" that opens
 * it. Rows follow the input: a coarse pointer reads Touch only, a fine one
 * Trackpad, Mouse and Keyboard; Draw swaps in the drawing rows, with the
 * keyboard recipe that used to sit in the Draw panel. Touch follows the
 * owner-updated D1 gesture model. Rows
 * follow the view the map shows: in 2D and the area review the modifiers
 * and arrows move the map, so no orbit row is offered.
 */
export const renderMapHelp = ({ state, coarse, t, close }: MapHelpContext) => {
  const draw = state.workflow === "draw";
  const flat = topView(state) === "top";
  const title = t("v4_how_to_move", "How to move the map");
  const rows: readonly (readonly [string, string])[] = coarse
    ? [[t("v4_touch", "Touch"), draw
      ? drawPointerHelp(state.draw.tool, true, t)
      : flat
        ? t("v4_touch_top_help", "Drag to move the map · pinch to zoom · twist two fingers to rotate")
        : t("v4_touch_three_help", "Drag to move the map · pinch to zoom · twist two fingers to rotate · drag two fingers up or down to tilt")]]
    : [
      [t("v4_trackpad", "Trackpad"), t("v4_trackpad_help", "Scroll to move the map · pinch to zoom · twist to rotate")],
      [t("v4_mouse", "Mouse"), draw
        ? drawPointerHelp(state.draw.tool, false, t)
        : flat
          ? t("v4_mouse_top_help", "Drag to move the map · wheel to zoom")
          : t("v4_mouse_help", "Drag to move the map · right-drag or Shift-drag to rotate · wheel to zoom")],
      [t("v4_keyboard", "Keyboard"), !draw
        ? flat
          ? t("v4_keyboard_top_help", "WASD or arrows to move · +/− to zoom · 0 to fit")
          : t("v4_keyboard_help", "WASD to move · Q/E or arrows to orbit · +/− to zoom · 0 to fit")
        : state.draw.tool === "outline"
          ? t("v4_zone_keyboard_help", "Focus the map, aim with arrow keys, and press Enter to place points. The edges join automatically after three points. Keep adding points or Tab to a point; arrows move it, Delete removes it, and Escape cancels a drag.")
          : state.draw.tool === "pan"
            ? t("v4_keyboard_draw_pan_help", "Arrow keys to move · +/− to zoom · 0 to fit. D selects Paint; E selects Erase.")
            : t("v4_keyboard_draw_help", "Focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")],
    ];
  return html`
    <style>
      .map-rail { --help-top: var(--row); --help-bottom: 116px; }
      .map-rail:has(.appearance-switch) { --help-top: calc(2 * var(--row)); }
      .map-root:has(.selection-chip) .map-rail { --help-bottom: calc(116px + 4rem); }
      :host([narrow]) .map-rail { --help-bottom: calc(var(--map-sheet-offset, 0px) + 44px + var(--ms-space-2)); }
      .map-rail:has(.map-chip) { --help-top: calc(2 * var(--row)); }
      .map-rail:has(.map-chip):has(.appearance-switch) { --help-top: calc(3 * var(--row)); }
      .navigation-help { position: absolute; inset-block-start: var(--help-top); inset-inline-end: 0; max-block-size: calc(100% - var(--help-top) - var(--help-bottom)); overflow: auto; box-sizing: border-box; inline-size: 22rem; max-inline-size: 100%; padding: 0.8rem 0.9rem; font-size: 0.74rem; line-height: 1.45; }
      .navigation-help header { display: flex; align-items: center; justify-content: space-between; gap: var(--ms-space-2); margin-block-end: 0.5rem; }
      .navigation-help h2 { margin: 0; font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
      .navigation-help dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem 0.65rem; margin: 0; }
      .navigation-help dt { font-weight: 750; }
      .navigation-help dd { margin: 0; color: var(--ms-text-quiet); }
      @media (any-pointer: coarse) { .navigation-help .ms-btn--sm { min-inline-size: var(--ms-control); min-block-size: var(--ms-control); } }
    </style>
    <div id="navigation-help" class="navigation-help ms-surface ms-surface--floating" role="dialog" aria-modal="false" aria-label=${title}>
      <header>
        <h2>${title}</h2>
        <button ${ref(focusClose)} class="ms-btn ms-btn--sm" type="button" @click=${close}>${t("v4_close", "Close")}</button>
      </header>
      <dl>${rows.map(([term, detail]) => html`<dt>${term}</dt><dd>${detail}</dd>`)}</dl>
    </div>
  `;
};
