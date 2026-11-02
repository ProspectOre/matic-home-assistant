import { css } from "lit";

// Shell rules for markup that renders only once the workflow chunk is ready
// (the Back button, the action bar's summary and jump, the grip's Back
// column and the sheet's brush settings). The discard dialog stays with the shell:
// a Draw draft can be dirty while this chunk failed. The shell adopts them with its
// own styles when the chunk loads, so startup does not carry them.
export const shellWorkflowStyles = css`

    .workspace.comparison { grid-template-columns: minmax(0, 1fr); }
    .workspace.comparison > .canvas { display: none; }
    .workspace.comparison > .inspector,
    .narrow .workspace.comparison > .mobile-sheet[data-detent] {
      grid-column: 1; position: relative; inset: auto; transform: none;
      block-size: 100%; max-block-size: 100%; border-inline-start: 0;
    }

    .panel-back { flex: none; }

    /* One-tap shortcuts share a quiet surface; navigation keeps separate cards.
       Whole-row targets and full names/due lines keep actions easy to identify. */
    .home-shortcuts-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--ms-space-2); }
    .home-shortcuts-heading .ms-btn--icon { flex: none; margin-inline-start: auto; }
    .quick-actions.home-shortcuts { gap: 0; border: 1px solid var(--ms-line); border-radius: var(--ms-radius-lg); }
    /* Keep the first standard cleaning choice in reach at the phone peek. */
    .narrow .home-shortcuts + .ms-section-heading { margin-block-start: var(--ms-space-4); }
    .home-shortcuts .shortcut-edit { cursor: default; }
    .home-shortcuts .shortcut-edit .ms-row__body { flex: 1; }
    .shortcut-order { display: flex; flex: none; gap: var(--ms-space-1); }
    .home-shortcuts .shortcut { --ms-local: light-dark(color-mix(in srgb, var(--ms-accent) 4%, var(--ms-surface-card)), color-mix(in srgb, var(--ms-accent) 8%, var(--ms-surface-card))); border-color: transparent; border-radius: 0; }
    .home-shortcuts .shortcut:first-child { border-start-start-radius: var(--ms-radius-lg); border-start-end-radius: var(--ms-radius-lg); }
    .home-shortcuts .shortcut:last-child { border-end-start-radius: var(--ms-radius-lg); border-end-end-radius: var(--ms-radius-lg); }
    .home-shortcuts .shortcut + .shortcut { border-block-start-color: var(--ms-line); }
    .home-shortcuts .shortcut .ms-row__lead { border-radius: 50%; }
    .home-shortcuts .shortcut:not([aria-disabled="true"]) .ms-row__lead { color: var(--ms-resolved-on-accent-fill, var(--ms-on-accent)); background: var(--ms-resolved-accent-fill, var(--ms-accent)); }
    .quick-actions .card-title { display: flex; gap: var(--ms-space-1) var(--ms-space-2); align-items: center; min-inline-size: 0; }
    .quick-actions .card-name { min-inline-size: 0; overflow-wrap: anywhere; }
    .quick-actions .card-title .ms-chip { flex: none; }
    .quick-actions .card-lines { display: block; margin-block-start: 0.125rem; color: var(--ms-text); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
    .quick-actions .ms-row[aria-disabled="true"] .card-lines { color: var(--ms-text-disabled); }
    /* A held shortcut's reason is the one thing that says why: readable text. */
    .quick-actions .ms-row[aria-disabled="true"] .line[data-tone="warning"] { color: var(--ms-text-quiet); }
    @media (forced-colors: active) {
      .quick-actions.home-shortcuts, .home-shortcuts .shortcut + .shortcut { border-color: ButtonBorder; }
      .home-shortcuts .shortcut:not([aria-disabled="true"]) .ms-row__lead { forced-color-adjust: none; color: HighlightText; background: Highlight; }
    }
    .quick-actions .line { display: block; padding-inline-start: 1.25rem; text-indent: -1.25rem; }
    .quick-actions .line .ms-icon { display: inline-block; inline-size: 1rem; block-size: 1rem; margin-inline-end: var(--ms-space-1); vertical-align: -0.1875rem; color: var(--ms-resolved-indicator, var(--ms-accent)); }
    .quick-actions .line[data-tone="warning"] .ms-icon { color: var(--ms-warning); }
    .pins-error { margin: 0; padding: var(--ms-space-3); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }

    .action-summary { margin: 0; overflow: hidden; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); text-overflow: ellipsis; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    /* A landscape phone keeps the bar to its button (home-rooms.md §7). */
    @media (max-height: 479px) { .action-summary { display: none; } }

    .action-jump { text-decoration: underline; }


    .narrow .panel-back { inline-size: var(--ms-control); padding-inline: 0; }
    .narrow .panel-back .ms-btn__label {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    /* Draw controls arrive with the workflow and draw-tool chunks. */
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
    @media (max-width: 359px), (max-height: 479px) {
      .narrow .draw-tools--grid .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; clip-path: inset(50%); }
    }
    @media (max-height: 479px) {
      .narrow .draw-tools--grid, .narrow .draw-tools--grid[data-zone="true"] { display: flex; overflow-x: auto; }
      .narrow .draw-tools--grid .ms-btn { flex: none; inline-size: var(--ms-control); padding-inline: 0; }
    }
    .compact [data-workflow="draw"] .sheet-grip:has(.paired) .sheet-back { display: none; }
    .compact [data-detent="peek"] .sheet-hint { display: none; }

    .narrow .sheet-grip:has(.sheet-back) { grid-template-columns: auto minmax(0, 1fr) auto auto; }
    .narrow .sheet-precision { display: block; margin-block-end: var(--ms-space-2); }
    .narrow .sheet-hint { margin: 0 0 var(--ms-space-2); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }

`;
