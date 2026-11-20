import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { BackendError, type MaticBackend } from "./backend";
import { controls } from "./controls";
import type { DateFormat, Localize, NoticePlaceholders, PhotoMarks, WorkspaceIntent } from "./contracts";
import { translate } from "./localize";
import type { GalleryViewpoint } from "./photo-gallery-data";
import { base, tokens } from "./tokens";

export const VIEWPOINT_EDITOR_TAG = "matic-viewpoint-editor-v4";

/** One press of Turn left or Turn right. */
const TURN = Math.PI / 12;

/** What the server's refusal means to someone placing a viewpoint. */
const REFUSALS: Readonly<Record<string, readonly [string, string]>> = {
  viewpoint_name_invalid: ["v4_viewpoint_name_invalid", "Give the viewpoint a name of up to 64 characters."],
  viewpoint_name_taken: ["v4_viewpoint_name_taken", "Another viewpoint already has this name."],
  viewpoint_name_is_room: ["v4_viewpoint_name_is_room", "A room has this name. Choose another, so a photo tour stop can't mean either."],
  viewpoint_limit: ["v4_viewpoint_limit", "This robot has 50 viewpoints. Delete one to save another."],
  viewpoint_outside_rooms: ["v4_viewpoint_outside_rooms", "Place the viewpoint inside a room."],
  viewpoint_room_no_photo: ["v4_viewpoint_room_no_photo", "Photos are off in this room. Place the viewpoint in another room."],
  viewpoint_in_no_go_zone: ["v4_viewpoint_in_no_go_zone", "That spot is in or next to a no-go zone. Move it at least 25 cm away."],
  viewpoint_zones_unavailable: ["v4_viewpoint_zones_unavailable", "The robot's no-go zones can't be read right now. Try again shortly."],
  viewpoint_map_unavailable: ["v4_viewpoint_map_changed", "The robot's map changed. Cancel, then place the viewpoint again."],
  map_changed: ["v4_viewpoint_map_changed", "The robot's map changed. Cancel, then place the viewpoint again."],
};

/**
 * Photos' viewpoints: the list with Delete, and placing a new one. Placing
 * puts a draft in the workspace state, so a map tap sets its spot and later
 * taps aim it; the turn buttons aim it without the map.
 */
export class MaticViewpointEditorV4 extends LitElement {
  static override properties = {
    backend: { attribute: false },
    entryId: { attribute: false },
    localize: { attribute: false },
    dates: { attribute: false },
    emit: { attribute: false },
    viewpoints: { attribute: false },
    marks: { attribute: false },
    _name: { state: true },
    _error: { state: true },
    _busy: { state: true },
    _confirm: { state: true },
  };

  static override styles = [tokens, base, controls, css`
:host { display: block; }
section { display: grid; gap: var(--ms-space-2); }
h3 { margin: 0; font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); }
p { margin: 0; font-size: var(--ms-t-sm); line-height: var(--ms-lh-snug); }
.subtle { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
ul { display: grid; gap: var(--ms-space-1); margin: 0; padding: 0; list-style: none; }
li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--ms-space-2); min-block-size: var(--ms-control-sm); font-size: var(--ms-t-sm); }
.actions { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.ms-field { display: grid; gap: var(--ms-space-1); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
.draft { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-3); border: 1px solid var(--ms-line-strong); border-radius: var(--ms-radius-md); }
[role="alert"] { color: color-mix(in srgb, var(--ms-danger) 82%, var(--ms-text)); }
`];

  backend: MaticBackend | null = null;
  entryId: string | null = null;
  localize?: Localize;
  dates?: DateFormat;
  emit: (intent: WorkspaceIntent) => void = () => {};
  /** Every saved viewpoint, on any map. */
  viewpoints: readonly GalleryViewpoint[] = [];
  /** The marks on the map Photos shows; null while that map is unknown. */
  marks: PhotoMarks | null = null;
  _name = "";
  _error: string | null = null;
  _busy = false;
  /** The viewpoint whose Delete was pressed once. */
  _confirm: string | null = null;
  #placing = false;
  /** Focus Add viewpoint once it is back, after a save, cancel or delete. */
  #returnFocus = false;

  protected override updated(changed: PropertyValues<this>): void {
    const placing = !!this.marks?.draft;
    if (placing && !this.#placing) this.renderRoot.querySelector<HTMLInputElement>("input")?.focus();
    this.#placing = placing;
    if (changed.has("_confirm") && this._confirm) this.renderRoot.querySelector<HTMLButtonElement>(".confirm .ms-btn--danger")?.focus();
    // The list and the draft arrive back through the workspace, a render or two after the press.
    const add = this.#returnFocus && this.renderRoot.querySelector<HTMLButtonElement>(".add");
    if (add) {
      add.focus();
      this.#returnFocus = false;
    }
  }

  #t(key: string, fallback: string, placeholders?: NoticePlaceholders): string {
    return translate(this.localize, key, fallback, placeholders, this.dates);
  }

  #start(): void {
    this._name = "";
    this._error = null;
    this._confirm = null;
    this.emit({ type: "edit-viewpoint", draft: { spot: null, heading: 0 } });
  }

  #cancel(): void {
    this._error = null;
    this.#returnFocus = true;
    this.emit({ type: "edit-viewpoint", draft: null });
  }

  #turn(direction: 1 | -1): void {
    const draft = this.marks?.draft;
    if (!draft?.spot) return;
    // Left is counter-clockwise from the robot's own view, whatever way the map is turned.
    this.emit({ type: "edit-viewpoint", draft: { ...draft, heading: Math.atan2(Math.sin(draft.heading + direction * TURN), Math.cos(draft.heading + direction * TURN)) } });
  }

  #changed(viewpoints: readonly GalleryViewpoint[]): void {
    this.dispatchEvent(new CustomEvent<readonly GalleryViewpoint[]>("viewpoints-changed", { detail: viewpoints }));
  }

  #refusal(error: unknown): string | null {
    const known = error instanceof BackendError ? REFUSALS[error.code] : undefined;
    return known ? this.#t(...known) : null;
  }

  async #save(event: Event): Promise<void> {
    event.preventDefault();
    const { backend, entryId, marks } = this;
    const draft = marks?.draft;
    if (!backend || !entryId || !draft || this._busy) return;
    const name = this._name.trim();
    if (!draft.spot) {
      this._error = this.#t("v4_viewpoint_place_first", "Tap the map where the robot should stand.");
      return;
    }
    if (!name) {
      this._error = this.#t("v4_viewpoint_name_invalid", "Give the viewpoint a name of up to 64 characters.");
      this.renderRoot.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    this._busy = true;
    this._error = null;
    try {
      const saved = await backend.saveViewpoint(entryId, {
        name, x: draft.spot.x, y: draft.spot.y, heading: draft.heading, map_session_key: marks.mapSessionKey,
      });
      if (!this.isConnected) return;
      this.#changed([...this.viewpoints, saved]);
      // Only the draft this save sent is done; one cancelled, moved or started since stays.
      if (this.marks?.draft === draft) {
        this.#returnFocus = true;
        this.emit({ type: "edit-viewpoint", draft: null });
      }
    } catch (error) {
      this._error = this.#refusal(error) ?? this.#t("v4_viewpoint_save_failed", "Couldn't save the viewpoint. Try again.");
    } finally {
      this._busy = false;
    }
  }

  async #delete(viewpoint: GalleryViewpoint): Promise<void> {
    const { backend, entryId } = this;
    if (!backend || !entryId || this._busy) return;
    this._busy = true;
    this._error = null;
    try {
      await backend.deleteViewpoint(entryId, viewpoint.id);
      this.#gone(viewpoint);
    } catch (error) {
      // A viewpoint already gone needs no retry; the list just drops it.
      if (error instanceof BackendError && error.status === 404) this.#gone(viewpoint);
      else this._error = this.#t("v4_viewpoint_delete_failed", "Couldn't delete the viewpoint. Try again.");
    } finally {
      this._busy = false;
    }
  }

  #gone(viewpoint: GalleryViewpoint): void {
    this._confirm = null;
    // While a viewpoint is placed, focus stays where the person is working.
    this.#returnFocus = !!this.marks && !this.marks.draft;
    this.#changed(this.viewpoints.filter((item) => item.id !== viewpoint.id));
  }

  #row(viewpoint: GalleryViewpoint) {
    if (this._confirm === viewpoint.id) {
      return html`<li class="confirm"><p>${this.#t("v4_viewpoint_delete_confirm", "Delete {name}? Photo tours that stop there will stop working.", { name: viewpoint.name })}</p>
        <span class="actions">
          <button class="ms-btn ms-btn--sm ms-btn--primary ms-btn--danger" type="button" aria-disabled=${String(this._busy)} @click=${() => void this.#delete(viewpoint)}>${this.#t("v4_viewpoint_delete", "Delete viewpoint")}</button>
          <button class="ms-btn ms-btn--sm" type="button" @click=${() => { this._confirm = null; }}>${this.#t("v4_keep", "Keep")}</button>
        </span></li>`;
    }
    return html`<li><span>${viewpoint.name}</span>
      <button class="ms-btn ms-btn--sm ms-btn--danger" type="button" aria-label=${this.#t("v4_viewpoint_delete_named", "Delete {name}", { name: viewpoint.name })}
        @click=${() => { this._confirm = viewpoint.id; this._error = null; }}>${this.#t("v4_delete", "Delete")}</button></li>`;
  }

  #draft() {
    const spot = this.marks!.draft!.spot;
    return html`<form class="draft" @submit=${(event: Event) => void this.#save(event)}>
      <p role="status">${spot
        ? this.#t("v4_viewpoint_aim", "Tap the map where the camera should look, or turn it here.")
        : this.#t("v4_viewpoint_place_first", "Tap the map where the robot should stand.")}</p>
      ${spot ? html`<div class="actions">
        <button class="ms-btn ms-btn--sm ms-btn--secondary" type="button" @click=${() => this.#turn(1)}>${this.#t("v4_viewpoint_turn_left", "Turn left")}</button>
        <button class="ms-btn ms-btn--sm ms-btn--secondary" type="button" @click=${() => this.#turn(-1)}>${this.#t("v4_viewpoint_turn_right", "Turn right")}</button>
        <button class="ms-btn ms-btn--sm ms-btn--secondary" type="button" @click=${() => this.emit({ type: "edit-viewpoint", draft: { spot: null, heading: this.marks!.draft!.heading } })}>${this.#t("v4_viewpoint_move", "Move")}</button>
      </div>` : nothing}
      <label class="ms-field">${this.#t("v4_viewpoint_name", "Name")}
        <input type="text" maxlength="64" autocomplete="off" .value=${this._name} @input=${(event: Event) => { this._name = (event.currentTarget as HTMLInputElement).value; }}></label>
      ${this._error ? html`<p role="alert">${this._error}</p>` : nothing}
      <div class="actions">
        <button class="ms-btn ms-btn--primary" type="submit" aria-disabled=${String(this._busy)}>${this._busy ? this.#t("v4_saving", "Saving…") : this.#t("v4_viewpoint_save", "Save viewpoint")}</button>
        <button class="ms-btn" type="button" @click=${() => this.#cancel()}>${this.#t("v4_cancel", "Cancel")}</button>
      </div>
    </form>`;
  }

  protected override render() {
    const placing = !!this.marks?.draft;
    return html`<section>
      <h3>${this.#t("v4_photos_viewpoints", "Saved viewpoints")}</h3>
      ${this.viewpoints.length ? html`<ul>${this.viewpoints.map((viewpoint) => this.#row(viewpoint))}</ul>`
        : html`<p class="subtle">${this.#t("v4_viewpoint_none", "A viewpoint is a spot and direction a photo tour can stop at to take a photo.")}</p>`}
      ${this._error && !placing ? html`<p role="alert">${this._error}</p>` : nothing}
      ${placing ? this.#draft()
        : this.marks ? html`<div><button class="ms-btn ms-btn--secondary add" type="button" @click=${() => this.#start()}>${this.#t("v4_viewpoint_add", "Add viewpoint")}</button></div>`
        : html`<p class="subtle">${this.#t("v4_viewpoint_no_map", "Viewpoints can be added once the robot's current map is shown.")}</p>`}
    </section>`;
  }
}

if (!customElements.get(VIEWPOINT_EDITOR_TAG)) customElements.define(VIEWPOINT_EDITOR_TAG, MaticViewpointEditorV4);

declare global {
  interface HTMLElementTagNameMap {
    [VIEWPOINT_EDITOR_TAG]: MaticViewpointEditorV4;
  }
}
