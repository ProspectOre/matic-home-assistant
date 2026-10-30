import type { MapPoint } from "./renderer-controller";
import type { CanvasPalette, Channel } from "./theme-probe";

// Original low-poly robot drawn on the map overlay: a squircle body with a
// bevelled lid, a dark sensor band and visor on the front, and the theme's
// indicator colour as a ring on the lid. No vendor artwork is used.
//
// Geometry is in robot-local meters, x forward and y to the left, and each
// point goes through the map projection, so the model turns with the robot's
// heading and with the camera in both the top and the 3D views.

/** Projects robot-frame meters at a height in meters, or null off the camera. */
export type RobotProjection = (forward: number, left: number, height: number) => MapPoint | null;

type Local = readonly [x: number, y: number];

const LENGTH = 0.34;
const BODY = 0.095;
const LID = 0.115;
const LID_INSET = 0.9;
const BAND: readonly [low: number, high: number] = [0.055, 0.082];
/** On-screen length the model never shrinks below, in CSS pixels. */
const MIN_PIXELS = 30;
const MAX_SCALE = 8;
/** Light comes from the map's upper left, in map meters. */
const LIGHT: Local = [-0.6, 0.8];

const ring = (count: number, point: (t: number) => Local): Local[] =>
  Array.from({ length: count }, (_, i) => point(i / count * Math.PI * 2));

// Superellipse footprint, wound counter-clockwise from above.
const superellipse = (t: number): Local => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [0.17 * Math.sign(c) * Math.abs(c) ** 0.5, 0.16 * Math.sign(s) * Math.abs(s) ** 0.5];
};
const FOOTPRINT = ring(32, superellipse);
const LID_OUTLINE = FOOTPRINT.map(([x, y]): Local => [x * LID_INSET, y * LID_INSET]);
const NORMALS = FOOTPRINT.map(([x, y], i): Local => {
  const [nextX, nextY] = FOOTPRINT[(i + 1) % FOOTPRINT.length] as Local;
  const length = Math.hypot(nextX - x, nextY - y) || 1;
  return [(nextY - y) / length, (x - nextX) / length];
});
// Pill across the front of the lid: the left cap, then the right cap.
const VISOR = Array.from({ length: 14 }, (_, i): Local => {
  const a = (i < 7 ? i : i - 1) * Math.PI / 6;
  return [0.124 + Math.cos(a) * 0.02, (i < 7 ? 0.075 : -0.075) + Math.sin(a) * 0.02];
});
const LID_RING = ring(20, (t) => [-0.02 + Math.cos(t) * 0.075, Math.sin(t) * 0.075]);

const shade = ([r, g, b]: Channel, light: number): string =>
  `rgb(${Math.round(r * light)},${Math.round(g * light)},${Math.round(b * light)})`;

const signedArea = (points: readonly MapPoint[]): number => {
  let area = 0;
  points.forEach((point, i) => {
    const next = points[(i + 1) % points.length] as MapPoint;
    area += point.x * next.y - next.x * point.y;
  });
  return area;
};

const path = (context: CanvasRenderingContext2D, points: readonly MapPoint[]): void => {
  context.beginPath();
  points.forEach((point, i) => {
    if (i === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
};

/**
 * Draws the robot and returns true, or returns false without drawing when a
 * point falls behind the camera so the caller can draw its flat marker.
 */
export const drawRobot = (
  context: CanvasRenderingContext2D,
  project: RobotProjection,
  heading: number,
  palette: CanvasPalette,
): boolean => {
  const centre = project(0, 0, 0);
  const front = project(1, 0, 0);
  const side = project(0, 1, 0);
  if (!centre || !front || !side) return false;
  const pixelsPerMeter = Math.max(
    Math.hypot(front.x - centre.x, front.y - centre.y),
    Math.hypot(side.x - centre.x, side.y - centre.y),
  );
  const scale = Math.min(MAX_SCALE, Math.max(1, MIN_PIXELS / Math.max(1e-6, LENGTH * pixelsPerMeter)));
  const projectAll = (points: readonly Local[], height: number, grow = 1): MapPoint[] | null => {
    const out: MapPoint[] = [];
    for (const [x, y] of points) {
      const point = project(x * scale * grow, y * scale * grow, height * scale);
      if (!point) return null;
      out.push(point);
    }
    return out;
  };
  const floor = projectAll(FOOTPRINT, 0);
  const shoulder = projectAll(FOOTPRINT, BODY);
  const top = projectAll(LID_OUTLINE, LID);
  const shadow = projectAll(FOOTPRINT, 0, 1.12);
  const visor = projectAll(VISOR, LID);
  const lidRing = projectAll(LID_RING, LID);
  const bandLow = projectAll(FOOTPRINT, BAND[0]);
  const bandHigh = projectAll(FOOTPRINT, BAND[1]);
  if (!floor || !shoulder || !top || !shadow || !visor || !lidRing || !bandLow || !bandHigh) return false;

  const forced = palette.forced;
  const body: Channel = forced ? palette.accent : [236, 240, 242];
  const trim: Channel = forced ? palette.onAccent : [38, 50, 56];
  const edge = forced ? shade(palette.onAccent, 1) : "rgba(38,50,56,0.7)";
  // Faces whose projected winding matches the lid face the camera.
  const upward = Math.sign(signedArea(top));
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const lightFor = ([x, y]: Local): number => {
    const dot = (x * cos - y * sin) * LIGHT[0] + (x * sin + y * cos) * LIGHT[1];
    return forced ? 1 : 0.68 + 0.26 * Math.max(0, dot);
  };
  const face = (points: MapPoint[], fill: string): void => {
    path(context, points);
    context.fillStyle = fill;
    context.strokeStyle = fill;
    context.fill();
    context.stroke();
  };

  context.save();
  context.lineJoin = "round";
  if (!forced) {
    path(context, shadow);
    context.fillStyle = "rgba(0,0,0,0.2)";
    context.fill();
  }
  path(context, floor);
  context.lineWidth = 2.5;
  context.strokeStyle = edge;
  context.stroke();
  context.lineWidth = 0.75;
  // The bevel between the body and the lid catches more light.
  const rings: readonly (readonly [MapPoint[], MapPoint[], number])[] = [[floor, shoulder, 1], [shoulder, top, 1.1]];
  for (const [lower, upper, lift] of rings) {
    FOOTPRINT.forEach((_, i) => {
      const j = (i + 1) % FOOTPRINT.length;
      const quad = [lower[i], lower[j], upper[j], upper[i]] as MapPoint[];
      if (Math.sign(signedArea(quad)) !== upward) return;
      const normal = NORMALS[i] as Local;
      face(quad, shade(body, Math.min(1, lightFor(normal) * lift)));
      if (lower === floor && normal[0] > 0.55) {
        // Sensor band across the front face.
        face([bandLow[i], bandLow[j], bandHigh[j], bandHigh[i]] as MapPoint[], shade(trim, 1));
      }
    });
  }
  face(top, shade(body, 1));
  path(context, top);
  context.lineWidth = 1;
  context.strokeStyle = edge;
  context.stroke();
  face(visor, shade(trim, 1));
  path(context, lidRing);
  context.lineWidth = Math.max(1.5, scale * pixelsPerMeter * 0.008);
  context.strokeStyle = shade(forced ? palette.onAccent : palette.accent, 1);
  context.stroke();
  context.restore();
  return true;
};
