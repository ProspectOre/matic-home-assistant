import type { PhotoMarks, ViewpointDraft } from "./contracts";

/** A tap nearer the spot than this, in metres, gives no direction to aim at. */
const AIM_MIN = 0.1;

/** Photos' marks with the viewpoint being placed set, turned or ended; no marks, no map to place on. */
export const editViewpoint = (marks: PhotoMarks | null, draft: ViewpointDraft | null): PhotoMarks | null =>
  marks && { ...marks, draft };

/** The first tap sets the spot; later taps turn the camera toward the tapped point. */
export function placeViewpoint(marks: PhotoMarks | null, point: { readonly x: number; readonly y: number }): PhotoMarks | null {
  const draft = marks?.draft;
  if (!draft) return marks;
  const { spot } = draft;
  if (!spot) return { ...marks, draft: { spot: { x: point.x, y: point.y }, heading: draft.heading } };
  const dx = point.x - spot.x;
  const dy = point.y - spot.y;
  if (Math.hypot(dx, dy) < AIM_MIN) return marks;
  return { ...marks, draft: { spot, heading: Math.atan2(dy, dx) } };
}
