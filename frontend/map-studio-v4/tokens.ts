import { css } from "lit";

// Shared design tokens for every Map Studio component.
//
// Two rules keep this honest:
//
// 1. `:host` holds only surface-INDEPENDENT values. A var() inside a custom
//    property is substituted where the property is DECLARED, not where it is
//    used, so a token like `--hover: color-mix(..., var(--local))` would freeze
//    against :host's surface and mix against the wrong background everywhere
//    else. Surface-relative colours are therefore written inline in normal
//    properties, against the `--ms-local` that each painted container sets.
// 2. Every element that paints a background declares `--ms-local` to the same
//    value, and `--ms-local` is never `transparent`: the contrast test reads
//    getComputedStyle(...).backgroundColor, and rgba(0,0,0,0) parses as black.
//
// 3. Light or dark is the inherited `color-scheme`: the panel sets it from
//    Home Assistant's theme, so tokens pick
//    their value with light-dark(). (Controls already need relative colour
//    syntax, which every browser with light-dark() has.)
//
// Authored compact on purpose. esbuild ships tagged-template contents
// byte-for-byte -- --minify does not touch them -- so indentation is shipped
// to every browser.
export const tokens = css`
:host {
--ms-safe-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
--ms-safe-right: var(--safe-area-inset-right, env(safe-area-inset-right, 0px));
--ms-safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
--ms-safe-left: var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
--ms-accent: var(--primary-color, light-dark(#0678ce, #58a6e8));
--ms-on-accent: var(--text-primary-color, light-dark(#fff, #102234));
--ms-danger: var(--error-color, light-dark(#b3261e, #f2837b));
--ms-warning: var(--warning-color, light-dark(#8a5b00, #e0a63a));
--ms-success: var(--success-color, light-dark(#2e7d4f, #74c69d));
--ms-surface-app: var(--primary-background-color, light-dark(#f3f6f8, #101a20));
--ms-surface-card: var(--card-background-color, light-dark(#fff, #1a262d));
--ms-surface-sunken: var(--secondary-background-color, light-dark(#eef2f4, #141e23));
--ms-surface-bar: var(--app-header-background-color, var(--ms-surface-card));
--ms-bar-text: var(--app-header-text-color, var(--ms-text));
--ms-local: var(--card-background-color, light-dark(#fff, #1a262d));
--ms-text: var(--primary-text-color, light-dark(#1f2933, #eef4f7));
--ms-text-quiet: color-mix(in srgb, var(--secondary-text-color, light-dark(#5b6b75, #a4b3bc)) 90%, var(--ms-text));
--ms-text-disabled: var(--disabled-text-color, light-dark(#8a959c, #7c8a92));
--ms-line: var(--divider-color, color-mix(in srgb, var(--ms-text) 14%, transparent));
--ms-line-strong: color-mix(in srgb, var(--ms-text) 26%, transparent);
--ms-scrim: color-mix(in srgb, #000 46%, transparent);
--ms-space-1: 0.25rem;
--ms-space-2: 0.5rem;
--ms-space-3: 0.75rem;
--ms-space-4: 1rem;
--ms-space-5: 1.5rem;
--ms-radius-xs: 0.25rem;
--ms-radius-sm: 0.5rem;
--ms-radius-md: 0.75rem;
--ms-radius-lg: 1rem;
--ms-radius-pill: 999rem;
--ms-control: 2.75rem;
--ms-control-sm: 2.25rem;
--ms-control-lg: 3.25rem;
--ms-icon: 1.25rem;
--ms-font: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
--ms-w-regular: 400;
--ms-w-medium: 500;
--ms-w-bold: 700;
--ms-t-xs: 0.75rem;
--ms-t-sm: 0.8125rem;
--ms-t-md: 0.875rem;
--ms-t-lg: 1rem;
--ms-t-xl: 1.25rem;
--ms-lh-tight: 1.2;
--ms-lh-snug: 1.35;
--ms-lh-normal: 1.5;
--ms-track-tight: -0.01em;
--ms-shadow-1: 0 1px 2px light-dark(rgb(0 0 0 / 10%), rgb(0 0 0 / 40%));
--ms-shadow-2: 0 4px 12px light-dark(rgb(0 0 0 / 14%), rgb(0 0 0 / 48%));
--ms-shadow-3: 0 12px 32px light-dark(rgb(0 0 0 / 22%), rgb(0 0 0 / 60%));
--ms-fast: 120ms;
--ms-base: 180ms;
--ms-ease: cubic-bezier(0.2, 0, 0, 1);
}
@media (prefers-reduced-motion: reduce) {
:host {
--ms-fast: 0s;
--ms-base: 0s;
--ms-ease: linear;
}
}
@media (forced-colors: active) {
:host {
--ms-accent: Highlight;
--ms-on-accent: HighlightText;
--ms-surface-app: Canvas;
--ms-surface-card: Canvas;
--ms-surface-sunken: Canvas;
--ms-surface-bar: Canvas;
--ms-bar-text: CanvasText;
--ms-local: Canvas;
--ms-text: CanvasText;
--ms-text-quiet: CanvasText;
--ms-text-disabled: GrayText;
--ms-line: ButtonBorder;
--ms-line-strong: ButtonBorder;
--ms-danger: CanvasText;
--ms-warning: CanvasText;
--ms-success: CanvasText;
--ms-shadow-1: none;
}
}
`;

// Reset and utilities shared by every component. Previously re-pasted per file.
export const base = css`
*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
.ms-icon { display: block; flex: none; inline-size: var(--ms-icon); block-size: var(--ms-icon); }
.ms-icon--dir:dir(rtl) { scale: -1 1; }
`;
