import type { FloorTypeOutline, WorkspaceState } from "./contracts";
import { buildWifiRaster, drawWifiRaster } from "./wifi-raster";
import type { SceneRoom } from "./backend-contracts";
import { entryCoherenceIdentity } from "./backend-contracts";
import type { CanvasPalette } from "./theme-probe";
import { rgba } from "./theme-probe";
import { clamp } from "./shared-primitives";

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

/** Paint map layers that users can enable from Map options. */
export function drawMapLayers(
  context: CanvasRenderingContext2D,
  state: WorkspaceState,
  project: ProjectMeters,
): void {
  const currentFloor = state.dataMode === "live" && !state.floor.readOnly
    && state.selection.floorId === "current";
  if (currentFloor) {
    const support = state.resources.scene.value?.metadata.floorSupport;
    if (support && state.wifiSignal?.status === "ready") {
      const raster = buildWifiRaster(state.wifiSignal, support, state.wifiScale);
      if (raster) drawWifiRaster(context, raster, support, project, state.view === "three");
    }
    if (state.floorTypes?.status === "ready") {
      if (state.floorTypeModes & 1) {
        drawFloorType(context, state.floorTypes.carpet, "hsl(28 55% 42%)", project);
      }
      if (state.floorTypeModes & 2) {
        drawFloorType(context, state.floorTypes.vent, "hsl(205 80% 50%)", project);
      }
    }
    if (state.liveCoverage?.active && state.liveCoverage.ownershipUnverified !== true && state.resources.entry
      && state.resources.entry.nativeSessionActive === true
      && state.liveCoverage.frameKey === entryCoherenceIdentity(state.resources.entry)) {
      drawCleaningCoverage(context, state, project);
    }
  }
}

function drawCleaningCoverage(
  context: CanvasRenderingContext2D,
  state: WorkspaceState,
  project: ProjectMeters,
): void {
  const layer = state.liveCoverage;
  if (!layer) return;
  context.save();
  for (const [bit, enabled, colour] of [
    [1, Boolean(state.coverageModes & 1), "rgba(41, 142, 239, 0.35)"],
    [2, Boolean(state.coverageModes & 2), "rgba(29, 192, 157, 0.38)"],
  ] as const) {
    if (!enabled) continue;
    context.beginPath();
    for (const [cellX, cellY, length, mask] of layer.runs) {
      if (!(mask & bit)) continue;
      const x = cellX * layer.cellSize;
      const y = cellY * layer.cellSize;
      const right = (cellX + length) * layer.cellSize;
      const bottom = (cellY + 1) * layer.cellSize;
      const a = project(x, y, 0, false);
      const b = project(right, y, 0, false);
      const c = project(right, bottom, 0, false);
      const d = project(x, bottom, 0, false);
      if (!a || !b || !c || !d) continue;
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.lineTo(c.x, c.y);
      context.lineTo(d.x, d.y);
      context.closePath();
    }
    context.fillStyle = colour;
    context.fill();
  }
  context.restore();
}

export function drawRunTrail(
  context: CanvasRenderingContext2D,
  state: WorkspaceState,
  palette: CanvasPalette,
  project: ProjectMeters,
): void {
  // A trail is drawn only over the map session it was recorded on
  // (run_history.py); a past run's trail only while Cleaning history is open.
  const trail = state.trail;
  if (!trail || state.dataMode !== "live"
    || (trail.id !== "live" && state.workflow !== "runs")
    || trail.mapSessionKey !== state.resources.entry?.mapSessionKey) return;
  const isolated: MapPoint[] = [];
  context.beginPath();
  for (const segment of trail.segments) {
    let previous: { x: number; y: number; point: MapPoint; linked: boolean } | null = null;
    const finishPoint = () => { if (previous && !previous.linked) isolated.push(previous.point); };
    segment.forEach(([x, y]) => {
      const point = project(x, y, 0, false);
      if (!point) { finishPoint(); previous = null; return; }
      // The recorder supplies a new segment at a verified localization break.
      // Preserve every adjacent observation inside a segment, including long
      // straight passes and the spacing retained by legacy saved trails.
      const linked = previous !== null;
      if (linked) context.lineTo(point.x, point.y);
      else { finishPoint(); context.moveTo(point.x, point.y); }
      previous = { x, y, point, linked };
    });
    finishPoint();
  }
  context.save();
  context.lineJoin = context.lineCap = "round";
  context.strokeStyle = rgba(palette.onAccent, 1);
  context.lineWidth = 4;
  context.stroke();
  context.strokeStyle = rgba(palette.accent, 1);
  context.lineWidth = 2;
  context.stroke();
  // A lone observation would otherwise have no stroked line at all.
  for (const [radius, colour] of [[2, palette.onAccent], [1, palette.accent]] as const) {
    context.beginPath();
    for (const point of isolated) {
      context.moveTo(point.x + radius, point.y);
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    }
    context.fillStyle = rgba(colour, 1);
    context.fill();
  }
  context.restore();
}

// Even-odd fill keeps the holes the integration traces inside a rug.
function drawFloorType(
  context: CanvasRenderingContext2D,
  outlines: readonly FloorTypeOutline[],
  colour: string,
  project: ProjectMeters,
): void {
  if (!outlines.length) return;
  context.save();
  context.beginPath();
  for (const outline of outlines) {
    let started = false;
    for (const [x, y] of outline) {
      const point = project(x, y, 0.05, false);
      if (!point) continue;
      if (started) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
      started = true;
    }
    if (started) context.closePath();
  }
  context.globalAlpha = 0.35;
  context.fillStyle = colour;
  context.fill("evenodd");
  context.globalAlpha = 0.8;
  context.strokeStyle = colour;
  context.lineWidth = 1.25;
  context.stroke();
  context.restore();
}
