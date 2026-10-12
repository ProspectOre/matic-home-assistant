import { css } from "lit";

// Spec preview, not a component library. Everything here is a rule that
// docs/ux-spec-0.5/design-system.md §4–§5 (plus shell.md, plan.md,
// room-schedule.md and home-rooms.md layout lines) adds to or changes in
// tokens.ts, controls.ts and shell-styles.ts. The mockups load the real
// tokens/controls/shell styles first and this layer after it, so each rule
// below is exactly the delta a build PR would make. Nothing here ships.
export const previewTokens = css`
:host {
--ms-accent-fill: var(--ms-resolved-accent-fill, var(--ms-accent));
--ms-on-accent-fill: var(--ms-resolved-on-accent-fill, var(--ms-on-accent));
--ms-danger-fill: var(--ms-resolved-danger-fill, var(--ms-danger));
--ms-on-danger-fill: var(--ms-resolved-on-danger-fill, var(--ms-on-accent));
--ms-indicator: var(--ms-resolved-indicator, var(--ms-accent));
--ms-danger-text: var(--ms-resolved-danger-text, var(--ms-danger));
--ms-tint-accent: light-dark(color-mix(in srgb, var(--ms-accent) 12%, var(--ms-surface-card)), color-mix(in srgb, var(--ms-accent) 20%, var(--ms-surface-card)));
--ms-tint-danger: light-dark(color-mix(in srgb, var(--ms-danger) 12%, var(--ms-surface-card)), color-mix(in srgb, var(--ms-danger) 20%, var(--ms-surface-card)));
--ms-tint-warning: light-dark(color-mix(in srgb, var(--ms-warning) 12%, var(--ms-surface-card)), color-mix(in srgb, var(--ms-warning) 20%, var(--ms-surface-card)));
--ms-tint-success: light-dark(color-mix(in srgb, var(--ms-success) 12%, var(--ms-surface-card)), color-mix(in srgb, var(--ms-success) 20%, var(--ms-surface-card)));
--ms-bar: var(--header-height, 3.5rem);
--ms-bar-compact: 3rem;
--ms-inspector: 22.5rem;
--ms-inspector-compact: 20rem;
}
@media (forced-colors: active) {
:host {
--ms-accent-fill: Highlight;
--ms-on-accent-fill: HighlightText;
--ms-danger-fill: Highlight;
--ms-on-danger-fill: HighlightText;
--ms-indicator: Highlight;
--ms-danger-text: CanvasText;
--ms-tint-accent: Canvas;
--ms-tint-danger: Canvas;
--ms-tint-warning: Canvas;
--ms-tint-success: Canvas;
}
}
`;

export const previewControls = css`
/* design-system.md §4 .ms-btn: 14 px labels; --block may wrap; --sm is 44 under a coarse pointer. */
.ms-btn { font-size: var(--ms-t-md); }
/* home-rooms.md §9 D2: the navigation primary is an <a class="ms-btn">, drawn like a button. */
a.ms-btn { text-decoration: none; }
.ms-btn--sm { font-size: var(--ms-t-xs); }
.ms-btn--block { white-space: normal; text-align: center; }
@media (any-pointer: coarse) { .ms-btn--sm { min-block-size: var(--ms-control); min-inline-size: var(--ms-control); } }
.ms-btn:focus-visible, .ms-row:focus-visible, .ms-check:has(:focus-visible) { outline: 2px solid var(--ms-indicator); outline-offset: 2px; }
/* Fills read the resolved pair; hover and active start from the fill and mix away from the label. */
.ms-btn--primary { --ms-local: var(--ms-accent-fill); color: var(--ms-on-accent-fill); background: var(--ms-accent-fill); }
.ms-btn--primary.ms-btn--danger { --ms-local: var(--ms-danger-fill); color: var(--ms-on-danger-fill); background: var(--ms-danger-fill); border-color: transparent; }
@media (hover: hover) {
.ms-btn--primary:hover:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in srgb, var(--ms-accent-fill) 86%, rgb(from currentColor calc(255 - r) calc(255 - g) calc(255 - b))); }
.ms-btn--primary.ms-btn--danger:hover:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in srgb, var(--ms-danger-fill) 86%, rgb(from currentColor calc(255 - r) calc(255 - g) calc(255 - b))); }
}
.ms-btn--danger:not(.ms-btn--primary) { color: color-mix(in srgb, var(--ms-danger) 82%, var(--ms-text)); }
/* Disabled keeps the variant's own border; fills turn sunken with a disabled label. */
.ms-btn:disabled, .ms-btn[aria-disabled="true"] { border-color: transparent; color: var(--ms-text-disabled); }
.ms-btn--secondary:disabled, .ms-btn--secondary[aria-disabled="true"] { border-color: var(--ms-line-strong); }
.ms-btn--danger:not(.ms-btn--primary):disabled, .ms-btn--danger:not(.ms-btn--primary)[aria-disabled="true"] { border-color: var(--ms-line-strong); }
.ms-btn--primary:disabled, .ms-btn--primary[aria-disabled="true"] { --ms-local: var(--ms-surface-sunken); color: var(--ms-text-disabled); background: var(--ms-local); border-color: transparent; box-shadow: none; }
/* Selected rows: indicator border + tint on the row only. */
.ms-row[aria-pressed="true"], .ms-row[aria-current="true"], .ms-row[data-selected="true"] { --ms-local: var(--ms-tint-accent); border-color: var(--ms-indicator); background: var(--ms-local); }
.ms-btn[aria-pressed="true"], .ms-btn[aria-checked="true"] { --ms-local: var(--ms-tint-accent); background: var(--ms-local); border-color: var(--ms-indicator); }
.ms-row--featured { --ms-local: var(--ms-tint-accent); background: var(--ms-local); border-color: color-mix(in srgb, var(--ms-indicator) 35%, var(--ms-line)); }
.ms-row { font-size: var(--ms-t-md); }
.ms-row__body small { line-height: var(--ms-lh-snug); }
/* Row leads read the accent tint token instead of an inline mix (controls.ts:105). */
.ms-row__lead { background: var(--ms-tint-accent); }
/* NEW .ms-row[aria-disabled="true"]: the enabled fill and border stay (no
   lighter or darker inversion); title, detail, line 3, lead glyph, chevron
   and chip text take --ms-text-disabled, and chips keep their tint. */
.ms-row[aria-disabled="true"] { background: var(--ms-local); border-color: var(--ms-line); color: var(--ms-text-disabled); }
/* design-system.md §4: a demoted featured card drops its accent border and
   tint and takes the plain row's disabled fill. */
.ms-row--featured[aria-disabled="true"] { --ms-local: var(--ms-surface-sunken); border-color: var(--ms-line); }
.ms-row[aria-disabled="true"] :is(.ms-row__body strong, .ms-row__body small, .ms-row__lead, .ms-row__trail, .warn-line, .warn-line .ms-icon, .due-block, .due-line .ms-icon, .ms-chip) { color: var(--ms-text-disabled); }
/* .ms-switch: the knob moves by a logical offset, so RTL keeps it on the track. */
.ms-switch::after { inset-inline-start: 0.4375rem; translate: 0 -50%; transition: inset-inline-start var(--ms-fast) var(--ms-ease); }
.ms-switch[aria-checked="true"]::after { inset-inline-start: 1.6875rem; translate: 0 -50%; }
.ms-switch[aria-checked="true"]::before { border-color: var(--ms-indicator); background: var(--ms-indicator); }
.ms-switch[aria-readonly="true"] { cursor: default; opacity: 0.7; }
/* NEW .ms-check: the label part of a row; trailing controls are siblings. */
.ms-check { display: flex; flex: 1; align-items: center; gap: var(--ms-space-3); min-inline-size: 0; min-block-size: var(--ms-control); padding-inline: var(--ms-space-3); padding-block: var(--ms-space-1); cursor: pointer; font-size: var(--ms-t-md); }
.ms-check input { flex: none; inline-size: var(--ms-icon); block-size: var(--ms-icon); margin: 0; accent-color: var(--ms-indicator); cursor: pointer; }
.ms-check input:focus-visible { outline: none; }
.ms-row:has(.ms-check :checked) { --ms-local: var(--ms-tint-accent); border-color: var(--ms-indicator); background: var(--ms-local); }
/* NEW .ms-disclosure: a full-row 44 px summary with the directional chevron. */
.ms-disclosure { display: flex; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control); padding-inline: var(--ms-space-3); list-style: none; cursor: pointer; font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); }
.ms-disclosure::-webkit-details-marker { display: none; }
.ms-disclosure:focus-visible { outline: 2px solid var(--ms-indicator); outline-offset: -2px; border-radius: var(--ms-radius-sm); }
.ms-disclosure__value { margin-inline-start: auto; color: var(--ms-text-quiet); font-weight: var(--ms-w-regular); font-size: var(--ms-t-xs); text-align: end; }
.chev { flex: none; transition: rotate var(--ms-fast) var(--ms-ease); }
details[open] > .ms-disclosure .chev, [aria-expanded="true"] > .chev { rotate: 90deg; }
details[open] > .ms-disclosure .chev:dir(rtl), [aria-expanded="true"] > .chev:dir(rtl) { rotate: -90deg; }
.ms-icon--dir:dir(rtl) { scale: -1 1; }
/* NEW .ms-stepper: [− 44×44][field][+ 44×44] in one bordered box. */
.ms-stepper { --ms-local: var(--ms-surface-card); display: inline-grid; flex: none; grid-template-columns: var(--ms-control) minmax(3rem, 4.5rem) var(--ms-control); gap: var(--ms-space-1); align-items: center; border: 1px solid var(--ms-line-strong); border-radius: var(--ms-radius-sm); background: var(--ms-local); }
.ms-stepper--readonly { grid-template-columns: minmax(3rem, 4.5rem); }
.ms-stepper .ms-btn { border-radius: calc(var(--ms-radius-sm) - 1px); }
.ms-stepper input { inline-size: 100%; min-inline-size: 0; min-block-size: var(--ms-control); padding: 0; border: 0; border-radius: var(--ms-radius-xs); color: var(--ms-text); background: transparent; font-size: var(--ms-t-md); font-weight: var(--ms-w-medium); font-variant-numeric: tabular-nums; text-align: center; appearance: textfield; -moz-appearance: textfield; }
.ms-stepper input::-webkit-inner-spin-button, .ms-stepper input::-webkit-outer-spin-button { margin: 0; appearance: none; -webkit-appearance: none; }
.ms-stepper input::placeholder { color: var(--ms-text-quiet); font-weight: var(--ms-w-medium); opacity: 1; }
.ms-stepper input:focus-visible { outline: 2px solid var(--ms-indicator); outline-offset: -2px; }
.ms-stepper input[readonly] { color: var(--ms-text-quiet); }
/* NEW .ms-range */
.ms-range { inline-size: 100%; min-block-size: var(--ms-control); margin: 0; accent-color: var(--ms-indicator); }
/* NEW .ms-section-heading replaces .group-heading and .shelf-heading. */
.ms-section-heading { margin: var(--ms-space-5) 0 var(--ms-space-2); color: var(--ms-text-quiet); font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); line-height: var(--ms-lh-tight); }
.ms-section-heading:first-child { margin-block-start: 0; }
/* NEW .ms-notice: --ms-text on the tone tint, a 3 px bar and a tone glyph. */
.ms-notice { --tone: var(--ms-accent); --ms-local: var(--ms-tint-accent); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--ms-space-2); align-items: center; padding-inline: var(--ms-space-3) 0; border-inline-start: 3px solid var(--tone); border-radius: var(--ms-radius-md); color: var(--ms-text); background: var(--ms-local); font-size: var(--ms-t-md); line-height: var(--ms-lh-snug); }
.ms-notice[data-tone="success"] { --tone: var(--ms-success); --ms-local: var(--ms-tint-success); }
.ms-notice[data-tone="warning"] { --tone: var(--ms-warning); --ms-local: var(--ms-tint-warning); }
.ms-notice[data-tone="error"] { --tone: var(--ms-danger); --ms-local: var(--ms-tint-danger); }
.ms-notice > .ms-icon { color: var(--tone); }
.ms-notice > p { margin: 0; padding-block: var(--ms-space-2); }
@media (forced-colors: active) {
.ms-btn--primary, .ms-btn--primary.ms-btn--danger { forced-color-adjust: none; color: HighlightText; background: Highlight; border-color: Highlight; }
.ms-btn--primary:disabled, .ms-btn--primary[aria-disabled="true"] { color: GrayText; background: Canvas; border-color: GrayText; }
.ms-notice, .ms-stepper, .ms-toast { border: 1px solid CanvasText; }
/* design-system.md §4 .ms-chip and plan.md §8: chips keep their text and a 1 px ButtonBorder outline. */
.ms-chip { border: 1px solid ButtonBorder; }
.ms-row:has(.ms-check :checked) { border-color: Highlight; }
.ms-row[aria-disabled="true"] :is(.ms-row__body strong, .ms-row__body small, .ms-row__lead, .ms-row__trail, .warn-line, .warn-line .ms-icon, .due-block, .due-line .ms-icon, .ms-chip) { color: GrayText; }
}
`;

// design-system.md §4 .ms-chip and .ms-badge (plan.md §3 names the chips:
// "Default", "Paused", "Needs attention", "Unsaved changes"; the badge
// is the Saved-order position number).
export const previewChips = css`
.ms-chip { --ms-local: var(--ms-tint-accent); display: inline-flex; align-items: center; gap: var(--ms-space-1); min-block-size: 1.5rem; padding-inline: var(--ms-space-2); border-radius: var(--ms-radius-pill); color: var(--ms-text); background: var(--ms-local); font-size: var(--ms-t-xs); font-weight: var(--ms-w-regular); line-height: var(--ms-lh-tight); white-space: nowrap; vertical-align: middle; }
.ms-chip[data-tone="warning"] { --ms-local: var(--ms-tint-warning); }
.ms-chip[data-tone="danger"] { --ms-local: var(--ms-tint-danger); }
.ms-chip[data-tone="neutral"] { --ms-local: var(--ms-surface-sunken); border: 1px solid var(--ms-line); }
.ms-badge { display: grid; flex: none; place-items: center; inline-size: 1.5rem; block-size: 1.5rem; border-radius: 50%; color: var(--ms-text); background: var(--ms-tint-accent); font-size: var(--ms-t-xs); font-weight: var(--ms-w-bold); font-variant-numeric: tabular-nums; }
/* design-system.md §4: inside a selected (tinted) row the badge takes the card fill and a line border. */
.ms-row[data-selected="true"] .ms-badge, .ms-row:has(.ms-check :checked) .ms-badge { box-sizing: border-box; border: 1px solid var(--ms-line); background: var(--ms-surface-card); }
.mock-chips { display: flex; flex-wrap: wrap; gap: var(--ms-space-1); margin-block-start: var(--ms-space-1); }
`;

// Shell geometry from design-system.md §3/§7 and shell.md §3/§7: 56 px bar
// (48 compact), no 28rem/36rem floors, a 360 px inspector (320 compact),
// the h2 and notice slot pinned above the scrolling body, reasons under the
// strip, the compact action bar in the grip row, one detent toggle.
export const previewShell = css`
.app, .narrow .app { grid-template-rows: var(--ms-bar) minmax(0, 1fr); min-block-size: 0; }
.compact .app { grid-template-rows: var(--ms-bar-compact) minmax(0, 1fr); }
.workspace { grid-template-columns: minmax(0, 1fr) var(--ms-inspector); }
.compact-inspector .workspace { grid-template-columns: minmax(0, 1fr) var(--ms-inspector-compact); }
.narrow .workspace { grid-template-columns: minmax(0, 1fr); }
.workspace.full-map { grid-template-columns: minmax(0, 1fr); }
.title, .narrow .title { font-size: var(--ms-t-lg); flex: none; }
.narrow .sheet-status { font-size: var(--ms-t-lg); }
.status-strip { grid-template-columns: var(--ms-control-sm) minmax(0, 1fr) auto; }
.status-strip strong { font-size: var(--ms-t-md); }
/* The status icon reads the accent tint token instead of an inline mix (shell-styles.ts:149). */
.status-icon { background: var(--ms-tint-accent); }
/* shell.md §3: paused [Resume][Stop] share the trailing slot on one row; the detail truncates first. */
.status-actions { display: flex; gap: var(--ms-space-2); }
.status-strip .action-reason { display: block; grid-column: 2 / -1; margin-block-start: calc(-1 * var(--ms-space-2)); text-align: start; }
.panel-pinned { flex: none; display: grid; gap: var(--ms-space-2); padding-block-end: var(--ms-space-3); }
.panel-heading h2 { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-heading h2 .ms-chip { margin-inline-start: var(--ms-space-2); }
.panel-heading .ms-btn--icon { flex: none; }
.panel-description { margin: 0 0 var(--ms-space-4); font-size: var(--ms-t-md); }
.workflow { padding-block-end: var(--ms-space-3); }
.narrow .mobile-sheet { max-block-size: none; }
.narrow .mobile-sheet .panel-pinned { padding-block: var(--ms-space-2) var(--ms-space-3); }
.narrow .mobile-sheet[data-detent="peek"] .panel-pinned { display: none; }
.narrow .sheet-grip { grid-template-columns: minmax(0, 1fr) auto; gap: var(--ms-space-2); }
.narrow .sheet-grip:has(.sheet-back) { grid-template-columns: auto minmax(0, 1fr) auto; }
.compact .sheet-grip { grid-template-columns: minmax(0, 1fr) auto auto; }
.compact .sheet-grip:has(.sheet-back) { grid-template-columns: auto minmax(0, 1fr) auto auto; }
.compact .sheet-grip .action-bar { display: flex; gap: var(--ms-space-2); padding: 0; margin: 0; }
.compact .sheet-grip .action-bar .ms-btn--lg { min-block-size: var(--ms-control); inline-size: auto; padding-inline: var(--ms-space-4); }
.compact .grip-reason { margin: 0; padding-block-end: var(--ms-space-1); overflow: hidden; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); text-overflow: ellipsis; white-space: nowrap; }
.sheet-toggle { flex: none; }
.action-row { display: flex; gap: var(--ms-space-2); }
.action-row > .ms-btn { flex: 1; }
.action-reason { font-size: var(--ms-t-xs); }
.action-reason a { display: inline-flex; align-items: center; min-block-size: var(--ms-control); padding-inline: var(--ms-space-2); color: var(--ms-indicator); font-weight: var(--ms-w-bold); }
.action-summary { font-size: var(--ms-t-xs); }
.host-state p, .dialog p { font-size: var(--ms-t-md); }
.dialog h2 { font-size: var(--ms-t-lg); }
.dialog-actions { flex-wrap: wrap; }
.full-map-hud { inline-size: auto; max-inline-size: calc(100% - 1.5rem); }
.full-map-hud .ms-btn { min-inline-size: 0; }
.narrow .full-map-hud { inset-inline: var(--ms-space-3); }
.hud-actions { display: flex; gap: var(--ms-space-2); }
/* design-system.md §4 Type: the 13 px --ms-t-sm uses move to --ms-t-md. The detail keeps shell-styles.ts:220's ellipsis. */
.hud-copy strong { font-size: var(--ms-t-md); }
.ms-toast { --ms-local: var(--ms-surface-card); position: absolute; z-index: 20; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--ms-space-2); align-items: center; inline-size: min(24rem, calc(100% - 1.5rem)); padding-inline: var(--ms-space-3) 0; border-inline-start: 3px solid var(--tone, var(--ms-accent)); border-radius: var(--ms-radius-md); color: var(--ms-text); background: var(--ms-local); box-shadow: var(--ms-shadow-3); font-size: var(--ms-t-md); line-height: var(--ms-lh-snug); }
.ms-toast[data-tone="error"] { --tone: var(--ms-danger); }
.ms-toast[data-tone="success"] { --tone: var(--ms-success); }
.ms-toast > .ms-icon { color: var(--tone, var(--ms-accent)); }
.ms-toast > p { margin: 0; padding-block: var(--ms-space-2); }
`;
