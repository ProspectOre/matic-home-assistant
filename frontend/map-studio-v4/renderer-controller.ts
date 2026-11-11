import { PERSPECTIVE_FIELD_OF_VIEW } from "./renderer-math";
import { liveCameraKey, mapCameraIdentity } from "./camera-preferences";
import type { AreaCircle, PoseModel, SceneModel } from "./backend-contracts";
import type { CameraPreference, CoordinateEditCapture, MapQuality, MapView, WorkspaceState } from "./contracts";
import type { RoomIdentityResult } from "./spatial-identity";
import type { PoseMotion } from "./pose-motion";
import { canShowExactPose, forcesTop, savedMapPosition, topView } from "./state";
import { FrameGovernor } from "./frame-governor";
import type { CanvasPalette } from "./theme-probe";
import { RendererCamera, angle, type CameraOrigin, type CameraState, type MapPoint } from "./renderer-camera";
import { RendererGl, advanceUpload, samePointLayout, validDeltaBlocks, type GpuUpload } from "./renderer-gl";
import { containsMapPoint, roomAt, roomCandidatesAt } from "./renderer-hit-test";
import { RendererModules, type ModuleCallbacks } from "./renderer-modules";
import { FallbackRaster, RendererOverlay, layersNeeded, roomColours } from "./renderer-overlays";

export type { CameraOrigin, CameraState, MapPoint } from "./renderer-camera";
export type { RendererModuleName, RendererModuleStatus } from "./renderer-modules";
export type RendererSurfaceDetail = "limited" | "sampled" | null;

export interface RendererDiagnostics {
  readonly mode: "webgl2" | "canvas2d" | "unavailable";
  readonly contextGeneration: number;
  readonly sceneRevision: number | null;
  readonly sourcePoints: number;
  readonly renderedPoints: number;
  readonly frameMs: number;
  readonly detailScale: number;
  readonly cameraDistance: number;
  readonly fitDistance: number;
  readonly fitActive: boolean;
  readonly topPixelsPerMeter: number;
}

interface RendererCallbacks extends ModuleCallbacks {
  readonly onCamera?: (
    camera: CameraState,
    zoomPercent: number,
    origin?: CameraOrigin,
  ) => void;
  readonly onCameraPreferences?: (
    cameras: Readonly<Partial<Record<MapView, CameraPreference>>>,
  ) => void;
  readonly onViewport?: () => void;
  readonly onProblem?: (problem: string) => void;
  readonly onMode?: (mode: RendererDiagnostics["mode"]) => void;
  readonly onSurfaceDetail?: (detail: RendererSurfaceDetail) => void;
}

const qualityScale = (quality: MapQuality): number =>
  quality === "efficient" ? .35 : quality === "balanced" ? .65 : 1;

export { topView } from "./state";

const sceneContext = (state: WorkspaceState): string => {
  return `${state.dataMode}|${state.selection.entryId ?? "none"}|${state.selection.floorId}`
    + `|${state.selection.historyId ?? "none"}|${mapCameraIdentity(state)}`;
};

// Touch-device qualification showed GPU/presentation delay despite short
// JavaScript frames. Auto bounds the point workload and, because fill cost
// grows with device pixels (150% zoom on a tablet: touch-to-present p95 86 ms
// at full density, 74 ms within this budget), each canvas's backing store.
const AUTO_TOUCH_POINT_LIMIT = 350_000;
const AUTO_TOUCH_CANVAS_PIXELS = 1_100_000;
// A saved map's photo is faded so it is not taken for the live map. Room
// colors and the shapes over it keep their colour.
const SAVED_MAP_SATURATION = 0.35;

export class RendererController {
  readonly #sceneCanvas: HTMLCanvasElement;
  readonly #overlayCanvas: HTMLCanvasElement;
  readonly #callbacks: RendererCallbacks;
  readonly #points = new RendererGl();
  readonly #view: RendererCamera;
  readonly #modules: RendererModules;
  readonly #raster: FallbackRaster;
  readonly #overlay: RendererOverlay;
  /** The latest state, with the robot where the pose motion draws it. */
  #state: WorkspaceState | null = null;
  #stored: WorkspaceState | null = null;
  #motion: PoseMotion | null = null;
  #unwatchMotion: (() => void) | null = null;
  #scene: SceneModel | null = null;
  #sceneContext: string | null = null;
  #admittedScene: SceneModel | null = null;
  #admittedContext: string | null = null;
  #upload: GpuUpload | null = null;
  #frame: number | null = null;
  // What the next frame redraws. A frame that only advances an upload leaves
  // the 2D canvas alone; one that only moves the cursor leaves the scene.
  #sceneDirty = false;
  #overlayDirty = false;
  #layersFrame: number | null = null;
  #resizeObserver: ResizeObserver;
  #mode: RendererDiagnostics["mode"] = "unavailable";
  #modeReported = false;
  #contextGeneration = 0;
  #renderedPoints = 0;
  readonly #touch = window.matchMedia("(any-pointer: coarse)").matches;
  readonly #governor = new FrameGovernor(this.#touch);
  /** The view-projection the scene was last drawn with. */
  readonly #drawnMatrix = new Float32Array(16);
  #disposed = false;
  #cameraFollow: import("./camera-follow").CameraFollowController | null = null;
  #surfaceGeometry: import("./surface-geometry").SurfaceGeometry | null = null;
  #geometry: import("./overlay-geometry").OverlayGeometry | null = null;
  /** undefined until the robot chunk and a context are here, null when its program fails. */
  #robotMesh: import("./robot-model").RobotMesh | null | undefined;
  #pendingFollow: {
    readonly pose: PoseModel | null;
    readonly mode: "off" | "follow" | "ride";
    readonly reducedMotion: boolean;
  } | null = null;
  #reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    sceneCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    callbacks: RendererCallbacks = {},
  ) {
    this.#sceneCanvas = sceneCanvas;
    this.#overlayCanvas = overlayCanvas;
    this.#callbacks = callbacks;
    const requestRender = (): void => this.requestRender();
    this.#view = new RendererCamera(sceneCanvas, {
      scene: () => this.#scene,
      state: () => this.#state,
      requestRender,
      onCamera: callbacks.onCamera,
      onCameraPreferences: callbacks.onCameraPreferences,
    });
    this.#modules = new RendererModules(callbacks, { disposed: () => this.#disposed, requestRender });
    this.#raster = new FallbackRaster(this.#view, {
      scene: () => this.#scene,
      active: () => !this.#disposed && this.#state?.pageActive === true && this.#mode === "canvas2d",
      rendered: (points) => { this.#renderedPoints = points; },
      requestRender,
    });
    this.#overlay = new RendererOverlay(overlayCanvas, this.#view, this.#modules, this.#raster, {
      scene: () => this.#scene,
      state: () => this.#state,
      fallback: () => this.#mode === "canvas2d",
      robotInScene: () => this.#robot() !== null,
      pixelRatio: () => this.#pixelRatio(),
      requestRender: (scene) => this.requestRender(scene),
      scheduleLayers: () => this.#scheduleLayers(),
    });
    this.#sceneCanvas.addEventListener("webglcontextlost", this.#contextLost);
    this.#sceneCanvas.addEventListener("webglcontextrestored", this.#contextRestored);
    this.#initWebGl();
    this.#resizeObserver = new ResizeObserver(() => {
      // Layout is clean here, so frames use this size instead of measuring.
      this.#view.measureViewport();
      const previousThree = this.#view.homeThree;
      const previousTop = this.#view.homeTop;
      this.#view.updateHomeDistances();
      if (this.#view.fitActive
        && (previousThree !== this.#view.homeThree || previousTop !== this.#view.homeTop)) {
        this.#view.fit(false);
      } else {
        this.requestRender();
      }
    });
    this.#resizeObserver.observe(sceneCanvas);
  }

  get camera(): CameraState {
    return { ...this.#view.current };
  }

  setCamera(camera: CameraState, notify = true): void {
    this.#view.set(camera, notify);
  }

  cameraAfterPan(camera: CameraState, deltaX: number, deltaY: number, anchorX?: number, anchorY?: number): CameraState {
    return this.#view.afterPan(camera, deltaX, deltaY, anchorX, anchorY);
  }

  frameCircles(circles: readonly AreaCircle[]): void {
    this.#view.frameCircles(circles);
  }

  setCirclePreview(circles: readonly AreaCircle[] | null, capture?: CoordinateEditCapture): void {
    this.#overlay.setCirclePreview(circles, capture);
  }

  setPalette(palette: CanvasPalette): void {
    this.#overlay.setPalette(palette);
  }

  setCursor(point: MapPoint | null): void {
    this.#overlay.setCursor(point);
  }

  mapToScreen(point: MapPoint): MapPoint | null {
    return this.#view.mapToScreen(point);
  }

  offsetMapPoint(point: MapPoint, horizontalMeters: number, verticalMeters: number): MapPoint | null {
    return this.#view.offsetMapPoint(point, horizontalMeters, verticalMeters);
  }

  /** The layers chunk, once it has loaded. */
  get layers(): typeof import("./renderer-layers") | null {
    return this.#modules.layers;
  }

  screenToMap(clientX: number, clientY: number): MapPoint | null {
    return this.#view.screenToMap(clientX, clientY);
  }

  roomAt(clientX: number, clientY: number): string | null {
    const map = this.screenToMap(clientX, clientY);
    return map && this.#scene && this.#state ? roomAt(this.#scene, this.#state, map) : null;
  }

  async roomCandidatesAt(clientX: number, clientY: number): Promise<RoomIdentityResult> {
    const map = this.screenToMap(clientX, clientY);
    if (!map || !this.#scene || !this.#state) return { status: "unmatched" };
    return roomCandidatesAt(this.#scene, this.#state, map);
  }

  containsMapPoint(point: MapPoint): boolean {
    return this.#scene !== null && containsMapPoint(this.#scene, point);
  }

  fit(notify = true, view?: MapView): void {
    this.#view.fit(notify, view);
  }

  zoomAt(factor: number, clientX?: number, clientY?: number): void {
    this.#view.zoomAt(factor, clientX, clientY);
  }

  panBy(deltaX: number, deltaY: number): void {
    this.#view.panBy(deltaX, deltaY);
  }

  orbitBy(deltaX: number, deltaY: number): void {
    this.#view.orbitBy(deltaX, deltaY);
  }

  setState(state: WorkspaceState): void {
    if (this.#disposed) return;
    const previous = this.#state;
    const view = topView(state);
    const previousScene = this.#scene;
    const admittedBefore = this.#admittedScene;
    const admittedContextBefore = this.#admittedContext;
    this.#stored = state;
    this.#state = this.#posed(state, performance.now());
    if (!state.pageActive) {
      if (this.#frame !== null) window.cancelAnimationFrame(this.#frame);
      this.#frame = null;
      this.#governor.pause();
    }
    const scene = state.resources.scene.value;
    const holdingScene = state.dataMode === "live" && state.floor.readOnly && scene !== null && scene === this.#scene
      && state.owner?.userKey === previous?.owner?.userKey && state.selection.entryId === previous?.selection.entryId;
    const context = holdingScene ? this.#sceneContext : scene ? sceneContext(state) : null;
    const ownerChanged = Boolean(previous && (state.owner?.userKey !== previous.owner?.userKey
      || state.selection.entryId !== previous.selection.entryId));
    const cameraContextChanged = !holdingScene && context !== this.#sceneContext;
    if (cameraContextChanged || (previous && topView(previous) !== view)) this.#overlay.clearLabels();
    const liveKey = liveCameraKey(state);
    const liveCameraChanged = liveKey !== null && liveKey !== liveCameraKey(previous);
    this.#admittedScene = scene;
    this.#admittedContext = context;
    let rebasedPreferences: Partial<Record<MapView, CameraPreference>> | null = null;
    const uploadMatches = Boolean(this.#upload && this.#uploadIsCurrent(this.#upload));
    if (!state.pageActive) {
      if (scene === null || context !== this.#sceneContext || ownerChanged) this.#clearSceneOwnership();
      else {
        this.#cancelGpuUpload(true);
        this.#raster.cancel();
      }
    } else if (scene !== null && context !== null) {
      // A held scene keeps its admitted context. Let its upload finish (or
      // materialize it again) while verification waits for live geometry.
      const sceneContextKey = context;
      const targetChanged = scene !== admittedBefore || sceneContextKey !== admittedContextBefore;
      const currentUpload = this.#upload;
      const frontNeedsMaterialization = this.#mode === "webgl2" && !currentUpload
        && this.#points.initializedPoints < scene.total;
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
      // Finish a same-context back upload before starting the latest
      // replacement; a busy stream must not repeatedly reset its frontier.
      if (!(advanced || currentUpload?.staging && uploadMatches) && (frontNeedsMaterialization || uploadChanged || targetChanged
        || scene !== this.#scene || sceneContextKey !== this.#sceneContext)) {
        const sameSceneContext = this.#scene !== null && this.#sceneContext === sceneContextKey;
        const compatible = sameSceneContext && samePointLayout(this.#scene!, scene);
        const publishedFrontComplete = Boolean(this.#scene && this.#points.initializedPoints >= this.#scene.total);
        const publishedSuccessorBlocks = !currentUpload && compatible && publishedFrontComplete
          ? validDeltaBlocks(scene, this.#scene?.revision ?? -1)
          : null;
        this.#cancelGpuUpload(false);
        if (this.#mode === "webgl2") {
          // A live map can grow or change its point counts without changing
          // floor/session. Keep its complete published frame while the new
          // layout uploads, just as for a compatible pixel update. A different
          // scene context still replaces the front immediately.
          if (compatible || (sameSceneContext && publishedFrontComplete)) {
            if (publishedSuccessorBlocks !== null) {
              this.#startGpuUpload(
                scene, sceneContextKey, state, true, this.#scene,
                "copy", publishedSuccessorBlocks,
              );
            } else {
              this.#startGpuUpload(scene, sceneContextKey, state, true, this.#scene);
            }
          } else {
            this.#cancelGpuUpload(true);
            this.#scene = scene;
            this.#sceneContext = sceneContextKey;
            rebasedPreferences = this.#installScene(
              scene,
              sameSceneContext && !this.#view.fitActive,
              previousScene,
              sameSceneContext,
              previous ? topView(previous) : null,
            );
            this.#startGpuUpload(scene, sceneContextKey, state, false, previousScene);
          }
        } else {
          this.#scene = scene;
          this.#sceneContext = sceneContextKey;
          rebasedPreferences = this.#installScene(
            scene,
            sameSceneContext && !this.#view.fitActive,
            previousScene,
            sameSceneContext,
            previous ? topView(previous) : null,
          );
        }
      }
    } else if (this.#scene !== null || this.#upload !== null || this.#points.stagingBuffer !== null) {
      this.#clearSceneOwnership();
    }
    if (!previous || previous.quality !== state.quality) this.#governor.reset(qualityScale(state.quality));
    // Leaving the area review gives back the camera the user had before it
    // framed the area (map-surfaces.md §5): live when Draw follows, else as
    // the top view's saved preference, so the 3D view is untouched.
    const leftReview = previous?.workflow === "areaReview" && state.workflow !== "areaReview";
    let published = false;
    if (leftReview && this.#beforeReview) {
      const { camera, fit } = this.#beforeReview;
      this.#beforeReview = null;
      // Leaving a forced top view reads preferences again below. Carry the
      // restored camera into that read instead of the review's framed state.
      rebasedPreferences = { ...rebasedPreferences, top: this.#view.preferenceOf(camera, fit) };
      if (view === "top") {
        this.#view.current = camera;
        this.#view.fitActive = fit;
        // The review can change the canvas size (especially on phones). Its
        // resize lands while framing has disabled fit, so a saved fit camera
        // may carry the old viewport's distance. Refit against the current
        // viewport; manual cameras keep their exact saved distance.
        if (fit) this.#view.fit(false, view);
        this.#view.notify();
        published = true;
      } else {
        this.#callbacks.onCameraPreferences?.({ top: this.#view.preferenceOf(camera, fit) });
      }
    }
    // Entering or leaving a workflow that looks straight down re-reads the
    // view's preference, as a view change does.
    const enteredTop = !forcesTop(previous) && forcesTop(state);
    const leftTop = forcesTop(previous) && !forcesTop(state);
    if (!previous || previous.view !== state.view || enteredTop || leftTop
      || (!holdingScene && (cameraContextChanged || liveCameraChanged))) {
      this.#view.applyPreferred(view, state, rebasedPreferences);
    }
    if (previous?.workflow !== "areaReview" && state.workflow === "areaReview" && state.draw.circles.length) {
      this.#beforeReview = { camera: this.#view.current, fit: this.#view.fitActive };
      this.#view.frameCircles(state.draw.circles);
      published = true;
    }
    if (state.workflow === "draw"
      && previous?.draw.zoomPercent !== state.draw.zoomPercent
      && Math.round(this.#view.homeTop / this.#view.current.distance * 100) !== state.draw.zoomPercent) {
      this.#view.current = {
        ...this.#view.current,
        orthographic: true,
        pitch: Math.PI / 2 - 0.018,
        distance: this.#view.homeTop * 100 / state.draw.zoomPercent,
      };
      this.#view.fitActive = state.draw.zoomPercent === 100
        && Math.abs(this.#view.current.targetX - this.#view.homeTargetX) < 0.001
        && Math.abs(this.#view.current.targetZ - this.#view.homeTargetZ) < 0.001
        && Math.abs(angle(this.#view.current.yaw)) < 0.001;
    }
    // Publish only the final effective camera. Its percentage also updates the
    // draw control; echoing that rounded percentage must not move the camera.
    if (!published && (rebasedPreferences || enteredTop || liveCameraChanged)) this.#view.notify();
    this.requestRender();
  }

  #beforeReview: { readonly camera: CameraState; readonly fit: boolean } | null = null;

  /** Draws the robot where `motion` puts it on each frame, between store updates. */
  setMotion(motion: PoseMotion | null): void {
    this.#unwatchMotion?.();
    this.#motion = motion;
    this.#unwatchMotion = motion?.subscribe(() => this.#requestFrame()) ?? null;
  }

  /** `pose` where the motion draws it at `now`, when the motion is on that pose's map. */
  #live(pose: PoseModel | null, now: number): PoseModel | null {
    const live = pose && this.#motion?.at(now);
    return live && live.mapSessionKey === pose.mapSessionKey ? live : pose;
  }

  #posed(state: WorkspaceState, now: number): WorkspaceState {
    const pose = state.resources.pose;
    const live = this.#live(pose.value, now);
    return live === pose.value ? state : { ...state, resources: { ...state.resources, pose: { ...pose, value: live } } };
  }

  /** Follow loads its camera animation controller only after the user enables it. */
  updateFollow(pose: PoseModel | null, mode: "off" | "follow" | "ride", reducedMotion = this.#reducedMotion): void {
    if (mode === "off") {
      this.#pendingFollow = null;
      this.#cameraFollow?.cancel(true);
      return;
    }
    this.#pendingFollow = { pose, mode, reducedMotion };
    if (this.#cameraFollow) {
      this.#cameraFollow.update(this.#live(pose, performance.now()), mode, reducedMotion);
      return;
    }
    if (this.#modules.cameraFollowStatus !== "idle") return;
    this.#modules.setStatus("camera-follow", "loading");
    void this.#modules.loadCameraFollow().then(({ CameraFollowController }) => {
      if (this.#disposed) return;
      this.#modules.setStatus("camera-follow", "ready");
      this.#cameraFollow = new CameraFollowController({
        state: () => this.#state,
        camera: () => this.#view.current,
        setCamera: (camera) => { this.#view.current = camera; },
        fitActive: () => this.#view.fitActive,
        worldForMeters: (x, y) => this.#view.worldForMeters(x, y),
        radius: () => this.#view.radius,
        setFitActive: (active) => { this.#view.fitActive = active; },
        requestRender: () => this.requestRender(),
        notifyCamera: () => this.#view.notify(),
        disposed: () => this.#disposed,
      });
      const pending = this.#pendingFollow;
      if (pending) this.#cameraFollow.update(this.#live(pending.pose, performance.now()), pending.mode, pending.reducedMotion);
    }).catch(() => {
      if (this.#disposed) return;
      this.#pendingFollow = null;
      this.#modules.setStatus("camera-follow", "failed");
    });
  }

  /** Gesture cancellation keeps the camera where the user took control. */
  cancelFollow(restore: boolean): void {
    this.#pendingFollow = null;
    this.#cameraFollow?.cancel(restore);
  }

  #initWebGl(): void {
    try {
      this.#points.init(this.#sceneCanvas);
      this.#setMode("webgl2");
      this.#contextGeneration += 1;
    } catch {
      this.#releaseWebGl();
      this.#initFallback();
    }
  }

  #clearSceneOwnership(): void {
    this.#cancelGpuUpload(true);
    this.#raster.cancel();
    this.#points.deleteFrontBuffer();
    this.#points.deleteStagingBuffer();
    this.#scene = null;
    this.#sceneContext = null;
    this.#renderedPoints = 0;
    this.#points.initializedPoints = 0;
    this.#overlay.clearLabels();
    this.#surfaceGeometry?.clearDetail();
  }

  #cancelGpuUpload(clearPartialFront: boolean): void {
    const upload = this.#upload;
    if (!upload) return;
    this.#upload = null;
    if (!upload.staging && clearPartialFront && this.#points.buffer === upload.buffer) {
      this.#points.deleteFrontBuffer();
      this.#scene = null;
      this.#sceneContext = null;
      this.#renderedPoints = 0;
      this.#points.initializedPoints = 0;
    }
  }

  #startGpuUpload(
    scene: SceneModel,
    context: string,
    state: WorkspaceState,
    staging: boolean,
    previousScene: SceneModel | null,
    seed: "scene" | "copy" = "scene",
    dirtyBlocks: readonly number[] = [],
  ): void {
    if (!this.#points.gl || this.#mode !== "webgl2" || !state.pageActive || this.#disposed) return;
    const buffer = this.#points.uploadBuffer(staging, scene.total * 8, seed === "scene");
    if (!buffer) {
      this.#transitionToFallback();
      return;
    }
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
      frontierBytes: 0,
      dirtyBlocks: [...dirtyBlocks],
      transitionBlocks: new Set(dirtyBlocks),
    };
    if (!staging) {
      this.#points.initializedPoints = 0;
      this.#renderedPoints = 0;
    }
    this.requestRender(true, false);
  }

  #advanceGpuUpload(
    scene: SceneModel,
    context: string,
    state: WorkspaceState,
    dirtyBlocks: readonly number[],
  ): boolean {
    const upload = this.#upload;
    if (!upload || upload.context !== context || upload.contextGeneration !== this.#contextGeneration
      || !samePointLayout(upload.scene, scene)
      || !advanceUpload(upload, scene, state.generation, dirtyBlocks)) return false;
    this.requestRender(true, false);
    return true;
  }

  #installScene(
    scene: SceneModel | null,
    preserveCamera = false,
    previousScene: SceneModel | null = null,
    rebasePreferences = false,
    preferenceView: MapView | null = null,
  ): Partial<Record<MapView, CameraPreference>> | null {
    this.#raster.cancel();
    if (!scene) {
      this.#renderedPoints = 0;
      this.#points.initializedPoints = 0;
      this.requestRender();
      return null;
    }
    return this.#view.installScene(scene, preserveCamera, previousScene, rebasePreferences, preferenceView);
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
        this.#installScene(scene, sameContext && !this.#view.fitActive, previousScene, sameContext,
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

  #uploadGpuChunk(): void {
    const upload = this.#upload;
    if (!upload || !this.#points.gl) return;
    if (!this.#uploadIsCurrent(upload)) {
      this.#cancelGpuUpload(true);
      return;
    }
    const byteLength = upload.scene.total * 8;
    if (!this.#points.uploadChunk(upload)) return this.#transitionToFallback();

    if (!this.#uploadIsCurrent(upload)) {
      this.#cancelGpuUpload(true);
      return;
    }
    if (upload.frontierBytes < byteLength || upload.dirtyBlocks.length > 0) {
      this.requestRender(true, false);
      return;
    }
    if (upload.staging) {
      const currentState = this.#state;
      if (!currentState) return;
      const currentView = topView(currentState);
      const previousBuffer = this.#points.buffer;
      this.#points.buffer = upload.buffer;
      this.#points.stagingBuffer = previousBuffer;
      this.#points.bindVertexBuffer(upload.buffer);
      this.#scene = upload.scene;
      this.#sceneContext = upload.context;
      this.#upload = null;
      this.#points.initializedPoints = upload.scene.total;
      this.#renderedPoints = upload.scene.total;
      const rebased = this.#installScene(
        upload.scene,
        // Input remains live on the published front during staging. Honor
        // the user's latest pan/zoom or Fit, rather than the upload's start.
        !this.#view.fitActive,
        upload.previousScene,
        true,
        currentView,
      );
      if (rebased) {
        this.#view.applyPreferred(currentView, currentState, rebased);
        this.#view.notify();
      }
      if (this.#admittedScene !== upload.scene && this.#state) this.setState(this.#state);
    } else {
      this.#upload = null;
      this.#scene = upload.scene;
      this.#sceneContext = upload.context;
      this.#points.initializedPoints = upload.scene.total;
      this.#renderedPoints = upload.scene.total;
    }
  }

  #uploadIsCurrent(upload: GpuUpload): boolean {
    const state = this.#state;
    if (!state) return false;
    return !this.#disposed && state.pageActive
      && (upload.scene === this.#admittedScene || upload.staging)
      && upload.revision === upload.scene.revision
      && upload.context === this.#admittedContext
      && upload.generation === state.generation
      && upload.contextGeneration === this.#contextGeneration
      && (upload.staging ? this.#points.stagingBuffer === upload.buffer : this.#points.buffer === upload.buffer);
  }

  #initFallback(): void {
    this.#raster.cancel();
    this.#setMode("canvas2d");
    if (!this.#raster.init()) {
      this.#setMode("unavailable");
      this.#callbacks.onProblem?.("renderer-unavailable");
    }
  }

  #setMode(mode: RendererDiagnostics["mode"]): void {
    if (this.#modeReported && this.#mode === mode) return;
    this.#mode = mode;
    this.#modeReported = true;
    this.#callbacks.onMode?.(mode);
  }

  /** Device pixels per CSS pixel for both canvases; never below CSS
   * resolution, so labels stay legible within the touch budget. */
  #pixelRatio(): number {
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    if (!this.#touch || this.#state?.quality !== "auto") return ratio;
    const area = Math.max(1, this.#view.viewport.width * this.#view.viewport.height);
    return Math.min(ratio, Math.max(1, Math.sqrt(AUTO_TOUCH_CANVAS_PIXELS / area)));
  }

  /** Sizes both canvases to the cached viewport; true when either changed. */
  #resize(): boolean {
    let resized = false;
    const bounds = this.#view.size();
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
    return resized;
  }

  requestRender(scene = true, overlay = true): void {
    this.#sceneDirty ||= scene;
    this.#overlayDirty ||= overlay;
    this.#requestFrame();
  }

  #requestFrame(): void {
    if (this.#frame !== null || this.#disposed || this.#state?.pageActive === false) return;
    this.#frame = window.requestAnimationFrame(this.#onFrame);
  }

  readonly #onFrame = (time: number): void => {
    this.#frame = null;
    if (this.#disposed || this.#state?.pageActive === false) return;
    if (this.#governor.begin(time, this.#state?.quality === "auto" && this.#mode === "webgl2")) this.#sceneDirty = true;
    const moving = this.#move(time);
    const drawn = this.#sceneDirty || this.#overlayDirty ? this.#render() : null;
    if (this.#governor.end(time, drawn === true, drawn === null) || moving) this.#requestFrame();
  };

  /** Moves the robot, and a camera following it, to where the motion is at `time`. */
  #move(time: number): boolean {
    const stored = this.#stored;
    if (!stored || !this.#motion || !canShowExactPose(stored)) return false;
    const posed = this.#posed(stored, time);
    if (posed.resources.pose.value === this.#state?.resources.pose.value) return false;
    this.#state = posed;
    this.#overlayDirty = true;
    // The robot's mesh is part of the scene; the 2D canvas draws it otherwise.
    if (this.#robot()) this.#sceneDirty = true;
    const follow = this.#pendingFollow;
    if (follow) this.#cameraFollow?.update(posed.resources.pose.value, follow.mode, follow.reducedMotion);
    return true;
  }

  /** Draws what is dirty; true when that drew the scene from a camera that moved. */
  #render(): boolean {
    let scene = this.#sceneDirty;
    let overlay = this.#overlayDirty;
    this.#sceneDirty = false;
    this.#overlayDirty = false;
    this.#uploadGpuChunk();
    if (this.#resize()) scene = overlay = true;
    const matrix = this.#view.cameraMatrix(this.#view.current, this.#view.matrix);
    const moved = scene && matrix.some((value, index) => value !== this.#drawnMatrix[index]);
    if (moved) this.#drawnMatrix.set(matrix);
    const geometry = this.#overlayGeometry();
    if (scene && this.#mode === "webgl2") this.#renderWebGl(geometry);
    else if (scene) this.#renderFallback(geometry);
    if (overlay) this.#overlay.render(geometry);
    return moved;
  }

  /** The floor-plane shapes for this frame; null until their chunk and a scene are here. */
  #overlayGeometry(): import("./overlay-geometry").OverlayGeometry | null {
    const layers = this.#modules.layers;
    if (!layers || !this.#scene || !this.#state) return null;
    if (!this.#geometry) {
      // A context that cannot build the programs leaves the shapes to Canvas 2D.
      try {
        this.#geometry = new layers.OverlayGeometry(this.#points.gl);
      } catch {
        this.#geometry = new layers.OverlayGeometry(null);
      }
    }
    this.#geometry.update(this.#scene, this.#state, this.#overlay.palette);
    return this.#geometry;
  }

  #renderWebGl(geometry: import("./overlay-geometry").OverlayGeometry | null): void {
    const gl = this.#points.gl;
    if (!gl) return;
    const { width, height } = this.#sceneCanvas;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    this.#drawScenePoints(gl, geometry !== null && roomColours(this.#state));
    const camera = this.#view.current;
    geometry?.draw(this.#view.matrix, width, height, this.#pixelRatio(),
      height / (2 * camera.distance * (camera.orthographic ? 1 : Math.tan(PERSPECTIVE_FIELD_OF_VIEW / 2))));
    const pose = this.#state && canShowExactPose(this.#state) ? this.#state.resources.pose.value : null;
    const robot = this.#robot();
    const world = pose?.position && this.#view.worldOfMeters(pose.position[0], pose.position[1]);
    if (robot && world && typeof pose?.heading === "number") {
      robot.draw(this.#view.matrix, world[0], world[1], pose.heading,
        this.#view.viewport.height / (2 * (camera.orthographic ? camera.distance : Math.tan(PERSPECTIVE_FIELD_OF_VIEW / 2))),
        this.#overlay.palette.accent);
    }
  }

  /**
   * The robot drawn in the scene, or null while the 2D overlay draws it:
   * before its chunk loads, without WebGL, in forced colours or when its
   * program fails.
   */
  #robot(): import("./robot-model").RobotMesh | null {
    const gl = this.#points.gl;
    const module = this.#modules.robot;
    if (this.#mode !== "webgl2" || !gl || !module || this.#overlay.palette.forced) return null;
    if (this.#robotMesh === undefined) {
      try {
        this.#robotMesh = new module.RobotMesh(gl);
      } catch {
        this.#robotMesh = null;
      }
    }
    return this.#robotMesh;
  }

  /** Room colors replace the photo once the chunk that draws them is here. */
  #drawScenePoints(gl: WebGL2RenderingContext, roomColours: boolean): void {
    const scene = this.#scene;
    const { buffer, vertexArray } = this.#points;
    if (!scene || !this.#points.ready || !buffer || !vertexArray) {
      this.#setSurfaceNeeded(false);
      return;
    }
    if (roomColours) {
      this.#setSurfaceNeeded(false);
      this.#renderedPoints = 0;
      return;
    }
    const initializedPoints = Math.min(scene.total, this.#points.initializedPoints);
    const saturation = this.#state && savedMapPosition(this.#state) ? SAVED_MAP_SATURATION : 1;
    const cellPixels = scene.metadata.metersPerCell * this.#view.viewport.height
      / (2 * this.#view.current.distance * (this.#view.current.orthographic ? 1 : Math.tan(PERSPECTIVE_FIELD_OF_VIEW / 2)));
    const surfaceNeeded = this.#state?.optionalUiReady === true && cellPixels > 2.5;
    const surfaceSupported = Boolean(scene.tileIndex || scene.total <= AUTO_TOUCH_POINT_LIMIT);
    this.#setSurfaceNeeded(surfaceNeeded, surfaceSupported);
    if (surfaceNeeded && surfaceSupported && this.#modules.surfaceStatus === "idle") this.#modules.loadSurface();
    if (surfaceNeeded && surfaceSupported && this.#modules.surface && this.#modules.surfaceStatus === "ready") {
      try {
        this.#surfaceGeometry ??= new this.#modules.surface.SurfaceGeometry(gl, this.#callbacks.onSurfaceDetail);
        this.#renderedPoints = this.#surfaceGeometry.draw({ scene, matrix: this.#view.matrix,
          buffer, vertexArray, initializedPoints,
          qualityScale: this.#governor.scale,
          adaptiveQuality: this.#state?.quality === "auto",
          maxVisiblePoints: this.#touch && this.#state?.quality === "auto" ? AUTO_TOUCH_POINT_LIMIT : null,
          camera: this.#view.current, saturation });
        return;
      } catch {
        this.#surfaceGeometry?.clearDetail();
        this.#surfaceGeometry?.dispose();
        this.#surfaceGeometry = null;
        this.#modules.setStatus("surface-geometry", "failed");
      }
    }
    const auto = this.#state?.quality === "auto";
    const step = Math.max(
      auto ? this.#governor.stride(initializedPoints) : Math.ceil(1 / this.#governor.scale),
      this.#touch && auto ? Math.ceil(initializedPoints / AUTO_TOUCH_POINT_LIMIT) : 1,
    );
    this.#renderedPoints = this.#points.drawPoints(scene, this.#view.matrix,
      this.#sceneCanvas.width, this.#sceneCanvas.height, step, this.#pixelRatio(), saturation);
  }

  #renderFallback(geometry: import("./overlay-geometry").OverlayGeometry | null): void {
    const scene = this.#scene;
    if (this.#mode !== "canvas2d" || !scene || (geometry && roomColours(this.#state))) {
      this.#raster.cancel();
      this.#renderedPoints = 0;
      return;
    }
    this.#raster.update(scene);
  }

  #setSurfaceNeeded(needed: boolean, supported = true): void {
    if (!needed || !supported) this.#surfaceGeometry?.clearDetail();
    this.#modules.setSurfaceNeeded(needed, supported);
  }

  #scheduleLayers(): void {
    if (this.#modules.layersStatus !== "idle" || this.#layersFrame !== null || this.#disposed) return;
    // Let the late-admitted map get one paint opportunity before requesting
    // its outlines and labels (the bounded no-map UI fallback may have fired).
    this.#layersFrame = window.requestAnimationFrame(() => {
      this.#layersFrame = null;
      const state = this.#state;
      if (!this.#disposed && state?.pageActive && layersNeeded(state, this.#scene)) this.#modules.loadLayers();
    });
  }

  diagnostics(): RendererDiagnostics {
    return {
      mode: this.#mode,
      contextGeneration: this.#contextGeneration,
      sceneRevision: this.#scene?.revision ?? null,
      sourcePoints: this.#scene?.total ?? 0,
      renderedPoints: this.#renderedPoints,
      frameMs: Math.round(this.#governor.frameMs * 100) / 100,
      detailScale: this.#governor.scale,
      cameraDistance: this.#view.current.distance,
      fitDistance: this.#view.current.orthographic ? this.#view.homeTop : this.#view.homeThree,
      fitActive: this.#view.fitActive,
      topPixelsPerMeter: Math.min(this.#view.viewport.height, this.#view.viewport.width * 5) / (2 * this.#view.current.distance),
    };
  }

  readonly #contextLost = (event: Event): void => {
    event.preventDefault();
    this.#transitionToFallback();
  };

  readonly #contextRestored = (): void => {
    const previousScene = this.#scene;
    const previousContext = this.#sceneContext;
    this.#raster.cancel();
    this.#releaseWebGl();
    this.#initWebGl();
    const scene = this.#admittedScene;
    const context = this.#admittedContext;
    const state = this.#state;
    if (this.#mode === "webgl2" && scene && context && state?.pageActive) {
      const sameContext = previousScene !== null && previousContext === context;
      this.#points.deleteFrontBuffer();
      this.#scene = scene;
      this.#sceneContext = context;
      let rebased: Partial<Record<MapView, CameraPreference>> | null = null;
      if (scene !== previousScene) {
        rebased = this.#installScene(
          scene,
          sameContext && !this.#view.fitActive,
          previousScene,
          sameContext,
          topView(state),
        );
      }
      this.#startGpuUpload(scene, context, state, false, previousScene);
      if (rebased) {
        const view = topView(state);
        this.#view.applyPreferred(view, state, rebased);
        this.#view.notify();
      }
    }
    this.requestRender();
  };

  #releaseWebGl(): void {
    this.#cancelGpuUpload(false);
    if (!this.#disposed) this.#surfaceGeometry?.clearDetail();
    this.#surfaceGeometry?.dispose();
    this.#surfaceGeometry = null;
    this.#geometry?.dispose();
    this.#geometry = null;
    this.#robotMesh?.dispose();
    this.#robotMesh = undefined;
    this.#setSurfaceNeeded(false);
    if (this.#modules.surface && this.#modules.surfaceStatus === "failed") this.#modules.surfaceStatus = "ready";
    this.#points.release();
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
    this.#pendingFollow = null;
    this.#unwatchMotion?.();
    this.#modules.dispose();
    this.#cameraFollow?.dispose();
    if (this.#layersFrame !== null) window.cancelAnimationFrame(this.#layersFrame);
    this.#releaseWebGl();
    this.#raster.dispose();
    this.#overlay.dispose();
    this.#scene = null;
    this.#state = this.#stored = null;
    this.#admittedScene = null;
    this.#admittedContext = null;
  }
}
