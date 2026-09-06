import { html, nothing } from "lit";
import type { AreaOutline, AreaPoint } from "./area-outline";
import { outlineCircles, validOutline } from "./area-outline";
import type { WorkspaceIntent, WorkspaceState } from "./contracts";
import type { RendererController } from "./renderer-controller";
import { canEditCoordinates } from "./state";

/** Perimeter handles own only their pointer gesture. Map navigation, draft
 * history and persistence remain in the existing controllers. */
export class OutlineEditor {
  #drag: { index: number; pointer: number; baseline: AreaOutline; preview: AreaOutline; target: HTMLElement } | null = null;
  #message = "";
  #selected: number | null = null;
  constructor(
    private readonly state: () => WorkspaceState,
    private readonly renderer: () => RendererController | null,
    private readonly intent: (intent: WorkspaceIntent) => void,
    private readonly update: () => void,
    private readonly t: (key: string, fallback: string) => string,
    private readonly focusPoint: (index: number) => void,
  ) {}

  #enabled(): boolean {
    const s = this.state();
    return !s.dialog && s.workflow === "draw" && s.draw.tool === "outline" && canEditCoordinates(s)
      && (s.command === "idle" || s.command === "failed");
  }

  #commit(outline: AreaOutline): void {
    if (!this.#enabled()) return;
    if (!validOutline(outline)) {
      this.#message = this.t("v4_zone_invalid", "Keep the outline from crossing itself.");
      this.update();
      return;
    }
    const circles = outlineCircles(outline, (p) => this.renderer()?.containsMapPoint(p) ?? false);
    if (outline.closed && !circles.length) {
      this.#message = this.t("v4_zone_empty", "Make the zone wider and keep it on mapped floor.");
      this.update();
      return;
    }
    this.#message = "";
    this.intent({ type: "set-draft-circles", circles, outline });
  }

  addPoint(point: AreaPoint): void {
    if (!this.#enabled() || !this.renderer()?.containsMapPoint(point)) return;
    const outline = this.state().draw.outline ?? { points: [], closed: false };
    if (outline.closed || outline.points.length >= 64) return;
    this.#commit({ points: [...outline.points, point], closed: false });
  }

  #close(): void {
    const outline = this.state().draw.outline;
    if (outline && outline.points.length >= 3) this.#commit({ ...outline, closed: true });
  }

  #remove(index: number): void {
    const outline = this.state().draw.outline;
    if (!outline) return;
    this.#selected = null;
    const points = outline.points.filter((_, i) => i !== index);
    this.#commit({ points, closed: outline.closed && points.length >= 3 });
    this.focusPoint(Math.min(index, points.length - 1));
  }

  #insert(index: number): void {
    const outline = this.state().draw.outline;
    if (!outline || outline.points.length >= 64) return;
    const a = outline.points[index], b = outline.points[(index + 1) % outline.points.length];
    if (!a || !b || (!outline.closed && index === outline.points.length - 1)) return;
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.#commit({ ...outline, points: [...outline.points.slice(0, index + 1), midpoint, ...outline.points.slice(index + 1)] });
    this.focusPoint(index + 1);
  }

  #down(event: PointerEvent, index: number): void {
    if (!this.#enabled() || event.button !== 0 || this.#drag || (event.pointerType === "touch" && !event.isPrimary)) return;
    this.#selected = index;
    this.update();
    const baseline = this.state().draw.outline;
    if (!baseline) return;
    event.stopPropagation(); event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    this.#drag = { index, pointer: event.pointerId, baseline, preview: baseline, target };
  }

  #move(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation(); event.preventDefault();
    if (!this.#enabled() || this.state().draw.outline !== drag.baseline) { this.cancel(); return; }
    const point = this.renderer()?.screenToMap(event.clientX, event.clientY);
    if (!point || !this.renderer()?.containsMapPoint(point)) return;
    drag.preview = { ...drag.baseline, points: drag.baseline.points.map((p, i) => i === drag.index ? point : p) };
    this.update();
  }

  #up(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation(); event.preventDefault();
    this.#drag = null;
    drag.target.releasePointerCapture(event.pointerId);
    if (this.state().draw.outline === drag.baseline && this.#enabled()) {
      if (drag.preview !== drag.baseline) this.#commit(drag.preview);
      else if (drag.index === 0 && !drag.baseline.closed) this.#close();
    }
    this.update();
  }

  cancel(): void {
    const drag = this.#drag;
    if (!drag) return;
    this.#drag = null;
    if (drag.target.hasPointerCapture(drag.pointer)) drag.target.releasePointerCapture(drag.pointer);
    this.update();
  }

  #key(event: KeyboardEvent, index: number): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Escape") { event.stopPropagation(); this.cancel(); return; }
    const outline = this.state().draw.outline;
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
    const point = this.renderer()?.offsetMapPoint(p, dx, dy);
    if (point && this.renderer()?.containsMapPoint(point)) this.#commit({ ...outline, points: outline.points.map((p, i) => i === index ? point : p) });
  }

  render() {
    if (!this.#enabled()) return nothing;
    const outline = this.#drag?.preview ?? this.state().draw.outline;
    const points = outline?.points ?? [];
    const projected = points.map((p) => this.renderer()?.mapToScreen(p));
    const path = projected.map((p, i) => p ? `${i ? "L" : "M"}${p.x},${p.y}` : "").join(" ");
    const valid = !outline || validOutline(outline);
    return html`
      <div class="zone-overlay">
        <svg aria-hidden="true"><path d=${path + (outline?.closed ? " Z" : "")} class=${valid ? "" : "invalid"} fill=${outline?.closed ? "var(--ms-accent)" : "none"}></path></svg>
        ${projected.map((p, i) => p ? html`
          <button class="zone-point" type="button" data-zone-index=${i} data-selected=${String(this.#selected === i)} data-map-control style=${`left:${p.x}px;top:${p.y}px`}
            aria-label=${`${this.t("v4_zone_point", "Zone point")} ${i + 1}`} aria-describedby="zone-handle-help"
            title=${this.t("v4_zone_point_help", "Drag to move. Arrow keys adjust; Delete removes.")}
            @pointerdown=${(e: PointerEvent) => this.#down(e, i)} @pointermove=${(e: PointerEvent) => this.#move(e)}
            @pointerup=${(e: PointerEvent) => this.#up(e)} @pointercancel=${() => this.cancel()}
            @lostpointercapture=${() => { if (this.#drag) this.cancel(); }}
            @focus=${() => { this.#selected = i; this.update(); }}
            @keydown=${(e: KeyboardEvent) => this.#key(e, i)}
            @click=${(e: MouseEvent) => { if (e.detail === 0 && i === 0 && !outline?.closed) this.#close(); }}
          >${i + 1}</button>
        ` : nothing)}
        ${points.map((a, i) => {
          const b = points[(i + 1) % points.length];
          if (!b || (!outline?.closed && i === points.length - 1) || points.length >= 64) return nothing;
          const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const p = this.renderer()?.mapToScreen(midpoint);
          const start = projected[i], end = projected[(i + 1) % projected.length];
          return p && start && end && Math.hypot(start.x - end.x, start.y - end.y) >= 100 ? html`<button class="zone-point zone-midpoint" type="button" data-map-control
            style=${`left:${p.x}px;top:${p.y}px`} aria-label=${`${this.t("v4_zone_add_point", "Add point after")} ${i + 1}`}
            @click=${() => this.#insert(i)}>+</button>` : nothing;
        })}
        <div class="zone-help ms-surface" data-map-control>
          <span id="zone-handle-help" class="sr-only">${this.t("v4_zone_point_help", "Drag to move. Arrow keys adjust; Delete removes.")}</span>
          <span>${outline?.closed ? this.t("v4_zone_edit_help", "Drag points to reshape. + adds a point.") : this.t("v4_zone_create_help", "Place points. Select the first to close.")}</span>
          ${points.length >= 3 && !outline?.closed ? html`<button class="ms-btn" type="button" @click=${() => this.#close()}>${this.t("v4_zone_close", "Close zone")}</button>` : nothing}
          ${this.#selected !== null && this.#selected < points.length ? html`
            ${points.length < 64 && (outline?.closed || this.#selected < points.length - 1) ? html`<button class="ms-btn" type="button" @click=${() => this.#insert(this.#selected!)}>${this.t("v4_zone_insert_point", "Insert point")}</button>` : nothing}
            <button class="ms-btn" type="button" @click=${() => this.#remove(this.#selected!)}>${this.t("v4_zone_delete_point", "Delete point")} ${this.#selected + 1}</button>` : nothing}
          <span role="status">${this.#message}</span>
        </div>
      </div>
    `;
  }
}
