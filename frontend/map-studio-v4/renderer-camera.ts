import { PERSPECTIVE_FIELD_OF_VIEW, sceneGeometryBounds, perspectiveBoundsFitDistance, multiply, perspective, orthographic, lookAt } from "./renderer-math";
import { clamp } from "./shared-primitives";
import { cameraPreferences } from "./camera-preferences";
import type { AreaCircle, SceneModel } from "./backend-contracts";
import type { CameraPreference, MapView, WorkspaceState } from "./contracts";
import { topView } from "./state";

export interface MapPoint {
  readonly x: number;
  readonly y: number;
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

export interface ViewportBounds {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

export interface CameraHost {
  readonly scene: () => SceneModel | null;
  readonly state: () => WorkspaceState | null;
  readonly requestRender: () => void;
  readonly onCamera?: ((camera: CameraState, zoomPercent: number, origin?: CameraOrigin) => void) | undefined;
  readonly onCameraPreferences?: ((cameras: Readonly<Partial<Record<MapView, CameraPreference>>>) => void) | undefined;
}

export const angle = (value: number): number => {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
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

const cameraPreferenceIsFit = (view: MapView, preference: CameraPreference | undefined): boolean => {
  if (!preference) return true;
  const top = view === "top";
  return Math.abs(preference.zoom - 1) < 0.001
    && Math.abs(preference.targetX) < 0.001
    && Math.abs(preference.targetZ) < 0.001
    && Math.abs(angle(preference.yaw - (top ? 0 : -Math.PI / 4))) < 0.001
    && (top || Math.abs(preference.pitch - 1.12) < 0.001);
};

const cameraPreferenceIsHomeFit = (
  view: MapView,
  preference: CameraPreference | undefined,
  homeTargetX: number,
  homeTargetZ: number,
): boolean => Boolean(preference
  && (Math.abs(preference.targetX - homeTargetX) < 0.001
    && Math.abs(preference.targetZ - homeTargetZ) < 0.001
    || cameraPreferenceIsFit(view, preference))
  && cameraPreferenceIsFit(view, { ...preference, targetX: 0, targetZ: 0 }));

const rebaseCameraPreferences = (
  cameras: Readonly<Partial<Record<MapView, CameraPreference>>>,
  previousScene: SceneModel,
  nextScene: SceneModel,
  previousHome: Readonly<Record<MapView, number>>,
  nextHome: Readonly<Record<MapView, number>>,
  previousHomeTarget: Readonly<{ x: number; z: number }>,
  nextHomeTarget: Readonly<{ x: number; z: number }>,
): Partial<Record<MapView, CameraPreference>> => Object.fromEntries(
  Object.entries(cameras).map(([view, camera]) => {
    const mapView = view as MapView;
    if (!camera) return [view, camera];
    // A fitted camera follows the geometry center and remains fitted when the
    // admitted floor's actual bounds move. Legacy fit preferences use (0, 0);
    // current ones store the prior geometry-centered home target.
    if (cameraPreferenceIsFit(mapView, camera)
      || cameraPreferenceIsHomeFit(mapView, camera, previousHomeTarget.x, previousHomeTarget.z)) {
      return [view, {
        ...camera,
        zoom: 1,
        targetX: nextHomeTarget.x,
        targetZ: nextHomeTarget.z,
      }];
    }
    const [targetX, targetZ] = rebaseTarget(camera.targetX, camera.targetZ, previousScene, nextScene);
    const oldHome = previousHome[mapView];
    const newHome = nextHome[mapView];
    const zoom = oldHome > 0 && newHome > 0
      ? camera.zoom * newHome / oldHome
      : camera.zoom;
    return [view, { ...camera, targetX, targetZ, zoom }];
  }),
) as Partial<Record<MapView, CameraPreference>>;

/** The camera, its fit distances, and the projection between map and screen. */
export class RendererCamera {
  readonly #canvas: HTMLCanvasElement;
  readonly #host: CameraHost;
  current: CameraState = {
    yaw: -Math.PI / 4,
    pitch: 0.82,
    distance: 12,
    targetX: 0,
    targetZ: 0,
    orthographic: false,
  };
  homeThree = 12;
  homeTop = 8;
  homeTargetX = 0;
  homeTargetZ = 0;
  radius = 4;
  fitActive = true;
  viewport: ViewportBounds = { width: 1, height: 1, left: 0, top: 0 };
  /** False until the canvas has been measured once. */
  #measured = false;
  /** The view-projection of the frame being drawn. */
  readonly matrix: Float32Array = new Float32Array(16);
  readonly #view = new Float32Array(16);
  readonly #projection = new Float32Array(16);
  readonly #scratch = new Float32Array(16);
  readonly #geometryBoundsCache = new WeakMap<SceneModel, ReturnType<typeof sceneGeometryBounds>>();

  constructor(canvas: HTMLCanvasElement, host: CameraHost) {
    this.#canvas = canvas;
    this.#host = host;
  }

  clampDistance(distance: number, top = this.current.orthographic): number {
    const home = top ? this.homeTop : this.homeThree;
    // Keep the gesture range while allowing every numeric tier on small or
    // elongated maps, and use the same bounds when restoring preferences.
    return clamp(distance,
      Math.min(Math.max(0.2, this.radius * 0.04), home / 10),
      Math.max(this.radius * 8, home));
  }

  #targetBounds(): { readonly x: number; readonly z: number } {
    const scene = this.#host.scene();
    const span = scene?.metadata.span;
    const meters = scene?.metadata.metersPerCell;
    if (!span || meters === undefined) return { x: this.radius, z: this.radius };
    return {
      x: Math.max(0.5, span[0] * meters * 0.55),
      z: Math.max(0.5, span[1] * meters * 0.55),
    };
  }

  set(camera: CameraState, notify = true): void {
    const target = this.#targetBounds();
    this.current = {
      yaw: angle(camera.yaw),
      pitch: camera.orthographic
        ? Math.PI / 2 - 0.018
        : clamp(camera.pitch, 0.18, 1.38),
      distance: this.clampDistance(camera.distance, camera.orthographic),
      targetX: clamp(camera.targetX, -target.x, target.x),
      targetZ: clamp(camera.targetZ, -target.z, target.z),
      orthographic: camera.orthographic,
    };
    this.fitActive = false;
    this.#host.requestRender();
    if (notify) this.notify();
  }

  afterPan(
    camera: CameraState,
    deltaX: number,
    deltaY: number,
    anchorX?: number,
    anchorY?: number,
  ): CameraState {
    const bounds = this.measureViewport();
    const startX = anchorX ?? bounds.left + bounds.width / 2;
    const startY = anchorY ?? bounds.top + bounds.height / 2;
    const start = this.#screenToMapForPan(startX, startY, camera);
    const end = this.#screenToMapForPan(startX + deltaX, startY + deltaY, camera);
    const target = this.#targetBounds();
    // Unproject both ends of the gesture onto the floor plane. This accounts
    // for perspective and pitch, where a fixed world-per-pixel scale can vary
    // dramatically between the foreground and horizon. Bound the result so
    // near-horizon drags cannot fling the camera across an entire map.
    const maxPan = Math.max(0.5, this.radius * 2);
    const rawX = start && end ? end.x - start.x : 0;
    const rawZ = start && end ? start.y - end.y : 0;
    const length = Math.hypot(rawX, rawZ);
    const scale = length > maxPan ? maxPan / length : 1;
    return {
      ...camera,
      targetX: clamp(
        camera.targetX + rawX * scale,
        -target.x,
        target.x,
      ),
      targetZ: clamp(
        camera.targetZ + rawZ * scale,
        -target.z,
        target.z,
      ),
    };
  }

  preferenceOf(camera: CameraState, fit: boolean, home = this.homeTop): CameraPreference {
    if (fit) return { yaw: camera.orthographic ? 0 : -Math.PI / 4,
      pitch: camera.orthographic ? Math.PI / 2 - 0.018 : 1.12, zoom: 1,
      targetX: this.homeTargetX, targetZ: this.homeTargetZ };
    return { yaw: camera.yaw, pitch: camera.pitch, zoom: home / camera.distance, targetX: camera.targetX, targetZ: camera.targetZ };
  }

  /** The world position of a map point in metres (the overlay's coordinate space). */
  worldForMeters(x: number, y: number): readonly [number, number] | null {
    const scene = this.#host.scene();
    if (!scene) return null;
    const world = this.#worldForCell(x / scene.metadata.metersPerCell - scene.metadata.origin[0], y / scene.metadata.metersPerCell - scene.metadata.origin[1]);
    return world ? [world[0], world[2]] : null;
  }

  /** Frames the circles' bounds in the top view with a 12 % margin and publishes the camera. */
  frameCircles(circles: readonly AreaCircle[]): void {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const circle of circles) {
      for (const [x, y] of [[circle.x - circle.radius, circle.y - circle.radius], [circle.x + circle.radius, circle.y + circle.radius]] as const) {
        const world = this.worldForMeters(x, y);
        if (!world) return;
        minX = Math.min(minX, world[0]); maxX = Math.max(maxX, world[0]);
        minZ = Math.min(minZ, world[1]); maxZ = Math.max(maxZ, world[1]);
      }
    }
    if (!Number.isFinite(minX)) return;
    const viewport = this.size();
    const aspect = Math.max(0.2, viewport.width / Math.max(1, viewport.height));
    const distance = Math.max((maxZ - minZ) / 2, (maxX - minX) / (2 * aspect)) * 1.12;
    this.set({
      yaw: 0,
      pitch: Math.PI / 2 - 0.018,
      distance,
      targetX: (minX + maxX) / 2,
      targetZ: (minZ + maxZ) / 2,
      orthographic: true,
    });
  }

  applyPreferred(
    view: MapView,
    state: WorkspaceState,
    rebasedPreferences: Partial<Record<MapView, CameraPreference>> | null = null,
  ): void {
    const top = view === "top";
    const home = top ? this.homeTop : this.homeThree;
    const preference = rebasedPreferences?.[view] ?? cameraPreferences(state)[view];
    if (!preference) {
      this.fit(false, view);
      return;
    }
    const target = this.#targetBounds();
    this.fitActive = cameraPreferenceIsHomeFit(view, preference, this.homeTargetX, this.homeTargetZ);
    this.current = {
      yaw: preference.yaw,
      pitch: top ? Math.PI / 2 - 0.018 : preference.pitch,
      distance: this.clampDistance(home / clamp(preference.zoom, 0.01, 100), top),
      targetX: clamp(preference.targetX, -target.x, target.x),
      targetZ: clamp(preference.targetZ, -target.z, target.z),
      orthographic: top,
    };
  }

  /** Fits or rebases the camera for a newly published scene; returns rebased preferences, if any. */
  installScene(
    scene: SceneModel,
    preserveCamera: boolean,
    previousScene: SceneModel | null,
    rebasePreferences: boolean,
    preferenceView: MapView | null,
  ): Partial<Record<MapView, CameraPreference>> | null {
    const meters = scene.metadata.metersPerCell;
    const bounds = this.#sceneGeometryBounds(scene).floor;
    const width = Math.max(1, bounds.maxX - bounds.minX + 1) * meters;
    const depth = Math.max(1, bounds.maxY - bounds.minY + 1) * meters;
    const previousHomeTarget = { x: this.homeTargetX, z: this.homeTargetZ };
    this.radius = Math.max(1, Math.hypot(width, depth) / 2);
    this.homeTargetX = -((bounds.minX + bounds.maxX) / 2 - (scene.metadata.span[0] - 1) / 2) * meters;
    this.homeTargetZ = ((bounds.minY + bounds.maxY) / 2 - (scene.metadata.span[1] - 1) / 2) * meters;
    const previousHome = { three: this.homeThree, top: this.homeTop } as const;
    this.updateHomeDistances();
    if (preserveCamera && previousScene) {
      this.set(rebaseCameraTarget(this.current, previousScene, scene), false);
    }
    else this.fit(false, preferenceView ?? undefined);
    const state = this.#host.state();
    if (rebasePreferences && previousScene && state) {
      const nextHome = { three: this.homeThree, top: this.homeTop } as const;
      const preferences = rebaseCameraPreferences(
        cameraPreferences(state),
        previousScene,
        scene,
        previousHome,
        nextHome,
        previousHomeTarget,
        { x: this.homeTargetX, z: this.homeTargetZ },
      );
      const effectiveView = preferenceView
        ?? (topView(state));
      const home = effectiveView === "top" ? this.homeTop : this.homeThree;
      preferences[effectiveView] = this.preferenceOf(this.current, false, home);
      this.#host.onCameraPreferences?.(preferences);
      return preferences;
    }
    return null;
  }

  updateHomeDistances(): void {
    const scene = this.#host.scene();
    if (!scene) return;
    const { floor: bounds, all: sceneBounds } = this.#sceneGeometryBounds(scene);
    const meters = scene.metadata.metersPerCell;
    const width = Math.max(1, bounds.maxX - bounds.minX + 1) * meters;
    const depth = Math.max(1, bounds.maxY - bounds.minY + 1) * meters;
    const viewport = this.size();
    const aspect = Math.max(0.2, viewport.width / Math.max(1, viewport.height));
    // A high three-quarter angle keeps a recognisable floor overview while
    // preserving the complete admitted scene footprint on first launch.
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minY + bounds.maxY) / 2;
    this.homeThree = perspectiveBoundsFitDistance({
      minX: -(sceneBounds.maxX - centerX) * meters,
      maxX: -(sceneBounds.minX - centerX) * meters,
      minZ: (sceneBounds.minY - centerZ) * meters,
      maxZ: (sceneBounds.maxY - centerZ) * meters,
      minHeight: sceneBounds.minHeight * meters,
      maxHeight: sceneBounds.maxHeight * meters,
    }, aspect, 1.12, -Math.PI / 4, 0.05);
    this.homeTop = Math.max(depth / 2, width / (2 * aspect)) * 1.12;
  }

  #sceneGeometryBounds(scene: SceneModel): ReturnType<typeof sceneGeometryBounds> {
    let bounds = this.#geometryBoundsCache.get(scene);
    if (!bounds) {
      bounds = sceneGeometryBounds(
        scene.buffer, scene.pointOffset, scene.floorCount, scene.total, scene.metadata.span,
      );
      this.#geometryBoundsCache.set(scene, bounds);
    }
    return bounds;
  }

  /** The canvas's size as the resize observer last reported it, measured once before its first report. */
  size(): ViewportBounds {
    return this.#measured ? this.viewport : this.measureViewport();
  }

  /**
   * Reads the canvas's box. Only the resize observer and input, which needs
   * the current position, measure; everything else uses the cached size.
   */
  measureViewport(): ViewportBounds {
    const bounds = this.#canvas.getBoundingClientRect();
    this.#measured = true;
    this.viewport = {
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      top: bounds.top,
    };
    return this.viewport;
  }

  /**
   * The camera's view-projection. Without `out` the result is a scratch
   * matrix, valid until the next call.
   */
  cameraMatrix(camera: CameraState = this.current, out: Float32Array = this.#scratch): Float32Array {
    const bounds = this.viewport;
    const aspect = Math.max(0.2, bounds.width / Math.max(1, bounds.height));
    const horizontal = Math.cos(camera.pitch) * camera.distance;
    lookAt(this.#view, camera.targetX + Math.sin(camera.yaw) * horizontal, Math.sin(camera.pitch) * camera.distance,
      camera.targetZ + Math.cos(camera.yaw) * horizontal, camera.targetX, 0, camera.targetZ);
    if (camera.orthographic) {
      orthographic(this.#projection, -camera.distance * aspect, camera.distance * aspect,
        -camera.distance, camera.distance, -this.radius * 4, this.radius * 4);
    } else {
      perspective(this.#projection, PERSPECTIVE_FIELD_OF_VIEW, aspect, 0.02, Math.max(60, this.radius * 12));
    }
    return multiply(out, this.#projection, this.#view);
  }

  #worldForCell(x: number, y: number, height = 0): readonly [number, number, number] | null {
    const scene = this.#host.scene();
    if (!scene) return null;
    return [
      -(x - (scene.metadata.span[0] - 1) / 2) * scene.metadata.metersPerCell,
      height * scene.metadata.metersPerCell,
      (y - (scene.metadata.span[1] - 1) / 2) * scene.metadata.metersPerCell,
    ];
  }

  projectCell(x: number, y: number, height = 0, clipToViewport = true, matrix = this.matrix,
    bounds: Pick<ViewportBounds, "width" | "height"> = this.viewport): MapPoint | null {
    const world = this.#worldForCell(x, y, height);
    return world && this.projectWorld(world[0], world[1], world[2], clipToViewport, matrix, bounds);
  }

  /** Projects a world position in metres to CSS pixels in the viewport. */
  projectWorld(worldX: number, worldY: number, worldZ: number, clipToViewport = true, matrix = this.matrix,
    bounds: Pick<ViewportBounds, "width" | "height"> = this.viewport): MapPoint | null {
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

  projectMeters(x: number, y: number, height = 0, clipToViewport = true, matrix = this.matrix): MapPoint | null {
    const scene = this.#host.scene();
    if (!scene) return null;
    const cellX = x / scene.metadata.metersPerCell - scene.metadata.origin[0];
    const cellY = y / scene.metadata.metersPerCell - scene.metadata.origin[1];
    return this.projectCell(cellX, cellY, height, clipToViewport, matrix);
  }

  mapToScreen(point: MapPoint): MapPoint | null {
    if (!this.#host.scene()) return null;
    const bounds = this.size();
    if (!bounds.width || !bounds.height) return null;
    return this.projectMeters(point.x, point.y, 0, false, this.cameraMatrix());
  }

  offsetMapPoint(point: MapPoint, horizontalMeters: number, verticalMeters: number): MapPoint | null {
    const projected = this.mapToScreen(point);
    if (!projected) return null;
    const bounds = this.viewport;
    const worldPerPixel = this.current.distance * 2 / bounds.height;
    return this.screenToMap(
      bounds.left + projected.x + horizontalMeters / worldPerPixel,
      bounds.top + projected.y + verticalMeters / worldPerPixel,
    );
  }

  screenToMap(clientX: number, clientY: number, camera: CameraState = this.current): MapPoint | null {
    const scene = this.#host.scene();
    if (!scene) return null;
    const bounds = this.measureViewport();
    if (!bounds.width || !bounds.height) return null;
    // Invert the floor-plane homography, including perspective division in 3D.
    const matrix = this.cameraMatrix(camera);
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

  #screenToMapForPan(clientX: number, clientY: number, camera: CameraState): MapPoint | null {
    const bounds = this.measureViewport();
    const centerY = bounds.top + bounds.height / 2;
    const center = this.screenToMap(clientX, centerY, camera);
    if (!center) return this.screenToMap(clientX, clientY, camera);
    const maxOffset = Math.max(0.5, Math.min(this.radius * 2, camera.distance * 4));
    const isSafe = (point: MapPoint | null): point is MapPoint => Boolean(point
      && Math.hypot(point.x - center.x, point.y - center.y) <= maxOffset);
    const direct = this.screenToMap(clientX, clientY, camera);
    if (isSafe(direct)) return direct;

    // A drag can begin above the floor-plane horizon, where no ground point
    // exists. Clamp that endpoint to the nearest safe point toward the view
    // center; this lets the same drag start moving once it crosses the horizon
    // without feeding an unbounded near-horizon intersection into the camera.
    let safeY = centerY;
    let unsafeY = clientY;
    let safePoint = center;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidateY = (safeY + unsafeY) / 2;
      const candidate = this.screenToMap(clientX, candidateY, camera);
      if (isSafe(candidate)) {
        safeY = candidateY;
        safePoint = candidate;
      } else {
        unsafeY = candidateY;
      }
    }
    return safePoint;
  }

  fit(notify = true, view?: MapView): void {
    const state = this.#host.state();
    const top = (view ?? (state ? topView(state) : "three")) === "top";
    this.current = {
      yaw: top ? 0 : -Math.PI / 4,
      pitch: top ? Math.PI / 2 - 0.018 : 1.12,
      distance: top ? this.homeTop : this.homeThree,
      targetX: this.homeTargetX,
      targetZ: this.homeTargetZ,
      orthographic: top,
    };
    this.fitActive = true;
    this.#host.requestRender();
    if (notify) this.notify();
  }

  zoomAt(factor: number, clientX?: number, clientY?: number): void {
    const before = clientX === undefined || clientY === undefined ? null : this.screenToMap(clientX, clientY);
    this.current = {
      ...this.current,
      distance: this.clampDistance(this.current.distance / factor),
    };
    this.fitActive = false;
    if (before && clientX !== undefined && clientY !== undefined) {
      const after = this.screenToMap(clientX, clientY);
      if (after) {
        this.current = {
          ...this.current,
          targetX: this.current.targetX - (before.x - after.x),
          targetZ: this.current.targetZ + (before.y - after.y),
        };
      }
    }
    this.#host.requestRender();
    this.notify(clientX, clientY);
  }

  panBy(deltaX: number, deltaY: number): void {
    this.set(this.afterPan(this.current, deltaX, deltaY));
  }

  orbitBy(deltaX: number, deltaY: number): void {
    if (this.current.orthographic) {
      this.panBy(deltaX, deltaY);
      return;
    }
    this.current = {
      ...this.current,
      yaw: angle(this.current.yaw + deltaX * 0.006),
      pitch: clamp(this.current.pitch - deltaY * 0.004, 0.18, 1.38),
    };
    this.fitActive = false;
    this.#host.requestRender();
    this.notify();
  }

  notify(clientX?: number, clientY?: number): void {
    const home = this.current.orthographic ? this.homeTop : this.homeThree;
    const bounds = clientX === undefined || clientY === undefined
      ? this.viewport
      : this.measureViewport();
    const origin = clientX === undefined || clientY === undefined || !bounds.width || !bounds.height
      ? undefined
      : {
        xPercent: clamp((clientX - bounds.left) / bounds.width * 100, 0, 100),
        yPercent: clamp((clientY - bounds.top) / bounds.height * 100, 0, 100),
      };
    this.#host.onCamera?.(
      { ...this.current },
      Math.round(home / this.current.distance * 100),
      origin,
    );
  }
}
