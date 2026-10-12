// Resolves CSS colours into numeric channels: the design tokens for canvas
// drawing, and Home Assistant's theme colours for the contrast resolver.
//
// Canvas 2D cannot read `var(--ms-accent)`, so a hidden probe span is coloured
// with each token and its computed colour read back as a canvas pixel. Under
// forced colours the system palette is probed instead so the overlay follows
// the OS theme.

export type Channel = readonly [number, number, number];
export type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

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

// The accent strokes the selected room, so it is the resolved indicator
// (design-system.md §7).
const SOURCES: Readonly<Record<PaletteKey, readonly [color: string, forced: string, fallback: Channel]>> = {
  accent: ["var(--ms-resolved-indicator, var(--ms-accent))", "Highlight", [6, 120, 206]],
  onAccent: ["var(--ms-on-accent)", "HighlightText", [255, 255, 255]],
  text: ["var(--ms-text)", "CanvasText", [38, 50, 56]],
  quiet: ["var(--ms-text-quiet)", "GrayText", [75, 92, 105]],
  plate: ["var(--ms-surface-card)", "Canvas", [250, 252, 253]],
  roomFill: ["var(--ms-surface-sunken)", "Canvas", [231, 238, 242]],
};

export const rgba = (channel: Channel, alpha: number): string =>
  `rgba(${channel[0]},${channel[1]},${channel[2]},${alpha})`;

// Each CSS colour as sRGB channels with its alpha (0-255), or null when it is
// unparsable or fully transparent (nothing is painted). CSS
// custom properties keep their authored syntax (for example `hsl()` or a
// named colour) when read directly, so each colour goes through the
// browser's colour parser on a probe inside `host`, which inherits the
// host's custom properties. The probe sets `background-color`, which is not
// inherited, so an unparsable value computes to transparent instead of the
// inherited text colour, and one pixel drawn on a canvas brings CSS Color 4
// values (oklch, display-p3) into sRGB.
export const readColors = <K extends string>(host: ParentNode, colors: Readonly<Record<K, string>>): Record<K, Rgba | null> => {
  const probe = document.createElement("span");
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
  // Not rendered, so it never shifts layout or reaches assistive tech; its
  // computed style still inherits the host's custom properties.
  probe.style.display = "none";
  host.append(probe);
  const read = (color: string): Rgba | null => {
    if (!context) return null;
    probe.style.backgroundColor = color;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "transparent";
    context.fillStyle = getComputedStyle(probe).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
    return alpha ? [red, green, blue, alpha] : null;
  };
  try {
    return Object.fromEntries(Object.entries<string>(colors).map(([key, color]) => [key, read(color)])) as Record<K, Rgba | null>;
  } finally {
    probe.remove();
  }
};

const rgb = ([red, green, blue]: Rgba): Channel => [red, green, blue];

// A colour with one contrast ratio: opaque, as sRGB channels, else null.
export const opaque = (color: Rgba | null): Channel | null => (color?.[3] === 255 ? rgb(color) : null);

// The canvas draws a translucent theme colour's RGB; only the contrast
// resolver needs it opaque.
export const readCanvasPalette = (host: HTMLElement): CanvasPalette => {
  const forced = window.matchMedia?.("(forced-colors: active)").matches ?? false;
  const keys = Object.keys(SOURCES) as PaletteKey[];
  const colors = readColors(host, Object.fromEntries(keys.map((key) => {
    const [color, system] = SOURCES[key];
    return [key, forced ? system : color];
  })) as Record<PaletteKey, string>);
  return {
    ...Object.fromEntries(keys.map((key) => [key, colors[key] ? rgb(colors[key]) : SOURCES[key][2]])) as Record<PaletteKey, Channel>,
    forced,
  };
};

// Calls `onChange` whenever the page theme may have changed: Home Assistant
// rewrites the document element's style or class, or the colour scheme or
// forced colours flip. Returns the function that stops watching. Callers
// run it from connectedCallback, so `document` and `matchMedia` exist: the
// panel only runs in browsers Home Assistant supports, which all have both.
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

// The first 5% step of `color` toward `toward`, from 100% down to 50%, that
// `passes`, or null.
const search = (color: Channel, toward: number, passes: (step: Channel) => boolean): Channel | null => {
  for (let weight = 100; weight >= 50; weight -= 5) {
    const step = color.map((value) => Math.round((value * weight + toward * (100 - weight)) / 100)) as unknown as Channel;
    if (passes(step)) return step;
  }
  return null;
};

// design-system.md §5 (MS-AXE-03): a fill keeps HA's colour and label when
// they reach 4.5:1. Otherwise the first 5% step of the fill toward black
// (toward white under a darker label), from 95% down to 50%, that reaches it
// wins; failing that the fill stays and the label is black or white,
// whichever contrasts more.
export const resolveFill = (fill: Channel, label: Channel): readonly [fill: Channel, label: Channel] => {
  const step = search(fill, luminance(label) < luminance(fill) ? 255 : 0, (candidate) => contrast(candidate, label) >= 4.5);
  return step ? [step, label] : [fill, contrast(fill, BLACK) > contrast(fill, WHITE) ? BLACK : WHITE];
};

// The indicator (3:1) and danger text (4.5:1) keep HA's colour when it
// reaches `ratio` on every surface; otherwise the same search runs toward
// black on a light first surface and white on a dark one, then toward the
// other end, and every step is checked on every surface. If no step reaches
// it, the end colour (black or white) whose lowest contrast across the
// surfaces is higher is used (the spec names no last step).
export const resolveTone = (color: Channel, ratio: number, surfaces: readonly [Channel, ...Channel[]]): Channel => {
  const passes = (step: Channel): boolean => surfaces.every((surface) => contrast(step, surface) >= ratio);
  const lowest = (tone: Channel): number => Math.min(...surfaces.map((surface) => contrast(tone, surface)));
  const [end, other] = contrast(surfaces[0], BLACK) > contrast(surfaces[0], WHITE) ? [BLACK, WHITE] : [WHITE, BLACK];
  return search(color, end[0], passes) ?? search(color, other[0], passes)
    ?? (lowest(BLACK) >= lowest(WHITE) ? BLACK : WHITE);
};
