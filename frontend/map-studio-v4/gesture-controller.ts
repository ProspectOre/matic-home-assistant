import type { AreaCircle } from "./backend-contracts";
import type { WorkspaceState } from "./contracts";
import { RendererController, type MapPoint } from "./renderer-controller";

interface GestureCallbacks {
  readonly state: () => WorkspaceState;
  readonly onCircles: (
    circles: readonly AreaCircle[],
    record: boolean,
    previous?: readonly AreaCircle[],
  ) => void;
  readonly onRoom: (roomId: string) => void;
}

interface PointerRecord {
  readonly id: number;
  readonly type: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

const distance = (first: PointerRecord, second: PointerRecord): number =>
  Math.hypot(first.x - second.x, first.y - second.y);

const midpoint = (first: PointerRecord, second: PointerRecord): MapPoint => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
});

const cloneCircles = (circles: readonly AreaCircle[]): AreaCircle[] =>
  circles.map((circle) => ({ ...circle }));

const isInteractiveControl = (target: EventTarget | null): boolean =>
  target instanceof Element
  && Boolean(target.closest("button, input, select, textarea, a, [role='button'], [role='menuitem']"));

export class GestureController {
  readonly #host: HTMLElement;
  readonly #renderer: RendererController;
  readonly #callbacks: GestureCallbacks;
  readonly #pointers = new Map<number, PointerRecord>();
  #spacePressed = false;
  #mode: "idle" | "paint" | "erase" | "pan" | "orbit" | "pinch" = "idle";
  #baseline: AreaCircle[] = [];
  #draft: AreaCircle[] = [];
  #lastMapPoint: MapPoint | null = null;
  #pinchDistance = 0;
  #pinchCenter: MapPoint | null = null;
  #navigationUntilRelease = false;
  #touchArmTimer: number | null = null;
  #disposed = false;

  constructor(host: HTMLElement, renderer: RendererController, callbacks: GestureCallbacks) {
    this.#host = host;
    this.#renderer = renderer;
    this.#callbacks = callbacks;
    host.addEventListener("pointerdown", this.#pointerDown);
    host.addEventListener("pointermove", this.#pointerMove);
    host.addEventListener("pointerup", this.#pointerUp);
    host.addEventListener("pointercancel", this.#pointerUp);
    host.addEventListener("wheel", this.#wheel, { passive: false });
    host.addEventListener("keydown", this.#keyDown);
    host.addEventListener("keyup", this.#keyUp);
    host.addEventListener("blur", this.#blur);
  }

  readonly #pointerDown = (event: PointerEvent): void => {
    if (this.#disposed || !event.isPrimary && event.pointerType === "mouse") return;
    if (isInteractiveControl(event.target)) return;
    this.#host.focus({ preventScroll: true });
    const pointer: PointerRecord = {
      id: event.pointerId,
      type: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
    };
    this.#pointers.set(event.pointerId, pointer);
    this.#host.setPointerCapture?.(event.pointerId);
    if (this.#pointers.size >= 2) {
      this.#cancelTouchArm();
      if (this.#mode === "paint" || this.#mode === "erase") {
        this.#draft = cloneCircles(this.#baseline);
        this.#callbacks.onCircles(this.#draft, false);
      }
      this.#mode = "pinch";
      this.#navigationUntilRelease = true;
      const [first, second] = [...this.#pointers.values()];
      if (first && second) {
        this.#pinchDistance = Math.max(1, distance(first, second));
        this.#pinchCenter = midpoint(first, second);
      }
      event.preventDefault();
      return;
    }
    const state = this.#callbacks.state();
    const drawing = state.workflow === "draw" && state.map.available && !state.floor.readOnly;
    const navigation = this.#navigationUntilRelease
      || this.#spacePressed
      || event.button === 1
      || state.draw.tool === "pan";
    if (navigation) {
      this.#mode = "pan";
    } else if (drawing && (state.draw.tool === "paint" || state.draw.tool === "erase")) {
      this.#baseline = cloneCircles(state.draw.circles);
      this.#draft = cloneCircles(state.draw.circles);
      if (event.pointerType === "touch") {
        this.#mode = "idle";
        this.#touchArmTimer = window.setTimeout(() => {
          this.#touchArmTimer = null;
          if (this.#pointers.size !== 1 || this.#navigationUntilRelease) return;
          this.#mode = state.draw.tool;
          const current = this.#pointers.get(event.pointerId);
          if (current) this.#applyBrush(current.x, current.y);
        }, 110);
      } else {
        this.#mode = state.draw.tool;
        this.#applyBrush(event.clientX, event.clientY);
      }
    } else {
      this.#mode = state.view === "three" && !event.shiftKey ? "orbit" : "pan";
    }
    event.preventDefault();
  };

  readonly #pointerMove = (event: PointerEvent): void => {
    const pointer = this.#pointers.get(event.pointerId);
    if (!pointer) {
      const map = this.#renderer.screenToMap(event.clientX, event.clientY);
      this.#renderer.setCursor(map);
      return;
    }
    const previousX = pointer.x;
    const previousY = pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (this.#mode === "pinch" && this.#pointers.size >= 2) {
      const [first, second] = [...this.#pointers.values()];
      if (!first || !second) return;
      const nextDistance = Math.max(1, distance(first, second));
      const nextCenter = midpoint(first, second);
      this.#renderer.zoomAt(nextDistance / this.#pinchDistance, nextCenter.x, nextCenter.y);
      if (this.#pinchCenter) {
        this.#renderer.panBy(nextCenter.x - this.#pinchCenter.x, nextCenter.y - this.#pinchCenter.y);
      }
      this.#pinchDistance = nextDistance;
      this.#pinchCenter = nextCenter;
      event.preventDefault();
      return;
    }
    if (this.#mode === "paint" || this.#mode === "erase") {
      this.#applyBrush(event.clientX, event.clientY);
    } else if (this.#mode === "pan") {
      this.#renderer.panBy(event.clientX - previousX, event.clientY - previousY);
    } else if (this.#mode === "orbit") {
      this.#renderer.orbitBy(event.clientX - previousX, event.clientY - previousY);
    }
    const map = this.#renderer.screenToMap(event.clientX, event.clientY);
    this.#renderer.setCursor(map);
    event.preventDefault();
  };

  readonly #pointerUp = (event: PointerEvent): void => {
    const pointer = this.#pointers.get(event.pointerId);
    if (!pointer) return;
    this.#pointers.delete(event.pointerId);
    this.#host.releasePointerCapture?.(event.pointerId);
    this.#cancelTouchArm();
    if ((this.#mode === "paint" || this.#mode === "erase")
      && JSON.stringify(this.#draft) !== JSON.stringify(this.#baseline)) {
      this.#callbacks.onCircles(this.#draft, true, this.#baseline);
    } else if (this.#mode !== "pinch"
      && !this.#navigationUntilRelease
      && Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) < 7
      && this.#callbacks.state().workflow === "rooms") {
      const roomId = this.#renderer.roomAt(pointer.x, pointer.y);
      if (roomId) this.#callbacks.onRoom(roomId);
    }
    if (this.#pointers.size === 0) {
      this.#mode = "idle";
      this.#navigationUntilRelease = false;
      this.#pinchCenter = null;
      this.#lastMapPoint = null;
    } else if (this.#mode === "pinch") {
      this.#mode = "pan";
      this.#navigationUntilRelease = true;
    }
    event.preventDefault();
  };

  #applyBrush(clientX: number, clientY: number): void {
    const point = this.#renderer.screenToMap(clientX, clientY);
    if (!point) return;
    const state = this.#callbacks.state();
    const radius = state.draw.brushMeters / 2;
    if (this.#mode === "erase") {
      this.#draft = this.#draft.filter((circle) =>
        Math.hypot(circle.x - point.x, circle.y - point.y) > circle.radius + radius);
    } else {
      if (!this.#renderer.containsMapPoint(point)) return;
      const spacing = Math.max(0.04, radius * 0.55);
      const start = this.#lastMapPoint || point;
      const path = Math.hypot(point.x - start.x, point.y - start.y);
      const steps = Math.max(1, Math.ceil(path / spacing));
      for (let index = 0; index <= steps && this.#draft.length < 512; index += 1) {
        const progress = index / steps;
        const sample = {
          x: start.x + (point.x - start.x) * progress,
          y: start.y + (point.y - start.y) * progress,
        };
        if (this.#draft.some((circle) =>
          Math.hypot(circle.x - sample.x, circle.y - sample.y) < Math.max(0.025, radius * 0.28))) continue;
        this.#draft.push({
          x: Math.round(sample.x * 10_000) / 10_000,
          y: Math.round(sample.y * 10_000) / 10_000,
          radius: Math.round(radius * 100) / 100,
        });
      }
    }
    this.#lastMapPoint = point;
    this.#callbacks.onCircles(this.#draft, false);
  }

  readonly #wheel = (event: WheelEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isInteractiveControl(event.target)) return;
    event.preventDefault();
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.7 && Math.abs(event.deltaX) < 50) {
      this.#renderer.panBy(-event.deltaX, -event.deltaY);
      return;
    }
    this.#renderer.zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  };

  readonly #keyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Space") {
      this.#spacePressed = true;
      event.preventDefault();
      return;
    }
    if (event.key === "+" || event.key === "=") this.#renderer.zoomAt(1.25);
    else if (event.key === "-") this.#renderer.zoomAt(0.8);
    else if (event.key === "0") this.#renderer.fit();
    else if (event.key === "[") this.#renderer.orbitBy(-52, 0);
    else if (event.key === "]") this.#renderer.orbitBy(52, 0);
    else if (event.key === "PageUp") this.#renderer.orbitBy(0, -30);
    else if (event.key === "PageDown") this.#renderer.orbitBy(0, 30);
    else if (event.key.toLocaleLowerCase() === "d"
      && this.#callbacks.state().workflow === "draw") {
      this.#host.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-draw-tool", tool: "paint" },
        bubbles: true,
        composed: true,
      }));
    } else if (event.key.toLocaleLowerCase() === "e"
      && this.#callbacks.state().workflow === "draw") {
      this.#host.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-draw-tool", tool: "erase" },
        bubbles: true,
        composed: true,
      }));
    }
    else if (event.key === "ArrowLeft") this.#renderer.panBy(30, 0);
    else if (event.key === "ArrowRight") this.#renderer.panBy(-30, 0);
    else if (event.key === "ArrowUp") this.#renderer.panBy(0, 30);
    else if (event.key === "ArrowDown") this.#renderer.panBy(0, -30);
    else return;
    event.preventDefault();
  };

  readonly #keyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") this.#spacePressed = false;
  };

  readonly #blur = (): void => {
    this.#spacePressed = false;
    this.#cancelTouchArm();
    this.#renderer.setCursor(null);
  };

  #cancelTouchArm(): void {
    if (this.#touchArmTimer !== null) window.clearTimeout(this.#touchArmTimer);
    this.#touchArmTimer = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelTouchArm();
    this.#host.removeEventListener("pointerdown", this.#pointerDown);
    this.#host.removeEventListener("pointermove", this.#pointerMove);
    this.#host.removeEventListener("pointerup", this.#pointerUp);
    this.#host.removeEventListener("pointercancel", this.#pointerUp);
    this.#host.removeEventListener("wheel", this.#wheel);
    this.#host.removeEventListener("keydown", this.#keyDown);
    this.#host.removeEventListener("keyup", this.#keyUp);
    this.#host.removeEventListener("blur", this.#blur);
    this.#pointers.clear();
  }
}
