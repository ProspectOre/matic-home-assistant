import { LitElement, nothing, type PropertyValues } from "lit";
import { html, unsafeStatic } from "lit/static-html.js";
import { ARCHIVE_PANEL_TAG, ARCHIVE_WORKSPACE_TAG, MAP_COMPARISON_TAG } from "./element-tags";
import type { MaticBackend } from "./backend";
import type { DateFormat, Localize, WorkspaceIntent, WorkspaceState } from "./contracts";
import { initialWorkspaceState } from "./state";
import { ArchiveClient, archiveErrorMessage } from "./archive-client";
import type { ArchiveCatalog, ArchiveMutation } from "./archive-contracts";
import { LazyChunk, chunkStatus } from "./lazy-chunk";
import { translate } from "./localize";
import "./archive-panel";

const archiveTag = unsafeStatic(ARCHIVE_PANEL_TAG);
const comparisonTag = unsafeStatic(MAP_COMPARISON_TAG);

const destructiveMutation = (action: ArchiveMutation["action"]): boolean =>
  action === "delete" || action === "permanent_delete";

const ambiguousMutationFailure = (error: unknown): boolean => {
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  return typeof status !== "number" || status === 408 || status === 425 || status >= 500;
};

/** Owns archive transport and readback for one visible, authorized history workspace. */
export class MaticArchiveWorkspaceV4 extends LitElement {
  static override properties = {
    state: { attribute: false }, backend: { attribute: false }, localize: { attribute: false },
    dates: { attribute: false }, emit: { attribute: false },
    _catalog: { state: true }, _busy: { state: true }, _message: { state: true },
    _error: { state: true }, _pair: { state: true },
  };
  state: WorkspaceState = initialWorkspaceState();
  backend: MaticBackend | null = null;
  localize?: Localize;
  dates?: DateFormat;
  emit: (intent: WorkspaceIntent) => void = () => {};
  _catalog: ArchiveCatalog | null = null;
  _busy = false;
  _message = "";
  _error = "";
  _pair: readonly [string, string] | null = null;
  readonly #comparison = new LazyChunk(this, () => import("./map-comparison-element"));
  #key = "";
  #deniedKey = "";
  #controller: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #historyResource: WorkspaceState["resources"]["history"] | null = null;
  #refreshQueued = false;
  #download: string | null = null;
  #downloadTimer: ReturnType<typeof setTimeout> | undefined;

  #contextKey(): string {
    const { host, owner, pageActive, selection, workflow } = this.state;
    const key = this.isConnected && this.backend && host.administrator && host.connected && pageActive
      && workflow === "history" && owner && selection.entryId
      ? JSON.stringify([owner.userKey, selection.entryId]) : "";
    return key === this.#deniedKey ? "" : key;
  }

  protected override willUpdate(changed: PropertyValues): void {
    const key = this.#contextKey();
    const history = this.state.resources.history;
    const historyChanged = changed.has("state") && history !== this.#historyResource;
    this.#historyResource = history;
    if (key !== this.#key || changed.has("backend")) {
      this.#reset();
      this.#key = key;
      if (key) void this.#refresh();
    } else if (key && historyChanged && history.status !== "loading") {
      // The REST history catalog is refreshed on workspace history
      // invalidations. Saved-map names, retention and storage state share that
      // invalidation boundary, so refresh the management readback immediately.
      this.#requestRefresh();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#reset();
    this.#key = "";
  }

  #reset(): void {
    this.#controller?.abort(); this.#controller = null;
    clearTimeout(this.#timer); clearTimeout(this.#downloadTimer);
    this.#refreshQueued = false;
    if (this.#download) URL.revokeObjectURL(this.#download);
    this.#download = null;
    this._catalog = null; this.#setPair(null); this._busy = false;
    this._message = ""; this._error = "";
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    if (this.#contextKey()) this.#timer = setTimeout(() => { void this.#refresh(false); }, 15_000);
  }

  #requestRefresh(): void {
    if (!this.#contextKey()) return;
    if (this.#controller) { this.#refreshQueued = true; return; }
    void this.#refresh(false);
  }

  #afterRequest(): void {
    if (!this.#contextKey()) return;
    if (this.#refreshQueued) {
      this.#refreshQueued = false;
      void this.#refresh(false);
    } else this.#schedule();
  }

  #refreshHistoryView(historyId?: string): void {
    this.emit({ type: "refresh-history", ...(historyId ? { historyId } : {}) });
  }

  #setPair(ids: readonly [string, string] | null): void {
    const changed = Boolean(ids) !== Boolean(this._pair);
    this._pair = ids;
    if (changed) this.emit({ type: "set-comparison-active", value: Boolean(ids) });
  }

  #failure(error: unknown, key: string): void {
    const status = error && typeof error === "object" && "status" in error ? error.status : null;
    if (status === 401 || status === 403) {
      this.#deniedKey = key;
      this._catalog = null; this.#setPair(null);
      this.emit({ type: "archive-access-denied" });
    }
    this._error = archiveErrorMessage(error, this.localize);
  }

  async #refresh(clearError = true): Promise<void> {
    if (!this.backend || !this.#contextKey() || this.#controller) return;
    const controller = new AbortController();
    const key = this.#key;
    this.#refreshQueued = false;
    this.#controller = controller;
    try {
      const catalog = await new ArchiveClient(this.backend).catalog(this.state.selection.entryId!, controller.signal);
      if (controller.signal.aborted || this.#key !== key || this.#contextKey() !== key) return;
      const changed = this._catalog !== null && catalog.generation !== this._catalog.generation;
      this._catalog = catalog;
      if (clearError) this._error = "";
      if (changed) this.#refreshHistoryView();
    } catch (error) {
      if (!controller.signal.aborted && this.#key === key && this.#contextKey() === key) this.#failure(error, key);
    } finally {
      if (this.#controller === controller) { this.#controller = null; this.#afterRequest(); }
    }
  }

  async #run(operation: (client: ArchiveClient, entryId: string, signal: AbortSignal) => Promise<void>): Promise<void> {
    const key = this.#contextKey();
    if (!key || !this.backend || this._busy) return;
    this.#controller?.abort();
    clearTimeout(this.#timer);
    const controller = new AbortController();
    this.#controller = controller;
    this._busy = true; this._error = ""; this._message = "";
    try {
      const client = new ArchiveClient(this.backend);
      const entryId = this.state.selection.entryId!;
      await operation(client, entryId, controller.signal);
      const catalog = await client.catalog(entryId, controller.signal);
      if (controller.signal.aborted || this.#contextKey() !== key) return;
      this._catalog = catalog;
      this._message = translate(this.localize, "v4_archive_refreshed", "Saved maps refreshed");
      this.#refreshHistoryView();
    } catch (error) {
      if (!controller.signal.aborted && this.#contextKey() === key) this.#failure(error, key);
    } finally {
      if (this.#controller === controller) {
        this.#controller = null; this._busy = false; this.#afterRequest();
      }
    }
  }

  readonly #mutate = (request: ArchiveMutation): void => {
    if (request.expectedGeneration !== this._catalog?.generation) { void this.#refresh(); return; }
    const key = this.#contextKey();
    void this.#run(async (client, entry, signal) => {
      const invalidate = (): void => {
        this._catalog = null; this.#setPair(null);
        this.emit({ type: "invalidate-history", historyIds: request.recordIds });
      };
      try {
        await client.mutate(entry, request, signal);
      } catch (error) {
        if (destructiveMutation(request.action) && ambiguousMutationFailure(error)
          && !signal.aborted && this.#contextKey() === key) {
          // The server may have committed before the acknowledgement was lost.
          // Drop any selected scene first, then read the authoritative catalog.
          invalidate();
          try {
            const catalog = await client.catalog(entry, signal);
            if (!signal.aborted && this.#contextKey() === key) {
              this._catalog = catalog;
              this.#refreshHistoryView();
            }
          } catch (readError) {
            if (!signal.aborted && this.#contextKey() === key) {
              const status = readError && typeof readError === "object" && "status" in readError
                ? readError.status : null;
              if (status === 401 || status === 403) this.#failure(readError, key);
            }
          }
        }
        throw error;
      }
      if (signal.aborted || this.#contextKey() !== key) return;
      if (destructiveMutation(request.action)) invalidate();
    });
  };

  readonly #import = (file: File): void => {
    const generation = this._catalog?.generation;
    if (generation === undefined) return;
    const id = crypto.randomUUID();
    void this.#run(async (client, entry, signal) => { await client.importArchive(entry, file, generation, id, signal); });
  };

  readonly #export = (ids: readonly string[]): void => {
    const generation = this._catalog?.generation;
    if (generation === undefined) return;
    const key = this.#contextKey();
    void this.#run(async (client, entry, signal) => {
      const archive = await client.exportArchive(entry, ids, generation, signal);
      if (signal.aborted || this.#contextKey() !== key || this.state.selection.entryId !== entry) return;
      if (this.#download) URL.revokeObjectURL(this.#download);
      clearTimeout(this.#downloadTimer);
      this.#download = URL.createObjectURL(new Blob([JSON.stringify(archive)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = this.#download; link.download = "matic-saved-maps.json"; link.click();
      this.#downloadTimer = setTimeout(() => {
        if (this.#download) URL.revokeObjectURL(this.#download);
        this.#download = null;
      }, 60_000);
    });
  };

  protected override render() {
    const authorized = Boolean(this.#contextKey());
    if (this._pair) this.#comparison.request();
    return html`
      ${!this._pair ? html`<${archiveTag} .catalog=${this._catalog} .entryId=${this.state.selection.entryId ?? ""}
        .busy=${this._busy} .authorized=${authorized} .message=${this._message} .error=${this._error}
        .localize=${this.localize} .dates=${this.dates} .onAction=${this.#mutate} .onImport=${this.#import}
        .onExport=${this.#export} .onView=${(id: string) => this.#refreshHistoryView(id)}
        .onCompare=${(ids: readonly [string, string]) => { this.#setPair(ids); }}
        .onRefresh=${() => { this.#deniedKey = ""; this.#key = this.#contextKey(); void this.#refresh(); }}
      ></${archiveTag}>` : nothing}
      ${this._pair && authorized ? this.#comparison.status === "ready"
        ? html`<${comparisonTag} .backend=${this.backend} .state=${this.state} .catalog=${this._catalog}
            .localize=${this.localize} .dates=${this.dates}
            .recordIds=${this._pair} .onSelectionChange=${(ids: readonly [string, string] | null) => { this.#setPair(ids); }}
            .onClose=${() => { this.#setPair(null); }}></${comparisonTag}>`
        : chunkStatus(this.#comparison.status, this.localize, () => { this.#setPair(null); }) : nothing}
    `;
  }
}

if (!customElements.get(ARCHIVE_WORKSPACE_TAG)) customElements.define(ARCHIVE_WORKSPACE_TAG, MaticArchiveWorkspaceV4);
