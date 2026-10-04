import { LitElement, css, html } from "lit";
import { controls } from "./controls";
import { icon, iconCopy } from "./icons";
import { base, tokens } from "./tokens";
import type { Localize, WorkspaceState } from "./contracts";
import { translate } from "./localize";
import { initialWorkspaceState } from "./state";

export const DIAGNOSTICS_TAG = "matic-map-diagnostics-v4";

/** Support details are loaded only when the user opens Map diagnostics. */
export class MaticMapDiagnosticsV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    disabled: { type: Boolean },
    _copyStatus: { state: true },
  };

  static override styles = [tokens, base, controls, css`
:host { display: block; min-inline-size: 0; }
.stack { display: grid; gap: var(--ms-space-3); }
.subtle { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.diagnostics { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--ms-space-2) var(--ms-space-3); margin: 0; font-size: var(--ms-t-xs); }
.diagnostics dt { color: var(--ms-text-quiet); }
.diagnostics dd { margin: 0; font-weight: var(--ms-w-medium); }
.toolbar { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.copy-status { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
`];

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;
  disabled = false;
  _copyStatus: "idle" | "copied" | "failed" = "idle";
  #copyTimer: ReturnType<typeof setTimeout> | undefined;

  override disconnectedCallback(): void {
    if (this.#copyTimer !== undefined) clearTimeout(this.#copyTimer);
    this.#copyTimer = undefined;
    super.disconnectedCallback();
  }

  #t(key: string, fallback: string): string {
    return translate(this.localize, key, fallback);
  }

  #supportRows(): ReadonlyArray<readonly [string, string]> {
    const entry = this.state.resources.entry;
    const yes = this.#t("v4_yes", "Yes");
    const no = this.#t("v4_no", "No");
    const seen = this.#t("v4_seen", "Seen");
    const notSeen = this.#t("v4_not_seen", "Not seen");
    const unknown = this.#t("v4_unknown", "Unknown");
    return [
      [this.#t("v4_connection", "Connection"), this.state.host.connected ? this.#t("v4_connected", "Connected") : this.#t("v4_offline", "Offline")],
      [this.#t("v4_map_state", "Map state"), String(this.state.coherence)],
      [this.#t("v4_floor_verified", "Floor verified"), this.state.map.floorCoherent ? yes : no],
      [this.#t("v4_session_verified", "Session verified"), this.state.map.sessionVerified ? yes : no],
      [this.#t("v4_map_complete", "Map complete"), this.state.map.complete ? yes : no],
      [this.#t("v4_map_health", "Map health"), entry?.health || unknown],
      [this.#t("v4_blocked_by", "Blocked by"), entry?.mapBlockReason?.replaceAll("_", " ") || this.#t("v4_nothing", "Nothing")],
      [this.#t("v4_startup_map", "Startup map check"), entry?.bootstrapState?.replaceAll("_", " ") || unknown],
      [this.#t("v4_startup_photo", "Startup photo layer"), entry?.bootstrapPhotoSeen ? seen : notSeen],
      [this.#t("v4_startup_structure", "Startup structure layer"), entry?.bootstrapStructureSeen ? seen : notSeen],
      [this.#t("v4_startup_failures", "Startup failures"), String(entry?.bootstrapFailures || 0)],
      [this.#t("v4_stream_failures", "Stream failures"), String(entry?.streamFailures || 0)],
      [this.#t("v4_saved_floor_count", "Saved floor count"), String(this.state.floor.classifiedCount)],
    ];
  }

  #setCopyStatus(status: "idle" | "copied" | "failed"): void {
    if (this.#copyTimer !== undefined) clearTimeout(this.#copyTimer);
    this.#copyTimer = undefined;
    this._copyStatus = status;
    if (status === "copied") {
      this.#copyTimer = setTimeout(() => {
        this.#copyTimer = undefined;
        this._copyStatus = "idle";
      }, 2000);
    }
  }

  #legacyCopy(summary: string, restoreTarget?: HTMLElement | null): boolean {
    if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
    const active = restoreTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const textarea = document.createElement("textarea");
    textarea.value = summary;
    textarea.readOnly = true;
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.cssText = "position:fixed;inset-block-start:-1000px;inline-size:1px;block-size:1px;opacity:0";
    document.body.append(textarea);
    textarea.select();
    textarea.setSelectionRange(0, summary.length);
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
      active?.focus({ preventScroll: true });
    }
  }

  async #copySummary(source?: EventTarget | null): Promise<void> {
    const summary = this.#supportRows().map(([label, value]) => `${label}: ${value}`).join("\n");
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      try {
        await clipboard.writeText(summary);
        this.#setCopyStatus("copied");
        return;
      } catch {
        // LAN origins can expose the API but reject writes; fall back to selection copy.
      }
    }
    this.#setCopyStatus(this.#legacyCopy(summary, source instanceof HTMLElement ? source : null) ? "copied" : "failed");
  }

  protected override render() {
    const copyStatus = this._copyStatus === "copied"
      ? this.#t("v4_copied", "Copied")
      : this._copyStatus === "failed"
        ? this.#t("v4_copy_failed", "The summary could not be copied. Select the text to copy it by hand.")
        : "";
    return html`
      <div class="stack">
        <p class="subtle">${this.#t("v4_support_privacy", "This summary contains no map, coordinates, room or floor names, device identifiers, addresses, or credentials.")}</p>
        <dl class="diagnostics">
          ${this.#supportRows().map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}
        </dl>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" ?disabled=${this.disabled} @click=${(event: Event) => void this.#copySummary(event.currentTarget)}>${icon(iconCopy)}<span>${this.#t("v4_copy_summary", "Copy summary")}</span></button>
        </div>
        <p class="copy-status" role="status" aria-live="polite">${copyStatus}</p>
      </div>
    `;
  }
}

if (!customElements.get(DIAGNOSTICS_TAG)) {
  customElements.define(DIAGNOSTICS_TAG, MaticMapDiagnosticsV4);
}
