export interface PageLifecycleOptions {
  readonly onSuspend: () => void;
  readonly onResume: () => void;
}

/** Owns the page visibility and BFCache signals for one controller lifetime. */
export class PageLifecycle {
  readonly #onSuspend: () => void;
  readonly #onResume: () => void;
  #active = document.visibilityState !== "hidden";
  #started = false;
  #disposed = false;
  #pageHidden = false;

  constructor({ onSuspend, onResume }: PageLifecycleOptions) {
    this.#onSuspend = onSuspend;
    this.#onResume = onResume;
  }

  get active(): boolean {
    return this.#active;
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    window.addEventListener("pagehide", this.#handlePageHide);
    window.addEventListener("pageshow", this.#handlePageShow);
    document.addEventListener("visibilitychange", this.#handleVisibilityChange);

    // A visible initial start is already covered by the controller's initial
    // sync. Only a hidden document needs an explicit transition.
    if (document.visibilityState === "hidden") {
      if (this.#active) this.#setActive(false);
      else this.#onSuspend();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (!this.#started) return;
    window.removeEventListener("pagehide", this.#handlePageHide);
    window.removeEventListener("pageshow", this.#handlePageShow);
    document.removeEventListener("visibilitychange", this.#handleVisibilityChange);
  }

  readonly #handlePageHide = (): void => {
    this.#pageHidden = true;
    this.#setActive(false);
  };

  readonly #handlePageShow = (event: PageTransitionEvent): void => {
    this.#pageHidden = false;
    if (event.persisted) {
      // Some browsers restore from BFCache without a pagehide observable to
      // this owner. Revoke the old generation before admitting it again.
      if (document.visibilityState === "hidden") {
        this.#setActive(false);
      } else {
        this.#setActive(false);
        this.#setActive(true);
      }
      return;
    }
    this.#syncVisibility();
  };

  readonly #handleVisibilityChange = (): void => {
    this.#syncVisibility();
  };

  #syncVisibility(): void {
    if (this.#pageHidden || document.visibilityState === "hidden") {
      this.#setActive(false);
      return;
    }
    this.#setActive(true);
  }

  #setActive(active: boolean): void {
    if (this.#active === active || this.#disposed) return;
    this.#active = active;
    if (active) this.#onResume();
    else this.#onSuspend();
  }
}
