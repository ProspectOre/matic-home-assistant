import type { AreaCircle } from "./backend-contracts";
import type { WorkspaceState } from "./contracts";
import { rgba, type CanvasPalette } from "./theme-probe";
import type { MapPoint } from "./renderer-controller";

export type ProjectMeters = (x: number, y: number, height?: number, clipToViewport?: boolean) => MapPoint | null;

export function drawTaskOverlays(
  context: CanvasRenderingContext2D,
  state: WorkspaceState,
  circles: readonly AreaCircle[],
  cursor: MapPoint | null,
  palette: CanvasPalette,
  width: number,
  height: number,
  project: ProjectMeters,
): void {
  const drawCircle = (circle: AreaCircle, paint = true): void => {
    const center = project(circle.x, circle.y);
    const edge = project(circle.x + circle.radius, circle.y);
    if (!center || !edge) return;
    const radius = Math.max(1, Math.hypot(edge.x - center.x, edge.y - center.y));
    if (paint) context.beginPath();
    context.moveTo(center.x + radius, center.y);
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    if (paint) { context.fill(); context.stroke(); }
  };
  if (state.workflow === "areaReview" && circles.length && !palette.forced) {
    context.fillStyle = "rgba(0, 0, 0, 0.45)";
    context.fillRect(0, 0, width, height);
    context.save();
    context.globalCompositeOperation = "destination-out";
    context.fillStyle = "#000";
    context.beginPath();
    for (const circle of circles) drawCircle(circle, false);
    context.fill();
    context.restore();
  }
  if ((state.workflow === "draw" || state.workflow === "areaReview") && circles.length) {
    context.fillStyle = rgba(palette.accent, .22);
    context.strokeStyle = rgba(palette.accent, .92);
    context.lineWidth = 1.5;
    if (state.draw.outline?.closed) {
      context.beginPath();
      for (const circle of circles) drawCircle(circle, false);
      context.fill();
    } else {
      for (const circle of circles) drawCircle(circle);
    }
  }
  const outline = state.draw.outline;
  if (outline && (state.workflow === "draw" || state.workflow === "areaReview")
    && !(state.workflow === "draw" && state.draw.tool === "outline")) {
    context.beginPath();
    outline.points.forEach((point, i) => {
      const p = project(point.x, point.y, 0, false);
      if (p) { if (i === 0) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y); }
    });
    if (outline.closed) context.closePath();
    context.strokeStyle = rgba(palette.accent, 1);
    context.lineWidth = 2;
    context.stroke();
  }
  if (cursor && state.workflow === "draw" && (state.draw.tool === "paint" || state.draw.tool === "erase")) {
    const center = project(cursor.x, cursor.y);
    const edge = project(cursor.x + state.draw.brushMeters / 2, cursor.y, 0, false);
    if (center && edge) {
      context.beginPath();
      context.arc(center.x, center.y, Math.max(2, Math.hypot(edge.x - center.x, edge.y - center.y)), 0, Math.PI * 2);
      context.strokeStyle = rgba(palette.accent, 1);
      context.lineWidth = 2;
      context.stroke();
    }
  }
}
