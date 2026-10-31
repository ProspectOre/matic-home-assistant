import { css } from "lit";
import { base, tokens } from "./tokens";
import { controls } from "./controls";

// Shell layout and responsive surfaces. Interaction state stays in shell.ts.
export const shellStyles = [tokens, base, controls, css`
    :host {
      display: block;
      min-inline-size: 0;
      min-block-size: 0;
      block-size: 100%;
      color: var(--ms-text);
      background: var(--ms-surface-app);
      font-family: var(--ms-font);
      container-type: size;
    }

    /* Fixed layout widths also hold when HA uses a different root font size. */
    .root { --ms-inspector: 360px; position: relative; min-block-size: 0; block-size: 100%; }
    /* The compact inspector, 768 to 1023 px landscape (design-system.md §7). */
    @container (max-width: 1023px) { .root { --ms-inspector: 320px; } }

    .sr-only, .skip-link:not(:focus) {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .skip-link:focus {
      position: absolute;
      z-index: 40;
      inset-block-start: calc(var(--ms-space-2) + var(--ms-safe-top));
      inset-inline-start: var(--ms-space-2);
    }

    .app {
      display: grid;
      grid-template-rows: calc(3.5rem + var(--ms-safe-top)) minmax(0, 1fr);
      block-size: 100%;
      background: var(--ms-surface-app);
    }
    .app[inert] { filter: none; }

    .app-bar {
      color: var(--ms-bar-text);
      --ms-local: var(--ms-surface-bar);
      position: relative;
      z-index: 12;
      display: flex;
      align-items: center;
      gap: var(--ms-space-2);
      min-inline-size: 0;
      padding-block-start: var(--ms-safe-top);
      padding-inline: max(var(--ms-space-3), var(--ms-safe-left)) max(var(--ms-space-3), var(--ms-safe-right));
      border-block-end: 1px solid var(--ms-line);
      background: var(--ms-local);
      box-shadow: var(--ms-shadow-1);
    }

    .app-bar > .ms-btn, .app-bar > .overflow-wrap > .ms-btn { color: var(--ms-bar-text); }
    .app-bar > .ms-btn:focus-visible, .app-bar > .overflow-wrap > .ms-btn:focus-visible { outline-color: var(--ms-bar-text); }

    .context-switcher { max-inline-size: 9rem; inline-size: auto; min-block-size: var(--ms-control); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .floor-switcher, .robot-switcher { appearance: none; block-size: 44px; padding-inline-end: 1.8rem; background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%); background-position: calc(100% - 15px) 50%, calc(100% - 10px) 50%; background-size: 5px 5px; background-repeat: no-repeat; }
    .floor-switcher:dir(rtl), .robot-switcher:dir(rtl) { background-position: 10px 50%, 15px 50%; }


    /* The title keeps its own width (R24): a robot select beside it takes
       the rest of the bar and ends in an ellipsis. */
    .title {
      flex: none;
      overflow: hidden;
      min-inline-size: min-content;
      margin: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--ms-t-lg);
      font-weight: var(--ms-w-bold);
      letter-spacing: var(--ms-track-tight);
    }

    .spacer { flex: 1; }

    .overflow-wrap { position: relative; }

    .workspace {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) var(--ms-inspector);
      min-inline-size: 0;
      min-block-size: 0;
    }

    .workspace.full-map { grid-template-columns: minmax(0, 1fr); }
    .workspace.full-map .inspector,
    .workspace.full-map .mobile-sheet,
    .workspace.full-map .sheet-scrim { display: none; }

    .canvas { position: relative; min-inline-size: 0; min-block-size: 0; }
    .map-canvas { block-size: 100%; }

    .inspector {
      --ms-local: var(--ms-surface-card);
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      min-block-size: 0;
      border-inline-start: 1px solid var(--ms-line);
      background: var(--ms-local);
    }

    .status-strip {
      display: grid;
      grid-template-columns: var(--ms-control-sm) minmax(0, 1fr) auto;
      gap: var(--ms-space-3);
      align-items: center;
      padding: var(--ms-space-3) var(--ms-space-4);
      border-block-end: 1px solid var(--ms-line);
    }

    .status-icon {
      display: grid;
      place-items: center;
      inline-size: var(--ms-control-sm);
      block-size: var(--ms-control-sm);
      border-radius: 50%;
      color: var(--ms-accent);
      background: color-mix(in srgb, var(--ms-accent) 11%, var(--ms-local));
    }

    .status-copy { min-inline-size: 0; }
    .room-estimate { display: block; overflow-wrap: anywhere; font-size: var(--ms-t-sm); font-weight: var(--ms-w-regular); }
    .status-strip strong, .status-strip small { display: block; overflow-wrap: anywhere; }
    .status-strip strong { font-size: var(--ms-t-sm); }
    .status-strip small { margin-block-start: 0.125rem; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
    .status-strip .room-estimate { font-size: var(--ms-t-sm); }
    .status-strip .action-reason { grid-column: 1 / -1; text-align: start; }

    .workflow {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-block-size: 0;
      padding: var(--ms-space-4);
      overflow: hidden;
    }
    .workflow-body { flex: 1; min-block-size: 0; overflow: auto; overscroll-behavior: contain; }
    .panel-top:focus-visible, .sheet-body:focus-visible, .workflow-body:focus-visible { outline: 2px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: -2px; }
    .workflow > .action-bar { flex: none; }

    .panel-heading { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); align-items: center; min-inline-size: 0; }
    .panel-heading h2 { flex: 1; margin: 0; min-inline-size: 0; font-size: var(--ms-t-xl); letter-spacing: var(--ms-track-tight); }
    .panel-heading bdi { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel-heading h2:focus { outline: none; }
    .panel-heading h2:focus-visible { outline: 2px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: 4px; border-radius: var(--ms-radius-xs); }
    .panel-description { margin: var(--ms-space-1) 0 var(--ms-space-4); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }

    /* Notice slot and toast (shell.md §4, design-system.md .ms-notice): the
       text stays --ms-text on the tone's tint; the glyph carries the tone. */
    .notice {
      --notice-tone: var(--ms-accent);
      --ms-local: color-mix(in srgb, var(--notice-tone) 12%, var(--ms-surface-card));
      display: flex;
      gap: var(--ms-space-2);
      align-items: center;
      padding-inline-start: var(--ms-space-3);
      border-radius: var(--ms-radius-md);
      background: var(--ms-local);
      color: var(--ms-text);
      font-size: var(--ms-t-sm);
      line-height: var(--ms-lh-snug);
    }
    .notice[data-tone="success"] { --notice-tone: var(--ms-success); }
    .notice[data-tone="warning"] { --notice-tone: var(--ms-warning); }
    .notice[data-tone="error"] { --notice-tone: var(--ms-danger); }
    .notice > .ms-icon { color: var(--notice-tone); }
    .notice > .ms-btn { flex: none; }
    .notice-text { flex: 1; min-inline-size: 0; padding-block: var(--ms-space-2); }
    [data-notice-slot] { margin-block-start: var(--ms-space-3); }
    /* Wide: bottom centre of the canvas, above the dock. */
    .notice-toast {
      position: absolute;
      z-index: 10;
      inset-inline: 0 var(--ms-inspector);
      inset-block-end: calc(var(--ms-space-3) + 3.5rem + var(--ms-space-2));
      inline-size: fit-content;
      max-inline-size: min(28rem, calc(100% - var(--ms-inspector) - 2 * var(--ms-space-3)));
      margin-inline: auto;
      box-shadow: var(--ms-shadow-2);
    }
    .notice-toast[hidden] { display: none; }
    /* Narrow: the sheet's top edge. */
    .narrow > .notice-toast { inset-inline: 0; inset-block-end: calc(var(--map-sheet-offset, 0px) + var(--ms-space-2)); max-inline-size: calc(100% - 2 * var(--ms-space-3)); }
    /* Full map: above the HUD band and the Draw dock, clear of "?". */
    .root:has(.full-map-hud) > .notice-toast {
      inset-inline: auto var(--ms-space-3);
      inset-block-end: calc(var(--map-sheet-offset, 0px) + max(var(--ms-space-3), var(--ms-safe-bottom)));
      max-inline-size: min(24rem, calc(100% - 1.5rem));
    }
    .narrow:has(.full-map-hud) > .notice-toast { inset-inline: 0; max-inline-size: calc(100% - 7.5rem); }
    .root[data-dock] > .notice-toast { inset-block-end: calc(var(--map-sheet-offset, 0px) + 5.25rem); }

    /* minmax(0, 1fr): a card's one-line name must not widen the column. */
    .quick-actions, .shelf { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--ms-space-2); }
    .quick-actions .ms-row__body small { color: var(--ms-text-quiet); }
    /* The featured card is tinted with the accent, which drops the quiet
       text below AA (4.3:1 on the default light theme). Pull it towards
       the body text colour so it clears 4.5:1 on both schemes. */
    .quick-actions .ms-row--featured .ms-row__body small { color: color-mix(in srgb, var(--ms-text-quiet) 70%, var(--ms-text)); }
    /* A demoted card drops its tint and reads in the disabled colour; it stays
       in place and focusable, described by the one home reason (home-rooms.md §4). */
    .quick-actions .ms-row[aria-disabled="true"] { --ms-local: var(--ms-surface-sunken); border-color: var(--ms-line); }
    .quick-actions .ms-row[aria-disabled="true"] .ms-row__lead { color: var(--ms-text-disabled); background: color-mix(in srgb, var(--ms-text) 6%, var(--ms-local)); }
    .quick-actions .ms-row[aria-disabled="true"] :is(strong, small) { color: var(--ms-text-disabled); }
    .home-actions { display: flex; margin: 0 0 var(--ms-space-4); }
    .queue { display: grid; gap: var(--ms-space-2); margin: 0 0 var(--ms-space-4); }
    .queue .ms-field { display: grid; gap: var(--ms-space-1); font-size: var(--ms-t-sm); }
    .queue-actions { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
    .queue-status { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-sm); }
    .problem { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); }
    .problem p, .loading { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }
    .problem .ms-btn { justify-self: start; text-decoration: none; }

    .action-bar { display: grid; gap: var(--ms-space-2); margin-block-start: auto; padding-block-start: var(--ms-space-4); }
    .action-reason { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); text-align: center; }
    .paired { grid-template-columns: 1fr 1fr; align-items: center; }
    .paired .action-reason { grid-column: 1 / -1; order: 1; }
    .ms-btn--primary[aria-disabled="true"] { --ms-local: var(--ms-surface-sunken); background: var(--ms-local); border-color: transparent; }

    .full-map-hud {
      --ms-local: var(--ms-surface-card);
      position: absolute;
      z-index: 9;
      inset-inline-end: var(--ms-space-3);
      inset-block-end: max(var(--ms-space-3), var(--ms-safe-bottom));
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-auto-flow: column;
      grid-auto-columns: auto;
      gap: var(--ms-space-3);
      align-items: center;
      inline-size: fit-content;
      max-inline-size: calc(100% - 1.5rem);
      padding: var(--ms-space-3);
      background: var(--ms-local);
    }
    .hud-exit { gap: var(--ms-space-1); }
    .hud-copy { min-inline-size: 0; }
    .hud-copy strong, .hud-copy small { display: block; overflow-wrap: anywhere; }
    .hud-copy strong { font-size: var(--ms-t-sm); }
    .hud-copy small { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
    .full-map-hud .ms-btn { inline-size: auto; min-inline-size: 5rem; }
    .full-map-hud .action-reason { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; clip-path: inset(50%); white-space: nowrap; }

    .sheet-scrim { display: none; }
    .sheet-grip, .sheet-tools, .sheet-status { display: none; }

    .dialog-backdrop {
      position: fixed;
      z-index: 30;
      inset: 0;
      display: grid;
      place-items: center;
      padding: max(var(--ms-space-4), var(--ms-safe-top)) max(var(--ms-space-4), var(--ms-safe-right)) max(var(--ms-space-4), var(--ms-safe-bottom)) max(var(--ms-space-4), var(--ms-safe-left));
      background: var(--ms-scrim);
    }

    .dialog {
      --ms-local: var(--ms-surface-card);
      inline-size: min(24rem, 100%);
      min-block-size: 0;
      max-block-size: 100%;
      overflow-y: auto;
      padding: var(--ms-space-5);
      color: var(--ms-text);
      background: var(--ms-local);
    }

    .dialog h2 { margin: 0; font-size: var(--ms-t-lg); }
    .dialog p { color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }
    .dialog-actions { display: flex; justify-content: flex-end; gap: var(--ms-space-2); }

    /* Programmatic focus after a workflow change is for assistive tech; a ring on a heading reads as a control. */
    h2[tabindex="-1"]:focus { outline: 0; }
    .narrow .app { grid-template-rows: calc(3.35rem + var(--ms-safe-top)) minmax(0, 1fr); }
    .narrow .workspace { grid-template-columns: minmax(0, 1fr); }
    .narrow .inspector { border-inline-start: 0; }
    .narrow .mobile-sheet {
      position: absolute;
      z-index: 7;
      inset-inline: 0;
      inset-block-end: 0;
      display: flex;
      flex-direction: column;
      block-size: auto;
      max-block-size: calc(100% - 2rem);
      padding: 0 max(var(--ms-space-3), var(--ms-safe-right)) max(var(--ms-space-3), var(--ms-safe-bottom)) max(var(--ms-space-3), var(--ms-safe-left));
      border-start-start-radius: var(--ms-radius-lg);
      border-start-end-radius: var(--ms-radius-lg);
      box-shadow: 0 -8px 26px rgb(0 0 0 / 14%);
      overflow: hidden;
      transition: block-size var(--ms-base) var(--ms-ease);
      will-change: transform;
    }
    .narrow .mobile-sheet[data-detent="half"] { block-size: min(48%, 26rem); }
    .narrow .mobile-sheet[data-detent="full"] { block-size: min(92%, calc(100% - 9rem)); }
    .narrow .mobile-sheet.dragging,
    .narrow .mobile-sheet.instant { transition: none; }
    .narrow .mobile-sheet[data-detent="peek"] .sheet-panel { display: none; }

    .narrow .sheet-grip {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: var(--ms-space-1);
      align-items: center;
      min-block-size: var(--ms-control);
      padding-block: var(--ms-space-3) var(--ms-space-1);
      touch-action: none;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
    }
    .narrow .sheet-grip:active { cursor: grabbing; }
    /* The step buttons are compact on the grip line but still touch targets:
       full control height (44px) on a phone, not the 36px --sm size. */
    .narrow .sheet-grip .ms-btn--sm { min-block-size: var(--ms-control); min-inline-size: var(--ms-control); }
    .narrow .sheet-handle {
      position: absolute;
      inset-block-start: var(--ms-space-1);
      inset-inline-start: 50%;
      inline-size: 2.5rem;
      block-size: 0.25rem;
      border-radius: var(--ms-radius-pill);
      background: var(--ms-line-strong);
      transform: translateX(-50%);
    }
    .narrow .sheet-status {
      display: block;
      min-inline-size: 0;
      font-size: var(--ms-t-md);
      font-weight: var(--ms-w-bold);
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .narrow .sheet-tools { display: block; padding-block: var(--ms-space-1) var(--ms-space-2); }
    .sheet-tools > :is(.loading, .problem) { margin-block-end: var(--ms-space-2); }
    /* Two rows: Points to Move map, Undo to Brush; the last column takes its
       content so "Brush · 60 cm" never wraps. Points has no Brush, so its
       second row splits three ways (map-surfaces.md §5 collapse rule). */
    .narrow .draw-tools--grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; gap: var(--ms-space-1); padding: 0; }
    .narrow .draw-tools--grid[data-zone="true"] { grid-template-columns: repeat(12, minmax(0, 1fr)); }
    .narrow .draw-tools--grid .ms-btn {
      flex-direction: column;
      gap: var(--ms-space-1);
      min-inline-size: var(--ms-control);
      min-block-size: var(--ms-control);
      padding: var(--ms-space-1);
      border-color: var(--ms-line);
      font-size: var(--ms-t-xs);
    }
    .narrow .draw-tools--grid[data-zone="true"] .ms-btn { grid-column: span 4; }
    .narrow .draw-tools--grid[data-zone="true"] .ms-btn[data-tool] { grid-column: span 3; }
    /* Labels drop first (under 360 px), rows second (a landscape phone keeps
       one 44 px row that scrolls sideways when the sheet is narrower). */
    @media (max-width: 359px), (max-height: 479px) {
      .narrow .draw-tools--grid .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; clip-path: inset(50%); }
    }
    @media (max-height: 479px) {
      .narrow .draw-tools--grid, .narrow .draw-tools--grid[data-zone="true"] { display: flex; overflow-x: auto; }
      .narrow .draw-tools--grid .ms-btn { flex: none; inline-size: var(--ms-control); padding-inline: 0; }
    }
    .sr-only { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; clip-path: inset(50%); white-space: nowrap; }
    .narrow .sheet-panel { display: flex; flex: 1; flex-direction: column; min-block-size: 0; }
    /* On a short sheet the pinned heading and notice give the body at least half. */
    .narrow .panel-top { max-block-size: 50%; padding-block-start: var(--ms-space-1); overflow: auto; overscroll-behavior: contain; }
    .narrow .sheet-body { flex: 1; min-block-size: 0; padding-block-end: var(--ms-space-1); overflow: auto; overscroll-behavior: contain; }
    .narrow .mobile-sheet .action-bar { flex: none; margin-block-start: 0; padding-block-start: var(--ms-space-2); }
    .narrow .title { font-size: var(--ms-t-md); }
    .narrow .context-switcher { max-inline-size: 7rem; }
    .narrow .robot-switcher { flex: 1 1 auto; min-inline-size: 0; max-inline-size: none; }
    .narrow .full-map-hud { inset-inline-start: var(--ms-space-3); inset-block-end: max(var(--ms-space-3), var(--ms-safe-bottom)); inline-size: auto; max-inline-size: none; }
    .narrow .hud-exit { min-inline-size: var(--ms-control); padding-inline: var(--ms-space-2); }
    .narrow .hud-exit .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; clip-path: inset(50%); white-space: nowrap; }
    .narrow .workspace.full-map .mobile-sheet { display: none; }
    .narrow .sheet-scrim {
      position: absolute;
      z-index: 3;
      inset: 0;
      inset-block-end: var(--map-sheet-offset, 0px);
      display: block;
      border: 0;
      background: color-mix(in srgb, #000 18%, transparent);
      cursor: pointer;
    }
    .narrow .sheet-scrim:focus-visible { outline: 3px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: -3px; }

    @media (forced-colors: active) {
      .dialog, .full-map-hud, .mobile-sheet, .problem, .notice { border: 1px solid CanvasText; }
      .quick-actions .ms-row--featured:not([aria-disabled="true"]) { border-color: CanvasText; }
      .sheet-handle { background: CanvasText; }
    }

    @media (prefers-reduced-motion: reduce) {
      .narrow .mobile-sheet { transition: none; }
    }
    /* Compact sheet, height < 480 (design-system.md §7): a 48 px bar, peek
       and full, and the action bar in the grip row with its reason under it. */
    .compact .app { grid-template-rows: calc(3rem + var(--ms-safe-top)) minmax(0, 1fr); }
    .compact .mobile-sheet[data-detent="full"] { block-size: 72%; }
    .compact .sheet-grip { display: flex; flex-wrap: wrap; }
    .compact .sheet-status { flex: 1; }
    .compact .sheet-grip .action-bar { display: contents; }
    .compact .sheet-grip .ms-btn--block { inline-size: auto; min-block-size: var(--ms-control); }
    .compact .sheet-grip .action-reason { flex-basis: 100%; order: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .compact .action-summary { display: none; }
    /* In Draw, Cancel beside the primary is the way back, so the grip drops Back. */
    .compact [data-workflow="draw"] .sheet-grip:has(.paired) .sheet-back { display: none; }
    /* Draw at peek: the grip row and one 44 px tool row (map-surfaces.md §5). */
    .compact .sheet-tools { padding-block: var(--ms-space-1) 0; }
    .compact [data-detent="peek"] .sheet-hint { display: none; }
  `];
