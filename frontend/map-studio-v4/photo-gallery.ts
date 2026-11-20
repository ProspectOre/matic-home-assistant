import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { BackendError, type MaticBackend } from "./backend";
import { controls } from "./controls";
import type { DateFormat, Localize, NoticePlaceholders, PhotoMarks, ViewpointDraft, WorkspaceIntent } from "./contracts";
import { formatDateTime, translate } from "./localize";
import { downloadName, earlierOfSamePlace, withStar } from "./photo-compare";
import type { GalleryPhoto, GalleryViewpoint, PhotoAlbum, PhotoGallery } from "./photo-gallery-data";
import { forgetPhotoLink, photoLink } from "./photo-link";
import { base, tokens } from "./tokens";
import "./viewpoint-editor";

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

/** The saved viewpoints on the map the server named, for the map canvas. */
const photoMarks = ({ map, viewpoints }: PhotoGallery, draft: ViewpointDraft | null = null): PhotoMarks | null => map && {
  mapSessionKey: map.mapSessionKey,
  viewpoints: viewpoints.filter((viewpoint) => viewpoint.missionId === map.missionId)
    .map(({ id, name, x, y, heading }) => ({ id, name, x, y, heading })),
  draft,
};

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
    emit: { attribute: false },
    marks: { attribute: false },
    _load: { state: true },
    _gallery: { state: true },
    _previews: { state: true },
    _open: { state: true },
    _full: { state: true },
    _fullFailed: { state: true },
    _compare: { state: true },
    _compareFull: { state: true },
    _viewerError: { state: true },
    _starring: { state: true },
    _shown: { state: true },
    _linkMissing: { state: true },
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
.viewer { box-sizing: border-box; inline-size: 100vw; max-inline-size: none; block-size: 100dvh; max-block-size: none; margin: 0; padding: var(--ms-space-3); border: 0; background: rgb(0 0 0 / 0.94); color: #fff; touch-action: pan-y; }
.viewer[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: var(--ms-space-2); }
/* Light controls on the dark viewer; the shared ones are drawn for the panel's surface. */
.viewer .ms-btn { --ms-local: rgb(255 255 255 / 0.1); color: #fff; border-color: rgb(255 255 255 / 0.45); background: var(--ms-local); text-decoration: none; }
.viewer .ms-btn:hover:not([aria-disabled="true"]) { background: rgb(255 255 255 / 0.2); }
.viewer .ms-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.viewer .ms-btn[aria-disabled="true"] { opacity: 0.45; cursor: default; }
.viewer .tools { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--ms-space-2); }
.viewer .tools [aria-pressed="true"] .mark { color: #f5c518; }
.viewer .tools [role="alert"] { flex-basis: 100%; text-align: center; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: var(--ms-space-2); min-block-size: 0; }
.pair figure { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: var(--ms-space-1); margin: 0; min-block-size: 0; }
.pair figcaption { font-size: var(--ms-t-sm); text-align: center; }
.shot { position: relative; }
.shot .badge { position: absolute; inset-block-start: var(--ms-space-1); inset-inline-end: var(--ms-space-1); color: #f5c518; font-size: var(--ms-t-md); line-height: 1; text-shadow: 0 0 2px rgb(0 0 0 / 0.8); }
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
  /** The workflow panel's intent dispatch, which draws the viewpoints on the map. */
  emit: (intent: WorkspaceIntent) => void = () => {};
  /** Photos' marks on the map shown now, or null when viewpoints can't be placed on it. */
  marks: PhotoMarks | null = null;
  _load: Load = "loading";
  _gallery: PhotoGallery | null = null;
  /** Object URLs of fetched previews, by photo ID. */
  _previews: Readonly<Record<string, string>> = {};
  /** The photo open in the viewer. */
  _open: GalleryPhoto | null = null;
  _full: string | null = null;
  _fullFailed = false;
  /** The earlier photo of the same place shown beside the open one. */
  _compare: GalleryPhoto | null = null;
  _compareFull: string | null = null;
  _viewerError: string | null = null;
  _starring = false;
  /** How many of the newest photos the grid shows. */
  _shown = PAGE;
  /** A link named a photo the library no longer holds. */
  _linkMissing = false;
  #controller: AbortController | null = null;
  /** The open photo's full-size read; a step or close aborts it. */
  #fullRead: AbortController | null = null;
  #timeline: readonly GalleryPhoto[] = [];
  #timelineOf: PhotoGallery | null = null;
  #opener: HTMLElement | null = null;
  #swipeX: number | null = null;
  #compareRead: AbortController | null = null;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!this.hasUpdated || changed.has("entryId") || changed.has("backend")) void this.#read();
  }

  protected override updated(): void {
    const viewer = this.renderRoot.querySelector<HTMLDialogElement>("dialog.viewer");
    if (viewer && !viewer.open) viewer.showModal();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Home Assistant fires this when it navigates an open panel to a new link.
    window.addEventListener("location-changed", this.#openLinked);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("location-changed", this.#openLinked);
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
    this.#dropCompare();
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
    this.emit({ type: "show-photo-marks", marks: null });
    try {
      const gallery = await backend.photoGallery(entryId, controller.signal);
      if (controller.signal.aborted) return;
      this._gallery = gallery;
      this._load = "ready";
      this.emit({ type: "show-photo-marks", marks: photoMarks(gallery) });
      const previews = this.#readPreviews(0);
      void this.#openLinked();
      await previews;
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

  /** Opens the photo a link names, with its tile in the grid, and forgets the link. */
  readonly #openLinked = async (): Promise<void> => {
    const link = photoLink();
    if (!link || link.entryId !== this.entryId || !this._gallery) return;
    forgetPhotoLink();
    const photos = this.#photos();
    const index = photos.findIndex((photo) => photo.id === link.photoId);
    this._linkMissing = index < 0;
    if (index < 0) return;
    for (let from = this._shown; from <= index; from += PAGE) {
      this._shown = from + PAGE;
      void this.#readPreviews(from);
    }
    void this.#show(photos[index]!);
    await this.updateComplete;
    // Closing the viewer returns focus to the photo's tile, as after a tap.
    this.#opener = this.renderRoot.querySelectorAll<HTMLElement>(".shot")[index] ?? null;
  };

  async #show(photo: GalleryPhoto, opener?: HTMLElement): Promise<void> {
    if (opener) this.#opener = opener;
    this._linkMissing = false;
    this.#dropFull();
    this.#dropCompare();
    this._viewerError = null;
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

  #dropCompare(): void {
    this.#compareRead?.abort();
    this.#compareRead = null;
    if (this._compareFull) URL.revokeObjectURL(this._compareFull);
    this._compareFull = null;
    this._compare = null;
  }

  /** Shows the newest earlier photo of the same place beside the open one; a second press shows one photo again. */
  async #toggleCompare(photo: GalleryPhoto): Promise<void> {
    if (this._compare) return this.#dropCompare();
    const earlier = earlierOfSamePlace(this.#photos(), photo);
    if (!earlier) return;
    this._compare = earlier;
    const read = new AbortController();
    this.#compareRead = read;
    const blob = await this.backend?.photo(earlier.url, read.signal).catch(() => null);
    if (read.signal.aborted) return;
    this.#compareRead = null;
    if (blob) this._compareFull = URL.createObjectURL(blob);
    else this._viewerError = this.#t("v4_photos_photo_failed", "Couldn't load this photo.");
  }

  async #star(photo: GalleryPhoto): Promise<void> {
    const { backend, entryId } = this;
    if (!backend || !entryId || this._starring) return;
    this._starring = true;
    this._viewerError = null;
    try {
      const starred = await backend.starPhoto(entryId, photo.id, !photo.starred);
      if (!this._gallery) return;
      this._gallery = withStar(this._gallery, photo.id, starred);
      if (this._open?.id === photo.id) this._open = { ...this._open, starred };
    } catch (error) {
      this._viewerError = error instanceof BackendError && error.code === "star_limit"
        ? this.#t("v4_photos_star_limit", "100 photos are starred. Unstar one to star this one.")
        : this.#t("v4_photos_star_failed", "Couldn't change the star. Try again.");
    } finally {
      this._starring = false;
    }
  }

  #close(): void {
    this.renderRoot.querySelector<HTMLDialogElement>("dialog.viewer")?.close();
    this.#dropFull();
    this.#dropCompare();
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
        <button class="shot" type="button" aria-label=${photo.starred
          ? this.#t("v4_photos_starred_caption", "{caption}, starred", { caption: this.#caption(photo) }) : this.#caption(photo)}
          @click=${(event: Event) => void this.#show(photo, event.currentTarget as HTMLElement)}>
          ${this._previews[photo.id] ? html`<img src=${this._previews[photo.id]} alt="">` : nothing}
          ${photo.starred ? html`<span class="badge" aria-hidden="true">★</span>` : nothing}
        </button></li>`)}</ul>
    </section>`;
  }

  #swipeEnd(event: PointerEvent): void {
    const start = this.#swipeX;
    this.#swipeX = null;
    if (start === null || Math.abs(event.clientX - start) < SWIPE) return;
    this.#step(event.clientX < start ? 1 : -1);
  }

  #single(photo: GalleryPhoto) {
    return this._full ? html`<img src=${this._full} alt=${this.#caption(photo)} draggable="false">`
      : this._fullFailed ? html`<div class="failed"><p role="alert">${this.#t("v4_photos_photo_failed", "Couldn't load this photo.")}</p>
        <button class="ms-btn" type="button" @click=${() => void this.#show(photo)}>${this.#t("v4_retry", "Try again")}</button></div>`
        : html`<p role="status">${this.#t("v4_photos_loading_photo", "Loading the photo…")}</p>`;
  }

  /** The open photo beside the earlier one of the same place, each with its own caption. */
  #pair(photo: GalleryPhoto, earlier: GalleryPhoto) {
    const figure = (item: GalleryPhoto, url: string | null) => html`<figure>
      ${url ? html`<img src=${url} alt=${this.#caption(item)} draggable="false">`
        : html`<p role="status">${this.#t("v4_photos_loading_photo", "Loading the photo…")}</p>`}
      <figcaption>${this.#caption(item)}</figcaption></figure>`;
    return html`<div class="pair">${figure(earlier, this._compareFull)}${figure(photo, this._full)}</div>`;
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
      ${this._compare ? this.#pair(photo, this._compare) : this.#single(photo)}
      <div class="tools">
        <button class="ms-btn" type="button" aria-pressed=${String(photo.starred)} aria-disabled=${String(this._starring)} @click=${() => void this.#star(photo)}>
          <span class="mark" aria-hidden="true">${photo.starred ? "★" : "☆"}</span> ${this.#t("v4_photos_star", "Star")}</button>
        ${this._full ? html`<a class="ms-btn" href=${this._full} download=${downloadName(photo)}>${this.#t("v4_photos_download", "Download")}</a>` : nothing}
        ${this._compare || earlierOfSamePlace(this.#photos(), photo) ? html`<button class="ms-btn" type="button" @click=${() => void this.#toggleCompare(photo)}>
          ${this._compare ? this.#t("v4_photos_compare_end", "Show one photo") : this.#t("v4_photos_compare", "Compare with earlier")}</button>` : nothing}
        ${this._viewerError ? html`<p role="alert">${this._viewerError}</p>` : nothing}
      </div>
      <footer>
        <button class="ms-btn" type="button" aria-disabled=${String(!this.#neighbour(-1))} @click=${() => this.#step(-1)}>${this.#t("v4_photos_newer", "Newer")}</button>
        <button class="ms-btn" type="button" aria-disabled=${String(!this.#neighbour(1))} @click=${() => this.#step(1)}>${this.#t("v4_photos_older", "Older")}</button>
      </footer>
    </dialog>`;
  }

  readonly #viewpointsChanged = (event: CustomEvent<readonly GalleryViewpoint[]>): void => {
    if (!this._gallery) return;
    this._gallery = { ...this._gallery, viewpoints: event.detail };
    // A delete while placing keeps the viewpoint being placed.
    this.emit({ type: "show-photo-marks", marks: photoMarks(this._gallery, this.marks?.draft ?? null) });
  };

  protected override render() {
    if (this._load === "loading") return html`<p class="subtle" role="status">${this.#t("v4_photos_loading", "Loading photos…")}</p>`;
    if (this._load === "failed" || !this._gallery) {
      return html`<div class="stack"><p role="alert">${this.#t("v4_photos_failed", "Couldn't load the photos.")}</p>
        <button class="ms-btn" type="button" @click=${() => void this.#read()}>${this.#t("v4_retry", "Try again")}</button></div>`;
    }
    const { albums, viewpoints } = this._gallery;
    return html`<div class="stack">
      ${this._linkMissing ? html`<p role="status">${this.#t("v4_photos_link_missing", "The photo from the link is no longer saved.")}</p>` : nothing}
      ${albums.length ? this.#sections().map(({ album, photos }) => this.#album(album, photos))
        : html`<p class="subtle">${this.#t("v4_photos_empty", "No photos yet. Press Take photo, or run a photo tour from an automation.")}</p>`}
      ${this.#photos().length > this._shown ? html`<div><button class="ms-btn ms-btn--secondary" type="button" @click=${() => void this.#more()}>${this.#t("v4_photos_more", "Show older photos")}</button></div>` : nothing}
      <matic-viewpoint-editor-v4 .backend=${this.backend} .entryId=${this.entryId} .localize=${this.localize} .dates=${this.dates}
        .emit=${this.emit} .viewpoints=${viewpoints} .marks=${this.marks} @viewpoints-changed=${this.#viewpointsChanged}></matic-viewpoint-editor-v4>
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
