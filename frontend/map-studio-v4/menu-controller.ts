import type { ReactiveController, ReactiveControllerHost } from "lit";

type MenuHost = ReactiveControllerHost & HTMLElement & { readonly renderRoot: ParentNode };

/**
 * A menu button's open state (More actions, More for {room}): the first item takes focus on open, Escape closes it
 * back to its button, and focus or a press elsewhere closes it.
 */
export class MenuController implements ReactiveController {
  open = false;

  constructor(
    private readonly host: MenuHost,
    /** The wrapper holding the button and its menu. */
    private readonly root: string,
    /** The menu button, inside the wrapper. */
    private readonly launcher: string,
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    window.addEventListener("pointerdown", this.#outsidePointer, true);
  }

  hostDisconnected(): void {
    window.removeEventListener("pointerdown", this.#outsidePointer, true);
  }

  hostUpdated(): void {
    if (this.#focusFirst) {
      this.#focusFirst = false;
      this.host.renderRoot.querySelector<HTMLElement>(`${this.root} [role^=menuitem]`)?.focus();
    }
  }

  #focusFirst = false;

  #set(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.#focusFirst = open;
    this.host.requestUpdate();
  }

  toggle(): void {
    this.#set(!this.open);
  }

  close(restoreFocus: boolean): void {
    this.#set(false);
    if (restoreFocus) this.host.renderRoot.querySelector<HTMLElement>(`${this.root} ${this.launcher}`)?.focus();
  }

  // Escape closes the menu before the shell sees it.
  // Up and Down move between items (every menuitem* role), wrapping, and Home
  // and End go to the ends;
  // items take focus only this way, so Tab leaves the menu (APG menu button).
  readonly keydown = (event: KeyboardEvent): void => {
    if (!this.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.close(true);
      return;
    }
    const items = [...this.host.renderRoot.querySelectorAll<HTMLElement>(`${this.root} [role^=menuitem]`)];
    const at = items.indexOf(event.composedPath()[0] as HTMLElement);
    const to = event.key === "ArrowDown" ? at + 1
      : event.key === "ArrowUp" ? at - 1
        : event.key === "Home" ? 0
          : event.key === "End" ? items.length - 1
            : null;
    if (to === null || at < 0 || !items.length) return;
    event.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  };

  // The menu closes when focus or a press goes elsewhere. Safari gives a
  // pressed button no focus and moves it to a focusable ancestor instead, so
  // a press inside the menu keeps focus where it is (the menu's mousedown).
  readonly focusout = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    if (next && !(event.currentTarget as Node).contains(next)) this.#set(false);
  };

  readonly #outsidePointer = (event: PointerEvent): void => {
    const wrapper = this.host.renderRoot.querySelector(this.root);
    if (this.open && wrapper && !event.composedPath().includes(wrapper)) this.#set(false);
  };
}
