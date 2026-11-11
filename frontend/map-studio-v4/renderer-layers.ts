import type { WorkspaceState } from "./contracts";
import type { SceneRoom } from "./backend-contracts";
import type { CanvasPalette } from "./theme-probe";
import { rgba } from "./theme-probe";
import { clamp } from "./shared-primitives";
import { canShowExactPose } from "./state";

export { OverlayGeometry } from "./overlay-geometry";

export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

let positionFormat: { readonly locale: string; readonly format: Intl.NumberFormat } | null = null;

export type ProjectMeters = (
  x: number,
  y: number,
  height?: number,
  clipToViewport?: boolean,
) => MapPoint | null;

export interface RoomLabelBounds {
  readonly width: number;
  readonly height: number;
}

export interface RoomLabelResult {
  readonly offsets: Map<string, readonly [x: number, y: number]>;
  readonly retryWithoutHistory: boolean;
}

export type ProjectCell = (x: number, y: number, height?: number, clipToViewport?: boolean) => MapPoint | null;

/** Lay out and paint room-name plates after the controller has painted room fills. */
export function drawRoomNames(
  context: CanvasRenderingContext2D,
  rooms: readonly SceneRoom[],
  palette: CanvasPalette,
  bounds: RoomLabelBounds,
  state: WorkspaceState,
  selectedNames: ReadonlySet<string>,
  previousOffsets: ReadonlyMap<string, readonly [x: number, y: number]>,
  project: ProjectCell,
): RoomLabelResult {
  const labelOffsets = new Map<string, readonly [x: number, y: number]>();
  context.lineWidth = 1.5;
  context.font = "600 12px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const occupied: (readonly [number, number, number])[] = [];
  const labels: (() => void)[] = [];
  // Labels draw after all fills. Place selected/current rooms first so a
  // crowded viewport keeps the names that explain the user's current work.
  const currentName = state.currentArea?.toLocaleLowerCase();
  let selectedPositions: ReadonlyMap<string, string> | null = null;
  if (state.workflow === "plan" && state.planDraft.runBehavior === "ordered") {
    if (positionFormat?.locale !== state.locale) {
      positionFormat = { locale: state.locale, format: new Intl.NumberFormat(state.locale) };
    }
    const { format } = positionFormat;
    selectedPositions = new Map(state.planDraft.rooms.map((room, index) => [room.roomId, format.format(index + 1)]));
  }
  const priority = (room: SceneRoom): number => {
    const name = room.name.toLocaleLowerCase();
    return +selectedNames.has(name) * 2 + +(name === currentName);
  };
  for (const room of [...rooms].sort((a, b) => priority(b) - priority(a))) {
    const center = project(room.center[0], room.center[1], 1);
    if (!center) continue;
    const position = selectedPositions?.get(room.id);
    const badgeWidth = position ? Math.max(16, context.measureText(position).width + 10) : 0;
    const badgeSpace = position ? badgeWidth + 4 : 0;
    // Search nearby slots in both axes, keeping each complete plate on screen.
    // Never paint a colliding fallback when the viewport is full.
    const width = badgeSpace + context.measureText(room.name).width + 12;
    if (width > bounds.width || bounds.height < 20) continue;
    // A shallow landscape map cannot usefully show distant callouts for every
    // room. Keep names near their rooms and favor the active choice.
    const maxDisplacement = bounds.height < 160 ? (priority(room) ? 56 : 32) : Infinity;
    let placement: readonly [number, number] | undefined;
    const fits = (x: number, y: number, gapX = 8, gapY = 4) => !occupied.some(([left, top, otherWidth]) => x < left + otherWidth + gapX
      && x + width + gapX > left && y < top + 20 + gapY && y + 20 + gapY > top);
    let previous = previousOffsets.get(room.id);
    if (previous) {
      const x = clamp(center.x + previous[0] - width / 2, 0, bounds.width - width);
      const y = clamp(center.y + previous[1] - 10, 0, bounds.height - 20);
      // Cached plates may use their physical gap as hysteresis to avoid row swaps.
      const cachedFits = bounds.height >= 160 ? fits(x, y, 0, 0) : fits(x, y);
      if (Math.hypot(x + width / 2 - center.x, y + 10 - center.y) <= maxDisplacement + 24
        && cachedFits) placement = [x, y];
      else {
        // At a viewport edge, a one-pixel adjustment can preserve spacing.
        if (bounds.height < 160) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX + width > bounds.width || nextY + 20 > bounds.height) continue;
          if (Math.hypot(nextX + width / 2 - center.x, nextY + 10 - center.y) > maxDisplacement + 24 || !fits(nextX, nextY)) continue;
          placement = [nextX, nextY];
          break;
        }
        previous = undefined;
      }
    }
    let nearest = Infinity;
    if (!placement) for (let row = -4; row <= 4; row++) for (let column = -2; column <= 2; column++) {
      const x = clamp(center.x - width / 2 + column * (width + 8), 0, bounds.width - width);
      const y = clamp((Math.round((center.y - 10) / 24) + row) * 24, 0, Math.floor((bounds.height - 20) / 24) * 24);
      const distance = Math.hypot(x + width / 2 - center.x, y + 10 - center.y);
      if (distance > maxDisplacement || distance >= nearest || !fits(x, y)) continue;
      placement = [x, y];
      nearest = distance;
    }
    if (!placement) {
      // Repack a roomy viewport when retained offsets fragment it. A shallow
      // map deliberately omits crowded labels instead of making them jump.
      if (bounds.height >= 160 && previousOffsets.size) {
        return { offsets: new Map(), retryWithoutHistory: true };
      }
      continue;
    }
    const [left, top] = placement;
    labelOffsets.set(room.id, previous ?? [left + width / 2 - center.x, top + 10 - center.y]);
    occupied.push([left, top, width]);
    const edgeX = clamp(center.x, left, left + width);
    const edgeY = clamp(center.y, top, top + 20);
    if (edgeX !== center.x || edgeY !== center.y) {
      context.beginPath();
      context.moveTo(center.x, center.y);
      context.lineTo(edgeX, edgeY);
      context.lineWidth = 1;
      context.strokeStyle = rgba(palette.text, .7);
      context.stroke();
    }
    labels.push(() => {
      const y = top + 10;
      context.fillStyle = rgba(palette.plate, .88);
      context.fillRect(left, top, width, 20);
      if (position) {
        const badgeX = left + 6 + badgeWidth / 2;
        context.beginPath();
        context.roundRect(badgeX - badgeWidth / 2, y - 8, badgeWidth, 16, 8);
        context.fillStyle = rgba(palette.accent, 1);
        context.fill();
        context.fillStyle = rgba(palette.onAccent, 1);
        context.fillText(position, badgeX, y);
      }
      context.fillStyle = rgba(palette.text, 1);
      context.fillText(room.name, left + width / 2 + badgeSpace / 2, y);
    });
  }
  for (const paint of labels) paint();
  return { offsets: labelOffsets, retryWithoutHistory: false };
}

export function drawLastSeenDuringRun(
  context: CanvasRenderingContext2D,
  state: WorkspaceState,
  palette: CanvasPalette,
  project: ProjectMeters,
): void {
  if (!canShowLastSeenDuringRun(state) || !state.seen) return;
  const marker = project(state.seen.position[0], state.seen.position[1], 3, false);
  if (!marker) return;
  context.save();
  context.beginPath();
  context.moveTo(marker.x, marker.y - 10);
  context.lineTo(marker.x + 10, marker.y);
  context.lineTo(marker.x, marker.y + 10);
  context.lineTo(marker.x - 10, marker.y);
  context.closePath();
  context.setLineDash([3, 2]);
  context.strokeStyle = rgba(palette.text, .95);
  context.lineWidth = 2;
  context.stroke();
  context.setLineDash([]);
  context.font = "600 12px sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 4;
  context.strokeStyle = rgba(palette.onAccent, .95);
  context.strokeText("Last seen during last clean", marker.x + 14, marker.y);
  context.fillStyle = rgba(palette.text, 1);
  context.fillText("Last seen during last clean", marker.x + 14, marker.y);
  context.restore();
}

/** Historical marker eligibility is kept with its lazy drawing code. */
export const canShowLastSeenDuringRun = (state: WorkspaceState): boolean => {
  const marker = state.seen;
  const entry = state.resources.entry;
  return !!marker && state.pageActive && state.dataMode === "live" && state.map.available
    && state.selection.floorId === "current" && !state.floor.readOnly
    && !state.managedLock && state.activity === "docked" && !canShowExactPose(state)
    && marker.entryId === state.selection.entryId && marker.entryId === entry?.entryId
    && !!entry?.mapFloorCoherent && !!entry.mapSessionVerified
    && marker.mapSessionKey === entry.mapSessionKey
    && marker.mapSessionKey === state.resources.pose.value?.mapSessionKey;
};
