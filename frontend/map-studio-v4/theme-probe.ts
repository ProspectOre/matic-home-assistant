// Resolves the CSS design tokens into numeric channels for canvas drawing.
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

export const readCanvasPalette = (host: HTMLElement): CanvasPalette => {
  const forced = window.matchMedia?.("(forced-colors: active)").matches ?? false;
  if (!forced) {
    // CSS custom properties preserve their authored syntax (for example
    // `hsl()` or a named colour) when read directly. Resolve each token through
    // the browser's colour parser before converting it to canvas channels.
    const probe = document.createElement("span");
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none";
    host.append(probe);
    const read = (key: PaletteKey): Channel => {
      const [token, , fallback] = SOURCES[key];
      probe.style.color = `var(${token}, transparent)`;
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
      return parseColor(serialized) ?? fallback;
    };
    try {
      return {
        accent: read("accent"),
        onAccent: read("onAccent"),
        text: read("text"),
        quiet: read("quiet"),
        plate: read("plate"),
        roomFill: read("roomFill"),
        forced,
      };
    } finally {
      probe.remove();
    }
  }
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none";
  host.append(probe);
  const read = (key: PaletteKey): Channel => {
    const [, system, fallback] = SOURCES[key];
    probe.style.color = system;
    return parseColor(getComputedStyle(probe).color) ?? fallback;
  };
  try {
    return {
      accent: read("accent"),
      onAccent: read("onAccent"),
      text: read("text"),
      quiet: read("quiet"),
      plate: read("plate"),
      roomFill: read("roomFill"),
      forced,
    };
  } finally {
    probe.remove();
  }
};
