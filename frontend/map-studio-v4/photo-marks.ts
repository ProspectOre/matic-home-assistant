import type { WorkspaceState } from "./contracts";
import type { MapPoint } from "./renderer-layers";
import { rgba, type CanvasPalette } from "./theme-probe";

/** Half the camera's horizontal field of view (about 70°). */
const HALF_VIEW = (35 * Math.PI) / 180;
/** How far the drawn view reaches, in metres; a hint of direction, not the camera's range. */
const VIEW_REACH = 1.2;

type ProjectMeters = (x: number, y: number, height?: number, clipToViewport?: boolean) => MapPoint | null;

interface Mark {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  /** Saved viewpoints are labelled; the one being placed is dashed and unnamed. */
  readonly name: string | null;
}

/** Saved viewpoints, and one being placed, are drawn while Photos is open, on the live map they were read for. */
export const photoMarksVisible = (state: WorkspaceState): boolean => {
  const marks = state.photoMarks;
  return state.workflow === "photos" && state.dataMode === "live" && !!marks
    && (marks.viewpoints.length > 0 || !!marks.draft?.spot)
    && marks.mapSessionKey === state.resources.entry?.mapSessionKey;
};

/**
 * Each viewpoint as a pin with a wedge for the camera's view and its name.
 * Points are projected in metres, so the wedge follows the map's mirrored X
 * and any tilt without computing a screen angle.
 */
export function drawViewpoints(
  context: CanvasRenderingContext2D,
  state: WorkspaceState,
  palette: CanvasPalette,
  project: ProjectMeters,
): void {
  if (!photoMarksVisible(state)) return;
  const { viewpoints, draft } = state.photoMarks!;
  context.save();
  context.font = "600 12px system-ui, sans-serif";
  // Room names leave the shared context centred; names sit to the pin's right.
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  for (const viewpoint of viewpoints) drawMark(context, palette, project, viewpoint);
  if (draft?.spot) drawMark(context, palette, project, { ...draft.spot, heading: draft.heading, name: null });
  context.restore();
}

function drawMark(context: CanvasRenderingContext2D, palette: CanvasPalette, project: ProjectMeters, mark: Mark): void {
  const pin = project(mark.x, mark.y, 2, false);
  if (!pin) return;
  const placing = mark.name === null;
  const edge = (offset: number) => project(
    mark.x + VIEW_REACH * Math.cos(mark.heading + offset),
    mark.y + VIEW_REACH * Math.sin(mark.heading + offset),
    2,
    false,
  );
  const arc = [-HALF_VIEW, -HALF_VIEW / 2, 0, HALF_VIEW / 2, HALF_VIEW].map(edge);
  context.setLineDash(placing ? [5, 4] : []);
  if (arc.every(Boolean)) {
    context.beginPath();
    context.moveTo(pin.x, pin.y);
    for (const point of arc) context.lineTo(point!.x, point!.y);
    context.closePath();
    context.fillStyle = rgba(palette.accent, placing ? 0.32 : 0.22);
    context.fill();
    context.lineWidth = placing ? 2 : 1.5;
    context.strokeStyle = rgba(palette.accent, 0.9);
    context.stroke();
  }
  context.setLineDash([]);
  context.beginPath();
  context.arc(pin.x, pin.y, placing ? 8 : 6, 0, Math.PI * 2);
  context.fillStyle = rgba(placing ? palette.onAccent : palette.accent, 1);
  context.fill();
  context.lineWidth = placing ? 3 : 2.5;
  context.strokeStyle = rgba(placing ? palette.accent : palette.onAccent, 1);
  context.stroke();
  if (placing) return;
  context.lineWidth = 4;
  context.strokeStyle = rgba(palette.onAccent, 0.95);
  context.strokeText(mark.name!, pin.x + 10, pin.y);
  context.fillStyle = rgba(palette.text, 1);
  context.fillText(mark.name!, pin.x + 10, pin.y);
}
