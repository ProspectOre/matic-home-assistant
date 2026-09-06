import type { AreaCircle } from "./backend-contracts";

export interface AreaPoint { readonly x: number; readonly y: number }
export interface AreaOutline {
  readonly points: readonly AreaPoint[];
  readonly closed: boolean;
}

export const edgeDistance = (p: AreaPoint, a: AreaPoint, b: AreaPoint): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

export const insideOutline = (p: AreaPoint, points: readonly AreaPoint[]): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

const cross = (a: AreaPoint, b: AreaPoint, c: AreaPoint): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export const validOutline = ({ points, closed }: AreaOutline): boolean => {
  if (points.length > 64 || (closed && points.length < 3)
    || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 10000 || Math.abs(p.y) > 10000)) return false;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) < .01) return false;
    for (let j = i + 2; j < count; j++) {
      if (closed && i === 0 && j === count - 1) continue;
      const c = points[j]!, d = points[(j + 1) % points.length]!;
      if (Math.min(edgeDistance(a, c, d), edgeDistance(b, c, d), edgeDistance(c, a, b), edgeDistance(d, a, b)) < .00001
        || (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)) return false;
    }
  }
  return !closed || Math.abs(points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length]!;
    return sum + a.x * b.y - b.x * a.y;
  }, 0)) > .01;
};

/** Use only the already verified circle command. All preview circles are
 * inscribed; rounding may shrink them but must never expand past the outline.
 * A bounded grid keeps editing independent of polygon size or input density. */
export const outlineCircles = (outline: AreaOutline, contains: (point: AreaPoint) => boolean): AreaCircle[] => {
  if (!outline.closed || !validOutline(outline)) return [];
  const { points } = outline;
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const candidates: AreaCircle[] = [];
  for (let row = 0; row < 32; row++) for (let column = 0; column < 32; column++) {
    const p = { x: Math.round((minX + (column + .5) * (maxX - minX) / 32) * 10000) / 10000,
      y: Math.round((minY + (row + .5) * (maxY - minY) / 32) * 10000) / 10000 };
    if (!insideOutline(p, points) || !contains(p)) continue;
    const clearance = Math.min(...points.map((a, i) => edgeDistance(p, a, points[(i + 1) % points.length]!)));
    const radius = Math.floor(Math.min(2.5, clearance - .0001) * 10000) / 10000;
    if (radius >= .05) candidates.push({ ...p, radius });
  }
  candidates.sort((a, b) => b.radius - a.radius);
  const circles: AreaCircle[] = [];
  for (const circle of candidates) {
    if (circles.length >= 512) break;
    if (!circles.some((other) => Math.hypot(other.x - circle.x, other.y - circle.y) + circle.radius * .5 <= other.radius)) circles.push(circle);
  }
  return circles;
};
