import { html, nothing } from "lit";
import type { SceneModel } from "./backend-contracts";
import type { NoticePlaceholders, WifiSignalLayer } from "./contracts";
import type { MapPoint } from "./renderer-camera";
import { WIFI_BANDS, wifiBand, type WifiBand } from "./wifi-scale";
import { wifiReadingAt, type WifiReading } from "./wifi-surface";

type Translate = (key: string, fallback: string, placeholders?: NoticePlaceholders) => string;

export interface WifiLegendContext {
  readonly layer: WifiSignalLayer;
  readonly scene: SceneModel;
  /** The map point the user last tapped, if any. */
  readonly spot: MapPoint | null;
  readonly locale: string;
  readonly t: Translate;
}

const bandName = (band: WifiBand, t: Translate): string => ({
  strong: t("v4_wifi_band_strong", "Strong"),
  good: t("v4_wifi_band_good", "Good"),
  weak: t("v4_wifi_band_weak", "Weak"),
  dead: t("v4_wifi_band_dead", "Dead zone"),
})[band];

const bandRange = (index: number, t: Translate): string => {
  const { from } = WIFI_BANDS[index]!;
  const above = WIFI_BANDS[index - 1]?.from;
  if (above === undefined) return t("v4_wifi_band_from", "{dbm} dBm and up", { dbm: from });
  if (from === -Infinity) return t("v4_wifi_band_below", "Below {dbm} dBm", { dbm: above });
  return t("v4_wifi_band_between", "{low} to {high} dBm", { low: from, high: above - 1 });
};

const age = (seconds: number, locale: string): string => {
  const elapsed = Math.max(0, Date.now() / 1000 - seconds);
  const [value, unit] = elapsed < 3600 ? [elapsed / 60, "minute"] as const
    : elapsed < 86_400 ? [elapsed / 3600, "hour"] as const : [elapsed / 86_400, "day"] as const;
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.round(value), unit);
};

// The reading under the last tap, kept while the layer and spot are unchanged.
let cached: { readonly layer: WifiSignalLayer; readonly spot: MapPoint; readonly reading: WifiReading | null } | null = null;

/**
 * The Wi-Fi legend on the map: the four bands, the weakest room, the reading
 * under the last tap and every room's summary. map-layers.ts places it.
 */
export const wifiLegend = ({ layer, scene, spot, locale, t }: WifiLegendContext) => {
  if (!layer.cells.length) return nothing;
  const dbm = (value: number): string => t("v4_wifi_dbm", "{dbm} dBm", { dbm: Math.round(value) });
  const band = (value: number) => {
    const { band: name } = wifiBand(value);
    return html`<span class="wifi-band" data-band=${name}>${bandName(name, t)}</span>`;
  };
  if (spot && (cached?.layer !== layer || cached.spot !== spot)) {
    cached = { layer, spot, reading: wifiReadingAt(layer.cells, scene.metadata, spot, Date.now() / 1000) };
  }
  const reading = spot ? cached!.reading : null;
  const [weakest] = layer.rooms;
  const count = reading?.samples ?? 0;
  return html`
    <style>
      .wifi-legend { inline-size: 100%; padding: var(--ms-space-2) var(--ms-space-3); font-size: var(--ms-t-sm); }
      .wifi-legend:not([open]) { inline-size: fit-content; }
      .wifi-legend > * + * { margin-block-start: var(--ms-space-2); }
      .wifi-legend > summary + * { margin-block-start: var(--ms-space-1); }
      .wifi-legend :is(p, ul, table) { margin-inline: 0; margin-block-end: 0; }
      .wifi-legend > summary { font-weight: var(--ms-w-bold); cursor: pointer; }
      .wifi-bands { display: grid; grid-template-columns: 1.25rem 1fr auto; align-items: center; gap: 0.125rem var(--ms-space-2); padding: 0; list-style: none; }
      .wifi-bands li { display: contents; }
      .wifi-bands small, .wifi-quiet { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
      .wifi-swatch { block-size: 0.625rem; border-radius: 0.25rem; background: var(--swatch); }
      .wifi-swatch[data-band=dead] { outline: 1.5px solid var(--ms-text); outline-offset: -1.5px; }
      .wifi-row { display: flex; flex-wrap: wrap; gap: 0 var(--ms-space-2); }
      .wifi-row > :first-child { flex-basis: 100%; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
      .wifi-band { font-weight: var(--ms-w-bold); }
      .wifi-legend table { inline-size: 100%; border-collapse: collapse; }
      .wifi-legend td { padding-block: 0.125rem; }
      .wifi-legend td + td { text-align: end; white-space: nowrap; padding-inline-start: var(--ms-space-2); }
      @media (forced-colors: active) { .wifi-swatch { forced-color-adjust: none; } }
    </style>
    <details class="wifi-legend ms-surface ms-surface--floating" open>
      <summary>${t("v4_wifi_signal", "Wi-Fi signal")}</summary>
      <ul class="wifi-bands">${WIFI_BANDS.map(({ band: name, colour }, index) => html`
        <li><span class="wifi-swatch" data-band=${name} style=${`--swatch: rgb(${colour.join(" ")})`}></span>
          <span>${bandName(name, t)}</span><small>${bandRange(index, t)}</small></li>`)}
      </ul>
      ${weakest ? html`<p class="wifi-row" data-weakest-room><span>${t("v4_wifi_weakest_room", "Weakest room")}</span>
        <bdi>${weakest.name}</bdi><span>${dbm(weakest.dbm)}</span>${band(weakest.dbm)}</p>` : nothing}
      <p class="wifi-row" data-wifi-spot aria-live="polite">${!spot
        ? html`<span class="wifi-quiet">${t("v4_wifi_tap_hint", "Tap or click a spot on the map to read it.")}</span>`
        : reading ? html`<span>${t("v4_wifi_spot", "Selected spot")}</span><span>${dbm(reading.dbm)}</span>${band(reading.dbm)}
          <span class="wifi-quiet">${count === 1 ? t("v4_wifi_readings_one", "{count} reading", { count })
            : t("v4_wifi_readings_other", "{count} readings", { count })}</span>
          <span class="wifi-quiet">${age(reading.updatedAt, locale)}</span>`
        : html`<span class="wifi-quiet">${t("v4_wifi_spot_empty", "No readings near this spot.")}</span>`}</p>
      ${layer.rooms.length > 1 ? html`<details>
        <summary>${t("v4_wifi_every_room", "Every room")}</summary>
        <table>${layer.rooms.map((room) => html`<tr><td><bdi>${room.name}</bdi></td><td>${dbm(room.dbm)}</td><td>${band(room.dbm)}</td></tr>`)}</table>
      </details>` : nothing}
    </details>
  `;
};
