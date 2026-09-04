import type { AreaCircle } from "./backend-contracts";
import type { WorkspaceIntent, WorkspaceState } from "./contracts";
import {
  RendererController,
  type CameraState,
  type MapPoint,
} from "./renderer-controller";

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
  lastX: number;
  lastY: number;
  lastTime: number;
  velocityX: number;
  velocityY: number;
}

const distance = (first: PointerRecord, second: PointerRecord): number =>
  Math.hypot(first.x - second.x, first.y - second.y);

const midpoint = (first: PointerRecord, second: PointerRecord): MapPoint => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
});

const angle = (first: PointerRecord, second: PointerRecord): number =>
  Math.atan2(second.y - first.y, second.x - first.x);

const angleDelta = (value: number): number => {
  let delta = value;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

const cloneCircles = (circles: readonly AreaCircle[]): AreaCircle[] =>
  circles.map((circle) => ({ ...circle }));

const INTERACTIVE_SELECTOR =
  "button, input, select, textarea, a, [role='button'], [role='menuitem'], [data-map-control]";

// Walk the composed path rather than `target.closest(...)`: a press inside a
// custom element's shadow root is retargeted to the host, which matches
// nothing, so the map would swallow presses on shadow-root controls.
const isInteractiveControl = (event: Event): boolean =>
  event.composedPath().some((node) =>
    node instanceof Element && node.matches(INTERACTIVE_SELECTOR));

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
  #pinchAngle = 0;
  #pinchCamera: CameraState | null = null;
  #dragCamera: CameraState | null = null;
  #gestureCamera: CameraState | null = null;
  #gestureRotation = 0;
  #motionFrame: number | null = null;
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
    host.addEventListener("gesturestart", this.#gestureStart as EventListener, { passive: false });
    host.addEventListener("gesturechange", this.#gestureChange as EventListener, { passive: false });
    host.addEventListener("gestureend", this.#gestureEnd as EventListener, { passive: false });
    host.addEventListener("dblclick", this.#doubleClick);
    host.addEventListener("contextmenu", this.#contextMenu);
    host.addEventListener("keydown", this.#keyDown);
    host.addEventListener("keyup", this.#keyUp);
    host.addEventListener("blur", this.#blur);
  }

  readonly #pointerDown = (event: PointerEvent): void => {
    if (this.#disposed || !event.isPrimary && event.pointerType === "mouse") return;
    if (isInteractiveControl(event)) return;
    this.#host.focus({ preventScroll: true });
    this.#cancelMotion();
    const now = performance.now();
    const pointer: PointerRecord = {
      id: event.pointerId,
      type: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: now,
      velocityX: 0,
      velocityY: 0,
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
      this.#host.classList.add("navigating");
      this.#navigationUntilRelease = true;
      const [first, second] = [...this.#pointers.values()];
      if (first && second) {
        this.#pinchDistance = Math.max(1, distance(first, second));
        this.#pinchCenter = midpoint(first, second);
        this.#pinchAngle = angle(first, second);
        this.#pinchCamera = this.#renderer.camera;
      }
      event.preventDefault();
      return;
    }
    const state = this.#callbacks.state();
    const drawing = state.workflow === "draw" && state.map.available && !state.floor.readOnly;
    const navigation = this.#navigationUntilRelease
      || this.#spacePressed
      || event.button === 1
      || event.button === 2
      || state.draw.tool === "pan";
    if (navigation) {
      this.#mode = "pan";
      this.#dragCamera = this.#renderer.camera;
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
      this.#dragCamera = this.#renderer.camera;
    }
    if (this.#mode === "pan" || this.#mode === "orbit") this.#host.classList.add("navigating");
    event.preventDefault();
  };

  readonly #pointerMove = (event: PointerEvent): void => {
    const pointer = this.#pointers.get(event.pointerId);
    if (!pointer) {
      const map = this.#renderer.screenToMap(event.clientX, event.clientY);
      this.#renderer.setCursor(map);
      return;
    }
    const samples = event.getCoalescedEvents?.() || [];
    const sample = samples.at(-1) || event;
    const now = performance.now();
    const elapsed = Math.max(1, now - pointer.lastTime);
    const instantaneousX = (sample.clientX - pointer.lastX) / elapsed;
    const instantaneousY = (sample.clientY - pointer.lastY) / elapsed;
    pointer.velocityX = pointer.velocityX * 0.62 + instantaneousX * 0.38;
    pointer.velocityY = pointer.velocityY * 0.62 + instantaneousY * 0.38;
    pointer.lastX = sample.clientX;
    pointer.lastY = sample.clientY;
    pointer.lastTime = now;
    pointer.x = sample.clientX;
    pointer.y = sample.clientY;
    if (this.#mode === "pinch" && this.#pointers.size >= 2) {
      const [first, second] = [...this.#pointers.values()];
      if (!first || !second) return;
      const nextDistance = Math.max(1, distance(first, second));
      const nextCenter = midpoint(first, second);
      const nextAngle = angle(first, second);
      const start = this.#pinchCamera;
      if (start && this.#pinchCenter) {
        const transformed: CameraState = {
          ...start,
          distance: start.distance * this.#pinchDistance / nextDistance,
          yaw: start.yaw + angleDelta(nextAngle - this.#pinchAngle),
          pitch: start.orthographic
            ? start.pitch
            : start.pitch - (nextCenter.y - this.#pinchCenter.y) * 0.0035,
        };
        this.#renderer.setCamera(this.#renderer.cameraAfterPan(
          transformed,
          nextCenter.x - this.#pinchCenter.x,
          nextCenter.y - this.#pinchCenter.y,
        ));
      }
      event.preventDefault();
      return;
    }
    if (this.#mode === "paint" || this.#mode === "erase") {
      this.#applyBrush(event.clientX, event.clientY);
    } else if (this.#mode === "pan") {
      if (this.#dragCamera) this.#renderer.setCamera(this.#renderer.cameraAfterPan(
        this.#dragCamera,
        sample.clientX - pointer.startX,
        sample.clientY - pointer.startY,
      ));
    } else if (this.#mode === "orbit") {
      if (this.#dragCamera) this.#renderer.setCamera({
        ...this.#dragCamera,
        yaw: this.#dragCamera.yaw + (sample.clientX - pointer.startX) * 0.0045,
        pitch: this.#dragCamera.pitch - (sample.clientY - pointer.startY) * 0.004,
      });
    }
    const map = this.#renderer.screenToMap(sample.clientX, sample.clientY);
    this.#renderer.setCursor(map);
    event.preventDefault();
  };

  readonly #pointerUp = (event: PointerEvent): void => {
    const pointer = this.#pointers.get(event.pointerId);
    if (!pointer) return;
    const completedMode = this.#mode;
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
      this.#host.classList.remove("navigating");
      this.#navigationUntilRelease = false;
      this.#pinchCenter = null;
      this.#pinchCamera = null;
      this.#dragCamera = null;
      this.#lastMapPoint = null;
      if ((completedMode === "pan" || completedMode === "orbit")
        && pointer.type !== "mouse") {
        this.#startInertia(pointer.velocityX, pointer.velocityY, completedMode);
      }
    } else if (this.#mode === "pinch") {
      this.#mode = "pan";
      this.#navigationUntilRelease = true;
      const remaining = this.#pointers.values().next().value as PointerRecord | undefined;
      if (remaining) {
        remaining.startX = remaining.x;
        remaining.startY = remaining.y;
        remaining.velocityX = 0;
        remaining.velocityY = 0;
      }
      this.#dragCamera = this.#renderer.camera;
      this.#pinchCamera = null;
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
    if (isInteractiveControl(event)) return;
    event.preventDefault();
    this.#host.focus({ preventScroll: true });
    this.#cancelMotion();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, this.#host.clientHeight)
        : 1;
    const deltaX = event.deltaX * unit;
    const deltaY = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) {
      this.#renderer.zoomAt(
        Math.exp(clamp(-deltaY * 0.008, -0.28, 0.28)),
        event.clientX,
        event.clientY,
      );
      return;
    }
    if (event.altKey && this.#callbacks.state().view === "three") {
      this.#renderer.orbitBy(0, clamp(deltaY, -80, 80) * 0.75);
      return;
    }
    const mouseWheel = event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
      || (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) >= 50);
    if (mouseWheel) {
      this.#renderer.zoomAt(
        Math.exp(clamp(-deltaY * 0.0025, -0.28, 0.28)),
        event.clientX,
        event.clientY,
      );
      return;
    }
    this.#renderer.panBy(-clamp(deltaX, -80, 80), -clamp(deltaY, -80, 80));
  };

  readonly #gestureStart = (event: SafariGestureEvent): void => {
    if (this.#disposed || isInteractiveControl(event)) return;
    this.#host.focus({ preventScroll: true });
    this.#cancelMotion();
    this.#host.classList.add("navigating");
    this.#gestureCamera = this.#renderer.camera;
    this.#gestureRotation = Number.isFinite(event.rotation) ? event.rotation : 0;
    event.preventDefault();
  };

  readonly #gestureChange = (event: SafariGestureEvent): void => {
    if (this.#disposed || isInteractiveControl(event)) return;
    const start = this.#gestureCamera;
    if (!start || this.#pointers.size >= 2) return;
    const scale = Number.isFinite(event.scale) && event.scale > 0 ? Math.max(0.1, event.scale) : 1;
    const rotation = Number.isFinite(event.rotation) ? event.rotation : 0;
    this.#renderer.setCamera({
      ...start,
      distance: start.distance / scale,
      yaw: start.yaw + (rotation - this.#gestureRotation) * Math.PI / 180,
    });
    event.preventDefault();
  };

  readonly #gestureEnd = (event: SafariGestureEvent): void => {
    this.#gestureCamera = null;
    this.#gestureRotation = 0;
    this.#host.classList.remove("navigating");
    event.preventDefault();
  };

  readonly #keyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Space") {
      this.#spacePressed = true;
      event.preventDefault();
      return;
    }
    this.#cancelMotion();
    const state = this.#callbacks.state();
    const key = event.key.toLocaleLowerCase();
    if (event.key === "+" || event.key === "=") this.#renderer.zoomAt(1.25);
    else if (event.key === "-") this.#renderer.zoomAt(0.8);
    else if (event.key === "0") this.#renderer.fit();
    else if (key === "3") this.#dispatch({ type: "set-view", view: "three" });
    else if (key === "t") this.#dispatch({ type: "set-view", view: "top" });
    else if (event.key === "[") this.#renderer.orbitBy(-40, 0);
    else if (event.key === "]") this.#renderer.orbitBy(40, 0);
    else if (event.key === "PageUp") this.#renderer.orbitBy(0, -30);
    else if (event.key === "PageDown") this.#renderer.orbitBy(0, 30);
    else if (key === "d" && state.workflow === "draw") this.#dispatch({ type: "set-draw-tool", tool: "paint" });
    else if (key === "e" && state.workflow === "draw") this.#dispatch({ type: "set-draw-tool", tool: "erase" });
    else if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
      if (state.view === "three" && !event.shiftKey) {
        const horizontal = key === "arrowleft" ? -24 : key === "arrowright" ? 24 : 0;
        const vertical = key === "arrowup" ? -20 : key === "arrowdown" ? 20 : 0;
        this.#renderer.orbitBy(horizontal, vertical);
      } else {
        const horizontal = key === "arrowleft" ? 30 : key === "arrowright" ? -30 : 0;
        const vertical = key === "arrowup" ? 30 : key === "arrowdown" ? -30 : 0;
        this.#renderer.panBy(horizontal, vertical);
      }
    } else if (state.workflow !== "draw" && ["w", "a", "s", "d"].includes(key)) {
      this.#renderer.panBy(
        key === "a" ? 34 : key === "d" ? -34 : 0,
        key === "w" ? 34 : key === "s" ? -34 : 0,
      );
    } else if (state.workflow !== "draw" && (key === "q" || key === "e")) {
      this.#renderer.orbitBy(key === "q" ? -30 : 30, 0);
    }
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
    this.#host.classList.remove("navigating");
  };

  readonly #doubleClick = (event: MouseEvent): void => {
    if (isInteractiveControl(event)) return;
    this.#cancelMotion();
    this.#renderer.zoomAt(event.shiftKey ? 1 / 1.6 : 1.6, event.clientX, event.clientY);
    event.preventDefault();
  };

  readonly #contextMenu = (event: MouseEvent): void => {
    if (!isInteractiveControl(event)) event.preventDefault();
  };

  #dispatch(intent: WorkspaceIntent): void {
    this.#host.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: intent,
      bubbles: true,
      composed: true,
    }));
  }

  #startInertia(velocityX: number, velocityY: number, mode: "pan" | "orbit"): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let x = clamp(velocityX, -0.55, 0.55);
    let y = clamp(velocityY, -0.55, 0.55);
    if (Math.hypot(x, y) < 0.02) return;
    let last = performance.now();
    const step = (now: number): void => {
      const elapsed = Math.min(32, now - last);
      last = now;
      if (mode === "orbit") this.#renderer.orbitBy(x * elapsed, y * elapsed);
      else this.#renderer.panBy(x * elapsed, y * elapsed);
      const decay = 0.9 ** (elapsed / 16);
      x *= decay;
      y *= decay;
      if (Math.hypot(x, y) >= 0.01) this.#motionFrame = window.requestAnimationFrame(step);
      else this.#motionFrame = null;
    };
    this.#motionFrame = window.requestAnimationFrame(step);
  }

  #cancelMotion(): void {
    if (this.#motionFrame !== null) window.cancelAnimationFrame(this.#motionFrame);
    this.#motionFrame = null;
  }

  #cancelTouchArm(): void {
    if (this.#touchArmTimer !== null) window.clearTimeout(this.#touchArmTimer);
    this.#touchArmTimer = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelTouchArm();
    this.#cancelMotion();
    this.#host.removeEventListener("pointerdown", this.#pointerDown);
    this.#host.removeEventListener("pointermove", this.#pointerMove);
    this.#host.removeEventListener("pointerup", this.#pointerUp);
    this.#host.removeEventListener("pointercancel", this.#pointerUp);
    this.#host.removeEventListener("wheel", this.#wheel);
    this.#host.removeEventListener("gesturestart", this.#gestureStart as EventListener);
    this.#host.removeEventListener("gesturechange", this.#gestureChange as EventListener);
    this.#host.removeEventListener("gestureend", this.#gestureEnd as EventListener);
    this.#host.removeEventListener("dblclick", this.#doubleClick);
    this.#host.removeEventListener("contextmenu", this.#contextMenu);
    this.#host.removeEventListener("keydown", this.#keyDown);
    this.#host.removeEventListener("keyup", this.#keyUp);
    this.#host.removeEventListener("blur", this.#blur);
    this.#pointers.clear();
  }
}
