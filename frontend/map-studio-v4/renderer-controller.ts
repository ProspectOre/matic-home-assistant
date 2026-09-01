import type { AreaCircle, SceneModel, SceneRoom } from "./backend-contracts";
import type { MapQuality, MapView, WorkspaceState } from "./contracts";

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
  readonly onRoom?: (roomId: string) => void;
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
  #vertexArray: WebGLVertexArrayObject | null = null;
  #viewProjection: WebGLUniformLocation | null = null;
  #center: WebGLUniformLocation | null = null;
  #meters: WebGLUniformLocation | null = null;
  #pointPixels: WebGLUniformLocation | null = null;
  #maxPointPixels: WebGLUniformLocation | null = null;
  #state: WorkspaceState | null = null;
  #scene: SceneModel | null = null;
  #frame: number | null = null;
  #fallbackFrame: number | null = null;
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
  #renderedPoints = 0;
  #lastFrameMs = 0;
  #slowFrames = 0;
  #qualityScale = 1;
  #viewport = { width: 1, height: 1, left: 0, top: 0 };
  #disposed = false;

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
      this.requestRender();
    });
    this.#resizeObserver.observe(sceneCanvas);
  }

  get camera(): CameraState {
    return { ...this.#camera };
  }

  setState(state: WorkspaceState): void {
    if (this.#disposed) return;
    const previous = this.#state;
    this.#state = state;
    const scene = state.resources.scene.value;
    if (scene !== this.#scene) {
      this.#scene = scene;
      this.#installScene(scene);
    }
    if (!previous || previous.quality !== state.quality) {
      this.#qualityScale = qualityScale(state.quality);
      this.#slowFrames = 0;
    }
    const enteredDraw = previous?.workflow !== "draw" && state.workflow === "draw";
    const leftDraw = previous?.workflow === "draw" && state.workflow !== "draw";
    if (!previous || previous.view !== state.view || enteredDraw || leftDraw) {
      this.#camera = this.#preferredCamera(
        state.workflow === "draw" ? "top" : state.view,
        state,
      );
    }
    if (state.workflow === "draw" && previous?.draw.zoomPercent !== state.draw.zoomPercent) {
      this.#camera = {
        ...this.#camera,
        orthographic: true,
        pitch: Math.PI / 2 - 0.018,
        distance: this.#homeTop * 100 / state.draw.zoomPercent,
      };
    }
    this.requestRender();
  }

  #preferredCamera(view: MapView, state: WorkspaceState): CameraState {
    const top = view === "top";
    const home = top ? this.#homeTop : this.#homeThree;
    const preference = state.cameras[view];
    if (!preference) {
      return top
        ? { yaw: 0, pitch: Math.PI / 2 - 0.018, distance: home, targetX: 0, targetZ: 0, orthographic: true }
        : { yaw: -Math.PI / 4, pitch: 0.82, distance: home, targetX: 0, targetZ: 0, orthographic: false };
    }
    return {
      yaw: top ? 0 : preference.yaw,
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
      gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_SHORT, 8, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_BYTE, 8, 4);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 8, 5);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.#mode = "webgl2";
      this.#contextGeneration += 1;
      if (this.#scene) this.#uploadScene(this.#scene);
    } catch {
      this.#releaseWebGl();
      this.#initFallback();
    }
  }

  #installScene(scene: SceneModel | null): void {
    this.#cancelFallback();
    if (!scene) {
      this.#renderedPoints = 0;
      this.requestRender();
      return;
    }
    const [spanX, spanY] = scene.metadata.span;
    const meters = scene.metadata.metersPerCell;
    const width = spanX * meters;
    const depth = spanY * meters;
    this.#radius = Math.max(1, Math.hypot(width, depth) / 2);
    this.#homeThree = this.#radius * 1.72;
    const bounds = this.#measureViewport();
    const aspect = Math.max(0.2, bounds.width / Math.max(1, bounds.height));
    this.#homeTop = Math.max(depth / 2, width / (2 * aspect)) * 1.12;
    this.fit(false);
    if (this.#mode === "webgl2") this.#uploadScene(scene);
    else this.#buildFallback(scene);
  }

  #uploadScene(scene: SceneModel): void {
    const gl = this.#gl;
    if (!gl || !this.#buffer) return;
    const bytes = new Uint8Array(scene.buffer, scene.pointOffset, scene.total * 8);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
    this.#renderedPoints = scene.total;
  }

  #initFallback(): void {
    this.#mode = "canvas2d";
    this.#fallbackCanvas = document.createElement("canvas");
    this.#fallbackCanvas.width = 1024;
    this.#fallbackCanvas.height = 1024;
    this.#fallback = this.#fallbackCanvas.getContext("2d", { alpha: true });
    if (!this.#fallback) {
      this.#mode = "unavailable";
      this.#callbacks.onProblem?.("renderer-unavailable");
    } else if (this.#scene) {
      this.#buildFallback(this.#scene);
    }
  }

  #buildFallback(scene: SceneModel): void {
    const context = this.#fallback;
    if (!context || !this.#fallbackCanvas) return;
    context.clearRect(0, 0, this.#fallbackCanvas.width, this.#fallbackCanvas.height);
    const view = new DataView(scene.buffer, scene.pointOffset, scene.total * 8);
    const maximum = Math.min(scene.total, 50_000);
    const step = Math.max(1, Math.ceil(scene.total / maximum));
    let index = 0;
    let rendered = 0;
    const drawChunk = (): void => {
      if (this.#disposed || scene !== this.#scene || !this.#fallbackCanvas) return;
      const end = Math.min(scene.total, index + step * 4_000);
      for (; index < end; index += step) {
        const offset = index * 8;
        const x = view.getUint16(offset, true) / Math.max(1, scene.metadata.span[0]) * this.#fallbackCanvas.width;
        const y = view.getUint16(offset + 2, true) / Math.max(1, scene.metadata.span[1]) * this.#fallbackCanvas.height;
        const red = view.getUint8(offset + 5);
        const green = view.getUint8(offset + 6);
        const blue = view.getUint8(offset + 7);
        context.fillStyle = `rgb(${red} ${green} ${blue})`;
        context.fillRect(x, y, 1.5, 1.5);
        rendered += 1;
      }
      this.#renderedPoints = rendered;
      this.requestRender();
      if (index < scene.total) this.#fallbackFrame = window.setTimeout(drawChunk, 0);
      else this.#fallbackFrame = null;
    };
    drawChunk();
  }

  #cancelFallback(): void {
    if (this.#fallbackFrame !== null) window.clearTimeout(this.#fallbackFrame);
    this.#fallbackFrame = null;
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

  #resize(): void {
    const bounds = this.#measureViewport();
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    for (const canvas of [this.#sceneCanvas, this.#overlayCanvas]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
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
      : perspective(Math.PI / 3.15, aspect, 0.02, Math.max(60, this.#radius * 12));
    return multiply(projection, view);
  }

  requestRender(): void {
    if (this.#frame !== null || this.#disposed) return;
    this.#frame = window.requestAnimationFrame(() => {
      this.#frame = null;
      this.#render();
    });
  }

  #render(): void {
    const started = performance.now();
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
    if (!scene || !this.#program || !this.#vertexArray) return;
    if (this.#state?.view === "top" && this.#state.appearance === "rooms") {
      this.#renderedPoints = 0;
      return;
    }
    gl.useProgram(this.#program);
    gl.bindVertexArray(this.#vertexArray);
    gl.uniformMatrix4fv(this.#viewProjection, false, this.#matrix);
    gl.uniform2f(this.#center, (scene.metadata.span[0] - 1) / 2, (scene.metadata.span[1] - 1) / 2);
    gl.uniform1f(this.#meters, scene.metadata.metersPerCell);
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const pointBudget = Math.max(1, Math.floor(scene.total * this.#qualityScale));
    const floorCount = Math.min(scene.floorCount, pointBudget);
    const surfaceCount = Math.min(scene.surfaceCount, Math.max(0, pointBudget - floorCount));
    gl.uniform1f(this.#pointPixels, this.#sceneCanvas.height * 0.038);
    gl.uniform1f(this.#maxPointPixels, 4.5 * ratio);
    gl.drawArrays(gl.POINTS, 0, floorCount);
    gl.uniform1f(this.#pointPixels, this.#sceneCanvas.height * 0.05);
    gl.uniform1f(this.#maxPointPixels, 7 * ratio);
    gl.drawArrays(gl.POINTS, scene.floorCount, surfaceCount);
    gl.bindVertexArray(null);
    this.#renderedPoints = floorCount + surfaceCount;
  }

  #renderFallback(): void {
    // A WebGL canvas cannot later acquire a 2D context. The persistent overlay
    // owns the bounded raster fallback as well as vector annotations.
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

  #projectCell(x: number, y: number, height = 0): MapPoint | null {
    const world = this.#worldForCell(x, y, height);
    if (!world) return null;
    const [worldX, worldY, worldZ] = world;
    const matrix = this.#matrix;
    const clipX = (matrix[0] ?? 0) * worldX + (matrix[4] ?? 0) * worldY + (matrix[8] ?? 0) * worldZ + (matrix[12] ?? 0);
    const clipY = (matrix[1] ?? 0) * worldX + (matrix[5] ?? 0) * worldY + (matrix[9] ?? 0) * worldZ + (matrix[13] ?? 0);
    const clipW = (matrix[3] ?? 0) * worldX + (matrix[7] ?? 0) * worldY + (matrix[11] ?? 0) * worldZ + (matrix[15] ?? 0);
    if (clipW <= 0.001) return null;
    const xNormalized = clipX / clipW;
    const yNormalized = clipY / clipW;
    if (Math.abs(xNormalized) > 1.15 || Math.abs(yNormalized) > 1.15) return null;
    const bounds = this.#viewport;
    return {
      x: (xNormalized * 0.5 + 0.5) * bounds.width,
      y: (-yNormalized * 0.5 + 0.5) * bounds.height,
    };
  }

  #projectMeters(x: number, y: number, height = 0): MapPoint | null {
    const scene = this.#scene;
    if (!scene) return null;
    const cellX = x / scene.metadata.metersPerCell - scene.metadata.origin[0];
    const cellY = y / scene.metadata.metersPerCell - scene.metadata.origin[1];
    return this.#projectCell(cellX, cellY, height);
  }

  #renderOverlay(): void {
    const context = this.#overlay;
    const scene = this.#scene;
    const state = this.#state;
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const bounds = this.#viewport;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    if (!scene || !state) return;
    if (this.#mode === "canvas2d" && this.#fallbackCanvas
      && !(state.view === "top" && state.appearance === "rooms")) {
      const zoom = this.#homeTop / this.#camera.distance;
      const width = bounds.width * zoom;
      const height = bounds.height * zoom;
      const offsetX = (bounds.width - width) / 2 - this.#camera.targetX * 32 * zoom;
      const offsetY = (bounds.height - height) / 2 - this.#camera.targetZ * 32 * zoom;
      context.drawImage(this.#fallbackCanvas, offsetX, offsetY, width, height);
    }
    const selectedNames = this.#selectedRoomNames(state);
    if (state.labelsVisible || (state.view === "top" && state.appearance === "rooms")) {
      context.lineWidth = 1.5;
      context.font = "600 12px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      const occupied: DOMRect[] = [];
      for (const room of scene.metadata.rooms) {
        const selected = selectedNames.has(room.name.toLocaleLowerCase());
        context.strokeStyle = selected ? "#0678ce" : "rgba(75, 92, 105, .7)";
        context.fillStyle = selected
          ? "rgba(6, 120, 206, .26)"
          : state.view === "top" && state.appearance === "rooms"
            ? "rgba(231, 238, 242, .94)"
            : "rgba(255, 255, 255, .04)";
        context.beginPath();
        const step = Math.max(1, Math.ceil(room.boundary.length / 512));
        let started = false;
        for (let index = 0; index < room.boundary.length; index += step) {
          const point = room.boundary[index];
          if (!point) continue;
          const projected = this.#projectCell(point[0], point[1], 0.2);
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
        if (!state.labelsVisible) continue;
        const center = this.#projectCell(room.center[0], room.center[1], 1);
        if (!center) continue;
        const textWidth = context.measureText(room.name).width;
        const labelBounds = new DOMRect(center.x - textWidth / 2 - 6, center.y - 10, textWidth + 12, 20);
        if (occupied.some((other) => labelBounds.left < other.right + 8
          && labelBounds.right + 8 > other.left
          && labelBounds.top < other.bottom + 4
          && labelBounds.bottom + 4 > other.top)) continue;
        occupied.push(labelBounds);
        context.fillStyle = "rgba(250, 252, 253, .88)";
        context.fillRect(labelBounds.x, labelBounds.y, labelBounds.width, labelBounds.height);
        context.fillStyle = "#263238";
        context.fillText(room.name, center.x, center.y);
      }
    }
    const circles = state.draw.circles;
    if ((state.workflow === "draw" || state.workflow === "areaReview") && circles.length) {
      context.fillStyle = "rgba(6, 120, 206, .22)";
      context.strokeStyle = "rgba(6, 120, 206, .92)";
      context.lineWidth = 1.5;
      for (const circle of circles) this.#drawCircle(context, circle);
    }
    if (this.#cursor && state.workflow === "draw" && state.draw.tool !== "pan") {
      const center = this.#projectMeters(this.#cursor.x, this.#cursor.y);
      const edge = this.#projectMeters(this.#cursor.x + state.draw.brushMeters / 2, this.#cursor.y);
      if (center && edge) {
        context.beginPath();
        context.arc(center.x, center.y, Math.max(2, Math.hypot(edge.x - center.x, edge.y - center.y)), 0, Math.PI * 2);
        context.strokeStyle = "#0678ce";
        context.lineWidth = 2;
        context.stroke();
      }
    }
    const pose = state.resources.pose.value;
    if (state.map.exactPose && pose?.position && state.dataMode === "live") {
      // Pose coordinates share the floor-plan's meter space. Scene geometry is
      // stored in origin-relative cells, so it must cross the same conversion
      // boundary as custom-area coordinates before projection.
      const marker = this.#projectMeters(pose.position[0], pose.position[1], 3);
      if (marker) {
        context.beginPath();
        context.arc(marker.x, marker.y, 7, 0, Math.PI * 2);
        context.fillStyle = "#0678ce";
        context.fill();
        context.strokeStyle = "#fff";
        context.lineWidth = 3;
        context.stroke();
      }
    }
  }

  #selectedRoomNames(state: WorkspaceState): Set<string> {
    const rooms = state.resources.plans.value?.rooms || state.resources.areas.value?.rooms || [];
    return new Set(rooms
      .filter((room) => state.selection.roomIds.includes(room.roomId))
      .map((room) => room.name.toLocaleLowerCase()));
  }

  #drawCircle(context: CanvasRenderingContext2D, circle: AreaCircle): void {
    const center = this.#projectMeters(circle.x, circle.y);
    const edge = this.#projectMeters(circle.x + circle.radius, circle.y);
    if (!center || !edge) return;
    context.beginPath();
    context.arc(center.x, center.y, Math.max(1, Math.hypot(edge.x - center.x, edge.y - center.y)), 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  setCursor(point: MapPoint | null): void {
    this.#cursor = point;
    this.requestRender();
  }

  screenToMap(clientX: number, clientY: number): MapPoint | null {
    const scene = this.#scene;
    if (!scene || !this.#camera.orthographic) return null;
    const bounds = this.#measureViewport();
    if (!bounds.width || !bounds.height) return null;
    const worldPerPixel = this.#camera.distance * 2 / bounds.height;
    const worldX = this.#camera.targetX + (clientX - bounds.left - bounds.width / 2) * worldPerPixel;
    const worldZ = this.#camera.targetZ + (clientY - bounds.top - bounds.height / 2) * worldPerPixel;
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

  #roomId(room: SceneRoom, state: WorkspaceState): string {
    const candidates = state.resources.plans.value?.rooms || state.resources.areas.value?.rooms || [];
    return candidates.find((candidate) => candidate.name.localeCompare(room.name, undefined, { sensitivity: "base" }) === 0)?.roomId
      || room.id;
  }

  selectRoomAt(clientX: number, clientY: number): void {
    const roomId = this.roomAt(clientX, clientY);
    if (roomId) this.#callbacks.onRoom?.(roomId);
  }

  fit(notify = true): void {
    const top = this.#state?.view === "top" || this.#state?.workflow === "draw";
    this.#camera = top
      ? { yaw: 0, pitch: Math.PI / 2 - 0.018, distance: this.#homeTop, targetX: 0, targetZ: 0, orthographic: true }
      : { yaw: -Math.PI / 4, pitch: 0.82, distance: this.#homeThree, targetX: 0, targetZ: 0, orthographic: false };
    this.requestRender();
    if (notify) this.#notifyCamera();
  }

  zoomAt(factor: number, clientX?: number, clientY?: number): void {
    const before = clientX === undefined || clientY === undefined ? null : this.screenToMap(clientX, clientY);
    this.#camera = {
      ...this.#camera,
      distance: clamp(this.#camera.distance / factor, Math.max(0.2, this.#radius * 0.04), this.#radius * 8),
    };
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
    const bounds = this.#viewport;
    const worldPerPixel = this.#camera.distance * 2 / Math.max(1, bounds.height);
    const rightX = Math.cos(this.#camera.yaw);
    const rightZ = -Math.sin(this.#camera.yaw);
    const forwardX = -Math.sin(this.#camera.yaw);
    const forwardZ = -Math.cos(this.#camera.yaw);
    this.#camera = {
      ...this.#camera,
      targetX: clamp(
        this.#camera.targetX - deltaX * worldPerPixel * rightX + deltaY * worldPerPixel * forwardX,
        -this.#radius,
        this.#radius,
      ),
      targetZ: clamp(
        this.#camera.targetZ - deltaX * worldPerPixel * rightZ + deltaY * worldPerPixel * forwardZ,
        -this.#radius,
        this.#radius,
      ),
    };
    this.requestRender();
    this.#notifyCamera();
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
    this.requestRender();
    this.#notifyCamera();
  }

  rotateBy(deltaRadians: number): void {
    this.#camera = {
      ...this.#camera,
      yaw: angle(this.#camera.yaw + deltaRadians),
    };
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
    };
  }

  readonly #contextLost = (event: Event): void => {
    event.preventDefault();
    this.#releaseWebGl();
    this.#initFallback();
    this.requestRender();
  };

  readonly #contextRestored = (): void => {
    this.#releaseWebGl();
    this.#initWebGl();
    this.requestRender();
  };

  #releaseWebGl(): void {
    const gl = this.#gl;
    if (gl) {
      if (this.#buffer) gl.deleteBuffer(this.#buffer);
      if (this.#vertexArray) gl.deleteVertexArray(this.#vertexArray);
      if (this.#program) gl.deleteProgram(this.#program);
    }
    this.#buffer = null;
    this.#vertexArray = null;
    this.#program = null;
    this.#gl = null;
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
    this.#scene = null;
    this.#state = null;
  }
}
