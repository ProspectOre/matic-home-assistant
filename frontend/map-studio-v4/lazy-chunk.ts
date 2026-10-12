import { html, nothing, type ReactiveController, type ReactiveControllerHost } from "lit";
import type { Localize, Workflow } from "./contracts";
import { translate } from "./localize";

export type ChunkStatus = "idle" | "loading" | "ready" | "failed";

// copy-style-0.5.md:83 requires a loading line to time out with a recovery
// action. Twenty seconds matches the Locating timer (shell.md §5).
const TIMEOUT_MS = 20_000;

/**
 * A chunk an element imports on first use: idle → loading → ready | failed.
 * `load` resolves to the ready value, so anything that rejects or throws in it,
 * a constructor included, counts as failed, and so does a load still pending
 * after 20 s of the host being connected.
 *
 * Failed is final for the page. The browser keeps a failed module fetch for
 * the life of the document (the HTML module map: Chromium, WebKit and Firefox
 * all refuse a second import of the same URL), and after an update the old
 * versioned chunk path is gone, so Try again reloads the page.
 */
export class LazyChunk<T> implements ReactiveController {
  status: ChunkStatus = "idle";
  value: T | undefined;
  readonly #host: ReactiveControllerHost;
  readonly #load: () => Promise<T>;
  #expire: (() => void) | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: ReactiveControllerHost, load: () => Promise<T>) {
    this.#host = host;
    this.#load = load;
    host.addController(this);
  }

  /** Starts the load once. */
  request(): void {
    if (this.status === "idle") void this.#start();
  }

  hostConnected(): void {
    if (this.status === "loading") this.#arm();
  }

  hostDisconnected(): void {
    clearTimeout(this.#timer);
  }

  // Armed once when the load starts and again on each reconnect; disconnect
  // clears it, so a detached host gets no update from it.
  #arm(): void {
    this.#timer = setTimeout(() => this.#expire?.(), TIMEOUT_MS);
  }

  async #start(): Promise<void> {
    this.status = "loading";
    this.#arm();
    try {
      this.value = await Promise.race([
        this.#load(),
        new Promise<never>((_, reject) => { this.#expire = reject; }),
      ]);
      this.status = "ready";
    } catch {
      this.status = "failed";
    }
    clearTimeout(this.#timer);
    this.#host.requestUpdate();
  }
}

const RESUME_KEY = "matic-map-resume";
// A reload reaches the shell in seconds; a marker older than this was left by
// a reload that never got there (an offline error page, another page first).
const RESUME_MS = 30_000;

// Try again's reload, which the shell runs once no draft would be lost
// (shell.ts #retry). It lands back in `workflow`: the marker lives for the
// one reload, stamped with its time, and the shell takes it at startup
// (takeResume). The page's layer entries (layer-history.ts) are stepped back
// over first, so Back after the reload behaves as after a fresh entry. That
// step's popstate is the reload's alone, so it stops there before the layer
// controller reads it as a Back press.
export const reloadInto = (workflow: Workflow): void => {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ workflow, at: Date.now() }));
  } catch {
    // Without storage the reload opens on the entry screen.
  }
  const depth = (history.state as { maticMapLayer?: { depth?: number } } | null)?.maticMapLayer?.depth;
  if (!depth) {
    location.reload();
    return;
  }
  addEventListener("popstate", (event) => {
    event.stopImmediatePropagation();
    location.reload();
  }, { capture: true, once: true });
  history.go(-depth);
};

/**
 * Reads and clears the workflow a Try again reload was pressed in, if it was
 * pressed within the last 30 s; the workflow itself is unchecked.
 */
export const takeResume = (): string | null => {
  try {
    const stored = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    const { workflow, at } = JSON.parse(stored ?? "null") ?? {};
    const age = Date.now() - at;
    return typeof workflow === "string" && age >= 0 && age <= RESUME_MS ? workflow : null;
  } catch {
    return null;
  }
};

/** The one line a surface shows for a chunk it needs, until the chunk is ready. */
export const chunkStatus = (
  status: ChunkStatus,
  localize: Localize | undefined,
  retry: (event: Event) => void,
) => status === "ready"
  ? nothing
  : status === "failed"
    ? html`<div class="problem" role="alert"><p>${translate(localize, "v4_workflow_load_failed", "The cleaning tools didn't load. Reload the page to try again.")}</p><button class="ms-btn ms-btn--secondary" type="button" data-dialog-launcher="discardDraft" @click=${retry}>${translate(localize, "v4_retry", "Try again")}</button></div>`
    : html`<p class="loading" role="status">${translate(localize, "v4_workflow_loading", "Loading…")}</p>`;
