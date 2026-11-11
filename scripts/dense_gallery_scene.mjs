// Runs in the page. Replaces a gallery's scene with a deterministic dense
// floor on four times the span: 35% floor points, the rest walls and clutter.
export const loadDenseScene = (element, total) => {
  const state = element.getWorkspaceSnapshot();
  const scene = state.resources.scene.value;
  const factor = 4, floorCount = Math.round(total * 0.35);
  const buffer = new ArrayBuffer(scene.pointOffset + total * 8);
  new Uint8Array(buffer).set(new Uint8Array(scene.buffer, 0, scene.pointOffset));
  const view = new DataView(buffer, scene.pointOffset);
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let index = 0; index < total; index += 1) {
    const wall = index >= floorCount && index % 6 < 4, edge = index % 6, along = random();
    const x = wall ? (edge === 0 ? 10 : edge === 1 ? 170 : 10 + along * 160) : 10 + random() * 160;
    const y = wall ? (edge === 2 ? 10 : edge === 3 ? 130 : 10 + along * 120) : 10 + random() * 120;
    view.setUint16(index * 8, x * factor, true);
    view.setUint16(index * 8 + 2, y * factor, true);
    view.setUint8(index * 8 + 4, index < floorCount ? 0 : Math.floor(random() * 50));
    for (let channel = 5; channel < 8; channel += 1) view.setUint8(index * 8 + channel, 150 + random() * 90);
  }
  const scale = ([x, y]) => [x * factor, y * factor];
  state.resources.scene.value = { ...scene, buffer, floorCount, surfaceCount: total - floorCount, total,
    revision: scene.revision + 1, etag: '"synthetic-latency"', metadata: { ...scene.metadata,
      span: scene.metadata.span.map(value => value * factor),
      rooms: scene.metadata.rooms.map(room => ({ ...room, boundary: room.boundary.map(scale), center: scale(room.center) })) } };
  element.replaceWorkspaceState(state);
};
