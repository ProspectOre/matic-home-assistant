import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { MaticBackend } from "./backend";
import { controls } from "./controls";
import type { DateFormat, Localize, NoticePlaceholders } from "./contracts";
import { formatDateTime, translate } from "./localize";
import type { GalleryPhoto, PhotoAlbum, PhotoGallery } from "./photo-gallery-data";
import { base, tokens } from "./tokens";

export const PHOTO_GALLERY_TAG = "matic-photo-gallery-v4";

/** The manual album holds photos taken one at a time, from Home Assistant or the Matic app. */
const MANUAL_ALBUM = "manual";
/** Photos shown, and previews read, per "Show older photos". */
const PAGE = 60;
/** Preview reads in flight at once. */
const PREVIEW_READS = 4;
/** A horizontal drag this long, in CSS pixels, turns to the next photo. */
const SWIPE = 48;

type Load = "loading" | "ready" | "failed";

/**
 * Photos: albums newest first, a grid of each album's pixelated previews, and
 * a full-size viewer. It reads only this robot's photo routes and never moves
 * the robot.
 */
export class MaticPhotoGalleryV4 extends LitElement {
  static override properties = {
    backend: { attribute: false },
    entryId: { attribute: false },
    localize: { attribute: false },
    dates: { attribute: false },
    _load: { state: true },
    _gallery: { state: true },
    _previews: { state: true },
    _open: { state: true },
    _full: { state: true },
    _fullFailed: { state: true },
    _shown: { state: true },
  };

  static override styles = [tokens, base, controls, css`
:host { display: block; min-inline-size: 0; }
.stack { display: grid; gap: var(--ms-space-4); }
.subtle { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
h3 { margin: 0 0 var(--ms-space-2); font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); gap: var(--ms-space-2); margin: 0; padding: 0; list-style: none; }
.shot { display: block; inline-size: 100%; aspect-ratio: 4 / 3; padding: 0; border: 1px solid var(--ms-line); border-radius: var(--ms-radius-sm); background: var(--ms-surface-sunken); overflow: hidden; cursor: pointer; }
.shot:focus-visible { outline: 2px solid var(--ms-accent); outline-offset: 2px; }
.shot img { display: block; inline-size: 100%; block-size: 100%; object-fit: cover; }
.views { display: grid; gap: var(--ms-space-1); margin: 0; padding: 0; list-style: none; font-size: var(--ms-t-sm); }
.viewer { box-sizing: border-box; inline-size: 100vw; max-inline-size: none; block-size: 100dvh; max-block-size: none; margin: 0; padding: var(--ms-space-3); border: 0; background: rgb(0 0 0 / 0.94); color: #fff; touch-action: pan-y; }
.viewer[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: var(--ms-space-2); }
.viewer::backdrop { background: rgb(0 0 0 / 0.6); }
.viewer header, .viewer footer { display: flex; align-items: center; justify-content: space-between; gap: var(--ms-space-2); }
.viewer p { margin: 0; font-size: var(--ms-t-sm); }
.viewer .failed { display: grid; place-content: center; justify-items: center; gap: var(--ms-space-2); }
.viewer img { inline-size: 100%; block-size: 100%; object-fit: contain; user-select: none; }
`];

  backend: MaticBackend | null = null;
  entryId: string | null = null;
  localize?: Localize;
  dates?: DateFormat;
  _load: Load = "loading";
  _gallery: PhotoGallery | null = null;
  /** Object URLs of fetched previews, by photo ID. */
  _previews: Readonly<Record<string, string>> = {};
  /** The photo open in the viewer. */
  _open: GalleryPhoto | null = null;
  _full: string | null = null;
  _fullFailed = false;
  /** How many of the newest photos the grid shows. */
  _shown = PAGE;
  #controller: AbortController | null = null;
  /** The open photo's full-size read; a step or close aborts it. */
  #fullRead: AbortController | null = null;
  #timeline: readonly GalleryPhoto[] = [];
  #timelineOf: PhotoGallery | null = null;
  #opener: HTMLElement | null = null;
  #swipeX: number | null = null;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!this.hasUpdated || changed.has("entryId") || changed.has("backend")) void this.#read();
  }

  protected override updated(): void {
    const viewer = this.renderRoot.querySelector<HTMLDialogElement>("dialog.viewer");
    if (viewer && !viewer.open) viewer.showModal();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#reset();
  }

  #t(key: string, fallback: string, placeholders?: NoticePlaceholders): string {
    return translate(this.localize, key, fallback, placeholders, this.dates);
  }

  #reset(): void {
    this.#controller?.abort();
    this.#controller = null;
    for (const url of Object.values(this._previews)) URL.revokeObjectURL(url);
    this._previews = {};
    this.#dropFull();
    this._open = null;
  }

  async #read(): Promise<void> {
    this.#reset();
    this._gallery = null;
    this._shown = PAGE;
    const { backend, entryId } = this;
    // Photos can open before the catalog names a robot; the new entry starts a read.
    if (!backend || !entryId) {
      this._load = "failed";
      return;
    }
    const controller = new AbortController();
    this.#controller = controller;
    this._load = "loading";
    try {
      const gallery = await backend.photoGallery(entryId, controller.signal);
      if (controller.signal.aborted) return;
      this._gallery = gallery;
      this._load = "ready";
      await this.#readPreviews(0);
    } catch {
      if (!controller.signal.aborted) this._load = "failed";
    }
  }

  /** Reads the previews of one page of photos, a few at a time; a failed one leaves its tile blank. */
  async #readPreviews(from: number): Promise<void> {
    const { backend } = this;
    const signal = this.#controller?.signal;
    if (!backend || !signal) return;
    const queue = this.#photos().slice(from, from + PAGE);
    const reader = async (): Promise<void> => {
      for (let photo = queue.shift(); photo && !signal.aborted; photo = queue.shift()) {
        const blob = await backend.photo(photo.previewUrl, signal).catch(() => null);
        if (blob && !signal.aborted) this._previews = { ...this._previews, [photo.id]: URL.createObjectURL(blob) };
      }
    };
    await Promise.all(Array.from({ length: PREVIEW_READS }, reader));
  }

  async #more(): Promise<void> {
    const from = this._shown;
    this._shown += PAGE;
    void this.#readPreviews(from);
    // The last page removes the button; keep focus on the first photo it added.
    if (this.#photos().length > this._shown) return;
    await this.updateComplete;
    this.renderRoot.querySelectorAll<HTMLElement>(".shot")[from]?.focus();
  }

  /**
   * Every photo newest first by capture time. Single photos share one album
   * that spans the whole library, so album order alone would interleave
   * wrongly with photo tours.
   */
  #photos(): readonly GalleryPhoto[] {
    if (this.#timelineOf !== this._gallery) {
      this.#timelineOf = this._gallery;
      this.#timeline = (this._gallery?.albums.flatMap((album) => album.photos) ?? [])
        .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    }
    return this.#timeline;
  }

  /** The newest `_shown` photos, in runs of consecutive photos from one album. */
  #sections(): readonly { album: PhotoAlbum; photos: GalleryPhoto[] }[] {
    const albumOf = new Map(this._gallery?.albums.flatMap((album) => album.photos.map((photo) => [photo.id, album] as const)));
    const sections: { album: PhotoAlbum; photos: GalleryPhoto[] }[] = [];
    for (const photo of this.#photos().slice(0, this._shown)) {
      const album = albumOf.get(photo.id)!;
      const last = sections.at(-1);
      if (last?.album === album) last.photos.push(photo);
      else sections.push({ album, photos: [photo] });
    }
    return sections;
  }

  async #show(photo: GalleryPhoto, opener?: HTMLElement): Promise<void> {
    if (opener) this.#opener = opener;
    this.#dropFull();
    this._open = photo;
    const read = new AbortController();
    this.#fullRead = read;
    const blob = await this.backend?.photo(photo.url, read.signal).catch(() => null);
    if (read.signal.aborted) return;
    this.#fullRead = null;
    if (blob) this._full = URL.createObjectURL(blob);
    else this._fullFailed = true;
  }

  #dropFull(): void {
    this.#fullRead?.abort();
    this.#fullRead = null;
    if (this._full) URL.revokeObjectURL(this._full);
    this._full = null;
    this._fullFailed = false;
  }

  #close(): void {
    this.renderRoot.querySelector<HTMLDialogElement>("dialog.viewer")?.close();
    this.#dropFull();
    this._open = null;
    this.#opener?.focus();
    this.#opener = null;
  }

  /** The photo `offset` places from the open one, newest first. */
  #neighbour(offset: number): GalleryPhoto | undefined {
    const photos = this.#photos();
    const index = photos.findIndex((photo) => photo.id === this._open?.id);
    return index < 0 ? undefined : photos[index + offset];
  }

  #step(offset: number): void {
    const next = this.#neighbour(offset);
    if (next) void this.#show(next);
  }

  #keydown(event: KeyboardEvent): void {
    // The dialog's own cancel closes the viewer; the sheet must not also close.
    if (event.key === "Escape") return event.stopPropagation();
    if (event.key === "ArrowLeft") this.#step(-1);
    else if (event.key === "ArrowRight") this.#step(1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  #albumTitle(album: PhotoAlbum): string {
    if (album.id === MANUAL_ALBUM) return this.#t("v4_photos_single", "Single photos");
    const first = album.photos.at(-1);
    return first
      ? this.#t("v4_photos_tour_at", "Photo tour, {time}", { time: formatDateTime(first.capturedAt, this.dates) })
      : this.#t("v4_photos_tour", "Photo tour");
  }

  #caption(photo: GalleryPhoto): string {
    const when = formatDateTime(photo.capturedAt, this.dates);
    const where = photo.area ?? (photo.fromMaticApp ? this.#t("v4_photos_from_app", "From the Matic app") : null);
    return where ? `${where} · ${when}` : when;
  }

  #album(album: PhotoAlbum, photos: readonly GalleryPhoto[]) {
    return html`<section>
      <h3>${this.#albumTitle(album)}</h3>
      <ul class="grid">${photos.map((photo) => html`<li>
        <button class="shot" type="button" aria-label=${this.#caption(photo)}
          @click=${(event: Event) => void this.#show(photo, event.currentTarget as HTMLElement)}>
          ${this._previews[photo.id] ? html`<img src=${this._previews[photo.id]} alt="">` : nothing}
        </button></li>`)}</ul>
    </section>`;
  }

  #swipeEnd(event: PointerEvent): void {
    const start = this.#swipeX;
    this.#swipeX = null;
    if (start === null || Math.abs(event.clientX - start) < SWIPE) return;
    this.#step(event.clientX < start ? 1 : -1);
  }

  // A modal dialog sits in the top layer above the sheet, keeps focus inside
  // and closes on Escape; closing returns focus to the photo that opened it.
  // The ends use aria-disabled so focus stays on the button that reached them.
  #viewer(photo: GalleryPhoto) {
    return html`<dialog class="viewer" aria-label=${this.#caption(photo)} @keydown=${this.#keydown}
      @cancel=${(event: Event) => { event.preventDefault(); this.#close(); }}
      @pointerdown=${(event: PointerEvent) => { if (event.isPrimary) this.#swipeX = event.clientX; }}
      @pointerup=${this.#swipeEnd} @pointercancel=${() => { this.#swipeX = null; }}>
      <header>
        <p>${this.#caption(photo)}</p>
        <button class="ms-btn" type="button" autofocus @click=${() => this.#close()}>${this.#t("v4_close", "Close")}</button>
      </header>
      ${this._full ? html`<img src=${this._full} alt=${this.#caption(photo)} draggable="false">`
        : this._fullFailed ? html`<div class="failed"><p role="alert">${this.#t("v4_photos_photo_failed", "Couldn't load this photo.")}</p>
          <button class="ms-btn" type="button" @click=${() => void this.#show(photo)}>${this.#t("v4_retry", "Try again")}</button></div>`
          : html`<p role="status">${this.#t("v4_photos_loading_photo", "Loading the photo…")}</p>`}
      <footer>
        <button class="ms-btn" type="button" aria-disabled=${String(!this.#neighbour(-1))} @click=${() => this.#step(-1)}>${this.#t("v4_photos_newer", "Newer")}</button>
        <button class="ms-btn" type="button" aria-disabled=${String(!this.#neighbour(1))} @click=${() => this.#step(1)}>${this.#t("v4_photos_older", "Older")}</button>
      </footer>
    </dialog>`;
  }

  protected override render() {
    if (this._load === "loading") return html`<p class="subtle" role="status">${this.#t("v4_photos_loading", "Loading photos…")}</p>`;
    if (this._load === "failed" || !this._gallery) {
      return html`<div class="stack"><p role="alert">${this.#t("v4_photos_failed", "Couldn't load the photos.")}</p>
        <button class="ms-btn" type="button" @click=${() => void this.#read()}>${this.#t("v4_retry", "Try again")}</button></div>`;
    }
    const { albums, viewpoints } = this._gallery;
    return html`<div class="stack">
      ${albums.length ? this.#sections().map(({ album, photos }) => this.#album(album, photos))
        : html`<p class="subtle">${this.#t("v4_photos_empty", "No photos yet. Press Take photo, or run a photo tour from an automation.")}</p>`}
      ${this.#photos().length > this._shown ? html`<div><button class="ms-btn ms-btn--secondary" type="button" @click=${() => void this.#more()}>${this.#t("v4_photos_more", "Show older photos")}</button></div>` : nothing}
      ${viewpoints.length ? html`<section>
        <h3>${this.#t("v4_photos_viewpoints", "Saved viewpoints")}</h3>
        <ul class="views">${viewpoints.map((viewpoint) => html`<li>${viewpoint.name}</li>`)}</ul>
      </section>` : nothing}
      ${this._open ? this.#viewer(this._open) : nothing}
    </div>`;
  }
}

if (!customElements.get(PHOTO_GALLERY_TAG)) customElements.define(PHOTO_GALLERY_TAG, MaticPhotoGalleryV4);

declare global {
  interface HTMLElementTagNameMap {
    [PHOTO_GALLERY_TAG]: MaticPhotoGalleryV4;
  }
}
