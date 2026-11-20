import type { WorkspaceState } from "./contracts";
import type { MapPoint } from "./renderer-layers";
import { rgba, type CanvasPalette } from "./theme-probe";

/** Half the camera's horizontal field of view (about 70°). */
const HALF_VIEW = (35 * Math.PI) / 180;
/** How far the drawn view reaches, in metres; a hint of direction, not the camera's range. */
const VIEW_REACH = 1.2;

type ProjectMeters = (x: number, y: number, height?: number, clipToViewport?: boolean) => MapPoint | null;

/** Saved viewpoints are drawn while Photos is open, on the live map they were read for. */
export const photoMarksVisible = (state: WorkspaceState): boolean =>
  state.workflow === "photos" && state.dataMode === "live" && !!state.photoMarks?.viewpoints.length
  && state.photoMarks.mapSessionKey === state.resources.entry?.mapSessionKey;

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
  context.save();
  context.font = "600 12px system-ui, sans-serif";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  for (const viewpoint of state.photoMarks!.viewpoints) {
    const pin = project(viewpoint.x, viewpoint.y, 2, false);
    if (!pin) continue;
    const edge = (offset: number) => project(
      viewpoint.x + VIEW_REACH * Math.cos(viewpoint.heading + offset),
      viewpoint.y + VIEW_REACH * Math.sin(viewpoint.heading + offset),
      2,
      false,
    );
    const arc = [-HALF_VIEW, -HALF_VIEW / 2, 0, HALF_VIEW / 2, HALF_VIEW].map(edge);
    if (arc.every(Boolean)) {
      context.beginPath();
      context.moveTo(pin.x, pin.y);
      for (const point of arc) context.lineTo(point!.x, point!.y);
      context.closePath();
      context.fillStyle = rgba(palette.accent, 0.22);
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = rgba(palette.accent, 0.9);
      context.stroke();
    }
    context.beginPath();
    context.arc(pin.x, pin.y, 6, 0, Math.PI * 2);
    context.fillStyle = rgba(palette.accent, 1);
    context.fill();
    context.lineWidth = 2.5;
    context.strokeStyle = rgba(palette.onAccent, 1);
    context.stroke();
    context.lineWidth = 4;
    context.strokeStyle = rgba(palette.onAccent, 0.95);
    context.strokeText(viewpoint.name, pin.x + 10, pin.y);
    context.fillStyle = rgba(palette.text, 1);
    context.fillText(viewpoint.name, pin.x + 10, pin.y);
  }
  context.restore();
}
