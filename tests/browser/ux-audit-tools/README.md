# Map Studio v4 UX audit tools (behind `docs/ux-audit-0.5/responsive-a11y.md`)
Run `node tests/browser/server.mjs` (port 4173), then `node tests/browser/ux-audit-tools/<script>.mjs [args]` from the repo root. Output goes to stdout; only `forced.mjs` and `ds.mjs` write screenshots, to the git-ignored `tests/browser/.generated/ux-audit-tools/`.
- `common.mjs`: launch, `openScenario`, `settle` and the shadow-piercing `window.__uxAudit` walker the others import.
- `responsive.mjs [a,b,c]`: shell, sheet, inspector and page-scroll geometry per contract viewport.
- `touch.mjs [w] [h] [scenarios...]`: effective hit boxes under 44x44 (default 390x844).
- `keyboard.mjs`, `keyboard2.mjs`: Tab order, skip links, Escape order, dialog trap, focus restore; `keyboard2` isolates root causes.
- `ha_theme_axe.mjs`: axe `color-contrast` with Home Assistant's default palette applied through its CSS variables.
- `forced.mjs`: forced-colors computed styles, focus ring, reduced-motion properties, MS-DS-01 before/after PNGs.
- `reflow.mjs`: 200% and 400% zoom (320x256) overflow, clipped text and dialog fit.
- `ds.mjs`: control sizing, surface nesting, type scale and an HA-variable sentinel render.
