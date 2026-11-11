// Home Assistant's default light and dark palettes, the values
// tests/browser/ux-audit-tools/ha_theme_axe.mjs measures against. The mockups
// set these HA variables (never an --ms-* token) on the stage, the way HA's
// theme sets them on <home-assistant>, and set color-scheme beside them as
// design-system.md Decision 3 recommends.
export type ThemeName = "light" | "dark";

const SHARED = {
  "--primary-color": "#009ac7",
  "--text-primary-color": "#ffffff",
  "--error-color": "#db4437",
  "--warning-color": "#ffa600",
  "--success-color": "#43a047",
  "--header-height": "56px",
} as const;

export const HA_THEMES: Readonly<Record<ThemeName, Readonly<Record<string, string>>>> = {
  light: {
    ...SHARED,
    "--primary-background-color": "#fafafa",
    "--card-background-color": "#ffffff",
    "--secondary-background-color": "#e5e5e5",
    "--primary-text-color": "#141414",
    "--secondary-text-color": "#5e5e5e",
    "--divider-color": "rgba(0, 0, 0, 0.12)",
    "--disabled-text-color": "#bdbdbd",
    "color-scheme": "light",
  },
  dark: {
    ...SHARED,
    "--primary-background-color": "#111111",
    "--card-background-color": "#1c1c1c",
    "--secondary-background-color": "#282828",
    "--primary-text-color": "#e1e1e1",
    "--secondary-text-color": "#9b9b9b",
    "--divider-color": "rgba(225, 225, 225, 0.12)",
    "--disabled-text-color": "#6f6f6f",
    "color-scheme": "dark",
  },
};

/**
 * design-system.md Decision 1 with HA's default palette (§4 :22, §5 :61-62,
 * §10 Decision 1): the resolved `--ms-resolved-*` values the shell would write.
 * Off, the resolved tokens fall back to HA's own colours.
 */
export const D1_RESOLVED: Readonly<Record<ThemeName, Readonly<Record<string, string>>>> = {
  light: {
    "--ms-resolved-accent-fill": "#007b9f",
    "--ms-resolved-on-accent-fill": "#ffffff",
    "--ms-resolved-danger-fill": "#d04134",
    "--ms-resolved-on-danger-fill": "#ffffff",
    "--ms-resolved-indicator": "#008bb3",
    "--ms-resolved-on-indicator": "#000000",
    "--ms-resolved-danger-text": "#8e2c24",
  },
  dark: {
    "--ms-resolved-accent-fill": "#007b9f",
    "--ms-resolved-on-accent-fill": "#ffffff",
    "--ms-resolved-danger-fill": "#d04134",
    "--ms-resolved-on-danger-fill": "#ffffff",
    "--ms-resolved-indicator": "#009ac7",
    "--ms-resolved-on-indicator": "#000000",
    "--ms-resolved-danger-text": "#eb9891",
  },
};

export const RESOLVED_NAMES = Object.keys(D1_RESOLVED.light);

export const themeStyle = (theme: ThemeName, d1 = false): string =>
  Object.entries({ ...HA_THEMES[theme], ...(d1 ? D1_RESOLVED[theme] : {}) }).map(([name, value]) => `${name}:${value}`).join(";");
