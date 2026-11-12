// Synthetic live scenes in the wire form slam_scene.py serves: a manifest of
// page addresses and each page's points, plus the scene buffer Matic Map must
// assemble from them (the saved-map form, client/slam_scene.py).

export const sceneMetadata = ({ origin = [0, 0], span = [2048, 64], rooms = [] } = {}) => Buffer.from(JSON.stringify({
  meters_per_cell: 0.015,
  span_cells: span,
  origin_cells: origin,
  sample_step: 1,
  rooms,
}));

export const pageId = (value) => value.toString(16).padStart(24, "0");

/** `count` pages along x, each with `floor` floor and `surface` surface points. */
export const syntheticPages = (count, { floor = 3, surface = 2, seed = 0, y = 0 } = {}) =>
  Array.from({ length: count }, (_, index) => ({
    x: index,
    y,
    id: pageId(seed * 4096 + index + 1),
    floor,
    points: Array.from({ length: floor + surface }, (_, point) => [
      (index * 7 + point) % 32,
      (seed + point * 3) % 32,
      point < floor ? 0 : 1 + point % 16,
      (seed * 31 + index + point) & 0xff,
      (index * 13 + point * 5) & 0xff,
      (seed + point * 11) & 0xff,
    ]),
  }));

export const pageBytes = (page) => Buffer.from(page.points.flat());

export function manifestBytes(metadata, pages) {
  const header = Buffer.alloc(20);
  header.write("MATICMF\0", 0, "binary");
  header.writeUInt16LE(1, 8);
  header.writeUInt16LE(28, 10);
  header.writeUInt32LE(metadata.byteLength, 12);
  header.writeUInt32LE(pages.length, 16);
  const records = pages.map((page) => {
    const record = Buffer.alloc(28);
    record.writeInt32LE(page.x, 0);
    record.writeInt32LE(page.y, 4);
    record.writeUInt32LE(page.floor, 8);
    record.writeUInt32LE(page.points.length - page.floor, 12);
    Buffer.from(page.id, "hex").copy(record, 16);
    return record;
  });
  return Buffer.concat([header, metadata, ...records]);
}

export function sceneBytes(metadata, pages) {
  const [originX, originY] = JSON.parse(metadata.toString()).origin_cells;
  const point = (page, [x, y, z, red, green, blue]) => {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt16LE(page.x * 32 + x - originX, 0);
    bytes.writeUInt16LE(page.y * 32 + y - originY, 2);
    bytes.set([z, red, green, blue], 4);
    return bytes;
  };
  const floors = pages.flatMap((page) => page.points.slice(0, page.floor).map((value) => point(page, value)));
  const surfaces = pages.flatMap((page) => page.points.slice(page.floor).map((value) => point(page, value)));
  const header = Buffer.alloc(24);
  header.write("MATIC3D\0", 0, "binary");
  header.writeUInt16LE(1, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt32LE(metadata.byteLength, 12);
  header.writeUInt32LE(floors.length, 16);
  header.writeUInt32LE(surfaces.length, 20);
  return Buffer.concat([header, metadata, ...floors, ...surfaces]);
}

/** Everything a page needs to serve one live scene, as base64 strings. */
export const liveScene = (metadata, pages) => ({
  manifest: manifestBytes(metadata, pages).toString("base64"),
  pages: Object.fromEntries(pages.map((page) => [page.id, pageBytes(page).toString("base64")])),
  scene: sceneBytes(metadata, pages).toString("base64"),
});

/**
 * A fetchWithAuth body for the page: serves `window.__liveScene` (from
 * liveScene) at the scene path and its pages at `/pages?ids=`, records each
 * path in `window.__sceneRequests`, and answers 204 to `since` while
 * `window.__liveSceneRevision` has not passed it.
 */
export const LIVE_SCENE_FETCH = `async (path) => {
  const scene = window.__liveScene;
  const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  window.__sceneRequests.push(path);
  const url = new URL(path, location.origin);
  const revision = window.__liveSceneRevision ?? 7;
  if (url.pathname.endsWith("/pages")) {
    const ids = (url.searchParams.get("ids") ?? "").split(",");
    if (ids.some((id) => !(id in scene.pages))) return new Response(null, { status: 404 });
    const parts = ids.map((id) => decode(scene.pages[id]));
    const body = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    parts.reduce((offset, part) => { body.set(part, offset); return offset + part.length; }, 0);
    return new Response(body, { headers: { "Content-Type": "application/octet-stream" } });
  }
  const headers = { "X-Matic-Revision": String(revision), "X-Matic-Floor-Coherent": "1" };
  if (url.searchParams.get("since") === String(revision)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return new Response(null, { status: 204, headers });
  }
  return new Response(decode(scene.manifest), {
    headers: { ...headers, "Content-Type": "application/vnd.matic.slam-manifest" },
  });
}`;
