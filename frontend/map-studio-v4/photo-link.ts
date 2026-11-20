import type { WorkspaceIntent } from "./contracts";
import type { WorkspaceStore } from "./state";

/**
 * A link to one photo, /matic-map?entry=<entry id>&photo=<photo id>, such as
 * a photo check's notification opens. It stays in the address until Photos
 * shows the photo, so a link that arrives before the map is in still opens it.
 */
export interface PhotoLink {
  readonly entryId: string;
  readonly photoId: string;
}

export const photoLink = (): PhotoLink | null => {
  const query = new URLSearchParams(location.search);
  const entryId = query.get("entry");
  const photoId = query.get("photo");
  return entryId && photoId ? { entryId, photoId } : null;
};

/** Drops the link from the address, so Back or a reload doesn't open the photo again. */
export const forgetPhotoLink = (): void => {
  const url = new URL(location.href);
  url.searchParams.delete("entry");
  url.searchParams.delete("photo");
  history.replaceState(history.state, "", url);
};

/**
 * Opens Photos for the linked robot once its map is in or Matic Map stops
 * waiting for it; Photos then opens the photo. Home Assistant can navigate an
 * open panel to a new link, so `check` runs on each route change too.
 */
export class PhotoLinkOpener {
  #opened = "";
  readonly #store: WorkspaceStore;
  readonly #route: (intent: WorkspaceIntent) => void;
  readonly #unsubscribe: () => void;

  constructor(store: WorkspaceStore, route: (intent: WorkspaceIntent) => void) {
    this.#store = store;
    this.#route = route;
    this.#unsubscribe = store.subscribe(() => this.check());
  }

  check(): void {
    const link = photoLink();
    const key = link ? `${link.entryId}\n${link.photoId}` : "";
    if (!link || key === this.#opened) return;
    const state = this.#store.value;
    if (!state.owner || !state.optionalUiReady) return;
    if (!state.robots.some((robot) => robot.entryId === link.entryId)) {
      // A removed robot's photos are gone with it.
      if (state.robots.length) forgetPhotoLink();
      return;
    }
    if (state.selection.entryId !== link.entryId) return this.#route({ type: "select-entry", entryId: link.entryId });
    if (state.resources.entry?.entryId !== link.entryId) return;
    this.#opened = key;
    this.#route({ type: "open-workflow", workflow: "photos" });
  }

  dispose(): void {
    this.#unsubscribe();
  }
}
