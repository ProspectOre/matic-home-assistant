import type { ReactiveController, ReactiveControllerHost } from "lit";

// Roving tabindex for toolbars and radio-style groups: exactly one item is in
// the tab order, arrow keys move focus between items. Every handled key calls
// preventDefault() -- the map's GestureController listens on an ancestor and
// orbits the camera on arrows, bailing only when `defaultPrevented` is set.

export interface RovingFocusOptions {
  readonly container: () => HTMLElement | null;
  readonly items: string;
  readonly orientation?: "horizontal" | "vertical" | "both";
}

const isDisabled = (item: HTMLElement): boolean =>
  item.matches(":disabled, [aria-disabled='true']");

export class RovingFocusController implements ReactiveController {
  readonly #host: ReactiveControllerHost & HTMLElement;
  readonly #options: RovingFocusOptions;
  #container: HTMLElement | null = null;
  #current: HTMLElement | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement, options: RovingFocusOptions) {
    this.#host = host;
    this.#options = options;
    host.addController(this);
  }

  hostConnected(): void {
    this.#host.addEventListener("focusin", this.#focusIn);
  }

  hostDisconnected(): void {
    this.#host.removeEventListener("focusin", this.#focusIn);
    this.#container?.removeEventListener("keydown", this.#keyDown);
    this.#container = null;
    this.#current = null;
  }

  hostUpdated(): void {
    const container = this.#options.container();
    if (container !== this.#container) {
      this.#container?.removeEventListener("keydown", this.#keyDown);
      container?.addEventListener("keydown", this.#keyDown);
      this.#container = container;
    }
    this.#sync();
  }

  #items(): HTMLElement[] {
    const container = this.#container;
    if (!container) return [];
    return [...container.querySelectorAll<HTMLElement>(this.#options.items)]
      .filter((item) => !isDisabled(item));
  }

  #sync(): void {
    const items = this.#items();
    const active = (this.#current && items.includes(this.#current) ? this.#current : null)
      ?? items.find((item) => item.matches("[aria-pressed='true'], [aria-checked='true']"))
      ?? items[0]
      ?? null;
    this.#current = active;
    const all = this.#container?.querySelectorAll<HTMLElement>(this.#options.items) ?? [];
    for (const item of all) item.tabIndex = item === active ? 0 : -1;
  }

  readonly #focusIn = (event: FocusEvent): void => {
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLElement) || !this.#container?.contains(target)) return;
    if (!target.matches(this.#options.items)) return;
    this.#current = target;
    this.#sync();
  };

  readonly #keyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const orientation = this.#options.orientation ?? "horizontal";
    const horizontal = orientation !== "vertical";
    const vertical = orientation !== "horizontal";
    const items = this.#items();
    if (!items.length) return;
    const origin = event.composedPath()[0];
    const index = Math.max(0, items.findIndex((item) => item === this.#current
      || (origin instanceof Node && item.contains(origin))));
    let next: number;
    switch (event.key) {
      case "ArrowLeft": if (!horizontal) return; next = index - 1; break;
      case "ArrowRight": if (!horizontal) return; next = index + 1; break;
      case "ArrowUp": if (!vertical) return; next = index - 1; break;
      case "ArrowDown": if (!vertical) return; next = index + 1; break;
      case "Home": next = 0; break;
      case "End": next = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const target = items[(next + items.length) % items.length];
    if (!target) return;
    this.#current = target;
    this.#sync();
    target.focus();
  };
}
