import { css, html, nothing } from "lit";
import type { AreaOutline, AreaPoint } from "./area-outline";
import type { AreaCircle } from "./backend-contracts";
import type { CoordinateEditCapture, WorkspaceIntent, WorkspaceState } from "./contracts";
import { translate } from "./localize";
import type { MaticMapCanvasV4 } from "./map-canvas";
import type { RendererController } from "./renderer-controller";
import { captureCoordinateEdit, hasCoordinateEditAdmission } from "./state";

/**
 * Outline checks loaded alongside the editor and passed in by the shell.
 * The backend's deferred area decoder shares the same geometry module.
 */
export type OutlineGeometry = Pick<typeof import("./area-outline"), "edgeDistance" | "validOutline">;

export const insideOutline = (p: AreaPoint, points: readonly AreaPoint[]): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/** Use only the already verified circle command. All preview circles are
 * inscribed; rounding may shrink them but must never expand past the outline.
 * A bounded grid keeps editing independent of polygon size or input density. */
export const outlineCircles = (
  { edgeDistance, validOutline }: OutlineGeometry,
  outline: AreaOutline,
  contains: (point: AreaPoint) => boolean,
): AreaCircle[] => {
  if (!outline.closed || !validOutline(outline)) return [];
  const { points } = outline;
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const candidates: AreaCircle[] = [];
  for (let row = 0; row < 32; row++) for (let column = 0; column < 32; column++) {
    const p = { x: Math.round((minX + (column + .5) * (maxX - minX) / 32) * 10000) / 10000,
      y: Math.round((minY + (row + .5) * (maxY - minY) / 32) * 10000) / 10000 };
    if (!insideOutline(p, points) || !contains(p)) continue;
    const clearance = Math.min(...points.map((a, i) => edgeDistance(p, a, points[(i + 1) % points.length]!)));
    const radius = Math.floor(Math.min(2.5, clearance - .0001) * 10000) / 10000;
    if (radius >= .05) candidates.push({ ...p, radius });
  }
  candidates.sort((a, b) => b.radius - a.radius);
  const circles: AreaCircle[] = [];
  for (const circle of candidates) {
    if (circles.length >= 512) break;
    if (!circles.some((other) => Math.hypot(other.x - circle.x, other.y - circle.y) + circle.radius * .5 <= other.radius)) circles.push(circle);
  }
  return circles;
};

/** Perimeter handles own only their pointer gesture. Map navigation, draft
 * history and persistence remain in the existing controllers. The shell builds
 * the editor; the canvas showing it attaches before it renders or forwards a
 * point. */
// The map canvas adopts drawing styles when the editor arrives.
const drawCanvasStyles = css`
    .map-root[data-workflow="draw"][data-draw-tool="paint"],
    .map-root[data-workflow="draw"][data-draw-tool="erase"] { cursor: crosshair; }
    .map-root[data-workflow="draw"][data-draw-tool="pan"] { cursor: grab; }
    .map-root[data-workflow="draw"][data-draw-tool="pan"].navigating { cursor: grabbing; }
    .map-dock .draw-tools button { padding-inline: var(--ms-space-2); }
    .map-root[data-draw-tool="outline"] .map-scale { inset-block-end: auto; inset-block-start: 76px; }
    .keyboard-aim { display: none; position: absolute; z-index: 3; inset: 50% auto auto 50%; inline-size: 20px; block-size: 20px; translate: -50% -50%; border: 2px solid #fff; outline: 2px solid #111; border-radius: 50%; pointer-events: none; }
    .keyboard-aim::after { content: "+"; position: absolute; inset: 50% auto auto 50%; translate: -50% -50%; color: #111; font: 700 20px/1 sans-serif; text-shadow: 0 0 2px white; }
    .map-root:focus-visible .keyboard-aim { display: block; }
    @container (max-width: 49rem) {
      .map-dock .draw-tools button { padding-inline: 0; inline-size: var(--ms-control); }
      .map-dock .draw-tools .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
    }
    .zone-overlay { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; }
    .zone-overlay svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .zone-overlay path { stroke: var(--ms-resolved-indicator, var(--ms-accent)); stroke-width: 2; fill-opacity: .08; }
    .zone-overlay path.invalid { stroke: var(--error-color, #b3261e); }
    .zone-point { position: absolute; translate: -50% -50%; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: var(--ms-accent); pointer-events: auto; touch-action: none; cursor: grab; font: 700 12px system-ui; isolation: isolate; }
    .zone-point::before { content: ""; position: absolute; inset: 10px; z-index: -1; border-radius: 50%; background: var(--ms-surface-card); border: 2px solid var(--ms-resolved-indicator, var(--ms-accent)); box-shadow: 0 1px 4px #0008; }
    .zone-point[data-selected="true"] { color: var(--ms-on-accent); }
    .zone-point[data-selected="true"]::before { background: var(--ms-accent); border-color: var(--ms-surface-card); }
    .zone-point:focus-visible { outline: 3px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: 0; }
    .zone-midpoint { font-size: 18px; }
    .zone-midpoint::before { inset: 13px; background: var(--ms-surface-card); }
    .zone-midpoint { color: var(--ms-accent); }
    .zone-help { position: absolute; inset: auto auto 88px 50%; translate: -50% 0; width: max-content; max-width: calc(100% - 24px); display: grid; justify-items: center; gap: 6px; font-size: 12px; pointer-events: none; }
    .zone-point-actions { display: flex; align-items: center; gap: 4px; max-width: 100%; padding: 4px; border-radius: 14px; pointer-events: auto; }
    .zone-selection { padding-inline: 8px; color: var(--ms-text-quiet); white-space: nowrap; font-weight: 650; }
    .zone-point-actions .ms-btn { white-space: nowrap; padding-inline: 10px; border-radius: 10px; font-size: 12px; }
    .zone-point-actions .ms-btn + .ms-btn { border-inline-start: 1px solid var(--ms-line); }
    .zone-coordinates { display: grid; grid-template-columns: repeat(2, minmax(7rem, 1fr)); gap: 8px; max-width: min(100%, 24rem); padding: 8px; border-radius: 12px; pointer-events: auto; }
    .zone-coordinates label { display: grid; gap: 4px; min-width: 0; font-size: 12px; }
    .zone-coordinates input { min-width: 0; min-height: 44px; padding: 6px 8px; border: 1px solid var(--ms-line); border-radius: 8px; color: var(--ms-text); background: var(--ms-surface-card); font: inherit; }
    .zone-coordinates input:focus-visible { outline: 2px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: 1px; }
    .zone-feedback { max-width: 100%; padding: 8px 12px; border-radius: 12px; color: var(--ms-resolved-danger-text, var(--ms-danger)); pointer-events: auto; }
    .zone-feedback[hidden] { display: none; }
    /* On phones the drawing tools are in the sheet below the scene. */
    .map-root[data-narrow="true"] .zone-help { bottom: 12px; }
`;

export class OutlineEditor {
  readonly styles = drawCanvasStyles;
  readonly #geometry: OutlineGeometry;
  #canvas!: MaticMapCanvasV4;
  #renderer!: () => RendererController | null;
  #intent!: (intent: WorkspaceIntent) => void;
  #drag: {
    index: number;
    pointer: number;
    baseline: AreaOutline;
    preview: AreaOutline;
    target: HTMLElement;
    capture: CoordinateEditCapture;
  } | null = null;
  #message = "";
  #selected: number | null = null;
  constructor(geometry: OutlineGeometry) {
    this.#geometry = geometry;
  }

  attach(
    canvas: MaticMapCanvasV4,
    renderer: () => RendererController | null,
    intent: (intent: WorkspaceIntent) => void,
  ): void {
    this.#canvas = canvas;
    this.#renderer = renderer;
    this.#intent = intent;
  }

  #t(key: string, fallback: string, placeholders?: Readonly<Record<string, string | number>>): string {
    return translate(this.#canvas.localize, key, fallback, placeholders);
  }

  #focusPoint(index: number): void {
    void this.#canvas.updateComplete.then(() => {
      const root = this.#canvas.renderRoot;
      (root.querySelector<HTMLElement>(`[data-zone-index="${index}"]`) ?? root.querySelector<HTMLElement>(".map-root"))
        ?.focus({ preventScroll: true });
    });
  }

  #enabled(s = this.#canvas.state): boolean {
    return this.#canvas.drawingReady && captureCoordinateEdit(s, "outline") !== null;
  }

  #commit(outline: AreaOutline, capture?: CoordinateEditCapture): void {
    const admitted = capture ?? captureCoordinateEdit(this.#canvas.state, "outline");
    if (!this.#canvas.drawingReady || !hasCoordinateEditAdmission(this.#canvas.state, admitted)) return;
    if (!this.#geometry.validOutline(outline)) {
      this.#message = this.#t("v4_zone_invalid", "Keep the outline from crossing itself.");
      this.#canvas.requestUpdate();
      return;
    }
    const circles = outlineCircles(this.#geometry, outline, (p) => this.#renderer()?.containsMapPoint(p) ?? false);
    // Keep a small but valid outline editable so the next point can widen it.
    // Saving remains disabled until it contains verified cleaning coverage.
    this.#message = outline.closed && !circles.length
      ? this.#t("v4_zone_empty", "Make the outline wider and keep it on the mapped floor.") : "";
    this.#intent({ type: "set-draft-circles", circles, outline, coordinateEdit: admitted });
  }

  addPoint(point: AreaPoint, capture?: CoordinateEditCapture): void {
    const admitted = capture ?? captureCoordinateEdit(this.#canvas.state, "outline");
    if (!this.#canvas.drawingReady || !hasCoordinateEditAdmission(this.#canvas.state, admitted)
      || admitted.tool !== "outline" || !this.#renderer()?.containsMapPoint(point)) return;
    const outline = this.#canvas.state.draw.outline ?? { points: [], closed: false };
    if (outline.points.length >= 64) return;
    const points = [...outline.points, point];
    this.#commit({ points, closed: points.length >= 3 }, admitted);
  }

  #remove(index: number): void {
    const outline = this.#canvas.state.draw.outline;
    if (!outline) return;
    this.#selected = null;
    const points = outline.points.filter((_, i) => i !== index);
    this.#commit({ points, closed: outline.closed && points.length >= 3 });
    this.#focusPoint(Math.min(index, points.length - 1));
  }

  #insert(index: number): void {
    const outline = this.#canvas.state.draw.outline;
    if (!outline || outline.points.length >= 64) return;
    const a = outline.points[index], b = outline.points[(index + 1) % outline.points.length];
    if (!a || !b || (!outline.closed && index === outline.points.length - 1)) return;
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.#commit({ ...outline, points: [...outline.points.slice(0, index + 1), midpoint, ...outline.points.slice(index + 1)] });
    this.#focusPoint(index + 1);
  }

  #setCoordinate(index: number, axis: "x" | "y", value: number): void {
    const outline = this.#canvas.state.draw.outline;
    const admitted = captureCoordinateEdit(this.#canvas.state, "outline");
    const point = outline?.points[index];
    if (!this.#canvas.drawingReady || !outline || !point || !hasCoordinateEditAdmission(this.#canvas.state, admitted)) return;
    if (!Number.isFinite(value)) {
      this.#message = this.#t("v4_zone_coordinate_invalid", "Enter a map coordinate in meters.");
      this.#canvas.requestUpdate();
      return;
    }
    const next = { ...point, [axis]: value };
    if (!this.#renderer()?.containsMapPoint(next)) {
      this.#message = this.#t("v4_zone_coordinate_outside", "Keep the point on the mapped floor.");
      this.#canvas.requestUpdate();
      return;
    }
    this.#commit({ ...outline, points: outline.points.map((candidate, i) => i === index ? next : candidate) }, admitted);
  }

  #down(event: PointerEvent, index: number): void {
    if (!this.#canvas.drawingReady || event.button !== 0 || this.#drag || (event.pointerType === "touch" && !event.isPrimary)) return;
    const capture = captureCoordinateEdit(this.#canvas.state, "outline");
    if (!capture) return;
    this.#selected = index;
    this.#canvas.requestUpdate();
    const baseline = this.#canvas.state.draw.outline;
    if (!baseline) return;
    event.stopPropagation(); event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    this.#drag = { index, pointer: event.pointerId, baseline, preview: baseline, target, capture };
  }

  observeState(state: WorkspaceState): void {
    if (this.#drag && !hasCoordinateEditAdmission(state, this.#drag.capture)) this.cancel();
  }

  #move(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation(); event.preventDefault();
    if (!this.#canvas.drawingReady || !hasCoordinateEditAdmission(this.#canvas.state, drag.capture)) { this.cancel(); return; }
    const point = this.#renderer()?.screenToMap(event.clientX, event.clientY);
    if (!point || !this.#renderer()?.containsMapPoint(point)) return;
    drag.preview = { ...drag.baseline, points: drag.baseline.points.map((p, i) => i === drag.index ? point : p) };
    this.#canvas.requestUpdate();
  }

  #up(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation(); event.preventDefault();
    this.#drag = null;
    drag.target.releasePointerCapture(event.pointerId);
    if (this.#canvas.drawingReady && drag.preview !== drag.baseline) this.#commit(drag.preview, drag.capture);
    this.#canvas.requestUpdate();
  }

  cancel(): void {
    const drag = this.#drag;
    if (!drag) return;
    this.#drag = null;
    if (drag.target.hasPointerCapture(drag.pointer)) drag.target.releasePointerCapture(drag.pointer);
    this.#canvas.requestUpdate();
  }

  #key(event: KeyboardEvent, index: number): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Escape") { event.stopPropagation(); this.cancel(); return; }
    const outline = this.#canvas.state.draw.outline;
    if (!outline || !this.#enabled()) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault(); event.stopPropagation(); this.#remove(index); return;
    }
    const delta = event.shiftKey ? .1 : .02;
    const dx = event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
    const dy = event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
    if (!dx && !dy) return;
    event.preventDefault(); event.stopPropagation();
    const p = outline.points[index]!;
    const point = this.#renderer()?.offsetMapPoint(p, dx, dy);
    if (point && this.#renderer()?.containsMapPoint(point)) this.#commit({ ...outline, points: outline.points.map((p, i) => i === index ? point : p) });
  }

  render() {
    if (!this.#enabled()) return nothing;
    const outline = this.#drag?.preview ?? this.#canvas.state.draw.outline;
    const points = outline?.points ?? [];
    const projected = points.map((p) => this.#renderer()?.mapToScreen(p));
    const path = projected.map((p, i) => p ? `${i ? "L" : "M"}${p.x},${p.y}` : "").join(" ");
    const valid = !outline || this.#geometry.validOutline(outline);
    const selected = this.#selected !== null && this.#selected < points.length ? this.#selected : null;
    return html`
      <div class="zone-overlay">
        <svg aria-hidden="true"><path d=${path + (outline?.closed ? " Z" : "")} class=${valid ? "" : "invalid"} fill=${outline?.closed ? "var(--ms-accent)" : "none"}></path></svg>
        ${projected.map((p, i) => p ? html`
          <button class="zone-point" type="button" data-zone-index=${i} data-selected=${String(this.#selected === i)} data-map-control style=${`left:${p.x}px;top:${p.y}px`}
            aria-label=${this.#t("v4_zone_point_number", "Point {number}", { number: i + 1 })} aria-describedby="zone-handle-help"
            title=${this.#t("v4_zone_point_help", "Drag or edit the X and Y fields to move. Arrow keys adjust; Delete removes.")}
            @pointerdown=${(e: PointerEvent) => this.#down(e, i)} @pointermove=${(e: PointerEvent) => this.#move(e)}
            @pointerup=${(e: PointerEvent) => this.#up(e)} @pointercancel=${() => this.cancel()}
            @lostpointercapture=${() => { if (this.#drag) this.cancel(); }}
            @focus=${() => { this.#selected = i; this.#canvas.requestUpdate(); }}
            @keydown=${(e: KeyboardEvent) => this.#key(e, i)}
          >${i + 1}</button>
        ` : nothing)}
        ${points.map((a, i) => {
          const b = points[(i + 1) % points.length];
          if (!b || (!outline?.closed && i === points.length - 1) || points.length >= 64) return nothing;
          const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const p = this.#renderer()?.mapToScreen(midpoint);
          const start = projected[i], end = projected[(i + 1) % projected.length];
          return p && start && end && Math.hypot(start.x - end.x, start.y - end.y) >= 100 ? html`<button class="zone-point zone-midpoint" type="button" data-map-control
            style=${`left:${p.x}px;top:${p.y}px`} aria-label=${this.#t("v4_zone_add_point_after", "Add point after {number}", { number: i + 1 })}
            @click=${() => this.#insert(i)}>+</button>` : nothing;
        })}
        <div class="zone-help" data-map-control>
          <span id="zone-handle-help" class="sr-only">${this.#t("v4_zone_point_help", "Drag or edit the X and Y fields to move. Arrow keys adjust; Delete removes.")}</span>
          ${selected !== null ? html`
            <div class="zone-point-actions ms-surface" role="group" aria-label=${this.#t("v4_zone_point_number", "Point {number}", { number: selected + 1 })}>
              <span class="zone-selection">${this.#t("v4_zone_point_number", "Point {number}", { number: selected + 1 })}</span>
              <button class="ms-btn" type="button" ?disabled=${points.length >= 64 || (!outline?.closed && selected === points.length - 1)} @click=${() => this.#insert(selected)}>${this.#t("v4_zone_insert_point", "Insert point")}</button>
              <button class="ms-btn" type="button" aria-label=${this.#t("v4_zone_delete_point_number", "Delete point {number}", { number: selected + 1 })} @click=${() => this.#remove(selected)}>${this.#t("v4_zone_delete_point", "Delete point")}</button>
            </div>` : nothing}
          ${selected !== null && points[selected] ? html`
            <div class="zone-coordinates ms-surface" role="group" aria-label=${this.#t("v4_zone_coordinates_group", "Point coordinates in meters")}>
              <label>${this.#t("v4_zone_coordinate_x", "X coordinate (m)")}
                <input type="number" inputmode="decimal" step="0.01" .value=${String(points[selected]!.x)}
                  aria-label=${this.#t("v4_zone_coordinate_x_named", "X coordinate for point {number} in meters", { number: selected + 1 })}
                  @change=${(event: Event) => this.#setCoordinate(selected, "x", (event.currentTarget as HTMLInputElement).valueAsNumber)}>
              </label>
              <label>${this.#t("v4_zone_coordinate_y", "Y coordinate (m)")}
                <input type="number" inputmode="decimal" step="0.01" .value=${String(points[selected]!.y)}
                  aria-label=${this.#t("v4_zone_coordinate_y_named", "Y coordinate for point {number} in meters", { number: selected + 1 })}
                  @change=${(event: Event) => this.#setCoordinate(selected, "y", (event.currentTarget as HTMLInputElement).valueAsNumber)}>
              </label>
            </div>` : nothing}
          <span class="zone-feedback ms-surface" role="status" ?hidden=${!this.#message}>${this.#message}</span>
        </div>
      </div>
    `;
  }
}
