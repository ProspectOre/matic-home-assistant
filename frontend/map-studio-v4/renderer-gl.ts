import type { SceneModel } from "./backend-contracts";
import { SCENE_DELTA_DIRTY_BLOCK_BYTES } from "./backend-contracts";

const GPU_UPLOAD_CHUNK_BYTES = 512 * 1024;
const GPU_UPLOAD_FAIR_SHARE_BYTES = GPU_UPLOAD_CHUNK_BYTES / 2;
const GPU_DELTA_BLOCK_BYTES = SCENE_DELTA_DIRTY_BLOCK_BYTES;
const GPU_DELTA_MAX_BLOCKS = 256;

const sameSceneTransform = (left: SceneModel, right: SceneModel): boolean =>
  left.metadata.metersPerCell === right.metadata.metersPerCell
  && left.metadata.origin[0] === right.metadata.origin[0]
  && left.metadata.origin[1] === right.metadata.origin[1]
  && left.metadata.span[0] === right.metadata.span[0]
  && left.metadata.span[1] === right.metadata.span[1];

export const samePointLayout = (left: SceneModel, right: SceneModel): boolean =>
  left.pointOffset === right.pointOffset
  && left.floorCount === right.floorCount
  && left.surfaceCount === right.surfaceCount
  && left.total === right.total
  && left.source === right.source
  && sameSceneTransform(left, right);

export const validDeltaBlocks = (scene: SceneModel, baseRevision: number): readonly number[] | null => {
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

const insertSortedUniqueBlock = (blocks: number[], value: number): void => {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const current = blocks[middle]!;
    if (current === value) return;
    if (current < value) low = middle + 1;
    else high = middle;
  }
  blocks.splice(low, 0, value);
};

const hasEligibleDirtyBlock = (
  blocks: readonly number[],
  totalBytes: number,
  frontierBytes: number,
): boolean => {
  const first = blocks[0];
  if (first === undefined) return false;
  // Blocks are kept ascending, so eligibility is determined by the first one.
  return Math.min(totalBytes, (first + 1) * GPU_DELTA_BLOCK_BYTES) <= frontierBytes;
};

export interface GpuUpload {
  scene: SceneModel;
  revision: number;
  readonly context: string;
  generation: number;
  readonly contextGeneration: number;
  readonly buffer: WebGLBuffer;
  readonly staging: boolean;
  seed: "scene" | "copy";
  readonly previousScene: SceneModel | null;
  frontierBytes: number;
  /** Unique pending blocks kept in ascending offset order. */
  readonly dirtyBlocks: number[];
  readonly transitionBlocks: Set<number>;
}

/** Folds a compatible successor scene into an upload in flight. */
export const advanceUpload = (
  upload: GpuUpload,
  scene: SceneModel,
  generation: number,
  dirtyBlocks: readonly number[],
): boolean => {
  const combined = new Set(upload.transitionBlocks);
  for (const block of dirtyBlocks) combined.add(block);
  if (combined.size > GPU_DELTA_MAX_BLOCKS) return false;

  upload.scene = scene;
  upload.revision = scene.revision;
  upload.generation = generation;
  upload.transitionBlocks.clear();
  for (const block of combined) upload.transitionBlocks.add(block);
  if (upload.seed === "copy") {
    for (const block of dirtyBlocks) {
      insertSortedUniqueBlock(upload.dirtyBlocks, block);
    }
  } else {
    const uploadedBlocks = Math.ceil(upload.frontierBytes / GPU_DELTA_BLOCK_BYTES);
    for (const block of dirtyBlocks) {
      if (block < uploadedBlocks) insertSortedUniqueBlock(upload.dirtyBlocks, block);
    }
  }
  return true;
};

/** The WebGL context, point program and the front and staging point buffers. */
export class RendererGl {
  gl: WebGL2RenderingContext | null = null;
  buffer: WebGLBuffer | null = null;
  stagingBuffer: WebGLBuffer | null = null;
  vertexArray: WebGLVertexArrayObject | null = null;
  initializedPoints = 0;
  #program: WebGLProgram | null = null;
  #bufferCapacities = new WeakMap<WebGLBuffer, number>();
  #viewProjection: WebGLUniformLocation | null = null;
  #center: WebGLUniformLocation | null = null;
  #viewportPixels: WebGLUniformLocation | null = null;
  #meters: WebGLUniformLocation | null = null;
  #sampleStep: WebGLUniformLocation | null = null;
  #maxPointPixels: WebGLUniformLocation | null = null;

  #compile(type: number, source: string): WebGLShader {
    const gl = this.gl;
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

  /** Throws when WebGL2 or any point resource is unavailable. */
  init(canvas: HTMLCanvasElement): void {
    this.gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: true,
      // The overlay geometry counts fill rule and stroke coverage in it.
      stencil: true,
      powerPreference: "high-performance",
    });
    const gl = this.gl;
    if (!gl) throw new Error("webgl2-unavailable");
    // Near-plane points have no stable projected footprint, so keep their
    // sprites finite. Otherwise use the projected cell diagonal to cover
    // adjacent samples without changing their map-space area.
    const vertex = this.#compile(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      precision highp int;
      layout(location = 0) in uvec2 aXY;
      layout(location = 1) in uint aHeight;
      layout(location = 2) in vec3 aColor;
      uniform mat4 uViewProjection;
      uniform vec2 uCenter;
      uniform vec2 uViewportSize;
      uniform float uMetersPerCell;
      uniform float uSampleStep;
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
        float cellMeters = uMetersPerCell * uSampleStep;
        vec4 clipX = uViewProjection * vec4(world + vec3(cellMeters, 0.0, 0.0), 1.0);
        vec4 clipZ = uViewProjection * vec4(world + vec3(0.0, 0.0, cellMeters), 1.0);
        float cellDiameter = 1.0;
        if (clip.w > 0.02 && clipX.w > 0.02 && clipZ.w > 0.02) {
          vec2 cellX = (clipX.xy / clipX.w - clip.xy / clip.w) * uViewportSize * 0.5;
          vec2 cellZ = (clipZ.xy / clipZ.w - clip.xy / clip.w) * uViewportSize * 0.5;
          float projectedDiameter = max(length(cellX + cellZ), length(cellX - cellZ));
          if (!isnan(projectedDiameter) && !isinf(projectedDiameter)) {
            cellDiameter = projectedDiameter;
          }
        }
        gl_PointSize = clamp(cellDiameter, 1.0, uMaxPointPixels);
        vColor = aColor;
      }
    `);
    const fragment = this.#compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec3 vColor;
      out vec4 outColor;
      void main() {
        vec2 point = gl_PointCoord * 2.0 - 1.0;
        float radius = length(point);
        float edgeWidth = max(fwidth(radius), 0.001);
        float edge = 1.0 - smoothstep(1.0 - edgeWidth * 0.5, 1.0 + edgeWidth * 0.5, radius);
        if (edge <= 0.0) discard;
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
    this.#viewportPixels = gl.getUniformLocation(program, "uViewportSize");
    this.#meters = gl.getUniformLocation(program, "uMetersPerCell");
    this.#sampleStep = gl.getUniformLocation(program, "uSampleStep");
    this.#maxPointPixels = gl.getUniformLocation(program, "uMaxPointPixels");
    this.buffer = gl.createBuffer();
    this.vertexArray = gl.createVertexArray();
    gl.bindVertexArray(this.vertexArray);
    if (!this.buffer) throw new Error("buffer-unavailable");
    this.bindVertexBuffer(this.buffer);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  get ready(): boolean {
    return Boolean(this.#program && this.vertexArray && this.buffer);
  }

  bindVertexBuffer(buffer: WebGLBuffer, step = 1, first = 0): void {
    const gl = this.gl;
    if (!gl || !this.vertexArray) return;
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_SHORT, 8 * step, 8 * first);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_BYTE, 8 * step, 8 * first + 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 8 * step, 8 * first + 5);
    gl.bindVertexArray(null);
  }

  deleteFrontBuffer(): void {
    if (this.buffer && this.gl) this.gl.deleteBuffer(this.buffer);
    this.buffer = null;
  }

  deleteStagingBuffer(): void {
    if (this.stagingBuffer && this.gl) this.gl.deleteBuffer(this.stagingBuffer);
    this.stagingBuffer = null;
  }

  /** The front or staging buffer sized for an upload, or null when the GPU refuses it. */
  uploadBuffer(staging: boolean, byteLength: number, reset: boolean): WebGLBuffer | null {
    const gl = this.gl;
    if (!gl) return null;
    let buffer = staging ? this.stagingBuffer : this.buffer;
    if (!buffer && !staging && this.stagingBuffer) {
      buffer = this.stagingBuffer;
      this.stagingBuffer = null;
    }
    if (!buffer) {
      try {
        buffer = gl.createBuffer();
      } catch {
        return null;
      }
    }
    if (!buffer) return null;
    if (staging) this.stagingBuffer = buffer;
    else this.buffer = buffer;
    if (!this.#allocate(buffer, byteLength, reset)) return null;
    if (!staging) this.bindVertexBuffer(buffer);
    return buffer;
  }

  #allocate(buffer: WebGLBuffer, byteLength: number, reset: boolean): boolean {
    const gl = this.gl;
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
    const gl = this.gl;
    if (!gl) return true;
    try {
      const error = gl.getError();
      return typeof error === "number" && error !== gl.NO_ERROR;
    } catch {
      return true;
    }
  }

  #uploadFrontier(upload: GpuUpload, maximumBytes: number): number {
    const gl = this.gl;
    const bytesRemaining = upload.scene.total * 8 - upload.frontierBytes;
    const byteCount = Math.min(bytesRemaining, maximumBytes);
    if (!gl || byteCount <= 0) return 0;
    if (upload.seed === "copy") {
      if (!this.buffer || this.buffer === upload.buffer) return -1;
      gl.bindBuffer(gl.COPY_READ_BUFFER, this.buffer);
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
    if (!upload.staging) this.initializedPoints = upload.frontierBytes / 8;
    return byteCount;
  }

  #uploadDirtyBlocks(upload: GpuUpload, maximumBytes: number): number {
    const gl = this.gl;
    if (!gl || maximumBytes <= 0) return 0;
    const totalBytes = upload.scene.total * 8;
    let uploaded = 0;
    for (let index = 0; index < upload.dirtyBlocks.length;) {
      const block = upload.dirtyBlocks[index]!;
      const start = block * GPU_DELTA_BLOCK_BYTES;
      const end = Math.min(totalBytes, start + GPU_DELTA_BLOCK_BYTES);
      const length = end - start;
      if (end > upload.frontierBytes) break;
      if (uploaded + length > maximumBytes) {
        index += 1;
        continue;
      }
      const bytes = new Uint8Array(upload.scene.buffer, upload.scene.pointOffset + start, length);
      gl.bindBuffer(gl.ARRAY_BUFFER, upload.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, start, bytes);
      if (this.#hasGlError()) return -1;
      upload.dirtyBlocks.splice(index, 1);
      uploaded += length;
    }
    return uploaded;
  }

  /** Uploads one frame's share of an upload; false when the GPU rejected it. */
  uploadChunk(upload: GpuUpload): boolean {
    const byteLength = upload.scene.total * 8;
    const pendingFrontier = upload.frontierBytes < byteLength;
    let remainingBudget = GPU_UPLOAD_CHUNK_BYTES;
    try {
      const frontierLimit = pendingFrontier && upload.dirtyBlocks.length > 0
        ? GPU_UPLOAD_FAIR_SHARE_BYTES
        : GPU_UPLOAD_CHUNK_BYTES;
      const frontierBytes = this.#uploadFrontier(upload, frontierLimit);
      if (frontierBytes < 0) return false;
      remainingBudget -= frontierBytes;

      const canPatch = hasEligibleDirtyBlock(
        upload.dirtyBlocks,
        byteLength,
        upload.frontierBytes,
      );
      const patchLimit = pendingFrontier && canPatch
        ? Math.min(GPU_UPLOAD_FAIR_SHARE_BYTES, remainingBudget)
        : canPatch ? remainingBudget : 0;
      const patchBytes = this.#uploadDirtyBlocks(upload, patchLimit);
      if (patchBytes < 0) return false;
      remainingBudget -= patchBytes;

      const hasEligiblePatch = hasEligibleDirtyBlock(
        upload.dirtyBlocks,
        byteLength,
        upload.frontierBytes,
      );
      if (pendingFrontier && remainingBudget > 0 && !hasEligiblePatch) {
        if (this.#uploadFrontier(upload, remainingBudget) < 0) return false;
      }
    } catch {
      // Both upload failures and thrown WebGL calls select the same fallback.
      return false;
    }
    return true;
  }

  /** Draws the packed points with a stride; returns how many were submitted. */
  drawPoints(scene: SceneModel, matrix: Float32Array, width: number, height: number, step: number, ratio: number): number {
    const gl = this.gl;
    if (!gl || !this.buffer) return 0;
    const initializedPoints = Math.min(scene.total, this.initializedPoints);
    gl.useProgram(this.#program);
    gl.bindVertexArray(this.vertexArray);
    gl.uniformMatrix4fv(this.#viewProjection, false, matrix);
    gl.uniform2f(this.#center, (scene.metadata.span[0] - 1) / 2, (scene.metadata.span[1] - 1) / 2);
    gl.uniform2f(this.#viewportPixels, width, height);
    gl.uniform1f(this.#meters, scene.metadata.metersPerCell);
    // Strided points represent a lower-density sample of the packed scene.
    // Grow splats by the square root of the stride to recover some coverage
    // without treating packed order as a regular 2D grid; the existing point
    // caps bound overlap where nearby samples are clustered.
    gl.uniform1f(this.#sampleStep, scene.metadata.sampleStep * Math.sqrt(step));
    // The producer groups points by tile and then by floor/surface. Drawing
    // a prefix would crop later tiles and starve surfaces at lower quality.
    // Stride each range instead, using only its initialized upload frontier.
    const floorAvailable = Math.min(scene.floorCount, initializedPoints);
    const surfaceAvailable = Math.min(
      scene.surfaceCount,
      Math.max(0, initializedPoints - scene.floorCount),
    );
    const floorCount = Math.ceil(floorAvailable / step);
    const surfaceCount = Math.ceil(surfaceAvailable / step);
    if (floorCount > 0) {
      this.bindVertexBuffer(this.buffer, step);
      gl.bindVertexArray(this.vertexArray);
      gl.uniform1f(this.#maxPointPixels, 4.5 * ratio);
      gl.drawArrays(gl.POINTS, 0, floorCount);
    }
    if (surfaceCount > 0) {
      this.bindVertexBuffer(this.buffer, step, scene.floorCount);
      gl.bindVertexArray(this.vertexArray);
      gl.uniform1f(this.#maxPointPixels, 7 * ratio);
      gl.drawArrays(gl.POINTS, 0, surfaceCount);
    }
    gl.bindVertexArray(null);
    return floorCount + surfaceCount;
  }

  release(): void {
    const gl = this.gl;
    if (gl) {
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.stagingBuffer) gl.deleteBuffer(this.stagingBuffer);
      if (this.vertexArray) gl.deleteVertexArray(this.vertexArray);
      if (this.#program) gl.deleteProgram(this.#program);
    }
    this.buffer = null;
    this.stagingBuffer = null;
    this.vertexArray = null;
    this.#program = null;
    this.gl = null;
    this.initializedPoints = 0;
  }
}
