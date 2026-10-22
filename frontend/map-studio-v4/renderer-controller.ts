import type { AreaCircle, SceneModel, SceneRoom } from "./backend-contracts";
import { SCENE_DELTA_DIRTY_BLOCK_BYTES } from "./backend-contracts";
import type { CameraPreference, CoordinateEditCapture, MapQuality, MapView, WorkspaceState } from "./contracts";
import { canShowExactPose, hasCoordinateEditAdmission } from "./state";
import { rgba, type CanvasPalette, type Channel } from "./theme-probe";

export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

export interface RendererDiagnostics {
  readonly mode: "webgl2" | "canvas2d" | "unavailable";
  readonly contextGeneration: number;
  readonly sceneRevision: number | null;
  readonly sourcePoints: number;
  readonly renderedPoints: number;
  readonly lastFrameMs: number;
  readonly slowFrames: number;
  readonly cameraDistance: number;
  readonly fitDistance: number;
  readonly fitActive: boolean;
}

export interface CameraState {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly orthographic: boolean;
}

export interface CameraOrigin {
  readonly xPercent: number;
  readonly yPercent: number;
}

interface ViewportBounds {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

interface RendererCallbacks {
  readonly onCamera?: (
    camera: CameraState,
    zoomPercent: number,
    origin?: CameraOrigin,
  ) => void;
  readonly onCameraPreferences?: (
    cameras: Readonly<Partial<Record<MapView, CameraPreference>>>,
  ) => void;
  readonly onRoom?: (roomId: string) => void;
  readonly onViewport?: () => void;
  readonly onProblem?: (problem: string) => void;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const angle = (value: number): number => {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
};

const qualityScale = (quality: MapQuality): number => {
  switch (quality) {
    case "efficient": return 0.35;
    case "balanced": return 0.65;
    case "maximum":
    case "auto": return 1;
  }
};

const sceneCenter = (scene: SceneModel): readonly [number, number] => {
  const meters = scene.metadata.metersPerCell;
  return [
    (scene.metadata.origin[0] + (scene.metadata.span[0] - 1) / 2) * meters,
    (scene.metadata.origin[1] + (scene.metadata.span[1] - 1) / 2) * meters,
  ];
};

const rebaseTarget = (
  targetX: number,
  targetZ: number,
  previousScene: SceneModel,
  nextScene: SceneModel,
): readonly [number, number] => {
  const previousCenter = sceneCenter(previousScene);
  const nextCenter = sceneCenter(nextScene);
  return [
    targetX + (nextCenter[0] - previousCenter[0]),
    targetZ + (previousCenter[1] - nextCenter[1]),
  ];
};

const rebaseCameraTarget = (
  camera: CameraState,
  previousScene: SceneModel,
  nextScene: SceneModel,
): CameraState => {
  const [targetX, targetZ] = rebaseTarget(camera.targetX, camera.targetZ, previousScene, nextScene);
  return {
    ...camera,
    // World X is measured from the scene centre in the opposite direction;
    // world Z is measured from the scene centre in the same direction.
    targetX,
    targetZ,
  };
};

/** Draw and the area review look straight down; every other workflow keeps the user's view. */
const forcesTop = (state: WorkspaceState | null): boolean =>
  state?.workflow === "draw" || state?.workflow === "areaReview";
export const topView = (state: WorkspaceState): MapView => forcesTop(state) ? "top" : state.view;
/** Room colors replace the photo wherever the map shows the top view. */
const roomColours = (state: WorkspaceState | null): boolean =>
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

const cameraPreferenceIsFit = (view: MapView, preference: CameraPreference | undefined): boolean => {
  if (!preference) return true;
  const top = view === "top";
  return Math.abs(preference.zoom - 1) < 0.001
    && Math.abs(preference.targetX) < 0.001
    && Math.abs(preference.targetZ) < 0.001
    && Math.abs(angle(preference.yaw - (top ? 0 : -Math.PI / 4))) < 0.001
    && (top || Math.abs(preference.pitch - 0.82) < 0.001);
};

const rebaseCameraPreferences = (
  cameras: Readonly<Partial<Record<MapView, CameraPreference>>>,
  previousScene: SceneModel,
  nextScene: SceneModel,
  previousHome: Readonly<Record<MapView, number>>,
  nextHome: Readonly<Record<MapView, number>>,
): Partial<Record<MapView, CameraPreference>> => Object.fromEntries(
  Object.entries(cameras).map(([view, camera]) => {
    if (!camera || cameraPreferenceIsFit(view as MapView, camera)) return [view, camera];
    const [targetX, targetZ] = rebaseTarget(camera.targetX, camera.targetZ, previousScene, nextScene);
    const oldHome = previousHome[view as MapView];
    const newHome = nextHome[view as MapView];
    const zoom = oldHome > 0 && newHome > 0
      ? camera.zoom * newHome / oldHome
      : camera.zoom;
    return [view, { ...camera, targetX, targetZ, zoom }];
  }),
) as Partial<Record<MapView, CameraPreference>>;

const sceneContext = (state: WorkspaceState): string => {
  const entry = state.resources.entry;
  return [
    state.dataMode,
    state.selection.entryId ?? "none",
    state.selection.floorId,
    entry?.entryId ?? "none",
    entry?.selectedFloorOrdinal ?? "none",
    entry?.mapFloorOrdinal ?? "none",
    entry?.mapSessionKey ?? "none",
  ].join("|");
};

const GPU_UPLOAD_CHUNK_BYTES = 512 * 1024;
const GPU_UPLOAD_FAIR_SHARE_BYTES = GPU_UPLOAD_CHUNK_BYTES / 2;
const GPU_DELTA_BLOCK_BYTES = SCENE_DELTA_DIRTY_BLOCK_BYTES;
const GPU_DELTA_MAX_BLOCKS = 256;
// Touch-device qualification showed GPU/presentation delay despite short
// JavaScript frames. Auto bounds the point workload and, because fill cost
// grows with device pixels (150% zoom on a tablet: touch-to-present p95 86 ms
// at full density, 74 ms within this budget), each canvas's backing store.
const AUTO_TOUCH_POINT_LIMIT = 350_000;
const AUTO_TOUCH_CANVAS_PIXELS = 1_100_000;

const sameSceneTransform = (left: SceneModel, right: SceneModel): boolean =>
  left.metadata.metersPerCell === right.metadata.metersPerCell
  && left.metadata.origin[0] === right.metadata.origin[0]
  && left.metadata.origin[1] === right.metadata.origin[1]
  && left.metadata.span[0] === right.metadata.span[0]
  && left.metadata.span[1] === right.metadata.span[1];

const samePointLayout = (left: SceneModel, right: SceneModel): boolean =>
  left.pointOffset === right.pointOffset
  && left.floorCount === right.floorCount
  && left.surfaceCount === right.surfaceCount
  && left.total === right.total
  && left.source === right.source
  && sameSceneTransform(left, right);

const validDeltaBlocks = (scene: SceneModel, baseRevision: number): readonly number[] | null => {
  const hint = scene.deltaHint;
  if (!hint || hint.baseRevision !== baseRevision || scene.revision <= baseRevision
    || hint.blockBytes !== GPU_DELTA_BLOCK_BYTES
    || hint.dirtyBlocks.length > GPU_DELTA_MAX_BLOCKS) return null;
  const blockCount = Math.ceil(scene.total * 8 / GPU_DELTA_BLOCK_BYTES);
  let previous = -1;
  for (const block of hint.dirtyBlocks) {
    if (!Number.isSafeInteger(block) || block <= previous || block >= blockCount) return null;
    previous = block;
  }
  return hint.dirtyBlocks;
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

const PERSPECTIVE_FIELD_OF_VIEW = Math.PI / 3.15;
const FIT_PADDING = 1.08;

interface GpuUpload {
  scene: SceneModel;
  revision: number;
  readonly context: string;
  generation: number;
  readonly contextGeneration: number;
  readonly buffer: WebGLBuffer;
  readonly staging: boolean;
  seed: "scene" | "copy";
  readonly previousScene: SceneModel | null;
  readonly preserveCamera: boolean;
  readonly preferenceView: MapView | null;
  frontierBytes: number;
  readonly dirtyBlocks: Set<number>;
  readonly transitionBlocks: Set<number>;
}

const perspectiveFitDistance = (radius: number, aspect: number): number => {
  const halfVertical = PERSPECTIVE_FIELD_OF_VIEW / 2;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * Math.max(0.2, aspect));
  return radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * FIT_PADDING;
};

const multiply = (left: Float32Array, right: Float32Array): Float32Array => {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += (left[index * 4 + row] ?? 0) * (right[column * 4 + index] ?? 0);
      }
      result[column * 4 + row] = value;
    }
  }
  return result;
};

const perspective = (fieldOfView: number, aspect: number, near: number, far: number): Float32Array => {
  const focal = 1 / Math.tan(fieldOfView / 2);
  const result = new Float32Array(16);
  result[0] = focal / aspect;
  result[5] = focal;
  result[10] = (far + near) / (near - far);
  result[11] = -1;
  result[14] = (2 * far * near) / (near - far);
  return result;
};

const orthographic = (
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Float32Array => {
  const result = new Float32Array(16);
  result[0] = 2 / (right - left);
  result[5] = 2 / (top - bottom);
  result[10] = -2 / (far - near);
  result[12] = -(right + left) / (right - left);
  result[13] = -(top + bottom) / (top - bottom);
  result[14] = -(far + near) / (far - near);
  result[15] = 1;
  return result;
};

const lookAt = (eye: readonly number[], target: readonly number[]): Float32Array => {
  const forwardLength = Math.hypot(
    (eye[0] ?? 0) - (target[0] ?? 0),
    (eye[1] ?? 0) - (target[1] ?? 0),
    (eye[2] ?? 0) - (target[2] ?? 0),
  ) || 1;
  const z = [
    ((eye[0] ?? 0) - (target[0] ?? 0)) / forwardLength,
    ((eye[1] ?? 0) - (target[1] ?? 0)) / forwardLength,
    ((eye[2] ?? 0) - (target[2] ?? 0)) / forwardLength,
  ];
  const rightLength = Math.hypot(z[2] ?? 0, z[0] ?? 0) || 1;
  const x = [(z[2] ?? 0) / rightLength, 0, -(z[0] ?? 0) / rightLength];
  const y = [
    (z[1] ?? 0) * (x[2] ?? 0),
    (z[2] ?? 0) * (x[0] ?? 0) - (z[0] ?? 0) * (x[2] ?? 0),
    -(z[1] ?? 0) * (x[0] ?? 0),
  ];
  return new Float32Array([
    x[0] ?? 0, y[0] ?? 0, z[0] ?? 0, 0,
    x[1] ?? 0, y[1] ?? 0, z[1] ?? 0, 0,
    x[2] ?? 0, y[2] ?? 0, z[2] ?? 0, 0,
    -((x[0] ?? 0) * (eye[0] ?? 0) + (x[1] ?? 0) * (eye[1] ?? 0) + (x[2] ?? 0) * (eye[2] ?? 0)),
    -((y[0] ?? 0) * (eye[0] ?? 0) + (y[1] ?? 0) * (eye[1] ?? 0) + (y[2] ?? 0) * (eye[2] ?? 0)),
    -((z[0] ?? 0) * (eye[0] ?? 0) + (z[1] ?? 0) * (eye[1] ?? 0) + (z[2] ?? 0) * (eye[2] ?? 0)),
    1,
  ]);
};

const pointInPolygon = (x: number, y: number, boundary: readonly (readonly [number, number])[]): boolean => {
  let inside = false;
  let previous = boundary.at(-1);
  if (!previous) return false;
  for (const current of boundary) {
    const [currentX, currentY] = current;
    const [previousX, previousY] = previous;
    if ((currentY > y) !== (previousY > y)
      && x < (previousX - currentX) * (y - currentY) / (previousY - currentY) + currentX) {
      inside = !inside;
    }
    previous = current;
  }
  return inside;
};

export class RendererController {
  readonly #sceneCanvas: HTMLCanvasElement;
  readonly #overlayCanvas: HTMLCanvasElement;
  readonly #callbacks: RendererCallbacks;
  #gl: WebGL2RenderingContext | null = null;
  #overlay: CanvasRenderingContext2D | null = null;
  #fallback: CanvasRenderingContext2D | null = null;
  #fallbackCanvas: HTMLCanvasElement | null = null;
  #program: WebGLProgram | null = null;
  #buffer: WebGLBuffer | null = null;
  #stagingBuffer: WebGLBuffer | null = null;
  #bufferCapacities = new WeakMap<WebGLBuffer, number>();
  #vertexArray: WebGLVertexArrayObject | null = null;
  #viewProjection: WebGLUniformLocation | null = null;
  #center: WebGLUniformLocation | null = null;
  #meters: WebGLUniformLocation | null = null;
  #pointPixels: WebGLUniformLocation | null = null;
  #maxPointPixels: WebGLUniformLocation | null = null;
  #state: WorkspaceState | null = null;
  #circlePreview: { readonly circles: readonly AreaCircle[]; readonly capture: CoordinateEditCapture } | null = null;
  #scene: SceneModel | null = null;
  #sceneContext: string | null = null;
  #admittedScene: SceneModel | null = null;
  #admittedContext: string | null = null;
  #upload: GpuUpload | null = null;
  #frame: number | null = null;
  #fallbackFrame: number | null = null;
  #fallbackProjection: {
    readonly scene: SceneModel;
    readonly matrix: Float32Array;
    readonly width: number;
    readonly height: number;
  } | null = null;
  #resizeObserver: ResizeObserver;
  #camera: CameraState = {
    yaw: -Math.PI / 4,
    pitch: 0.82,
    distance: 12,
    targetX: 0,
    targetZ: 0,
    orthographic: false,
  };
  #homeThree = 12;
  #homeTop = 8;
  #radius = 4;
  #matrix: Float32Array<ArrayBufferLike> = new Float32Array(16);
  #cursor: MapPoint | null = null;
  #mode: RendererDiagnostics["mode"] = "unavailable";
  #contextGeneration = 0;
  #initializedPoints = 0;
  #renderedPoints = 0;
  #lastFrameMs = 0;
  #slowFrames = 0;
  #qualityScale = 1;
  readonly #touch = window.matchMedia("(any-pointer: coarse)").matches;
  #viewport = { width: 1, height: 1, left: 0, top: 0 };
  #fitActive = true;
  #disposed = false;
  #palette: CanvasPalette = DEFAULT_PALETTE;
  // Saved-order numbers are drawn every frame; one formatter per locale.
  #positionFormat: { readonly locale: string; readonly format: Intl.NumberFormat } | null = null;

  constructor(
    sceneCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    callbacks: RendererCallbacks = {},
  ) {
    this.#sceneCanvas = sceneCanvas;
    this.#overlayCanvas = overlayCanvas;
    this.#callbacks = callbacks;
    this.#overlay = overlayCanvas.getContext("2d", { alpha: true });
    this.#sceneCanvas.addEventListener("webglcontextlost", this.#contextLost);
    this.#sceneCanvas.addEventListener("webglcontextrestored", this.#contextRestored);
    this.#initWebGl();
    this.#resizeObserver = new ResizeObserver(() => {
      const previousThree = this.#homeThree;
      const previousTop = this.#homeTop;
      this.#updateHomeDistances();
      if (this.#fitActive
        && (previousThree !== this.#homeThree || previousTop !== this.#homeTop)) {
        this.fit(false);
      } else {
        this.requestRender();
      }
    });
    this.#resizeObserver.observe(sceneCanvas);
  }

  get camera(): CameraState {
    return { ...this.#camera };
  }

  #distanceBounds(): { readonly minimum: number; readonly maximum: number } {
    return {
      minimum: Math.max(0.2, this.#radius * 0.04),
      maximum: this.#radius * 8,
    };
  }

  #targetBounds(): { readonly x: number; readonly z: number } {
    const span = this.#scene?.metadata.span;
    const meters = this.#scene?.metadata.metersPerCell;
    if (!span || meters === undefined) return { x: this.#radius, z: this.#radius };
    return {
      x: Math.max(0.5, span[0] * meters * 0.55),
      z: Math.max(0.5, span[1] * meters * 0.55),
    };
  }

  setCamera(camera: CameraState, notify = true): void {
    const distance = this.#distanceBounds();
    const target = this.#targetBounds();
    this.#camera = {
      yaw: angle(camera.yaw),
      pitch: camera.orthographic
        ? Math.PI / 2 - 0.018
        : clamp(camera.pitch, 0.18, 1.38),
      distance: clamp(camera.distance, distance.minimum, distance.maximum),
      targetX: clamp(camera.targetX, -target.x, target.x),
      targetZ: clamp(camera.targetZ, -target.z, target.z),
      orthographic: camera.orthographic,
    };
    this.#fitActive = false;
    this.requestRender();
    if (notify) this.#notifyCamera();
  }

  cameraAfterPan(camera: CameraState, deltaX: number, deltaY: number): CameraState {
    const bounds = this.#measureViewport();
    const worldPerPixel = camera.distance * 1.75 / Math.max(200, bounds.height);
    const rightX = Math.cos(camera.yaw);
    const rightZ = -Math.sin(camera.yaw);
    const forwardX = -Math.sin(camera.yaw);
    const forwardZ = -Math.cos(camera.yaw);
    const target = this.#targetBounds();
    return {
      ...camera,
      targetX: clamp(
        camera.targetX - deltaX * worldPerPixel * rightX + deltaY * worldPerPixel * forwardX,
        -target.x,
        target.x,
      ),
      targetZ: clamp(
        camera.targetZ - deltaX * worldPerPixel * rightZ + deltaY * worldPerPixel * forwardZ,
        -target.z,
        target.z,
      ),
    };
  }

  setState(state: WorkspaceState): void {
    if (this.#disposed) return;
    const previous = this.#state;
    const previousScene = this.#scene;
    const admittedBefore = this.#admittedScene;
    const admittedContextBefore = this.#admittedContext;
    this.#state = state;
    if (!state.pageActive && this.#frame !== null) {
      window.cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }
    const scene = state.resources.scene.value;
    const context = scene ? sceneContext(state) : null;
    this.#admittedScene = scene;
    this.#admittedContext = context;
    let rebasedPreferences: Partial<Record<MapView, CameraPreference>> | null = null;
    const uploadMatches = Boolean(this.#upload && this.#upload.scene === scene
      && this.#upload.context === context && this.#upload.generation === state.generation
      && this.#upload.contextGeneration === this.#contextGeneration);
    if (!state.pageActive) {
      this.#cancelGpuUpload(true);
      this.#cancelFallback();
    } else if (scene !== null) {
      // Capture the context inside the non-null scene branch. The nullable
      // outer value also represents the intentionally empty-scene state.
      const sceneContextKey = sceneContext(state);
      const targetChanged = scene !== admittedBefore || sceneContextKey !== admittedContextBefore;
      const currentUpload = this.#upload;
      const frontNeedsMaterialization = this.#mode === "webgl2" && !currentUpload
        && this.#initializedPoints < scene.total;
      const pendingSuccessorBlocks = currentUpload && currentUpload.context === sceneContextKey
        && currentUpload.contextGeneration === this.#contextGeneration
        && samePointLayout(currentUpload.scene, scene)
        ? validDeltaBlocks(scene, currentUpload.revision)
        : null;
      const firstSuccessorNeedsBack = Boolean(currentUpload && !currentUpload.staging
        && currentUpload.seed === "scene" && currentUpload.frontierBytes < currentUpload.scene.total * 8
        && scene !== currentUpload.scene && pendingSuccessorBlocks !== null);
      const advanced = Boolean(currentUpload && !firstSuccessorNeedsBack && scene !== currentUpload.scene
        && pendingSuccessorBlocks !== null
        && this.#advanceGpuUpload(scene, sceneContextKey, state, pendingSuccessorBlocks));
      const uploadChanged = Boolean(currentUpload && !uploadMatches);
      if (!advanced && (frontNeedsMaterialization || uploadChanged || targetChanged
        || scene !== this.#scene || sceneContextKey !== this.#sceneContext)) {
        const sameSceneContext = this.#scene !== null && this.#sceneContext === sceneContextKey;
        const compatible = sameSceneContext && this.#scene && samePointLayout(this.#scene, scene);
        const publishedFrontComplete = Boolean(this.#scene && this.#initializedPoints >= this.#scene.total);
        const publishedSuccessorBlocks = !currentUpload && compatible && publishedFrontComplete
          ? validDeltaBlocks(scene, this.#scene?.revision ?? -1)
          : null;
        this.#cancelGpuUpload(false);
        if (this.#mode === "webgl2") {
          if (compatible) {
            if (publishedSuccessorBlocks !== null) {
              this.#startGpuUpload(
                scene, sceneContextKey, state, true, this.#scene, true,
                "copy", publishedSuccessorBlocks,
              );
            } else {
              this.#startGpuUpload(scene, sceneContextKey, state, true, this.#scene, true);
            }
          } else {
            this.#cancelGpuUpload(true);
            this.#scene = scene;
            this.#sceneContext = sceneContextKey;
            rebasedPreferences = this.#installScene(
              scene,
              sameSceneContext && !this.#fitActive,
              previousScene,
              sameSceneContext,
              previous ? topView(previous) : null,
            );
            this.#startGpuUpload(scene, sceneContextKey, state, false, previousScene, false);
          }
        } else {
          this.#scene = scene;
          this.#sceneContext = sceneContextKey;
          rebasedPreferences = this.#installScene(
            scene,
            sameSceneContext && !this.#fitActive,
            previousScene,
            sameSceneContext,
            previous ? topView(previous) : null,
          );
        }
      }
    } else if (this.#scene !== null || this.#upload !== null) {
      this.#cancelGpuUpload(true);
      this.#cancelFallback();
      this.#deleteFrontBuffer();
      this.#scene = null;
      this.#sceneContext = null;
      this.#renderedPoints = 0;
      this.#initializedPoints = 0;
    }
    if (!previous || previous.quality !== state.quality) {
      this.#qualityScale = qualityScale(state.quality);
      this.#slowFrames = 0;
    }
    // Leaving the area review gives back the camera the user had before it
    // framed the area (map-surfaces.md §5): live when Draw follows, else as
    // the top view's saved preference, so the 3D view is untouched.
    const leftReview = previous?.workflow === "areaReview" && state.workflow !== "areaReview";
    let published = false;
    if (leftReview && this.#beforeReview) {
      const { camera, fit } = this.#beforeReview;
      this.#beforeReview = null;
      if (topView(state) === "top") {
        this.#camera = camera;
        this.#fitActive = fit;
        this.#notifyCamera();
        published = true;
      } else {
        this.#callbacks.onCameraPreferences?.({ top: this.#preferenceOf(camera, fit) });
      }
    }
    const view = topView(state);
    // Entering or leaving a workflow that looks straight down re-reads the
    // view's preference, as a view change does.
    const enteredTop = !forcesTop(previous) && forcesTop(state);
    const leftTop = forcesTop(previous) && !forcesTop(state);
    if (!previous || previous.view !== state.view || enteredTop || leftTop) {
      this.#camera = this.#preferredCamera(view, state, rebasedPreferences);
      this.#fitActive = this.#preferenceIsFit(view, state, rebasedPreferences);
    }
    if (previous?.workflow !== "areaReview" && state.workflow === "areaReview" && state.draw.circles.length) {
      this.#beforeReview = { camera: this.#camera, fit: this.#fitActive };
      this.frameCircles(state.draw.circles);
      published = true;
    }
    if (state.workflow === "draw"
      && previous?.draw.zoomPercent !== state.draw.zoomPercent
      && Math.round(this.#homeTop / this.#camera.distance * 100) !== state.draw.zoomPercent) {
      this.#camera = {
        ...this.#camera,
        orthographic: true,
        pitch: Math.PI / 2 - 0.018,
        distance: this.#homeTop * 100 / state.draw.zoomPercent,
      };
      this.#fitActive = state.draw.zoomPercent === 100
        && Math.abs(this.#camera.targetX) < 0.001
        && Math.abs(this.#camera.targetZ) < 0.001
        && Math.abs(angle(this.#camera.yaw)) < 0.001;
    }
    // Publish only the final effective camera. Its percentage also updates the
    // draw control; echoing that rounded percentage must not move the camera.
    if (!published && (rebasedPreferences || enteredTop)) this.#notifyCamera();
    this.requestRender();
  }

  #beforeReview: { readonly camera: CameraState; readonly fit: boolean } | null = null;

  #preferenceOf(camera: CameraState, fit: boolean, home = this.#homeTop): CameraPreference {
    if (fit) return { yaw: 0, pitch: Math.PI / 2 - 0.018, zoom: 1, targetX: 0, targetZ: 0 };
    return { yaw: camera.yaw, pitch: camera.pitch, zoom: home / Math.max(0.2, camera.distance), targetX: camera.targetX, targetZ: camera.targetZ };
  }

  /** The world position of a map point in metres (the overlay's coordinate space). */
  #worldForMeters(x: number, y: number): readonly [number, number] | null {
    const scene = this.#scene;
    if (!scene) return null;
    const world = this.#worldForCell(x / scene.metadata.metersPerCell - scene.metadata.origin[0], y / scene.metadata.metersPerCell - scene.metadata.origin[1]);
    return world ? [world[0], world[2]] : null;
  }

  /** Frames the circles' bounds in the top view with a 12 % margin and publishes the camera. */
  frameCircles(circles: readonly AreaCircle[]): void {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const circle of circles) {
      for (const [x, y] of [[circle.x - circle.radius, circle.y - circle.radius], [circle.x + circle.radius, circle.y + circle.radius]] as const) {
        const world = this.#worldForMeters(x, y);
        if (!world) return;
        minX = Math.min(minX, world[0]); maxX = Math.max(maxX, world[0]);
        minZ = Math.min(minZ, world[1]); maxZ = Math.max(maxZ, world[1]);
      }
    }
    if (!Number.isFinite(minX)) return;
    const bounds = this.#measureViewport();
    const aspect = Math.max(0.2, bounds.width / Math.max(1, bounds.height));
    const distance = Math.max((maxZ - minZ) / 2, (maxX - minX) / (2 * aspect)) * 1.12;
    this.setCamera({
      yaw: 0,
      pitch: Math.PI / 2 - 0.018,
      distance,
      targetX: (minX + maxX) / 2,
      targetZ: (minZ + maxZ) / 2,
      orthographic: true,
    });
  }

  setCirclePreview(circles: readonly AreaCircle[] | null, capture?: CoordinateEditCapture): void {
    this.#circlePreview = circles && capture ? { circles, capture } : null;
    this.requestRender();
  }

  #preferredCamera(
    view: MapView,
    state: WorkspaceState,
    rebasedPreferences: Partial<Record<MapView, CameraPreference>> | null = null,
  ): CameraState {
    const top = view === "top";
    const home = top ? this.#homeTop : this.#homeThree;
    const preference = rebasedPreferences?.[view] ?? state.cameras[view];
    if (!preference) {
      return top
        ? { yaw: 0, pitch: Math.PI / 2 - 0.018, distance: home, targetX: 0, targetZ: 0, orthographic: true }
        : { yaw: -Math.PI / 4, pitch: 0.82, distance: home, targetX: 0, targetZ: 0, orthographic: false };
    }
    return {
      yaw: preference.yaw,
      pitch: top ? Math.PI / 2 - 0.018 : preference.pitch,
      distance: clamp(
        home / clamp(preference.zoom, 0.01, 100),
        Math.max(0.2, this.#radius * 0.04),
        this.#radius * 8,
      ),
      targetX: clamp(preference.targetX, -this.#radius, this.#radius),
      targetZ: clamp(preference.targetZ, -this.#radius, this.#radius),
      orthographic: top,
    };
  }

  #preferenceIsFit(
    view: MapView,
    state: WorkspaceState,
    rebasedPreferences: Partial<Record<MapView, CameraPreference>> | null = null,
  ): boolean {
    const preference = rebasedPreferences?.[view] ?? state.cameras[view];
    return cameraPreferenceIsFit(view, preference);
  }

  #compile(type: number, source: string): WebGLShader {
    const gl = this.#gl;
    if (!gl) throw new Error("webgl-unavailable");
    const shader = gl.createShader(type);
    if (!shader) throw new Error("shader-unavailable");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error("shader-failed");
    }
    return shader;
  }

  #initWebGl(): void {
    try {
      this.#gl = this.#sceneCanvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
        depth: true,
        powerPreference: "high-performance",
      });
      const gl = this.#gl;
      if (!gl) throw new Error("webgl2-unavailable");
      const vertex = this.#compile(gl.VERTEX_SHADER, `#version 300 es
        precision highp float;
        precision highp int;
        layout(location = 0) in uvec2 aXY;
        layout(location = 1) in uint aHeight;
        layout(location = 2) in vec3 aColor;
        uniform mat4 uViewProjection;
        uniform vec2 uCenter;
        uniform float uMetersPerCell;
        uniform float uPointPixels;
        uniform float uMaxPointPixels;
        out vec3 vColor;
        void main() {
          vec3 world = vec3(
            -(float(aXY.x) - uCenter.x) * uMetersPerCell,
            float(aHeight) * uMetersPerCell,
            (float(aXY.y) - uCenter.y) * uMetersPerCell
          );
          vec4 clip = uViewProjection * vec4(world, 1.0);
          gl_Position = clip;
          gl_PointSize = clamp(uPointPixels / max(0.18, clip.w), 1.1, uMaxPointPixels);
          vColor = aColor;
        }
      `);
      const fragment = this.#compile(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `);
      const program = gl.createProgram();
      if (!program) throw new Error("program-unavailable");
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("program-failed");
      this.#program = program;
      this.#viewProjection = gl.getUniformLocation(program, "uViewProjection");
      this.#center = gl.getUniformLocation(program, "uCenter");
      this.#meters = gl.getUniformLocation(program, "uMetersPerCell");
      this.#pointPixels = gl.getUniformLocation(program, "uPointPixels");
      this.#maxPointPixels = gl.getUniformLocation(program, "uMaxPointPixels");
      this.#buffer = gl.createBuffer();
      this.#vertexArray = gl.createVertexArray();
      gl.bindVertexArray(this.#vertexArray);
      if (!this.#buffer) throw new Error("buffer-unavailable");
      this.#bindVertexBuffer(this.#buffer);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.#mode = "webgl2";
      this.#contextGeneration += 1;
    } catch {
      this.#releaseWebGl();
      this.#initFallback();
    }
  }

  #installScene(
    scene: SceneModel | null,
    preserveCamera = false,
    previousScene: SceneModel | null = null,
    rebasePreferences = false,
    preferenceView: MapView | null = null,
  ): Partial<Record<MapView, CameraPreference>> | null {
    this.#cancelFallback();
    if (!scene) {
      this.#renderedPoints = 0;
      this.#initializedPoints = 0;
      this.requestRender();
      return null;
    }
    const [spanX, spanY] = scene.metadata.span;
    const meters = scene.metadata.metersPerCell;
    const width = spanX * meters;
    const depth = spanY * meters;
    this.#radius = Math.max(1, Math.hypot(width, depth) / 2);
    const previousHome = { three: this.#homeThree, top: this.#homeTop } as const;
    this.#updateHomeDistances();
    if (preserveCamera && previousScene) {
      this.setCamera(rebaseCameraTarget(this.#camera, previousScene, scene), false);
    }
    else this.fit(false, preferenceView ?? undefined);
    const state = this.#state;
    if (rebasePreferences && previousScene && state) {
      const nextHome = { three: this.#homeThree, top: this.#homeTop } as const;
      const preferences = rebaseCameraPreferences(
        state.cameras,
        previousScene,
        scene,
        previousHome,
        nextHome,
      );
      const effectiveView = preferenceView
        ?? (topView(state));
      const home = effectiveView === "top" ? this.#homeTop : this.#homeThree;
      preferences[effectiveView] = this.#preferenceOf(this.#camera, false, home);
      this.#callbacks.onCameraPreferences?.(preferences);
      return preferences;
    }
    return null;
  }

  #updateHomeDistances(): void {
    const scene = this.#scene;
    if (!scene) return;
    const [spanX, spanY] = scene.metadata.span;
    const meters = scene.metadata.metersPerCell;
    const width = spanX * meters;
    const depth = spanY * meters;
    const bounds = this.#measureViewport();
    const aspect = Math.max(0.2, bounds.width / Math.max(1, bounds.height));
    this.#homeThree = perspectiveFitDistance(this.#radius, aspect);
    this.#homeTop = Math.max(depth / 2, width / (2 * aspect)) * 1.12;
  }



  #bindVertexBuffer(buffer: WebGLBuffer, step = 1, first = 0): void {
    const gl = this.#gl;
    if (!gl || !this.#vertexArray) return;
    gl.bindVertexArray(this.#vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_SHORT, 8 * step, 8 * first);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_BYTE, 8 * step, 8 * first + 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 8 * step, 8 * first + 5);
    gl.bindVertexArray(null);
  }

  #deleteFrontBuffer(): void {
    if (this.#buffer && this.#gl) this.#gl.deleteBuffer(this.#buffer);
    this.#buffer = null;
  }

  #cancelGpuUpload(clearPartialFront: boolean): void {
    const upload = this.#upload;
    if (!upload) return;
    this.#upload = null;
    if (!upload.staging && clearPartialFront && this.#buffer === upload.buffer) {
      this.#deleteFrontBuffer();
      this.#scene = null;
      this.#sceneContext = null;
      this.#renderedPoints = 0;
      this.#initializedPoints = 0;
    }
  }

  #startGpuUpload(
    scene: SceneModel,
    context: string,
    state: WorkspaceState,
    staging: boolean,
    previousScene: SceneModel | null,
    preserveCamera: boolean,
    seed: "scene" | "copy" = "scene",
    dirtyBlocks: readonly number[] = [],
  ): void {
    const gl = this.#gl;
    if (!gl || this.#mode !== "webgl2" || !state.pageActive || this.#disposed) return;
    let buffer = staging ? this.#stagingBuffer : this.#buffer;
    if (!buffer && !staging && this.#stagingBuffer) {
      buffer = this.#stagingBuffer;
      this.#stagingBuffer = null;
    }
    if (!buffer) {
      try {
        buffer = gl.createBuffer();
      } catch {
        this.#transitionToFallback();
        return;
      }
    }
    if (!buffer) {
      this.#transitionToFallback();
      return;
    }
    if (staging) this.#stagingBuffer = buffer;
    else this.#buffer = buffer;
    if (!this.#allocateGpuBuffer(buffer, scene.total * 8, seed === "scene")) {
      this.#transitionToFallback();
      return;
    }
    if (!staging) this.#bindVertexBuffer(buffer);
    this.#upload = {
      scene,
      revision: scene.revision,
      context,
      generation: state.generation,
      contextGeneration: this.#contextGeneration,
      buffer,
      staging,
      seed,
      previousScene,
      preserveCamera,
      preferenceView: topView(state),
      frontierBytes: 0,
      dirtyBlocks: new Set(dirtyBlocks),
      transitionBlocks: new Set(dirtyBlocks),
    };
    if (!staging) {
      this.#initializedPoints = 0;
      this.#renderedPoints = 0;
    }
    this.requestRender();
  }

  #advanceGpuUpload(
    scene: SceneModel,
    context: string,
    state: WorkspaceState,
    dirtyBlocks: readonly number[],
  ): boolean {
    const upload = this.#upload;
    if (!upload || upload.context !== context || upload.contextGeneration !== this.#contextGeneration
      || !samePointLayout(upload.scene, scene)) return false;
    const combined = new Set(upload.transitionBlocks);
    for (const block of dirtyBlocks) combined.add(block);
    if (combined.size > GPU_DELTA_MAX_BLOCKS) return false;

    upload.scene = scene;
    upload.revision = scene.revision;
    upload.generation = state.generation;
    upload.transitionBlocks.clear();
    for (const block of combined) upload.transitionBlocks.add(block);
    if (upload.seed === "copy") {
      for (const block of dirtyBlocks) upload.dirtyBlocks.add(block);
    } else {
      const uploadedBlocks = Math.ceil(upload.frontierBytes / GPU_DELTA_BLOCK_BYTES);
      for (const block of dirtyBlocks) {
        if (block < uploadedBlocks) upload.dirtyBlocks.add(block);
      }
    }
    this.requestRender();
    return true;
  }

  #allocateGpuBuffer(buffer: WebGLBuffer, byteLength: number, reset: boolean): boolean {
    const gl = this.#gl;
    if (!gl) return false;
    const capacity = this.#bufferCapacities.get(buffer) ?? 0;
    if (!reset && capacity >= byteLength) return true;
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, byteLength, gl.DYNAMIC_DRAW);
      if (this.#hasGlError()) return false;
      this.#bufferCapacities.set(buffer, byteLength);
      return true;
    } catch {
      return false;
    }
  }

  #hasGlError(): boolean {
    const gl = this.#gl;
    if (!gl) return true;
    try {
      const error = gl.getError();
      return typeof error === "number" && error !== gl.NO_ERROR;
    } catch {
      return true;
    }
  }

  #transitionToFallback(): void {
    const scene = this.#admittedScene;
    const context = this.#admittedContext;
    const state = this.#state;
    const previousScene = this.#scene;
    const previousContext = this.#sceneContext;
    this.#cancelGpuUpload(false);
    this.#releaseWebGl();
    if (scene && context && state?.pageActive) {
      const sameContext = previousScene !== null && previousContext === context;
      if (scene !== previousScene || context !== previousContext) {
        this.#scene = scene;
        this.#sceneContext = context;
        this.#installScene(scene, sameContext && !this.#fitActive, previousScene, sameContext,
          topView(state));
      }
    } else if (!scene && previousScene) {
      this.#scene = null;
      this.#sceneContext = null;
      this.#installScene(null);
    }
    this.#initFallback();
    this.requestRender();
  }

  #uploadFrontier(upload: GpuUpload, maximumBytes: number): number {
    const gl = this.#gl;
    const bytesRemaining = upload.scene.total * 8 - upload.frontierBytes;
    const byteCount = Math.min(bytesRemaining, maximumBytes);
    if (!gl || byteCount <= 0) return 0;
    if (upload.seed === "copy") {
      if (!this.#buffer || this.#buffer === upload.buffer) return -1;
      gl.bindBuffer(gl.COPY_READ_BUFFER, this.#buffer);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, upload.buffer);
      gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER,
        upload.frontierBytes, upload.frontierBytes, byteCount);
    } else {
      const bytes = new Uint8Array(
        upload.scene.buffer,
        upload.scene.pointOffset + upload.frontierBytes,
        byteCount,
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, upload.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, upload.frontierBytes, bytes);
    }
    if (this.#hasGlError()) return -1;
    upload.frontierBytes += byteCount;
    if (!upload.staging) this.#initializedPoints = upload.frontierBytes / 8;
    return byteCount;
  }

  #uploadDirtyBlocks(upload: GpuUpload, maximumBytes: number): number {
    const gl = this.#gl;
    if (!gl || maximumBytes <= 0) return 0;
    const totalBytes = upload.scene.total * 8;
    const eligible = [...upload.dirtyBlocks].sort((left, right) => left - right);
    let uploaded = 0;
    for (const block of eligible) {
      const start = block * GPU_DELTA_BLOCK_BYTES;
      const end = Math.min(totalBytes, start + GPU_DELTA_BLOCK_BYTES);
      const length = end - start;
      if (end > upload.frontierBytes || uploaded + length > maximumBytes) continue;
      const bytes = new Uint8Array(upload.scene.buffer, upload.scene.pointOffset + start, length);
      gl.bindBuffer(gl.ARRAY_BUFFER, upload.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, start, bytes);
      if (this.#hasGlError()) return -1;
      upload.dirtyBlocks.delete(block);
      uploaded += length;
    }
    return uploaded;
  }

  #uploadGpuChunk(): void {
    const upload = this.#upload;
    const gl = this.#gl;
    const state = this.#state;
    if (!upload || !gl || !state) return;
    if (this.#disposed || !state.pageActive || upload.scene !== this.#admittedScene
      || upload.revision !== upload.scene.revision
      || upload.context !== this.#admittedContext || upload.generation !== state.generation
      || sceneContext(state) !== upload.context || state.resources.scene.value !== upload.scene
      || upload.contextGeneration !== this.#contextGeneration
      || (upload.staging && this.#stagingBuffer !== upload.buffer)
      || (!upload.staging && this.#buffer !== upload.buffer)) {
      this.#cancelGpuUpload(true);
      return;
    }
    const byteLength = upload.scene.total * 8;
    const pendingFrontier = upload.frontierBytes < byteLength;
    let remainingBudget = GPU_UPLOAD_CHUNK_BYTES;
    let used = 0;
    try {
      const frontierLimit = pendingFrontier && upload.dirtyBlocks.size > 0
        ? GPU_UPLOAD_FAIR_SHARE_BYTES
        : GPU_UPLOAD_CHUNK_BYTES;
      const frontierBytes = this.#uploadFrontier(upload, Math.min(frontierLimit, remainingBudget));
      if (frontierBytes < 0) throw new Error("gpu-frontier-upload-failed");
      remainingBudget -= frontierBytes;
      used += frontierBytes;

      const canPatch = [...upload.dirtyBlocks].some((block) =>
        Math.min(byteLength, (block + 1) * GPU_DELTA_BLOCK_BYTES) <= upload.frontierBytes);
      const patchLimit = pendingFrontier && canPatch
        ? Math.min(GPU_UPLOAD_FAIR_SHARE_BYTES, remainingBudget)
        : canPatch ? remainingBudget : 0;
      const patchBytes = this.#uploadDirtyBlocks(upload, patchLimit);
      if (patchBytes < 0) throw new Error("gpu-dirty-upload-failed");
      remainingBudget -= patchBytes;
      used += patchBytes;

      const hasEligiblePatch = [...upload.dirtyBlocks].some((block) =>
        Math.min(byteLength, (block + 1) * GPU_DELTA_BLOCK_BYTES) <= upload.frontierBytes);
      if (pendingFrontier && remainingBudget > 0 && !hasEligiblePatch) {
        const extraFrontier = this.#uploadFrontier(upload, remainingBudget);
        if (extraFrontier < 0) throw new Error("gpu-frontier-upload-failed");
        remainingBudget -= extraFrontier;
        used += extraFrontier;
      }
    } catch {
      this.#transitionToFallback();
      return;
    }

    if (used > 0 && !this.#uploadIsCurrent(upload)) {
      this.#cancelGpuUpload(true);
      return;
    }
    if (upload.frontierBytes < byteLength || upload.dirtyBlocks.size > 0) {
      this.requestRender();
      return;
    }
    if (!this.#uploadIsCurrent(upload)) {
      this.#cancelGpuUpload(true);
      return;
    }
    if (upload.staging) {
      const currentState = this.#state;
      const currentView = currentState
        ? topView(currentState)
        : upload.preferenceView;
      const previousBuffer = this.#buffer;
      this.#buffer = upload.buffer;
      this.#stagingBuffer = previousBuffer;
      this.#bindVertexBuffer(upload.buffer);
      this.#scene = upload.scene;
      this.#sceneContext = upload.context;
      this.#upload = null;
      this.#initializedPoints = upload.scene.total;
      this.#renderedPoints = upload.scene.total;
      const rebased = this.#installScene(
        upload.scene,
        upload.preserveCamera,
        upload.previousScene,
        true,
        currentView,
      );
      if (currentState && rebased) {
        const view = topView(currentState);
        this.#camera = this.#preferredCamera(view, currentState, rebased);
        this.#fitActive = this.#preferenceIsFit(view, currentState, rebased);
        this.#notifyCamera();
      }
    } else {
      this.#upload = null;
      this.#scene = upload.scene;
      this.#sceneContext = upload.context;
      this.#initializedPoints = upload.scene.total;
      this.#renderedPoints = upload.scene.total;
    }
  }

  #uploadIsCurrent(upload: GpuUpload): boolean {
    const state = this.#state;
    if (!state) return false;
    return !this.#disposed && state.pageActive
      && upload.scene === this.#admittedScene
      && upload.revision === upload.scene.revision
      && upload.context === this.#admittedContext
      && upload.generation === state.generation
      && sceneContext(state) === upload.context
      && state.resources.scene.value === upload.scene
      && upload.contextGeneration === this.#contextGeneration
      && (upload.staging ? this.#stagingBuffer === upload.buffer : this.#buffer === upload.buffer);
  }

  #initFallback(): void {
    this.#cancelFallback();
    this.#mode = "canvas2d";
    this.#fallbackCanvas = document.createElement("canvas");
    this.#fallback = this.#fallbackCanvas.getContext("2d", { alpha: true });
    if (!this.#fallback) {
      this.#mode = "unavailable";
      this.#callbacks.onProblem?.("renderer-unavailable");
    }
  }

  #buildFallback(scene: SceneModel): void {
    const context = this.#fallback;
    const canvas = this.#fallbackCanvas;
    if (!context || !canvas) return;
    this.#cancelFallback();
    const projection = {
      scene,
      matrix: new Float32Array(this.#matrix),
      width: this.#viewport.width,
      height: this.#viewport.height,
    };
    this.#fallbackProjection = projection;
    // Cache the camera-aligned raster, capped at four MiB regardless of zoom
    // or display density. Animation frames only composite this cached layer.
    const scale = Math.min(window.devicePixelRatio || 1,
      1024 / Math.max(1, projection.width), 1024 / Math.max(1, projection.height));
    canvas.width = Math.max(1, Math.round(projection.width * scale));
    canvas.height = Math.max(1, Math.round(projection.height * scale));
    context.setTransform(scale, 0, 0, scale, 0, 0);
    this.#renderedPoints = 0;
    const view = new DataView(scene.buffer, scene.pointOffset, scene.total * 8);
    const step = Math.max(1, Math.ceil(scene.total / 50_000));
    let index = 0;
    let rendered = 0;
    const drawChunk = (): void => {
      if (this.#disposed || !this.#state?.pageActive || this.#mode !== "canvas2d"
        || scene !== this.#scene || projection !== this.#fallbackProjection) return;
      this.#fallbackFrame = null;
      const started = performance.now();
      let processed = 0;
      while (index < scene.total && processed < 2_000) {
        const offset = index * 8;
        const point = this.#projectCell(view.getUint16(offset, true), view.getUint16(offset + 2, true),
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
      this.#renderedPoints = rendered;
      this.requestRender();
      if (index < scene.total) this.#fallbackFrame = window.setTimeout(drawChunk, 0);
    };
    this.#fallbackFrame = window.setTimeout(drawChunk, 0);
  }

  #cancelFallback(): void {
    if (this.#fallbackFrame !== null) window.clearTimeout(this.#fallbackFrame);
    this.#fallbackFrame = null;
    this.#fallbackProjection = null;
  }

  #measureViewport(): ViewportBounds {
    const bounds = this.#sceneCanvas.getBoundingClientRect();
    this.#viewport = {
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      top: bounds.top,
    };
    return this.#viewport;
  }

  /** Device pixels per CSS pixel for both canvases; never below CSS
   * resolution, so labels stay legible within the touch budget. */
  #pixelRatio(): number {
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    if (!this.#touch || this.#state?.quality !== "auto") return ratio;
    const area = Math.max(1, this.#viewport.width * this.#viewport.height);
    return Math.min(ratio, Math.max(1, Math.sqrt(AUTO_TOUCH_CANVAS_PIXELS / area)));
  }

  #resize(): void {
    let resized = false;
    const bounds = this.#measureViewport();
    const ratio = this.#pixelRatio();
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    for (const canvas of [this.#sceneCanvas, this.#overlayCanvas]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        resized = true;
      }
    }
    if (resized) this.#callbacks.onViewport?.();
  }

  #cameraMatrix(): Float32Array {
    const bounds = this.#viewport;
    const aspect = Math.max(0.2, bounds.width / Math.max(1, bounds.height));
    const horizontal = Math.cos(this.#camera.pitch) * this.#camera.distance;
    const eye = [
      this.#camera.targetX + Math.sin(this.#camera.yaw) * horizontal,
      Math.sin(this.#camera.pitch) * this.#camera.distance,
      this.#camera.targetZ + Math.cos(this.#camera.yaw) * horizontal,
    ];
    const target = [this.#camera.targetX, 0, this.#camera.targetZ];
    const view = lookAt(eye, target);
    const projection = this.#camera.orthographic
      ? orthographic(
        -this.#camera.distance * aspect,
        this.#camera.distance * aspect,
        -this.#camera.distance,
        this.#camera.distance,
        -this.#radius * 4,
        this.#radius * 4,
      )
      : perspective(PERSPECTIVE_FIELD_OF_VIEW, aspect, 0.02, Math.max(60, this.#radius * 12));
    return multiply(projection, view);
  }

  requestRender(): void {
    if (this.#frame !== null || this.#disposed || this.#state?.pageActive === false) return;
    this.#frame = window.requestAnimationFrame(() => {
      this.#frame = null;
      this.#render();
    });
  }

  #render(): void {
    if (this.#disposed || this.#state?.pageActive === false) return;
    const started = performance.now();
    this.#uploadGpuChunk();
    this.#resize();
    this.#matrix = this.#cameraMatrix();
    if (this.#mode === "webgl2") this.#renderWebGl();
    else this.#renderFallback();
    this.#renderOverlay();
    this.#lastFrameMs = performance.now() - started;
    if (this.#lastFrameMs > 18) {
      this.#slowFrames += 1;
      if (this.#slowFrames >= 3 && this.#state?.quality === "auto") {
        this.#qualityScale = Math.max(0.25, this.#qualityScale * 0.75);
      }
    } else {
      this.#slowFrames = Math.max(0, this.#slowFrames - 1);
    }
  }

  #renderWebGl(): void {
    const gl = this.#gl;
    const scene = this.#scene;
    if (!gl) return;
    gl.viewport(0, 0, this.#sceneCanvas.width, this.#sceneCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!scene || !this.#program || !this.#vertexArray || !this.#buffer) return;
    if (roomColours(this.#state)) {
      this.#renderedPoints = 0;
      return;
    }
    gl.useProgram(this.#program);
    gl.bindVertexArray(this.#vertexArray);
    gl.uniformMatrix4fv(this.#viewProjection, false, this.#matrix);
    gl.uniform2f(this.#center, (scene.metadata.span[0] - 1) / 2, (scene.metadata.span[1] - 1) / 2);
    gl.uniform1f(this.#meters, scene.metadata.metersPerCell);
    const ratio = this.#pixelRatio();
    // The producer groups points by tile and then by floor/surface. Drawing
    // a prefix would crop later tiles and starve surfaces at lower quality.
    // Stride each range instead, using only its initialized upload frontier.
    const initializedPoints = Math.min(scene.total, this.#initializedPoints);
    const step = Math.max(
      Math.ceil(1 / this.#qualityScale),
      this.#touch && this.#state?.quality === "auto"
        ? Math.ceil(initializedPoints / AUTO_TOUCH_POINT_LIMIT) : 1,
    );
    const floorAvailable = Math.min(scene.floorCount, initializedPoints);
    const surfaceAvailable = Math.min(
      scene.surfaceCount,
      Math.max(0, initializedPoints - scene.floorCount),
    );
    const floorCount = Math.ceil(floorAvailable / step);
    const surfaceCount = Math.ceil(surfaceAvailable / step);
    if (floorCount > 0) {
      this.#bindVertexBuffer(this.#buffer, step);
      gl.bindVertexArray(this.#vertexArray);
      gl.uniform1f(this.#pointPixels, this.#sceneCanvas.height * 0.038);
      gl.uniform1f(this.#maxPointPixels, 4.5 * ratio);
      gl.drawArrays(gl.POINTS, 0, floorCount);
    }
    if (surfaceCount > 0) {
      this.#bindVertexBuffer(this.#buffer, step, scene.floorCount);
      gl.bindVertexArray(this.#vertexArray);
      gl.uniform1f(this.#pointPixels, this.#sceneCanvas.height * 0.05);
      gl.uniform1f(this.#maxPointPixels, 7 * ratio);
      gl.drawArrays(gl.POINTS, 0, surfaceCount);
    }
    gl.bindVertexArray(null);
    this.#renderedPoints = floorCount + surfaceCount;
  }

  #renderFallback(): void {
    const scene = this.#scene;
    if (this.#mode !== "canvas2d" || !scene
      || roomColours(this.#state)) {
      this.#cancelFallback();
      this.#renderedPoints = 0;
      return;
    }
    const projection = this.#fallbackProjection;
    if (!projection || projection.scene !== scene
      || projection.width !== this.#viewport.width || projection.height !== this.#viewport.height
      || !projection.matrix.every((value, index) => value === this.#matrix[index])) {
      this.#buildFallback(scene);
    }
  }

  #worldForCell(x: number, y: number, height = 0): readonly [number, number, number] | null {
    const scene = this.#scene;
    if (!scene) return null;
    return [
      -(x - (scene.metadata.span[0] - 1) / 2) * scene.metadata.metersPerCell,
      height * scene.metadata.metersPerCell,
      (y - (scene.metadata.span[1] - 1) / 2) * scene.metadata.metersPerCell,
    ];
  }

  #projectCell(x: number, y: number, height = 0, clipToViewport = true, matrix = this.#matrix,
    bounds: Pick<ViewportBounds, "width" | "height"> = this.#viewport): MapPoint | null {
    const world = this.#worldForCell(x, y, height);
    if (!world) return null;
    const [worldX, worldY, worldZ] = world;
    const clipX = (matrix[0] ?? 0) * worldX + (matrix[4] ?? 0) * worldY + (matrix[8] ?? 0) * worldZ + (matrix[12] ?? 0);
    const clipY = (matrix[1] ?? 0) * worldX + (matrix[5] ?? 0) * worldY + (matrix[9] ?? 0) * worldZ + (matrix[13] ?? 0);
    const clipW = (matrix[3] ?? 0) * worldX + (matrix[7] ?? 0) * worldY + (matrix[11] ?? 0) * worldZ + (matrix[15] ?? 0);
    if (clipW <= 0.001) return null;
    const xNormalized = clipX / clipW;
    const yNormalized = clipY / clipW;
    if (!Number.isFinite(xNormalized) || !Number.isFinite(yNormalized)) return null;
    if (clipToViewport
      && (Math.abs(xNormalized) > 1.15 || Math.abs(yNormalized) > 1.15)) return null;
    return {
      x: (xNormalized * 0.5 + 0.5) * bounds.width,
      y: (-yNormalized * 0.5 + 0.5) * bounds.height,
    };
  }

  #projectMeters(x: number, y: number, height = 0, clipToViewport = true, matrix = this.#matrix): MapPoint | null {
    const scene = this.#scene;
    if (!scene) return null;
    const cellX = x / scene.metadata.metersPerCell - scene.metadata.origin[0];
    const cellY = y / scene.metadata.metersPerCell - scene.metadata.origin[1];
    return this.#projectCell(cellX, cellY, height, clipToViewport, matrix);
  }

  #renderOverlay(): void {
    const context = this.#overlay;
    const scene = this.#scene;
    const state = this.#state;
    if (!context) return;
    const ratio = this.#pixelRatio();
    const bounds = this.#viewport;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    if (!scene || !state) return;
    const palette = this.#palette;
    if (this.#mode === "canvas2d" && this.#fallbackCanvas
      && !roomColours(state)) {
      // A WebGL canvas cannot acquire a 2D context after context loss.
      context.drawImage(this.#fallbackCanvas, 0, 0, bounds.width, bounds.height);
    }
    const selectedNames = this.#selectedRoomNames(state);
    const selectedPositions = state.workflow === "plan" && state.planDraft.runBehavior === "ordered"
      ? (() => {
        if (this.#positionFormat?.locale !== state.locale) {
          this.#positionFormat = { locale: state.locale, format: new Intl.NumberFormat(state.locale) };
        }
        const { format } = this.#positionFormat;
        return new Map(state.planDraft.rooms.map((room, index) => [room.roomId, format.format(index + 1)]));
      })()
      : null;
    // Every room draws with Room names on or in Room colors; otherwise only
    // the selected ones (home-rooms.md §5 Parity, R9).
    const allRooms = state.labelsVisible || roomColours(state);
    if (allRooms || selectedNames.size) {
      // IDs keep each room's hue stable when scene metadata is reordered.
      const roomIndexes = new Map(scene.metadata.rooms.map((room) => room.id).sort()
        .map((id, index) => [id, index]));
      context.lineWidth = 1.5;
      context.font = "600 12px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      const occupied: DOMRect[] = [];
      for (const room of scene.metadata.rooms) {
        const selected = selectedNames.has(room.name.toLocaleLowerCase());
        if (!allRooms && !selected) continue;
        context.lineWidth = selected ? 3 : roomColours(state) ? 2 : 1.5;
        context.strokeStyle = selected ? rgba(palette.accent, 1)
          : roomColours(state) || palette.forced ? rgba(palette.text, 1) : rgba(palette.quiet, .7);
        context.fillStyle = roomColours(state)
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
          const projected = this.#projectCell(point[0], point[1], 0.2, false);
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
      // Labels draw after every fill so a later, overlapping room cannot paint
      // over an earlier room's name. Room names on draws every room.
      if (state.labelsVisible) for (const room of scene.metadata.rooms) {
        const center = this.#projectCell(room.center[0], room.center[1], 1);
        if (!center) continue;
        const position = selectedPositions?.get(room.id);
        const positionWidth = position ? context.measureText(position).width : 0;
        const badgeWidth = position ? Math.max(16, positionWidth + 10) : 0;
        const badgeGap = position ? 4 : 0;
        const textWidth = context.measureText(room.name).width;
        const contentWidth = badgeWidth + badgeGap + textWidth;
        // Every room keeps its name: a label that would cover another moves to
        // the nearest free slot above or below its room centre.
        const labelBounds = new DOMRect(center.x - contentWidth / 2 - 6, center.y - 10, contentWidth + 12, 20);
        // Steps visit the centre, 24 px below, 24 px above, 48 px below and
        // 48 px above on the canvas, and return to the centre when none fits.
        for (const step of [24, -48, 72, -96, 48]) {
          if (labelBounds.top >= 0 && labelBounds.bottom <= bounds.height
            && !occupied.some((other) => labelBounds.left < other.right + 8
            && labelBounds.right + 8 > other.left
            && labelBounds.top < other.bottom + 4
            && labelBounds.bottom + 4 > other.top)) break;
          labelBounds.y += step;
        }
        const y = labelBounds.y + 10;
        occupied.push(labelBounds);
        context.fillStyle = rgba(palette.plate, .88);
        context.fillRect(labelBounds.x, labelBounds.y, labelBounds.width, labelBounds.height);
        if (position) {
          const badgeX = center.x - contentWidth / 2 + badgeWidth / 2;
          context.beginPath();
          context.roundRect(badgeX - badgeWidth / 2, y - 8, badgeWidth, 16, 8);
          context.fillStyle = rgba(palette.accent, 1);
          context.fill();
          context.fillStyle = rgba(palette.onAccent, 1);
          context.fillText(position, badgeX, y);
        }
        context.fillStyle = rgba(palette.text, 1);
        context.fillText(room.name, center.x + (badgeWidth + badgeGap) / 2, y);
      }
    }
    const preview = this.#circlePreview;
    const circles = preview && hasCoordinateEditAdmission(state, preview.capture)
      ? preview.circles
      : state.draw.circles;
    if (state.workflow === "areaReview" && circles.length && !palette.forced) {
      // The review dims everything but the area (map-surfaces.md §5).
      context.fillStyle = "rgba(0, 0, 0, 0.45)";
      context.fillRect(0, 0, bounds.width, bounds.height);
      context.save();
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = "#000";
      context.beginPath();
      for (const circle of circles) this.#drawCircle(context, circle, false);
      context.fill();
      context.restore();
    }
    if ((state.workflow === "draw" || state.workflow === "areaReview") && circles.length) {
      context.fillStyle = rgba(palette.accent, .22);
      context.strokeStyle = rgba(palette.accent, .92);
      context.lineWidth = 1.5;
      if (state.draw.outline?.closed) {
        context.beginPath();
        for (const circle of circles) this.#drawCircle(context, circle, false);
        context.fill();
      } else {
        for (const circle of circles) this.#drawCircle(context, circle);
      }
    }
    const outline = state.draw.outline;
    if (outline && (state.workflow === "draw" || state.workflow === "areaReview")
      && !(state.workflow === "draw" && state.draw.tool === "outline")) {
      context.beginPath();
      outline.points.forEach((point, i) => {
        const p = this.#projectMeters(point.x, point.y, 0, false);
        if (p) { if (i === 0) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y); }
      });
      if (outline.closed) context.closePath();
      context.strokeStyle = rgba(palette.accent, 1);
      context.lineWidth = 2;
      context.stroke();
    }
    if (this.#cursor && state.workflow === "draw" && (state.draw.tool === "paint" || state.draw.tool === "erase")) {
      const center = this.#projectMeters(this.#cursor.x, this.#cursor.y);
      const edge = this.#projectMeters(this.#cursor.x + state.draw.brushMeters / 2, this.#cursor.y);
      if (center && edge) {
        context.beginPath();
        context.arc(center.x, center.y, Math.max(2, Math.hypot(edge.x - center.x, edge.y - center.y)), 0, Math.PI * 2);
        context.strokeStyle = rgba(palette.accent, 1);
        context.lineWidth = 2;
        context.stroke();
      }
    }
    const pose = state.resources.pose.value;
    if (canShowExactPose(state) && pose?.position) {
      // Pose coordinates share the floor-plan's meter space. Scene geometry is
      // stored in origin-relative cells, so it must cross the same conversion
      // boundary as custom-area coordinates before projection.
      const marker = this.#projectMeters(pose.position[0], pose.position[1], 3);
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

  #selectedRoomNames(state: WorkspaceState): Set<string> {
    const rooms = state.resources.plans.value?.rooms || state.resources.areas.value?.rooms || [];
    // Rooms and plan draw their own selections; home draws none (R9).
    const selectedRoomIds = new Set(state.workflow === "plan"
      ? state.planDraft.rooms.map((room) => room.roomId)
      : state.workflow === "rooms" ? state.selection.roomIds : []);
    const selectedNames = new Set<string>();
    for (const room of rooms) {
      if (selectedRoomIds.has(room.roomId)) selectedNames.add(room.name.toLocaleLowerCase());
    }
    return selectedNames;
  }

  #drawCircle(context: CanvasRenderingContext2D, circle: AreaCircle, paint = true): void {
    const center = this.#projectMeters(circle.x, circle.y);
    const edge = this.#projectMeters(circle.x + circle.radius, circle.y);
    if (!center || !edge) return;
    const radius = Math.max(1, Math.hypot(edge.x - center.x, edge.y - center.y));
    if (paint) context.beginPath();
    context.moveTo(center.x + radius, center.y);
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    if (paint) { context.fill(); context.stroke(); }
  }

  setPalette(palette: CanvasPalette): void {
    this.#palette = palette;
    this.requestRender();
  }

  setCursor(point: MapPoint | null): void {
    this.#cursor = point;
    this.requestRender();
  }

  mapToScreen(point: MapPoint): MapPoint | null {
    if (!this.#scene) return null;
    const bounds = this.#measureViewport();
    if (!bounds.width || !bounds.height) return null;
    return this.#projectMeters(point.x, point.y, 0, false, this.#cameraMatrix());
  }

  offsetMapPoint(point: MapPoint, horizontalMeters: number, verticalMeters: number): MapPoint | null {
    const projected = this.mapToScreen(point);
    if (!projected) return null;
    const bounds = this.#viewport;
    const worldPerPixel = this.#camera.distance * 2 / bounds.height;
    return this.screenToMap(
      bounds.left + projected.x + horizontalMeters / worldPerPixel,
      bounds.top + projected.y + verticalMeters / worldPerPixel,
    );
  }

  screenToMap(clientX: number, clientY: number): MapPoint | null {
    const scene = this.#scene;
    if (!scene) return null;
    const bounds = this.#measureViewport();
    if (!bounds.width || !bounds.height) return null;
    // Invert the floor-plane homography, including perspective division in 3D.
    const matrix = this.#cameraMatrix();
    const x = (clientX - bounds.left) / bounds.width * 2 - 1;
    const y = 1 - (clientY - bounds.top) / bounds.height * 2;
    const a = matrix[0]! - x * matrix[3]!;
    const b = matrix[8]! - x * matrix[11]!;
    const c = matrix[1]! - y * matrix[3]!;
    const d = matrix[9]! - y * matrix[11]!;
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
    const u = x * matrix[15]! - matrix[12]!;
    const v = y * matrix[15]! - matrix[13]!;
    const worldX = (u * d - b * v) / determinant;
    const worldZ = (a * v - u * c) / determinant;
    if (matrix[3]! * worldX + matrix[11]! * worldZ + matrix[15]! <= 0) return null;
    const cellX = -worldX / scene.metadata.metersPerCell + (scene.metadata.span[0] - 1) / 2;
    const cellY = worldZ / scene.metadata.metersPerCell + (scene.metadata.span[1] - 1) / 2;
    return {
      x: (cellX + scene.metadata.origin[0]) * scene.metadata.metersPerCell,
      y: (cellY + scene.metadata.origin[1]) * scene.metadata.metersPerCell,
    };
  }

  roomAt(clientX: number, clientY: number): string | null {
    const map = this.screenToMap(clientX, clientY);
    const scene = this.#scene;
    const state = this.#state;
    if (!map || !scene || !state) return null;
    const cellX = map.x / scene.metadata.metersPerCell - scene.metadata.origin[0];
    const cellY = map.y / scene.metadata.metersPerCell - scene.metadata.origin[1];
    const room = scene.metadata.rooms.find((candidate) => pointInPolygon(cellX, cellY, candidate.boundary));
    if (!room) return null;
    return this.#roomId(room, state);
  }

  containsMapPoint(point: MapPoint): boolean {
    const scene = this.#scene;
    if (!scene) return false;
    const cellX = point.x / scene.metadata.metersPerCell - scene.metadata.origin[0];
    const cellY = point.y / scene.metadata.metersPerCell - scene.metadata.origin[1];
    return scene.metadata.rooms.some((room) => pointInPolygon(cellX, cellY, room.boundary));
  }

  // A scene room with no catalog entry has no id to select (R9).
  #roomId(room: SceneRoom, state: WorkspaceState): string | null {
    const candidates = state.resources.plans.value?.rooms || state.resources.areas.value?.rooms || [];
    return candidates.find((candidate) => candidate.name.localeCompare(room.name, undefined, { sensitivity: "base" }) === 0)?.roomId
      ?? null;
  }

  selectRoomAt(clientX: number, clientY: number): void {
    const roomId = this.roomAt(clientX, clientY);
    if (roomId) this.#callbacks.onRoom?.(roomId);
  }

  fit(
    notify = true,
    view: MapView = this.#state ? topView(this.#state) : "three",
  ): void {
    const top = view === "top";
    this.#camera = top
      ? { yaw: 0, pitch: Math.PI / 2 - 0.018, distance: this.#homeTop, targetX: 0, targetZ: 0, orthographic: true }
      : { yaw: -Math.PI / 4, pitch: 0.82, distance: this.#homeThree, targetX: 0, targetZ: 0, orthographic: false };
    this.#fitActive = true;
    this.requestRender();
    if (notify) this.#notifyCamera();
  }

  zoomAt(factor: number, clientX?: number, clientY?: number): void {
    const before = clientX === undefined || clientY === undefined ? null : this.screenToMap(clientX, clientY);
    const distance = this.#distanceBounds();
    this.#camera = {
      ...this.#camera,
      distance: clamp(this.#camera.distance / factor, distance.minimum, distance.maximum),
    };
    this.#fitActive = false;
    if (before && clientX !== undefined && clientY !== undefined) {
      const after = this.screenToMap(clientX, clientY);
      if (after) {
        this.#camera = {
          ...this.#camera,
          targetX: this.#camera.targetX - (before.x - after.x),
          targetZ: this.#camera.targetZ + (before.y - after.y),
        };
      }
    }
    this.requestRender();
    this.#notifyCamera(clientX, clientY);
  }

  panBy(deltaX: number, deltaY: number): void {
    this.setCamera(this.cameraAfterPan(this.#camera, deltaX, deltaY));
  }

  orbitBy(deltaX: number, deltaY: number): void {
    if (this.#camera.orthographic) {
      this.panBy(deltaX, deltaY);
      return;
    }
    this.#camera = {
      ...this.#camera,
      yaw: angle(this.#camera.yaw + deltaX * 0.006),
      pitch: clamp(this.#camera.pitch - deltaY * 0.004, 0.18, 1.38),
    };
    this.#fitActive = false;
    this.requestRender();
    this.#notifyCamera();
  }

  rotateBy(deltaRadians: number): void {
    this.#camera = {
      ...this.#camera,
      yaw: angle(this.#camera.yaw + deltaRadians),
    };
    this.#fitActive = false;
    this.requestRender();
    this.#notifyCamera();
  }

  #notifyCamera(clientX?: number, clientY?: number): void {
    const home = this.#camera.orthographic ? this.#homeTop : this.#homeThree;
    const bounds = clientX === undefined || clientY === undefined
      ? this.#viewport
      : this.#measureViewport();
    const origin = clientX === undefined || clientY === undefined || !bounds.width || !bounds.height
      ? undefined
      : {
        xPercent: clamp((clientX - bounds.left) / bounds.width * 100, 0, 100),
        yPercent: clamp((clientY - bounds.top) / bounds.height * 100, 0, 100),
      };
    this.#callbacks.onCamera?.(
      this.camera,
      Math.round(home / this.#camera.distance * 100),
      origin,
    );
  }

  diagnostics(): RendererDiagnostics {
    return {
      mode: this.#mode,
      contextGeneration: this.#contextGeneration,
      sceneRevision: this.#scene?.revision ?? null,
      sourcePoints: this.#scene?.total ?? 0,
      renderedPoints: this.#renderedPoints,
      lastFrameMs: Math.round(this.#lastFrameMs * 100) / 100,
      slowFrames: this.#slowFrames,
      cameraDistance: this.#camera.distance,
      fitDistance: this.#camera.orthographic ? this.#homeTop : this.#homeThree,
      fitActive: this.#fitActive,
    };
  }

  readonly #contextLost = (event: Event): void => {
    event.preventDefault();
    this.#transitionToFallback();
  };

  readonly #contextRestored = (): void => {
    const previousScene = this.#scene;
    const previousContext = this.#sceneContext;
    this.#cancelFallback();
    this.#releaseWebGl();
    this.#initWebGl();
    const scene = this.#admittedScene;
    const context = this.#admittedContext;
    const state = this.#state;
    if (this.#mode === "webgl2" && scene && context && state?.pageActive) {
      const sameContext = previousScene !== null && previousContext === context;
      this.#deleteFrontBuffer();
      this.#scene = scene;
      this.#sceneContext = context;
      let rebased: Partial<Record<MapView, CameraPreference>> | null = null;
      if (scene !== previousScene) {
        rebased = this.#installScene(
          scene,
          sameContext && !this.#fitActive,
          previousScene,
          sameContext,
          topView(state),
        );
      }
      this.#startGpuUpload(scene, context, state, false, previousScene, sameContext && !this.#fitActive);
      if (rebased) {
        const view = topView(state);
        this.#camera = this.#preferredCamera(view, state, rebased);
        this.#fitActive = this.#preferenceIsFit(view, state, rebased);
        this.#notifyCamera();
      }
    }
    this.requestRender();
  };

  #releaseWebGl(): void {
    this.#cancelGpuUpload(false);
    const gl = this.#gl;
    if (gl) {
      if (this.#buffer) gl.deleteBuffer(this.#buffer);
      if (this.#stagingBuffer) gl.deleteBuffer(this.#stagingBuffer);
      if (this.#vertexArray) gl.deleteVertexArray(this.#vertexArray);
      if (this.#program) gl.deleteProgram(this.#program);
    }
    this.#buffer = null;
    this.#stagingBuffer = null;
    this.#vertexArray = null;
    this.#program = null;
    this.#gl = null;
    this.#initializedPoints = 0;
    this.#renderedPoints = 0;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#resizeObserver.disconnect();
    this.#sceneCanvas.removeEventListener("webglcontextlost", this.#contextLost);
    this.#sceneCanvas.removeEventListener("webglcontextrestored", this.#contextRestored);
    if (this.#frame !== null) window.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#cancelFallback();
    this.#releaseWebGl();
    this.#fallbackCanvas = null;
    this.#fallback = null;
    this.#overlay = null;
    this.#circlePreview = null;
    this.#scene = null;
    this.#state = null;
    this.#admittedScene = null;
    this.#admittedContext = null;
  }
}
