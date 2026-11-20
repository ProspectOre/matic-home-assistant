import type { GalleryPhoto, PhotoGallery } from "./photo-gallery-data";

/** Two poses this close, in metres, are the same spot. */
const SAME_SPOT = 0.5;
/** Two headings this close, in radians (30°), look the same way. */
const SAME_VIEW = Math.PI / 6;

/** Whether two photos show the same view: the same spot and direction on one map, or else the same area. */
export function samePlace(a: GalleryPhoto, b: GalleryPhoto): boolean {
  const [p, q] = [a.pose, b.pose];
  if (p && q && p.missionId !== null && p.missionId === q.missionId) {
    if (Math.hypot(p.x - q.x, p.y - q.y) > SAME_SPOT) return false;
    if (p.heading === null || q.heading === null) return true;
    return Math.abs(Math.atan2(Math.sin(p.heading - q.heading), Math.cos(p.heading - q.heading))) <= SAME_VIEW;
  }
  return a.area !== null && a.area === b.area;
}

/** The newest photo taken before `photo` of the same place, from a newest-first timeline. */
export function earlierOfSamePlace(timeline: readonly GalleryPhoto[], photo: GalleryPhoto): GalleryPhoto | null {
  const index = timeline.findIndex((item) => item.id === photo.id);
  return index < 0 ? null : timeline.slice(index + 1).find((item) => samePlace(item, photo)) ?? null;
}

/** The gallery with one photo's star changed. */
export const withStar = (gallery: PhotoGallery, id: string, starred: boolean): PhotoGallery => ({
  ...gallery,
  albums: gallery.albums.map((album) => album.photos.some((photo) => photo.id === id)
    ? { ...album, photos: album.photos.map((photo) => photo.id === id ? { ...photo, starred } : photo) }
    : album),
});

/** A file name for a downloaded photo: its capture time in UTC, sortable, with no characters a file system refuses. */
export const downloadName = (photo: GalleryPhoto): string =>
  `matic-photo-${new Date(photo.capturedAt).toISOString().slice(0, 19).replaceAll(":", "-")}.webp`;
