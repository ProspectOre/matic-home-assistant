import type { AreaCircle, SceneModel } from "./backend-contracts";
import type { CoordinateEditCapture, WorkspaceState } from "./contracts";
import { canShowExactPose, hasCoordinateEditAdmission, topView } from "./state";
import { rgba, type CanvasPalette } from "./theme-probe";
import type { OverlayGeometry } from "./overlay-geometry";
import type { MapPoint, RendererCamera } from "./renderer-camera";
import { selectedRoomNames } from "./renderer-hit-test";
import type { RendererModules } from "./renderer-modules";

/** Room colors replace the photo wherever the map shows the top view. */
export const roomColours = (state: WorkspaceState | null): boolean =>
  !!state && topView(state) === "top" && state.appearance === "rooms";

/**
 * A trail is drawn only over the map session it was recorded on
 * (run_history.py); a past run's trail only while Cleaning history is open.
 */
export const trailVisible = (state: WorkspaceState): boolean => {
  const trail = state.trail;
  return !!trail && state.dataMode === "live" && (trail.id === "live" || state.workflow === "runs")
    && trail.mapSessionKey === state.resources.entry?.mapSessionKey;
};

/**
 * Why the map needs the layers chunk: "now" for a layer the user turned on,
 * "soon" for the outlines every map draws and the live map's layer toggles,
 * which wait for the first map to be admitted so its first frames carry the
 * startup graph alone.
 */
export const layersNeeded = (state: WorkspaceState, scene: SceneModel | null): "now" | "soon" | null => {
  const live = state.dataMode === "live" && state.selection.floorId === "current";
  if (state.seen || trailVisible(state)
    || (live && !state.floor.readOnly && (state.wifiSignal || state.floorTypes))) return "now";
  return state.optionalUiReady && state.map.available && (live
    || scene?.metadata.rooms.length
      && (state.labelsVisible || roomColours(state) || selectedRoomNames(state).size)) ? "soon" : null;
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
  /** WebGL draws the robot, so this canvas leaves it out. */
  readonly robotInScene: () => boolean;
  readonly pixelRatio: () => number;
  /** `scene` is false when only this canvas changed. */
  readonly requestRender: (scene: boolean) => void;
  readonly scheduleLayers: () => void;
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
  #marker: MapPoint | null = null;
  palette: CanvasPalette = DEFAULT_PALETTE;
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
    this.#host.requestRender(false);
  }

  setPalette(palette: CanvasPalette): void {
    this.palette = palette;
    this.#host.requestRender(true);
  }

  setCursor(point: MapPoint | null): void {
    this.#cursor = point;
    this.#host.requestRender(false);
  }

  /** Rings the map point the user is inspecting (map-inspect.ts). */
  setMarker(point: MapPoint | null): void {
    if (point?.x === this.#marker?.x && point?.y === this.#marker?.y) return;
    this.#marker = point;
    this.#host.requestRender(false);
  }

  clearLabels(): void {
    this.#labelOffsets.clear();
  }

  /** `geometry` is null until the layers chunk that carries it has loaded. */
  render(geometry: OverlayGeometry | null): void {
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
    const needed = layersNeeded(state, scene);
    if (needed === "now") this.#modules.loadLayers();
    else if (needed) this.#host.scheduleLayers();
    const palette = this.palette;
    // Room colors replace the photo once the chunk that draws them is here.
    if (this.#host.fallback() && this.#raster.canvas && !(geometry && roomColours(state))) {
      // A WebGL canvas cannot acquire a 2D context after context loss.
      context.drawImage(this.#raster.canvas, 0, 0, bounds.width, bounds.height);
    }
    if (geometry?.painted) geometry.paint(context, (x, height, z) => camera.projectWorld(x, height, z, false));
    if (state.labelsVisible && state.optionalUiReady && this.#modules.layers) {
      const result = this.#modules.layers.drawRoomNames(
        context,
        scene.metadata.rooms,
        palette,
        { width: bounds.width, height: bounds.height },
        state,
        selectedRoomNames(state),
        this.#labelOffsets,
        (x, y, height, clip) => camera.projectCell(x, y, height, clip),
      );
      this.#labelOffsets = result.offsets;
      if (result.retryWithoutHistory) {
        this.#labelOffsets.clear();
        this.render(geometry);
        return;
      }
    }
    if (!state.labelsVisible) this.#labelOffsets.clear();
    const preview = this.#circlePreview;
    const circles = preview && hasCoordinateEditAdmission(state, preview.capture)
      ? preview.circles
      : state.draw.circles;
    this.#modules.drawOverlays?.drawTaskOverlays(context, state, circles, this.#cursor, palette,
      bounds.width, bounds.height,
      (x, y, height, clip) => camera.projectMeters(x, y, height, clip));
    if (this.#marker) {
      this.#modules.layers?.drawInspectMarker(context, this.#marker, palette,
        (x, y) => camera.projectMeters(x, y, 0, false));
    }
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
        this.#modules.loadRobot();
        if (this.#host.robotInScene()) return;
        const [x, y] = pose.position;
        const metersPerCell = scene.metadata.metersPerCell;
        if (this.#modules.robot?.drawVectorRobot(context, (forward, left, height) => camera.projectMeters(
          x + forward * Math.cos(heading) - left * Math.sin(heading),
          y + forward * Math.sin(heading) + left * Math.cos(heading),
          height / metersPerCell,
          false,
        ), heading, palette)) return;
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

  dispose(): void {
    this.#context = null;
    this.#circlePreview = null;
    this.#labelOffsets.clear();
  }
}
