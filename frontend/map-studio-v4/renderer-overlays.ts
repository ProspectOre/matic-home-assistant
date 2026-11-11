import type { AreaCircle, MapZoneOverlay, SceneModel } from "./backend-contracts";
import type { CoordinateEditCapture, WorkspaceState } from "./contracts";
import { canShowExactPose, hasCoordinateEditAdmission, topView } from "./state";
import { rgba, type CanvasPalette, type Channel } from "./theme-probe";
import type { drawRobot as DrawRobot } from "./robot-model";
import type { MapPoint, RendererCamera } from "./renderer-camera";
import { selectedRoomNames } from "./renderer-hit-test";
import type { RendererModules } from "./renderer-modules";

/** Room colors replace the photo wherever the map shows the top view. */
export const roomColours = (state: WorkspaceState | null): boolean =>
  !!state && topView(state) === "top" && state.appearance === "rooms";

// Put clearly separated hues first for ordinary homes. Larger maps retain a
// unique color for every supported room; IDs, rather than metadata order,
// determine the palette position. Boundaries and labels also identify rooms.
const ROOM_COLORS: readonly Channel[] = [
  [47, 158, 220], [13, 255, 13], [255, 13, 13], [215, 13, 255],
  [255, 185, 115], [7, 140, 7], [13, 53, 255], [140, 63, 115],
  [11, 217, 182], [255, 115, 185], [178, 129, 80], [35, 105, 140],
  [137, 98, 217], [217, 11, 148], [150, 178, 9], [140, 74, 7],
];
const roomColor = (index: number, palette: CanvasPalette): Channel => {
  if (palette.forced) return palette.roomFill;
  const slot = ((index - ROOM_COLORS.length) * 149 + 53) & 255;
  const color = ROOM_COLORS[index] ?? [40 + Math.floor(slot / 32) * 30,
    40 + Math.floor(slot / 4) % 8 * 30, 40 + slot % 4 * 70];
  return color.map((value, channel) => Math.round(value * .8
    + (palette.roomFill[channel] ?? 0) * .2)) as unknown as Channel;
};

// Matches the literal colours the overlay shipped with, so nothing changes
// until a host wires `readCanvasPalette()` through `setPalette()`.
const DEFAULT_PALETTE: CanvasPalette = {
  accent: [6, 120, 206],
  onAccent: [255, 255, 255],
  text: [38, 50, 56],
  quiet: [75, 92, 105],
  plate: [250, 252, 253],
  roomFill: [231, 238, 242],
  forced: false,
};

interface RasterHost {
  readonly scene: () => SceneModel | null;
  /** The page is active and the renderer is drawing without WebGL. */
  readonly active: () => boolean;
  readonly rendered: (points: number) => void;
  readonly requestRender: () => void;
}

/** The point cloud drawn with Canvas 2D when WebGL2 is unavailable. */
export class FallbackRaster {
  readonly #camera: RendererCamera;
  readonly #host: RasterHost;
  canvas: HTMLCanvasElement | null = null;
  #context: CanvasRenderingContext2D | null = null;
  #projection: {
    readonly scene: SceneModel;
    readonly matrix: Float32Array;
    readonly width: number;
    readonly height: number;
  } | null = null;
  #frame: number | null = null;

  constructor(camera: RendererCamera, host: RasterHost) {
    this.#camera = camera;
    this.#host = host;
  }

  /** False when the browser offers no 2D context either. */
  init(): boolean {
    this.canvas = document.createElement("canvas");
    this.#context = this.canvas.getContext("2d", { alpha: true });
    return this.#context !== null;
  }

  /** Rebuilds the raster when the scene, viewport or camera changed. */
  update(scene: SceneModel): void {
    const projection = this.#projection;
    const { viewport, matrix } = this.#camera;
    if (!projection || projection.scene !== scene
      || projection.width !== viewport.width || projection.height !== viewport.height
      || !projection.matrix.every((value, index) => value === matrix[index])) {
      this.#build(scene);
    }
  }

  #build(scene: SceneModel): void {
    const context = this.#context;
    const canvas = this.canvas;
    if (!context || !canvas) return;
    this.cancel();
    const projection = {
      scene,
      matrix: new Float32Array(this.#camera.matrix),
      width: this.#camera.viewport.width,
      height: this.#camera.viewport.height,
    };
    this.#projection = projection;
    // Cache the camera-aligned raster, capped at four MiB regardless of zoom
    // or display density. Animation frames only composite this cached layer.
    const scale = Math.min(window.devicePixelRatio || 1,
      1024 / Math.max(1, projection.width), 1024 / Math.max(1, projection.height));
    canvas.width = Math.max(1, Math.round(projection.width * scale));
    canvas.height = Math.max(1, Math.round(projection.height * scale));
    context.setTransform(scale, 0, 0, scale, 0, 0);
    this.#host.rendered(0);
    const view = new DataView(scene.buffer, scene.pointOffset, scene.total * 8);
    const step = Math.max(1, Math.ceil(scene.total / 50_000));
    let index = 0;
    let rendered = 0;
    const drawChunk = (): void => {
      if (!this.#host.active() || scene !== this.#host.scene() || projection !== this.#projection) return;
      this.#frame = null;
      const started = performance.now();
      let processed = 0;
      while (index < scene.total && processed < 2_000) {
        const offset = index * 8;
        const point = this.#camera.projectCell(view.getUint16(offset, true), view.getUint16(offset + 2, true),
          view.getUint8(offset + 4), true, projection.matrix, projection);
        if (point) {
          context.fillStyle = `rgb(${view.getUint8(offset + 5)} ${view.getUint8(offset + 6)} ${view.getUint8(offset + 7)})`;
          context.fillRect(point.x - 0.75, point.y - 0.75, 1.5, 1.5);
        }
        index += step;
        processed += 1;
        rendered += 1;
        if (processed % 64 === 0 && performance.now() - started >= 4) break;
      }
      this.#host.rendered(rendered);
      this.#host.requestRender();
      if (index < scene.total) this.#frame = window.setTimeout(drawChunk, 0);
    };
    this.#frame = window.setTimeout(drawChunk, 0);
  }

  cancel(): void {
    if (this.#frame !== null) window.clearTimeout(this.#frame);
    this.#frame = null;
    this.#projection = null;
  }

  dispose(): void {
    this.cancel();
    this.canvas = null;
    this.#context = null;
  }
}

interface OverlayHost {
  readonly scene: () => SceneModel | null;
  readonly state: () => WorkspaceState | null;
  readonly fallback: () => boolean;
  readonly pixelRatio: () => number;
  readonly requestRender: () => void;
  readonly scheduleRoomNames: () => void;
}

/** Everything drawn on the 2D canvas above the scene. */
export class RendererOverlay {
  #context: CanvasRenderingContext2D | null;
  readonly #camera: RendererCamera;
  readonly #modules: RendererModules;
  readonly #raster: FallbackRaster;
  readonly #host: OverlayHost;
  #circlePreview: { readonly circles: readonly AreaCircle[]; readonly capture: CoordinateEditCapture } | null = null;
  #cursor: MapPoint | null = null;
  /** undefined until a heading needs it, null while loading or after a failed load. */
  #robotModel: typeof DrawRobot | null | undefined;
  #palette: CanvasPalette = DEFAULT_PALETTE;
  #labelOffsets = new Map<string, readonly [x: number, y: number]>();

  constructor(canvas: HTMLCanvasElement, camera: RendererCamera, modules: RendererModules, raster: FallbackRaster, host: OverlayHost) {
    this.#context = canvas.getContext("2d", { alpha: true });
    this.#camera = camera;
    this.#modules = modules;
    this.#raster = raster;
    this.#host = host;
  }

  setCirclePreview(circles: readonly AreaCircle[] | null, capture?: CoordinateEditCapture): void {
    this.#circlePreview = circles && capture ? { circles, capture } : null;
    this.#host.requestRender();
  }

  setPalette(palette: CanvasPalette): void {
    this.#palette = palette;
    this.#host.requestRender();
  }

  setCursor(point: MapPoint | null): void {
    this.#cursor = point;
    this.#host.requestRender();
  }

  clearLabels(): void {
    this.#labelOffsets.clear();
  }

  render(): void {
    const context = this.#context;
    const scene = this.#host.scene();
    const state = this.#host.state();
    if (!context) return;
    const camera = this.#camera;
    const ratio = this.#host.pixelRatio();
    const bounds = camera.viewport;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    if (!scene || !state) return;
    if (state.workflow === "draw" || state.workflow === "areaReview") this.#modules.loadDrawOverlays();
    const currentFloor = state.dataMode === "live" && !state.floor.readOnly
      && state.selection.floorId === "current";
    const trail = state.trail;
    const trailVisible = Boolean(trail && state.dataMode === "live"
      && (trail.id === "live" || state.workflow === "runs")
      && trail.mapSessionKey === state.resources.entry?.mapSessionKey);
    if (state.seen || trailVisible || (currentFloor && (state.wifiSignal || state.floorTypes))) {
      this.#modules.loadLayers();
    }
    if (state.optionalUiReady && state.map.available && state.labelsVisible && scene.metadata.rooms.length > 0) {
      this.#host.scheduleRoomNames();
    }
    const palette = this.#palette;
    const colours = roomColours(state);
    if (this.#host.fallback() && this.#raster.canvas
      && !colours) {
      // A WebGL canvas cannot acquire a 2D context after context loss.
      context.drawImage(this.#raster.canvas, 0, 0, bounds.width, bounds.height);
    }
    // Drawn above the room fills, which are nearly opaque in Room colors, and
    // below the room names. A retained scene stays read-only until the live
    // one is admitted, so its geometry may belong to another floor or frame.
    let layersPending = currentFloor;
    const drawLayers = (): void => {
      if (!layersPending) return;
      layersPending = false;
      if (this.#modules.layers) {
        this.#modules.layers.drawMapLayers(context, state, (x, y, height, clip) =>
          camera.projectMeters(x, y, height, clip));
      }
    };
    const selectedNames = selectedRoomNames(state);
    // Every room draws with Room names on or in Room colors; otherwise only
    // the selected ones (home-rooms.md §5 Parity, R9).
    const allRooms = state.labelsVisible || colours;
    if (allRooms || selectedNames.size) {
      // IDs keep each room's hue stable when scene metadata is reordered.
      const roomIndexes = new Map(scene.metadata.rooms.map((room) => room.id).sort()
        .map((id, index) => [id, index]));
      context.lineWidth = 1.5;
      for (const room of scene.metadata.rooms) {
        const selected = selectedNames.has(room.name.toLocaleLowerCase());
        if (!allRooms && !selected) continue;
        context.lineWidth = selected ? 3 : colours ? 2 : 1.5;
        context.strokeStyle = selected ? rgba(palette.accent, 1)
          : colours || palette.forced ? rgba(palette.text, 1) : rgba(palette.quiet, .7);
        context.fillStyle = colours
          ? rgba(roomColor(roomIndexes.get(room.id) ?? 0, palette), .94)
          : selected ? rgba(palette.accent, .26) : rgba(palette.plate, .04);
        context.beginPath();
        const step = Math.max(1, Math.ceil(room.boundary.length / 512));
        let started = false;
        for (let index = 0; index < room.boundary.length; index += step) {
          const point = room.boundary[index];
          if (!point) continue;
          // Keep the complete polygon in one camera space and let Canvas clip
          // it to the viewport. Dropping off-screen vertices creates artificial
          // chords whose shape changes as the camera zooms or pans.
          const projected = camera.projectCell(point[0], point[1], 0.2, false);
          if (!projected) continue;
          if (!started) context.moveTo(projected.x, projected.y);
          else context.lineTo(projected.x, projected.y);
          started = true;
        }
        if (started) {
          context.closePath();
          context.fill();
          context.stroke();
        }
      }
      drawLayers();
      if (state.labelsVisible && state.optionalUiReady && this.#modules.layers) {
        const result = this.#modules.layers.drawRoomNames(
          context,
          scene.metadata.rooms,
          palette,
          { width: bounds.width, height: bounds.height },
          state,
          selectedNames,
          this.#labelOffsets,
          (x, y, height, clip) => camera.projectCell(x, y, height, clip),
        );
        this.#labelOffsets = result.offsets;
        if (result.retryWithoutHistory) {
          this.#labelOffsets.clear();
          this.render();
          return;
        }
      }
    }
    if (!state.labelsVisible) this.#labelOffsets.clear();
    drawLayers();
    const preview = this.#circlePreview;
    const circles = preview && hasCoordinateEditAdmission(state, preview.capture)
      ? preview.circles
      : state.draw.circles;
    this.#modules.drawOverlays?.drawTaskOverlays(context, state, circles, this.#cursor, palette,
      bounds.width, bounds.height,
      (x, y, height, clip) => camera.projectMeters(x, y, height, clip));
    // Zones describe the robot's current map, so a saved history map leaves them out.
    if (state.dataMode === "live" && state.selection.floorId === "current") {
      this.#drawZones(context, state.resources.areas.value?.zones ?? [], palette);
    }
    // A trail is drawn only over the map session it was recorded on
    // (run_history.py); a past run's trail only while Cleaning history is open.
    if (trailVisible) this.#modules.layers?.drawRunTrail(
      context,
      state,
      palette,
      (x, y, height, clip) => camera.projectMeters(x, y, height, clip),
    );
    const pose = state.resources.pose.value;
    if (state.seen) {
      this.#modules.layers?.drawLastSeenDuringRun(context, state, palette,
        (x, y, height, clip) => camera.projectMeters(x, y, height, clip));
    }
    if (canShowExactPose(state) && pose?.position) {
      // Pose coordinates share the floor-plan's meter space. Scene geometry is
      // stored in origin-relative cells, so it must cross the same conversion
      // boundary as custom-area coordinates before projection.
      const marker = camera.projectMeters(pose.position[0], pose.position[1], 3);
      const heading = pose.heading;
      if (marker && typeof heading === "number") {
        if (this.#robotModel === undefined) {
          // Heading rendering stays in a lazy chunk; a dot stands in if the
          // chunk itself is unavailable. The chunk owns the vector fallback.
          this.#robotModel = null;
          import("./robot-model").then(({ drawRobot }) => {
            this.#robotModel = drawRobot;
            this.#host.requestRender();
          }, () => undefined);
        }
        const [x, y] = pose.position;
        const metersPerCell = scene.metadata.metersPerCell;
        if (this.#robotModel?.(context, (forward, left, height) => camera.projectMeters(
          x + forward * Math.cos(heading) - left * Math.sin(heading),
          y + forward * Math.sin(heading) + left * Math.cos(heading),
          height / metersPerCell,
          false,
        ), heading, palette, camera.current.pitch, () => this.#host.requestRender())) return;
      }
      if (marker) {
        context.beginPath();
        context.arc(marker.x, marker.y, 7, 0, Math.PI * 2);
        context.fillStyle = rgba(palette.accent, 1);
        context.fill();
        context.strokeStyle = rgba(palette.onAccent, 1);
        context.lineWidth = 3;
        context.stroke();
      }
    }
  }

  #drawZones(context: CanvasRenderingContext2D, zones: readonly MapZoneOverlay[], palette: CanvasPalette): void {
    // Read-only: no-go zones are shaded and outlined; zones the robot made
    // itself, whose meaning is not known, get only a dashed outline.
    for (const zone of zones) {
      context.beginPath();
      for (const ring of [zone.outline, ...zone.holes]) {
        ring.forEach(([x, y], index) => {
          const p = this.#camera.projectMeters(x, y, 0, false);
          if (p) { if (index === 0) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y); }
        });
        context.closePath();
      }
      if (zone.kind === "no_go") {
        context.fillStyle = rgba(palette.text, .22);
        context.fill("evenodd");
      }
      context.setLineDash(zone.kind === "no_go" ? [] : [5, 4]);
      context.strokeStyle = rgba(palette.text, zone.kind === "no_go" ? .9 : .6);
      context.lineWidth = 1.5;
      context.stroke();
      context.setLineDash([]);
    }
  }

  dispose(): void {
    this.#context = null;
    this.#circlePreview = null;
    this.#labelOffsets.clear();
  }
}
