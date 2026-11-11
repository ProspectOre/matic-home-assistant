import type { ChunkStatus } from "./lazy-chunk";

export type RendererModuleName = "renderer-layers" | "draw-overlays" | "camera-follow" | "surface-geometry";
export type RendererModuleStatus = ChunkStatus;
const OPTIONAL_MODULE_TIMEOUT_MS = 20_000;

interface OptionalModuleLoad {
  timer: number | null;
  settled: boolean;
  reject: (error: Error) => void;
}

export interface ModuleCallbacks {
  readonly onModuleStatus?: (module: RendererModuleName, status: RendererModuleStatus) => void;
  readonly loadRendererLayers?: () => Promise<typeof import("./renderer-layers")>;
  readonly loadDrawOverlays?: () => Promise<typeof import("./draw-overlays")>;
  readonly loadCameraFollow?: () => Promise<typeof import("./camera-follow")>;
  readonly loadSurfaceGeometry?: () => Promise<typeof import("./surface-geometry")>;
}

interface ModuleHost {
  readonly disposed: () => boolean;
  readonly requestRender: () => void;
}

/** The renderer's lazily loaded chunks and the status each reports. */
export class RendererModules {
  readonly #callbacks: ModuleCallbacks;
  readonly #host: ModuleHost;
  layers: typeof import("./renderer-layers") | null = null;
  layersStatus: RendererModuleStatus = "idle";
  drawOverlays: typeof import("./draw-overlays") | null = null;
  drawOverlaysStatus: RendererModuleStatus = "idle";
  cameraFollowStatus: RendererModuleStatus = "idle";
  surface: typeof import("./surface-geometry") | null = null;
  surfaceStatus: RendererModuleStatus = "idle";
  #surfaceNeeded = false;
  #surfaceSupported = true;
  #timeouts = new Map<RendererModuleName, OptionalModuleLoad>();

  constructor(callbacks: ModuleCallbacks, host: ModuleHost) {
    this.#callbacks = callbacks;
    this.#host = host;
  }

  loadLayers(): void {
    if (this.layersStatus !== "idle" || this.#host.disposed()) return;
    this.#load("renderer-layers", this.#callbacks.loadRendererLayers ?? (() => import("./renderer-layers")),
      (layers) => { this.layers = layers; });
  }

  loadDrawOverlays(): void {
    if (this.drawOverlaysStatus !== "idle" || this.#host.disposed()) return;
    this.#load("draw-overlays", this.#callbacks.loadDrawOverlays ?? (() => import("./draw-overlays")),
      (overlays) => { this.drawOverlays = overlays; });
  }

  loadSurface(): void {
    if (this.surfaceStatus !== "idle" || this.#host.disposed()) return;
    this.#load("surface-geometry", this.#callbacks.loadSurfaceGeometry ?? (() => import("./surface-geometry")),
      (module) => { this.surface = module; });
  }

  loadCameraFollow(): Promise<typeof import("./camera-follow")> {
    return this.#loadOptional("camera-follow", this.#callbacks.loadCameraFollow ?? (() => import("./camera-follow")));
  }

  setStatus(module: RendererModuleName, status: RendererModuleStatus): void {
    if (module === "renderer-layers") this.layersStatus = status;
    else if (module === "draw-overlays") this.drawOverlaysStatus = status;
    else if (module === "camera-follow") this.cameraFollowStatus = status;
    else this.surfaceStatus = status;
    this.#callbacks.onModuleStatus?.(module, module === "surface-geometry"
      ? !this.#surfaceNeeded ? "idle" : this.#surfaceSupported ? status : "failed" : status);
  }

  setSurfaceNeeded(needed: boolean, supported: boolean): void {
    if (this.#surfaceNeeded === needed && this.#surfaceSupported === supported) return;
    this.#surfaceNeeded = needed;
    this.#surfaceSupported = supported;
    this.#callbacks.onModuleStatus?.("surface-geometry", !needed ? "idle" : supported ? this.surfaceStatus : "failed");
  }

  #load<T>(module: RendererModuleName, load: () => Promise<T>, accept: (value: T) => void): void {
    this.setStatus(module, "loading");
    void this.#loadOptional(module, load).then((value) => {
      if (this.#host.disposed()) return;
      accept(value);
      this.setStatus(module, "ready");
      this.#host.requestRender();
    }, () => {
      if (!this.#host.disposed()) this.setStatus(module, "failed");
    });
  }

  #loadOptional<T>(module: RendererModuleName, load: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Native import completion callbacks retain this small record and the
      // timer map, never the renderer controller. Disposal settles the outer
      // promise even if the browser keeps a failed/hung module fetch pending.
      const activeLoads = this.#timeouts;
      const record: OptionalModuleLoad = {
        timer: null,
        settled: false,
        reject: (error) => reject(error),
      };
      const settle = (error: unknown, value?: T): void => {
        if (record.settled) return;
        record.settled = true;
        if (record.timer !== null) window.clearTimeout(record.timer);
        if (activeLoads.get(module) === record) activeLoads.delete(module);
        if (error !== null) reject(error);
        else resolve(value as T);
      };
      record.reject = (error) => settle(error);
      activeLoads.set(module, record);
      record.timer = window.setTimeout(() => {
        settle(new Error("renderer-module-timeout"));
      }, OPTIONAL_MODULE_TIMEOUT_MS);
      Promise.resolve().then(load).then(
        (value) => settle(null, value),
        (error: unknown) => settle(error),
      );
    });
  }

  dispose(): void {
    for (const [module, record] of this.#timeouts) {
      if (record.timer !== null) window.clearTimeout(record.timer);
      record.timer = null;
      if (this.#timeouts.get(module) === record) this.#timeouts.delete(module);
      record.reject(new Error("renderer-module-disposed"));
    }
  }
}
