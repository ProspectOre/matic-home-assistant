// Where the live trail breaks and which of its points it keeps: the rules of
// trail_path.py, so the trail this browser grows matches the one a reload
// returns. Both are held to tests/fixtures/trail_path_v1.json.
import type { TrailPoint } from "./run-history-data";

/** A pose closer than this to the last kept point adds nothing to the path. */
export const TRAIL_STEP_METERS = 0.15;
const TRAIL_JUMP_METERS = 1;
const TRAIL_GAP_SECONDS = 8;

/** Whether a kept pose begins a new segment: a jump, or a stretch the robot went unseen. */
export const startsSegment = (last: TrailPoint, lastSeen: number | null, point: TrailPoint, seen: number | null): boolean =>
  Math.hypot(point[0] - last[0], point[1] - last[1]) > TRAIL_JUMP_METERS
  || (lastSeen !== null && seen !== null && seen - lastSeen > TRAIL_GAP_SECONDS);

/** Squared distance from a point to the segment between its kept neighbours. */
const weight = (point: TrailPoint, first: TrailPoint, last: TrailPoint): number => {
  const dx = last[0] - first[0], dy = last[1] - first[1];
  const px = point[0] - first[0], py = point[1] - first[1];
  const length = dx * dx + dy * dy;
  const along = length ? Math.min(1, Math.max(0, (px * dx + py * dy) / length)) : 0;
  const ex = px - along * dx, ey = py - along * dy;
  return ex * ex + ey * ey;
};

// [weight, index, previous, following], ordered as Python orders the tuple.
type Entry = readonly [number, number, number, number];
const before = (a: Entry, b: Entry): boolean => {
  for (let field = 0; field < 4; field += 1) if (a[field] !== b[field]) return a[field]! < b[field]!;
  return false;
};

/** A binary min-heap, as heapq; any order of equal-ranked pops gives the same result. */
class Heap {
  readonly #items: Entry[] = [];
  push(entry: Entry): void {
    const items = this.#items;
    let at = items.push(entry) - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!before(items[at]!, items[parent]!)) break;
      [items[at], items[parent]] = [items[parent]!, items[at]!];
      at = parent;
    }
  }
  pop(): Entry {
    const items = this.#items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      for (let at = 0; ;) {
        const left = 2 * at + 1, right = left + 1;
        let least = at;
        if (left < items.length && before(items[left]!, items[least]!)) least = left;
        if (right < items.length && before(items[right]!, items[least]!)) least = right;
        if (least === at) break;
        [items[at], items[least]] = [items[least]!, items[at]!];
        at = least;
      }
    }
    return top;
  }
}

/**
 * Keeps at most `limit` points, removing the least shape-defining first, as
 * trail_path.thin_segments does: each segment keeps its ends, equal weights
 * go oldest first, and the oldest segments go whole when the ends alone
 * exceed the budget.
 */
export const thinSegments = (segments: readonly (readonly TrailPoint[])[], limit: number): TrailPoint[][] => {
  let paths = segments.filter((segment) => segment.length > 0);
  let ends = 0;
  let first = paths.length;
  while (first && ends + Math.min(2, paths[first - 1]!.length) <= limit) {
    first -= 1;
    ends += Math.min(2, paths[first]!.length);
  }
  paths = paths.slice(first);
  const points = paths.flat();
  let remaining = points.length;
  if (remaining <= limit) return paths.map((path) => [...path]);
  const previous = points.map((_, index) => index - 1);
  const following = points.map((_, index) => index + 1);
  const candidate = new Array<boolean>(points.length).fill(false);
  let start = 0;
  for (const path of paths) {
    for (let index = start + 1; index < start + path.length - 1; index += 1) candidate[index] = true;
    start += path.length;
  }
  const removed = new Array<boolean>(points.length).fill(false);
  const weighed = (index: number): Entry => {
    const [p, f] = [previous[index]!, following[index]!];
    return [weight(points[index]!, points[p]!, points[f]!), index, p, f];
  };
  const heap = new Heap();
  candidate.forEach((interior, index) => { if (interior) heap.push(weighed(index)); });
  while (remaining > limit) {
    const [, index, p, f] = heap.pop();
    if (removed[index] || previous[index] !== p || following[index] !== f) continue;
    removed[index] = true;
    remaining -= 1;
    following[p] = f;
    previous[f] = p;
    for (const neighbour of [p, f]) if (candidate[neighbour]) heap.push(weighed(neighbour));
  }
  start = 0;
  return paths.map((path) => {
    const kept = path.filter((_, offset) => !removed[start + offset]);
    start += path.length;
    return kept;
  });
};
