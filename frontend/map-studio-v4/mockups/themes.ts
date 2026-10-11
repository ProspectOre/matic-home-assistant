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

export const themeStyle = (theme: ThemeName): string =>
  Object.entries(HA_THEMES[theme]).map(([name, value]) => `${name}:${value}`).join(";");
