import type { LitElement } from "lit";
import type { WorkspaceState, Workflow } from "./contracts";
import { hasFocusable } from "./shell-focus";

export type SheetDetent = "peek" | "half" | "full";

const DETENTS: readonly SheetDetent[] = ["peek", "half", "full"];
// A compact sheet (height < 480) has no half (design-system.md §7).
const COMPACT_DETENTS: readonly SheetDetent[] = ["peek", "full"];

// Where the sheet rests when a workflow or plan view opens (shell.md §5
// Sheet). The map is the document, so a drawing starts at peek; room and
// plan choices stay visible at half height, while the long forms (plan Edit,
// diagnostics) start at full height.
const DEFAULT_DETENT: Readonly<Record<Workflow, SheetDetent>> = {
  none: "half",
  rooms: "half",
  draw: "peek",
  plan: "half",
  plans: "half",
  areas: "half",
  areaReview: "half",
  history: "half",
  runs: "half",
  support: "full",
};
const startingDetent = (state: WorkspaceState, compact: boolean): SheetDetent =>
  compact ? /^(rooms|draw|areaReview|history)$/u.test(state.workflow) ? "peek" : "full"
  : state.workflow === "plan" && state.planView === "edit" ? "full" : DEFAULT_DETENT[state.workflow];

// Faster than this on release and the sheet goes to the next detent in the
// direction of travel regardless of where the finger let go.
const FLICK_VELOCITY = 0.5;
// Velocity is read over the samples from this many ms before release, not
// from the last pair of pointermoves alone: browsers deliver moves in bursts,
// and one late frame at the end of a real flick would otherwise read as a
// slow drag.
const FLICK_WINDOW_MS = 100;
const TAP_SLOP = 6;
const BODY_SWIPE_DISTANCE = 48;
// The panel's scrollers: the pinned top, capped on a sheet, and the body.
const SCROLLERS = ".panel-top, .sheet-body, .workflow-body";
const INTERACTIVE_SHEET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "label",
  "select",
  "textarea",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="slider"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  // A scroller is a tab stop only so a keyboard can scroll it
  // (#syncScrollers); a swipe that starts on it still steps the sheet.
  `[tabindex]:not([tabindex="-1"]):not(${SCROLLERS})`,
].join(",");

interface SheetDrag {
  readonly pointerId: number;
  readonly startY: number;
  readonly startHeight: number;
  readonly heights: Readonly<Record<SheetDetent, number>>;
  samples: { y: number; t: number }[];
  moved: boolean;
}

interface BodySwipe {
  readonly pointerId: number;
  readonly startY: number;
  readonly scroller: HTMLElement | null;
  consumed: boolean;
}

interface SheetCallbacks {
  readonly state: () => WorkspaceState;
  readonly helpOpen: () => boolean;
  readonly helpReturnsFull: () => boolean;
  readonly announce: (detent: SheetDetent) => void;
  readonly focusPanel: () => void;
}

export class SheetController {
  readonly #host: LitElement;
  readonly #callbacks: SheetCallbacks;
  #resizeObserver: ResizeObserver | null = null;
  #sheetResizeObserver: ResizeObserver | null = null;
  #scrollerResizeObserver: ResizeObserver | null = null;
  #observedSheet: Element | null = null;
  #focused: Element | null = null;
  #drag: SheetDrag | null = null;
  #bodySwipe: BodySwipe | null = null;
  // Until the first measurement, the host uses its narrow hint.
  #narrow?: boolean;
  #compact = false;
  #offset = 0;
  #detent: SheetDetent = "half";

  get narrow(): boolean | undefined { return this.#narrow; }
  get compact(): boolean { return this.#compact; }
  get offset(): number { return this.#offset; }
  get detent(): SheetDetent { return this.#detent; }

  constructor(host: LitElement, callbacks: SheetCallbacks) {
    this.#host = host;
    this.#callbacks = callbacks;
  }

  measure({ width, height }: { width: number; height: number }): void {
    if (!width || !height) return;
    const compact = height < 480;
    const narrow = compact || width < 768 || (width < 1024 && width <= height);
    if (narrow !== this.#narrow || compact !== this.#compact) {
      this.#narrow = narrow;
      if (compact !== this.#compact) {
        this.#compact = compact;
        this.#detent = startingDetent(this.#callbacks.state(), compact);
      }
      this.#host.requestUpdate();
    }
  }

  connect(): void {
    this.#observedSheet = null;
    this.#resizeObserver = new ResizeObserver(([entry]) => { if (entry) this.measure(entry.contentRect); });
    this.#resizeObserver.observe(this.#host);
    this.#sheetResizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = Math.ceil(entry.target.getBoundingClientRect().height);
      if (next !== this.#offset) { this.#offset = next; this.#host.requestUpdate(); }
    });
    this.#scrollerResizeObserver = new ResizeObserver(() => this.#syncScrollers());
    this.#host.requestUpdate();
  }

  disconnect(): void {
    const sheet = this.sheet();
    if (sheet && this.#drag) {
      this.#translateSheet(sheet, "");
      sheet.classList.remove("dragging");
    }
    this.#drag = null;
    this.#bodySwipe = null;
    this.#focused = null;
    this.#resizeObserver?.disconnect();
    this.#sheetResizeObserver?.disconnect();
    this.#scrollerResizeObserver?.disconnect();
    this.#resizeObserver = this.#sheetResizeObserver = this.#scrollerResizeObserver = null;
    this.#observedSheet = null;
  }

  captureFocus(): void { this.#focused = this.#host.shadowRoot?.activeElement ?? null; }

  afterRender(): void {
    const instant = this.#host.renderRoot.querySelector<HTMLElement>(".mobile-sheet.instant");
    if (instant) { void getComputedStyle(instant).blockSize; instant.classList.remove("instant"); }
    const focused = this.#focused;
    this.#focused = null;
    if (focused && (!focused.isConnected || focused.closest("[hidden]"))) this.#callbacks.focusPanel();
    const sheet = this.#host.renderRoot.querySelector(".mobile-sheet");
    if (sheet !== this.#observedSheet) {
      this.#sheetResizeObserver?.disconnect();
      this.#observedSheet = sheet;
      if (sheet) this.#sheetResizeObserver?.observe(sheet);
      else if (this.#offset !== 0) { this.#offset = 0; this.#host.requestUpdate(); }
    }
    this.#scrollerResizeObserver?.disconnect();
    for (const scroller of this.#host.renderRoot.querySelectorAll(SCROLLERS)) {
      for (const element of [scroller, ...scroller.children]) this.#scrollerResizeObserver?.observe(element);
    }
  }

  resetForWorkflow(state: WorkspaceState, instant: boolean): void {
    const detent = startingDetent(state, this.#compact);
    if (detent === this.#detent) return;
    if (instant) this.sheet()?.classList.add("instant");
    this.#detent = detent;
    this.#host.requestUpdate();
  }

  #syncScrollers = (): void => {
    for (const scroller of this.#host.renderRoot.querySelectorAll<HTMLElement>(SCROLLERS)) {
      const stop = scroller.scrollHeight > scroller.clientHeight && !hasFocusable(scroller);
      if (!stop && scroller.matches(":focus")) {
        scroller.addEventListener("blur", this.#syncScrollers, { once: true });
        continue;
      }
      const set = (name: string, value: string) => (stop ? scroller.setAttribute(name, value) : scroller.removeAttribute(name));
      set("tabindex", "0");
      if (scroller.classList.contains("panel-top")) {
        set("role", "group");
        set("aria-labelledby", "workspace-title");
      }
    }
  };

  setDetent(detent: SheetDetent): void {
    if (this.#callbacks.helpOpen() && this.#callbacks.helpReturnsFull()) detent = "peek";
    if (detent === this.#detent) return;
    this.#detent = detent;
    this.#host.requestUpdate();
    this.#callbacks.announce(detent);
  }

  #detents(): readonly SheetDetent[] {
    return this.#compact ? COMPACT_DETENTS : DETENTS;
  }

  step(delta: 1 | -1, wrap = false): void {
    const detents = this.#detents();
    let next = detents.indexOf(this.#detent) + delta;
    if (wrap && next >= detents.length) next = 0;
    this.setDetent(detents[Math.max(0, Math.min(detents.length - 1, next))] ?? this.#detent);
  }

  #detentHeights(sheet: HTMLElement): Readonly<Record<SheetDetent, number>> {
    const available = this.#host.renderRoot.querySelector<HTMLElement>(".workspace")?.clientHeight
      ?? sheet.parentElement?.clientHeight
      ?? sheet.offsetHeight;
    const rem = parseFloat(getComputedStyle(this.#host).fontSize) || 16;
    const chrome = [":scope>.sheet-grip", ":scope>.sheet-tools", ":scope>.action-bar"]
      .map((selector) => sheet.querySelector<HTMLElement>(selector)?.offsetHeight ?? 0)
      .reduce((sum, height) => sum + height, 0) + rem * 0.75;
    const full = this.#compact ? available * 0.72 : Math.min(available * 0.92, available - rem * 9);
    const half = Math.min(available * 0.52, rem * 26, full);
    return { peek: Math.min(chrome, half), half, full };
  }

  sheet(): HTMLElement | null {
    return this.#host.renderRoot.querySelector<HTMLElement>(".mobile-sheet");
  }

  // A drag moves the sheet by transform only, so the toast, anchored to the
  // sheet's resting top edge, takes the same transform and rides with it.
  #translateSheet(sheet: HTMLElement, transform: string): void {
    sheet.style.transform = transform;
    const toast = this.#host.renderRoot.querySelector<HTMLElement>("[data-notice-toast]");
    if (toast) toast.style.transform = transform;
  }

  #startsOnInteractiveSheetDescendant(event: PointerEvent): boolean {
    const currentTarget = event.currentTarget;
    for (const target of event.composedPath()) {
      if (target === currentTarget) return false;
      if (target instanceof Element && target.matches(INTERACTIVE_SHEET_SELECTOR)) return true;
    }
    return false;
  }

  readonly gripDown = (event: PointerEvent): void => {
    if (this.#callbacks.helpReturnsFull()) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (this.#startsOnInteractiveSheetDescendant(event)) return;
    const sheet = this.sheet();
    if (!sheet || this.#drag) return;
    this.#drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: sheet.offsetHeight,
      heights: this.#detentHeights(sheet),
      samples: [{ y: event.clientY, t: event.timeStamp }],
      moved: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    sheet.classList.add("dragging");
  };

  readonly gripMove = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const sheet = this.sheet();
    if (!sheet) return;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dy) > TAP_SLOP) drag.moved = true;
    drag.samples.push({ y: event.clientY, t: event.timeStamp });
    while (drag.samples.length > 2 && event.timeStamp - (drag.samples[1]?.t ?? 0) > FLICK_WINDOW_MS) drag.samples.shift();
    if (!drag.moved) return;
    // Positive = the sheet moves down. It may not rise above the full detent
    // or sink below peek. Translate, never resize: a height change here would
    // relayout the canvas on every frame.
    const min = drag.startHeight - drag.heights.full;
    const max = drag.startHeight - drag.heights.peek;
    const offset = Math.max(min, Math.min(max, dy));
    this.#translateSheet(sheet, `translateY(${offset}px)`);
  };

  readonly gripUp = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.#drag = null;
    const sheet = this.sheet();
    if (sheet) {
      this.#translateSheet(sheet, "");
      sheet.classList.remove("dragging");
    }
    if (event.type === "pointercancel") return;
    if (!drag.moved) {
      this.step(1, true);
      return;
    }
    const dy = event.clientY - drag.startY;
    const detents = this.#detents();
    const index = detents.indexOf(this.#detent);
    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    const velocity = first && last && last !== first ? (last.y - first.y) / Math.max(1, last.t - first.t) : 0;
    if (Math.abs(velocity) > FLICK_VELOCITY) {
      this.setDetent(detents[Math.max(0, Math.min(detents.length - 1, index + (velocity < 0 ? 1 : -1)))] ?? this.#detent);
      return;
    }
    const target = drag.startHeight - dy;
    let nearest: SheetDetent = this.#detent;
    let distance = Number.POSITIVE_INFINITY;
    for (const detent of detents) {
      const gap = Math.abs(drag.heights[detent] - target);
      if (gap < distance) {
        distance = gap;
        nearest = detent;
      }
    }
    this.setDetent(nearest);
  };

  // A swipe follows what the finger scrolls: the nearest scrollable ancestor
  // of where it starts inside the panel (the capped pinned top or the body).
  // It steps the sheet only while that scroller is at its top, or with none.
  #swipeScroller(event: PointerEvent): HTMLElement | null {
    for (const node of event.composedPath()) {
      if (node === event.currentTarget) break;
      if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight
        && /auto|scroll/u.test(getComputedStyle(node).overflowY)) return node;
    }
    return null;
  }

  readonly bodyDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") return;
    if (this.#startsOnInteractiveSheetDescendant(event)) return;
    const scroller = this.#swipeScroller(event);
    this.#bodySwipe = scroller?.scrollTop ? null : {
      pointerId: event.pointerId,
      startY: event.clientY,
      scroller,
      consumed: false,
    };
  };

  readonly bodyMove = (event: PointerEvent): void => {
    const swipe = this.#bodySwipe;
    if (!swipe || swipe.consumed || event.pointerId !== swipe.pointerId) return;
    if (swipe.scroller?.scrollTop) {
      this.#bodySwipe = null;
      return;
    }
    if (event.clientY - swipe.startY < BODY_SWIPE_DISTANCE) return;
    swipe.consumed = true;
    this.step(-1);
  };

  readonly bodyUp = (): void => {
    this.#bodySwipe = null;
  };

}
