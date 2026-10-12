// Resolves CSS colours into numeric channels: the design tokens for canvas
// drawing, and Home Assistant's theme colours for the contrast resolver.
//
// Canvas 2D cannot read `var(--ms-accent)`, so a hidden probe span is coloured
// with each token and its computed colour parsed back. Under forced colours
// the system palette is probed instead so the overlay follows the OS theme.

export type Channel = readonly [number, number, number];

export interface CanvasPalette {
  readonly accent: Channel;
  readonly onAccent: Channel;
  readonly text: Channel;
  readonly quiet: Channel;
  readonly plate: Channel;
  readonly roomFill: Channel;
  readonly forced: boolean;
}

type PaletteKey = Exclude<keyof CanvasPalette, "forced">;

const SOURCES: Readonly<Record<PaletteKey, readonly [token: string, forced: string, fallback: Channel]>> = {
  accent: ["--ms-accent", "Highlight", [6, 120, 206]],
  onAccent: ["--ms-on-accent", "HighlightText", [255, 255, 255]],
  text: ["--ms-text", "CanvasText", [38, 50, 56]],
  quiet: ["--ms-text-quiet", "GrayText", [75, 92, 105]],
  plate: ["--ms-surface-card", "Canvas", [250, 252, 253]],
  roomFill: ["--ms-surface-sunken", "Canvas", [231, 238, 242]],
};

const clampChannel = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)));

// Accepts `rgb(r, g, b)`, `rgba(r, g, b, a)`, `rgb(r g b / a)` and
// `color(srgb r g b / a)` (0..1 channels, scaled to 255).
export const parseColor = (value: string): Channel | null => {
  const normalized = value.trim();
  const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) {
    const channels = hex.length <= 4
      ? [hex[0], hex[1], hex[2]].map((part) => Number.parseInt(`${part}${part}`, 16))
      : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((part) => Number.parseInt(part, 16));
    const [r, g, b] = channels;
    return r === undefined || g === undefined || b === undefined ? null : [r, g, b];
  }
  const srgb = normalized.startsWith("color(srgb");
  const numbers = normalized.slice(normalized.indexOf("(") + 1).match(/-?\d*\.?\d+/g);
  if (!numbers || numbers.length < 3) return null;
  const scale = srgb ? 255 : 1;
  const channels = numbers.slice(0, 3).map((part) => clampChannel(Number(part) * scale));
  const [r, g, b] = channels;
  return r === undefined || g === undefined || b === undefined
    || [r, g, b].some((channel) => Number.isNaN(channel))
    ? null
    : [r, g, b];
};

export const rgba = (channel: Channel, alpha: number): string =>
  `rgba(${channel[0]},${channel[1]},${channel[2]},${alpha})`;

// Each CSS colour as sRGB channels, or null when it does not parse. CSS
// custom properties preserve their authored syntax (for example `hsl()` or a
// named colour) when read directly, so each colour goes through the
// browser's colour parser on a probe inside `host`, which inherits the
// host's custom properties.
export const readColors = <K extends string>(host: ParentNode, colors: Readonly<Record<K, string>>): Record<K, Channel | null> => {
  const probe = document.createElement("span");
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none";
  host.append(probe);
  const read = (color: string): Channel | null => {
    probe.style.color = color;
    const serialized = getComputedStyle(probe).color;
    if (context) {
      // Reading one pixel forces CSS Color 4 values (including oklch and
      // display-p3) through the canvas' sRGB backing store before parsing.
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "transparent";
      context.fillStyle = serialized;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      if (red !== undefined && green !== undefined && blue !== undefined && alpha !== undefined && alpha !== 0) {
        return [red, green, blue];
      }
    }
    return parseColor(serialized);
  };
  try {
    return Object.fromEntries(Object.entries<string>(colors).map(([key, color]) => [key, read(color)])) as Record<K, Channel | null>;
  } finally {
    probe.remove();
  }
};

export const readCanvasPalette = (host: HTMLElement): CanvasPalette => {
  const forced = window.matchMedia?.("(forced-colors: active)").matches ?? false;
  const keys = Object.keys(SOURCES) as PaletteKey[];
  const colors = readColors(host, Object.fromEntries(keys.map((key) => {
    const [token, system] = SOURCES[key];
    return [key, forced ? system : `var(${token}, transparent)`];
  })) as Record<PaletteKey, string>);
  return {
    ...Object.fromEntries(keys.map((key) => [key, colors[key] ?? SOURCES[key][2]])) as Record<PaletteKey, Channel>,
    forced,
  };
};

// Calls `onChange` whenever the page theme may have changed: Home Assistant
// rewrites the document element's style or class, or the colour scheme or
// forced colours flip. Returns the function that stops watching.
export const watchTheme = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  const queries = ["(prefers-color-scheme: dark)", "(forced-colors: active)"].map((query) => window.matchMedia(query));
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    for (const query of queries) query.removeEventListener("change", onChange);
  };
};

const linear = (value: number): number => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

const luminance = ([red, green, blue]: Channel): number =>
  0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);

// The WCAG 2 contrast ratio.
const contrast = (a: Channel, b: Channel): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const BLACK: Channel = [0, 0, 0];
const WHITE: Channel = [255, 255, 255];

// design-system.md §5 (MS-AXE-03): a fill keeps HA's colour and label when
// they reach 4.5:1. Otherwise the first 5% step of the fill toward black
// (toward white under a darker label), from 95% down to 50%, that reaches it
// wins; failing that the fill stays and the label is black or white,
// whichever contrasts more.
export const resolveFill = (fill: Channel, label: Channel): readonly [fill: Channel, label: Channel] => {
  const toward = luminance(label) < luminance(fill) ? 255 : 0;
  const [red, green, blue] = fill;
  for (let weight = 100; weight >= 50; weight -= 5) {
    const mix = (value: number): number => Math.round((value * weight + toward * (100 - weight)) / 100);
    const step: Channel = [mix(red), mix(green), mix(blue)];
    if (contrast(step, label) >= 4.5) return [step, label];
  }
  return [fill, contrast(fill, BLACK) > contrast(fill, WHITE) ? BLACK : WHITE];
};
