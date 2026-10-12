import { html, type ReactiveControllerHost } from "lit";

export type ChunkStatus = "idle" | "loading" | "ready" | "failed";

// copy-style-0.5.md:83: a loading line never stays up without a timeout and a
// recovery action. Twenty seconds is the panel's one "taking too long" mark
// (shell.md §5, Locating).
const TIMEOUT_MS = 20_000;

/**
 * A chunk an element imports on first use: idle → loading → ready | failed.
 * Anything that rejects or throws while loading, a constructor included,
 * counts as failed, and so does a load still pending at the timeout.
 *
 * Failed is final for the page. The browser keeps a failed module fetch for
 * the life of the document (the HTML module map: Chromium, WebKit and Firefox
 * all refuse a second import of the same URL), and after an update the old
 * versioned chunk path is gone, so Try again reloads the page.
 */
export class LazyChunk<T> {
  status: ChunkStatus = "idle";
  value: T | undefined;
  readonly #host: ReactiveControllerHost;
  readonly #load: () => Promise<T>;
  #request: Promise<T | undefined> | undefined;

  constructor(host: ReactiveControllerHost, load: () => Promise<T>) {
    this.#host = host;
    this.#load = load;
  }

  /** Starts the load once and resolves to the value, or undefined if it failed. */
  request(): Promise<T | undefined> {
    this.#request ??= this.#start();
    return this.#request;
  }

  async #start(): Promise<T | undefined> {
    this.status = "loading";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      this.value = await Promise.race([
        this.#load(),
        new Promise<never>((_, reject) => { timer = setTimeout(reject, TIMEOUT_MS); }),
      ]);
      this.status = "ready";
    } catch {
      this.status = "failed";
    }
    clearTimeout(timer);
    this.#host.requestUpdate();
    return this.value;
  }
}

const reload = (): void => location.reload();

/** The one line a surface shows for a chunk that is not ready yet. */
export const chunkStatus = (
  status: Exclude<ChunkStatus, "ready">,
  t: (key: string, fallback: string) => string,
) => status === "failed"
  ? html`<div class="problem" role="alert">
      <p>${t("v4_workflow_load_failed", "Workspace tools could not be loaded.")}</p>
      <button class="ms-btn ms-btn--secondary" type="button" @click=${reload}>${t("v4_retry", "Try again")}</button>
    </div>`
  : html`<p class="loading" role="status">${t("v4_workflow_loading", "Loading workspace tools…")}</p>`;
