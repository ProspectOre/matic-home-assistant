import type { SceneRoom } from "./backend-contracts";
import type { Channel } from "./theme-probe";

// Picked from Paul Tol's and Okabe and Ito's colour-blind-safe sets so that,
// toned with the light room fill, any two of the first five stay at least
// 25 CIELAB units apart with normal vision and under simulated protanopia,
// deuteranopia and tritanopia, and any two of all nine at least 12
// (tests/node/room_palette.test.mjs). Fills stay light enough to show the
// dark outlines.
export const ROOM_PALETTE: readonly Channel[] = [
  [204, 102, 119], [187, 204, 51], [153, 221, 255], [0, 114, 178], [204, 51, 17],
  [255, 170, 187], [213, 94, 0], [86, 180, 233], [204, 121, 167],
];

// Rooms closer than this share a wall or a doorway.
const NEIGHBOUR_METERS = 0.3;

type Piece = [room: number, ax: number, ay: number, bx: number, by: number];

const toPiece = (x: number, y: number, [, ax, ay, bx, by]: Piece): number => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
};

/** Pairs of rooms whose outlines come within NEIGHBOUR_METERS of each other. */
export const roomNeighbours = (rooms: readonly SceneRoom[], metersPerCell: number): Set<number>[] => {
  const reach = NEIGHBOUR_METERS / metersPerCell;
  const neighbours = rooms.map(() => new Set<number>());
  // Outlines are cut into pieces no longer than `reach`. Two such pieces that
  // come within `reach` have an end within `reach` of the other piece, and
  // midpoints at most twice `reach` apart, so pieces are bucketed by midpoint
  // in cells that size and compared only with the nine buckets around them.
  const size = 2 * reach;
  const buckets = new Map<string, Piece[]>();
  rooms.forEach((room, index) => {
    const boundary = room.boundary;
    boundary.forEach(([x0, y0], corner) => {
      const [x1, y1] = boundary[(corner + 1) % boundary.length]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / reach));
      for (let step = 0; step < steps; step += 1) {
        const piece: Piece = [index,
          x0 + (x1 - x0) * step / steps, y0 + (y1 - y0) * step / steps,
          x0 + (x1 - x0) * (step + 1) / steps, y0 + (y1 - y0) * (step + 1) / steps];
        const column = Math.floor((piece[1] + piece[3]) / 2 / size), row = Math.floor((piece[2] + piece[4]) / 2 / size);
        for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
          for (const other of buckets.get(`${column + dx},${row + dy}`) ?? []) {
            if (other[0] === index || neighbours[index]!.has(other[0])) continue;
            if (Math.min(toPiece(piece[1], piece[2], other), toPiece(piece[3], piece[4], other),
              toPiece(other[1], other[2], piece), toPiece(other[3], other[4], piece)) <= reach) {
              neighbours[index]!.add(other[0]);
              neighbours[other[0]]!.add(index);
            }
          }
        }
        const key = `${column},${row}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(piece);
        else buckets.set(key, [piece]);
      }
    });
  });
  return neighbours;
};

const assigned = new WeakMap<readonly SceneRoom[], ReadonlyMap<string, number>>();

/**
 * Each room's palette slot. Rooms take the lowest slot no neighbour holds,
 * most-connected first and then by id, so the colours do not depend on the
 * order the scene lists rooms in. A room takes a slot no higher than its
 * count of neighbours, so neighbours differ while no room has more than
 * eight; past that, the last colour can repeat.
 */
export const roomSlots = (rooms: readonly SceneRoom[], metersPerCell: number): ReadonlyMap<string, number> => {
  const cached = assigned.get(rooms);
  if (cached) return cached;
  const neighbours = roomNeighbours(rooms, metersPerCell);
  const order = rooms.map((_, index) => index).sort((a, b) => neighbours[b]!.size - neighbours[a]!.size
    || (rooms[a]!.id < rooms[b]!.id ? -1 : rooms[a]!.id > rooms[b]!.id ? 1 : 0));
  const slots: number[] = [];
  for (const index of order) {
    const taken = new Set([...neighbours[index]!].map((other) => slots[other]));
    let slot = 0;
    while (taken.has(slot) && slot < ROOM_PALETTE.length - 1) slot += 1;
    slots[index] = slot;
  }
  const result = new Map(rooms.map((room, index) => [room.id, slots[index]!]));
  assigned.set(rooms, result);
  return result;
};
