import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { base, tokens } from "./tokens";
import { controls } from "./controls";
import type { DateFormat, Localize, NoticePlaceholders } from "./contracts";
import { formatDateTime, translate } from "./localize";
import { archiveAction, confirmArchiveAction, prepareArchiveConfirmation, type ArchiveConfirmation } from "./archive-actions";
import { ARCHIVE_MAX_FILE_BYTES, type ArchiveAction, type ArchiveCatalog, type ArchiveMutation, type ArchiveRecord } from "./archive-contracts";
import { ARCHIVE_PANEL_TAG } from "./element-tags";

export { ARCHIVE_PANEL_TAG } from "./element-tags";

/** Accessible archive presentation. All reads, writes and authoritative readbacks belong to the workspace. */
export class MaticArchivePanelV4 extends LitElement {
  static override properties = {
    catalog: { attribute: false }, entryId: { attribute: false }, busy: { type: Boolean },
    authorized: { type: Boolean }, message: { type: String }, error: { type: String },
    localize: { attribute: false }, dates: { attribute: false },
    onAction: { attribute: false }, onImport: { attribute: false }, onExport: { attribute: false },
    onView: { attribute: false }, onCompare: { attribute: false }, onRefresh: { attribute: false },
    _selected: { state: true }, _confirmation: { state: true }, _includeKept: { state: true },
    _names: { state: true }, _filter: { state: true }, _notice: { state: true },
  };
  static override styles = [tokens, base, controls, css`
    :host { display: block; min-inline-size: 0; }
    .stack, .records { display: grid; gap: var(--ms-space-3); }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ms-space-2); }
    .summary, .record, .confirm { padding: var(--ms-space-3); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); }
    h2, h3, p { margin: 0; }
    .record { display: grid; gap: var(--ms-space-2); }
    .quiet { color: var(--ms-text-quiet); font-size: var(--ms-t-sm); }
    .name { display: flex; flex-wrap: wrap; align-items: end; gap: var(--ms-space-2); }
    .name label { display: grid; flex: 1 1 10rem; gap: .25rem; }
    input[type=text] { inline-size: 100%; min-inline-size: 0; }
    label { overflow-wrap: anywhere; }
    .check { display: flex; align-items: center; gap: var(--ms-space-2); min-block-size: 44px; }
    button, input[type=file], select { min-block-size: 44px; }
    .confirm { border-width: 2px; }
    ul { margin: 0; padding-inline-start: 1.5rem; }
    .error { color: var(--error-color, var(--ms-text)); }
  `];

  catalog: ArchiveCatalog | null = null;
  entryId = "";
  busy = false;
  authorized = false;
  message = "";
  error = "";
  localize?: Localize;
  dates?: DateFormat;
  onAction: (request: ArchiveMutation) => void = () => {};
  onImport: (file: File) => void = () => {};
  onExport: (ids: readonly string[]) => void = () => {};
  onView: (id: string) => void = () => {};
  onCompare: (ids: readonly [string, string]) => void = () => {};
  onRefresh: () => void = () => {};
  _selected: readonly string[] = [];
  _confirmation: ArchiveConfirmation | null = null;
  _includeKept = false;
  _names: Readonly<Record<string, string>> = {};
  _filter = "active";
  _notice = "";
  #restoreFocus: HTMLElement | null = null;

  #t(key: string, fallback: string, placeholders?: NoticePlaceholders): string {
    return translate(this.localize, key, fallback, placeholders, this.dates);
  }

  protected override willUpdate(changed: PropertyValues): void {
    const prior = changed.get("catalog") as ArchiveCatalog | null | undefined;
    if ((changed.has("catalog") && prior?.generation !== this.catalog?.generation) || changed.has("entryId") || !this.authorized) {
      if (this._confirmation) this._notice = this.#t("v4_archive_changed", "Saved maps changed. Review the current selection before continuing.");
      this._selected = [];
      this._confirmation = null;
      this._includeKept = false;
      this._names = Object.fromEntries(Object.entries(this._names).filter(([id]) => {
        const old = prior?.records.find((row) => row.id === id);
        const current = this.catalog?.records.find((row) => row.id === id);
        return old && current && current.retention !== "trash" && old.contentId === current.contentId && old.name === current.name;
      }));
      if (changed.has("entryId") || !this.authorized) { this._filter = "active"; this._notice = ""; this._names = {}; }
    }
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has("_confirmation")) {
      if (this._confirmation) this.renderRoot.querySelector<HTMLElement>(".confirm h3")?.focus();
      else if (this.#restoreFocus?.isConnected) { this.#restoreFocus.focus(); this.#restoreFocus = null; }
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._selected = []; this._confirmation = null; this._names = {}; this.#restoreFocus = null;
  }

  #label(row: ArchiveRecord): string { return row.name || formatDateTime(row.createdAt, this.dates); }
  #size(bytes: number): string {
    return new Intl.NumberFormat(this.dates?.language, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024));
  }
  #allowed(): boolean { return this.authorized && !this.busy && this.catalog !== null; }
  #selectedRecords(): readonly ArchiveRecord[] { return this.catalog?.records.filter((row) => this._selected.includes(row.id)) ?? []; }
  #select(id: string, checked: boolean): void {
    if (!this.#allowed()) return;
    this._selected = checked ? [...this._selected.filter((value) => value !== id), id] : this._selected.filter((value) => value !== id);
  }
  #act(action: ArchiveAction, ids: readonly string[], name?: string): void {
    if (!this.#allowed() || !this.catalog) return;
    this._notice = "";
    this.onAction(archiveAction(this.catalog, action, ids, crypto.randomUUID(), name));
  }
  #confirm(action: ArchiveConfirmation["action"], ids: readonly string[], trigger?: EventTarget | null): void {
    if (!this.#allowed() || !this.catalog) return;
    // Safari does not focus buttons on pointer activation. Remember the actual
    // trigger rather than whichever control happened to own focus beforehand.
    this.#restoreFocus = trigger instanceof HTMLElement ? trigger : this.shadowRoot?.activeElement as HTMLElement | null;
    this._confirmation = prepareArchiveConfirmation(this.catalog, action, ids, crypto.randomUUID());
    this._includeKept = false;
  }
  #submitConfirmation(): void {
    if (!this.#allowed() || !this.catalog || !this._confirmation) return;
    try {
      const request = confirmArchiveAction(this._confirmation, this.catalog, this._includeKept);
      this._confirmation = null;
      this.onAction(request);
    } catch { this._confirmation = null; this._notice = this.#t("v4_archive_changed", "Saved maps changed. Review the current selection before continuing."); }
  }

  #import(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !this.#allowed()) return;
    if (file.size > ARCHIVE_MAX_FILE_BYTES) { this._notice = this.#t("v4_archive_file_limit", "Choose an archive no larger than 68 MiB."); return; }
    this.onImport(file);
  }

  #confirmation() {
    const value = this._confirmation;
    if (!value) return nothing;
    const kept = value.records.filter((row) => row.retention === "kept").length;
    const permanent = value.action === "permanent_delete";
    const unkeep = value.action === "unkeep";
    const title = permanent ? this.#t("v4_archive_confirm_permanent", "Permanently delete these saved maps?")
      : unkeep ? this.#t("v4_archive_confirm_unkeep", "Allow automatic replacement?") : this.#t("v4_archive_confirm_delete", "Move these saved maps to Recently deleted?");
    return html`<section class="confirm stack" role="region" aria-labelledby="archive-confirm-title" @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape" && !this.busy) { event.stopPropagation(); this._confirmation = null; } }}>
      <h3 id="archive-confirm-title" tabindex="-1">${title}</h3>
      <ul>${value.records.map((row) => html`<li>${this.#label(row)} — ${formatDateTime(row.createdAt, this.dates)}</li>`)}</ul>
      <p>${permanent ? this.#t("v4_archive_permanent_warning", "This cannot be undone. Exports and backups remain independent copies. Space is reclaimed only after stored data and active readers are released.")
        : unkeep ? this.#t("v4_archive_unkeep_warning", "These maps become eligible for automatic replacement when new history needs space.")
          : this.#t("v4_archive_delete_warning", "Restore is available for 24 hours. These maps continue to count against storage until permanently removed. Open views and comparisons using them will become unavailable.")}</p>
      ${kept && !unkeep ? html`<label class="check"><input type="checkbox" .checked=${this._includeKept} ?disabled=${this.busy} @change=${(event: Event) => { this._includeKept = (event.currentTarget as HTMLInputElement).checked; }}>${this.#t("v4_archive_include_kept", "Include {count} explicitly selected kept maps", { count: String(kept) })}</label>` : nothing}
      <div class="toolbar"><button type="button" ?disabled=${this.busy} @click=${() => { this._confirmation = null; }}>${this.#t("v4_archive_cancel", "Cancel")}</button>
      <button type="button" ?disabled=${this.busy || (kept > 0 && !unkeep && !this._includeKept)} @click=${() => this.#submitConfirmation()}>${permanent ? this.#t("v4_archive_permanent", "Delete permanently") : unkeep ? this.#t("v4_archive_unkeep", "Unkeep") : this.#t("v4_archive_delete", "Move to Recently deleted")}</button></div>
    </section>`;
  }

  #row(row: ArchiveRecord) {
    const trash = row.retention === "trash";
    return html`<article class="record">
      <label class="check"><input type="checkbox" .checked=${this._selected.includes(row.id)} ?disabled=${this.busy} @change=${(event: Event) => this.#select(row.id, (event.currentTarget as HTMLInputElement).checked)}>${this.#label(row)}</label>
      <p class="quiet">${formatDateTime(row.createdAt, this.dates)} · ${this.#t("v4_archive_size", "{size} MiB compressed", { size: this.#size(row.compressedBytes) })} · ${row.retention === "kept" ? this.#t("v4_archive_kept", "Kept") : trash ? this.#t("v4_archive_trash", "Recently deleted") : this.#t("v4_archive_automatic", "Automatic")}${row.imported ? html` · ${this.#t("v4_archive_imported", "Imported")}` : nothing}</p>
      ${trash ? html`<p>${row.deletedUntil ? this.#t("v4_archive_restore_until", "Restore until {date}", { date: { date: row.deletedUntil } }) : this.#t("v4_archive_expiry_unknown", "Restore deadline unavailable")}</p>
        <div class="toolbar"><button type="button" ?disabled=${this.busy} @click=${() => this.#act("restore", [row.id])}>${this.#t("v4_archive_restore", "Restore")}</button><button type="button" ?disabled=${this.busy} @click=${(event: Event) => this.#confirm("permanent_delete", [row.id], event.currentTarget)}>${this.#t("v4_archive_permanent", "Delete permanently")}</button></div>`
        : html`<div class="name"><label>${this.#t("v4_archive_name", "Name")}<input type="text" maxlength="128" .value=${this._names[row.id] ?? row.name ?? ""} ?disabled=${this.busy} @input=${(event: Event) => { this._names = { ...this._names, [row.id]: (event.currentTarget as HTMLInputElement).value }; }}></label><button type="button" ?disabled=${this.busy || this._names[row.id] === undefined || this._names[row.id] === (row.name ?? "")} @click=${() => this.#act("rename", [row.id], this._names[row.id] ?? "")}>${this.#t("v4_archive_save_name", "Save name")}</button></div>
        <div class="toolbar"><button type="button" ?disabled=${this.busy || !row.sceneUrl} @click=${() => { if (this.#allowed()) this.onView(row.id); }}>${this.#t("v4_archive_view", "View")}</button>
        <button type="button" ?disabled=${this.busy} @click=${(event: Event) => row.retention === "kept" ? this.#confirm("unkeep", [row.id], event.currentTarget) : this.#act("keep", [row.id])}>${row.retention === "kept" ? this.#t("v4_archive_unkeep", "Unkeep") : this.#t("v4_archive_keep", "Keep")}</button>
        <button type="button" ?disabled=${this.busy} @click=${() => { if (this.#allowed()) this.onExport([row.id]); }}>${this.#t("v4_archive_export", "Export")}</button>
        <button type="button" ?disabled=${this.busy} @click=${(event: Event) => this.#confirm("delete", [row.id], event.currentTarget)}>${this.#t("v4_archive_delete", "Move to Recently deleted")}</button></div>`}
    </article>`;
  }

  protected override render() {
    if (!this.authorized) return html`<div class="stack"><p role="status">${this.#t("v4_archive_admin", "Administrator access is required to manage saved maps.")}</p><button type="button" ?disabled=${this.busy} @click=${() => { if (!this.busy) this.onRefresh(); }}>${this.#t("v4_archive_retry_access", "Retry access")}</button></div>`;
    const catalog = this.catalog;
    const selected = this.#selectedRecords();
    const active = selected.filter((row) => row.retention !== "trash");
    const trash = catalog?.records.filter((row) => row.retention === "trash") ?? [];
    const automatic = catalog?.records.filter((row) => row.retention === "automatic") ?? [];
    const rows = catalog?.records.filter((row) => this._filter === "trash" ? row.retention === "trash" : this._filter === "kept" ? row.retention === "kept" : row.retention !== "trash") ?? [];
    return html`<div class="stack" aria-busy=${String(this.busy)}>
      <h2>${this.#t("v4_archive_title", "Maps & storage")}</h2>
      <p class="quiet">${this.#t("v4_archive_local_only", "Saved maps are local history. These controls do not change the robot’s working map, plans, areas, run records or camera photos.")}</p>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <p role="status" aria-live="polite">${this.busy ? this.#t("v4_archive_pending", "Waiting for saved-map confirmation…") : this._notice || this.message}</p>
      <div class="toolbar"><button type="button" ?disabled=${this.busy} @click=${() => { if (!this.busy) this.onRefresh(); }}>${this.#t("v4_archive_refresh", "Refresh")}</button>
      ${catalog ? html`<button type="button" ?disabled=${this.busy} @click=${() => this.#act(catalog.capturePaused ? "resume_capture" : "pause_capture", [])}>${catalog.capturePaused ? this.#t("v4_archive_resume", "Resume automatic history") : this.#t("v4_archive_pause", "Pause automatic history")}</button>` : nothing}</div>
      ${catalog ? html`<section class="summary stack">
        <p>${this.#t("v4_archive_quota", "{count} of 12 maps · {size} of 48 MiB compressed", { count: String(catalog.usage.recordCount), size: this.#size(catalog.usage.compressedBytes) })}</p>
        <p>${this.#t("v4_archive_counts", "Automatic: {automatic} · Kept: {kept} · Recently deleted: {trash}", { automatic: String(catalog.usage.automaticCount), kept: String(catalog.usage.keptCount), trash: String(catalog.usage.trashCount) })}</p>
        <p>${catalog.capturePaused ? this.#t("v4_archive_paused", "Automatic history is paused.") : this.#t("v4_archive_enabled", "Automatic history is on. Unkept maps may be replaced; Keep versions you need.")}</p>
        ${!catalog.capturePaused && catalog.capacityBlocked ? html`<p role="status">${this.#t("v4_archive_capacity_blocked", "Automatic history will resume when space is available.")}</p>` : nothing}
        <p class="quiet">${this.#t("v4_archive_entry_quota", "The quota is shared across this robot’s floors, including kept and recently deleted maps. Disk usage is not measured here; compressed map size is not actual disk usage.")}</p>
        ${catalog.usage.reservedCount || catalog.usage.reservedBytes ? html`<p>${this.#t("v4_archive_reserved", "Capture reservation: {count} slots, {size} MiB", { count: String(catalog.usage.reservedCount), size: this.#size(catalog.usage.reservedBytes) })}</p>` : nothing}
      </section>
      <label>${this.#t("v4_archive_show", "Show")} <select .value=${this._filter} ?disabled=${this.busy} @change=${(event: Event) => { this._filter = (event.currentTarget as HTMLSelectElement).value; this._selected = []; this._confirmation = null; }}><option value="active">${this.#t("v4_archive_active", "Active saved maps")}</option><option value="kept">${this.#t("v4_archive_kept", "Kept")}</option><option value="trash">${this.#t("v4_archive_trash", "Recently deleted")}</option></select></label>
      <div class="toolbar">
        <button type="button" ?disabled=${this.busy || automatic.length === 0 || this._filter !== "active"} @click=${() => { this._selected = automatic.map((row) => row.id); }}>${this.#t("v4_archive_select_automatic", "Select all automatic maps")}</button>
        <button type="button" ?disabled=${this.busy || selected.length === 0} @click=${() => { this._selected = []; }}>${this.#t("v4_archive_clear_selection", "Clear selection")}</button>
        <button type="button" ?disabled=${this.busy || active.length !== selected.length || active.length === 0} @click=${() => { if (this.#allowed()) this.onExport(active.map((row) => row.id)); }}>${this.#t("v4_archive_export_selected", "Export selected")}</button>
        <button type="button" ?disabled=${this.busy || active.length !== 2 || selected.length !== 2} @click=${() => { if (this.#allowed() && active[0] && active[1]) this.onCompare([active[0].id, active[1].id]); }}>${this.#t("v4_archive_compare_selected", "Compare selected")}</button>
        <button type="button" ?disabled=${this.busy || active.length !== selected.length || active.length === 0} @click=${(event: Event) => this.#confirm("delete", active.map((row) => row.id), event.currentTarget)}>${this.#t("v4_archive_delete_selected", "Move selected to Recently deleted")}</button>
        <button type="button" ?disabled=${this.busy || trash.length === 0} @click=${(event: Event) => this.#confirm("permanent_delete", trash.map((row) => row.id), event.currentTarget)}>${this.#t("v4_archive_empty_trash", "Empty recently deleted")}</button>
      </div>
      ${this.#confirmation()}
      <div class="records">${rows.length ? rows.map((row) => this.#row(row)) : html`<p>${this.#t("v4_archive_empty", "No saved maps in this view.")}</p>`}</div>
      <section class="stack"><h3>${this.#t("v4_archive_import_title", "Import an archive")}</h3><p class="quiet">${this.#t("v4_archive_privacy", "Archives contain your home’s layout and imagery. Export downloads a local copy; it does not share or delete maps. Imported maps are historical only and cannot restore the robot’s navigation map.")}</p>
      <label>${this.#t("v4_archive_import_file", "Choose a map archive (maximum 68 MiB)")}<input type="file" accept="application/json,.json" ?disabled=${this.busy} @change=${(event: Event) => this.#import(event)}></label></section>`
        : html`<p>${this.#t("v4_archive_loading", "Saved-map information is not available yet. Refresh to try again.")}</p>`}
    </div>`;
  }
}

if (!customElements.get(ARCHIVE_PANEL_TAG)) customElements.define(ARCHIVE_PANEL_TAG, MaticArchivePanelV4);
