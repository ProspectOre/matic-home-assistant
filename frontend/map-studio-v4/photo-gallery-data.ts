/** Matic Map's read of /api/matic_robot/photo_gallery (photo_gallery_view.py). */

import { ContractError } from "./backend-contracts";

export interface PhotoPose {
  readonly x: number;
  readonly y: number;
  /** Radians, counter-clockwise from the map's +x axis; null when the robot did not report it. */
  readonly heading: number | null;
  readonly missionId: number | null;
}

export interface GalleryPhoto {
  readonly id: string;
  readonly capturedAt: string;
  readonly fromMaticApp: boolean;
  readonly starred: boolean;
  readonly area: string | null;
  readonly pose: PhotoPose | null;
  readonly url: string;
  readonly previewUrl: string;
}

export interface PhotoAlbum {
  readonly id: string;
  /** Newest first. */
  readonly photos: readonly GalleryPhoto[];
}

export interface GalleryViewpoint {
  readonly id: string;
  readonly name: string;
  readonly missionId: number;
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly roomId: string;
}

/** The map Matic Map shows now, as the server read it. */
export interface GalleryMap {
  readonly mapSessionKey: string;
  readonly missionId: number;
}

export interface PhotoGallery {
  readonly map: GalleryMap | null;
  readonly viewpoints: readonly GalleryViewpoint[];
  /** Newest album first. */
  readonly albums: readonly PhotoAlbum[];
}

// GALLERY_MAX_PHOTOS in photo_gallery_view.py; each album holds at least one photo.
const MAX_PHOTOS = 5_000;
const MAX_ALBUMS = MAX_PHOTOS;
const MAX_VIEWPOINTS = 50;

const fail = (code: string): never => {
  throw new ContractError(code);
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail("invalid-photo-gallery");

const list = (value: unknown, max: number): readonly unknown[] =>
  Array.isArray(value) && value.length <= max ? value : fail("invalid-photo-gallery");

// Limits count code points, as Python's len() does on the server.
const text = (value: unknown, max = 256): string =>
  typeof value === "string" && value.length > 0 && [...value].length <= max ? value : fail("invalid-photo-gallery");

// Areas are robot telemetry text, up to 512 bytes (_TELEMETRY_TEXT_MAX_BYTES).
const optionalText = (value: unknown): string | null => value === null ? null : text(value, 512);

const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000 ? value : fail("invalid-photo-gallery");

const optionalNumber = (value: unknown): number | null => value === null ? null : number(value);

const missionId = (value: unknown): number =>
  Number.isSafeInteger(value) ? value as number : fail("invalid-photo-gallery");

const time = (value: unknown): string => {
  const raw = text(value, 64);
  return Number.isNaN(Date.parse(raw)) ? fail("invalid-photo-gallery") : raw;
};

const flag = (value: unknown): boolean => typeof value === "boolean" ? value : fail("invalid-photo-gallery");

/** A photo link must be this robot's own photo route, so the gallery fetches nothing else. */
const photoPath = (value: unknown, prefix: string, photoId: string): string => {
  const path = text(value, 512);
  return path === `${prefix}${encodeURIComponent(photoId)}` ? path : fail("invalid-photo-gallery");
};

const pose = (value: unknown): PhotoPose | null => {
  if (value === null) return null;
  const raw = record(value);
  return {
    x: number(raw.x),
    y: number(raw.y),
    heading: optionalNumber(raw.heading),
    missionId: raw.mission_id === null ? null : missionId(raw.mission_id),
  };
};

const photo = (value: unknown, entryId: string): GalleryPhoto => {
  const raw = record(value);
  const id = text(raw.photo_id);
  const route = `/api/matic_robot/photo/${encodeURIComponent(entryId)}/`;
  const source = text(raw.source, 32);
  return {
    id,
    capturedAt: time(raw.captured_at),
    fromMaticApp: source === "matic_app" || (source === "home_assistant" ? false : fail("invalid-photo-gallery")),
    starred: flag(raw.starred),
    area: optionalText(raw.area),
    pose: pose(raw.pose),
    url: photoPath(raw.url, route, id),
    previewUrl: photoPath(raw.preview_url, `${route}preview/`, id),
  };
};

const viewpoint = (value: unknown): GalleryViewpoint => {
  const raw = record(value);
  return {
    id: text(raw.viewpoint_id),
    name: text(raw.name, 64),
    missionId: missionId(raw.mission_id),
    x: number(raw.x),
    y: number(raw.y),
    heading: number(raw.heading),
    roomId: text(raw.room_id),
  };
};

const galleryMap = (value: unknown): GalleryMap | null => {
  if (value === null) return null;
  const raw = record(value);
  const key = text(raw.map_session_key, 64);
  return /^[0-9a-f]{64}$/.test(key) ? { mapSessionKey: key, missionId: missionId(raw.mission_id) } : fail("invalid-photo-gallery");
};

export function parsePhotoGallery(value: unknown, entryId: string): PhotoGallery {
  const raw = record(value);
  let photos = 0;
  const albums = list(raw.albums, MAX_ALBUMS).map((item): PhotoAlbum => {
    const album = record(item);
    const parsed = list(album.photos, MAX_PHOTOS).map((entry) => photo(entry, entryId));
    photos += parsed.length;
    return { id: text(album.album), photos: parsed };
  });
  if (photos > MAX_PHOTOS) fail("invalid-photo-gallery");
  return { map: galleryMap(raw.map), viewpoints: list(raw.viewpoints, MAX_VIEWPOINTS).map(viewpoint), albums };
}
