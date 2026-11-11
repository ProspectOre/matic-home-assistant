import type { SceneModel } from "./backend-contracts";
import type { CameraState } from "./renderer-controller";

const TILE_CELLS = 32;
const MAX_TILE_RUNS = 8_192;
const QUAD_VERTICES = 6;
const FLOOR_FACES = 1;
const SURFACE_FACES = 3;
const MIN_AUTO_VISIBLE_POINTS = 50_000;

export type SurfaceDetail = "complete" | "limited" | "sampled";

export interface SurfaceFrame {
  readonly scene: SceneModel;
  readonly matrix: Float32Array;
  readonly buffer: WebGLBuffer;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly initializedPoints: number;
  readonly qualityScale: number;
  readonly adaptiveQuality?: boolean;
  readonly maxVisiblePoints: number | null;
  readonly camera: CameraState;
  /** Scales the photo's colour, from 0 for grey to 1 as recorded. */
  readonly saturation: number;
}

interface Plane { readonly x: number; readonly y: number; readonly z: number; readonly w: number; }

/** Extract normalized clip-space planes from a column-major view-projection matrix. */
export const frustumPlanes = (matrix: ArrayLike<number>): readonly Plane[] | null => {
  if (matrix.length < 16) return null;
  for (let index = 0; index < 16; index += 1) {
    if (!Number.isFinite(matrix[index])) return null;
  }
  const row = (index: number): readonly [number, number, number, number] =>
    [matrix[index]!, matrix[index + 4]!, matrix[index + 8]!, matrix[index + 12]!];
  const r0 = row(0); const r1 = row(1); const r2 = row(2); const r3 = row(3);
  const planes: Plane[] = [];
  for (const right of [r0, r1, r2]) for (const sign of [1, -1] as const) {
    const x = r3[0] + sign * right[0];
    const y = r3[1] + sign * right[1];
    const z = r3[2] + sign * right[2];
    const w = r3[3] + sign * right[3];
    const length = Math.hypot(x, y, z);
    if (!(length > 0) || !Number.isFinite(length)) return null;
    planes.push({ x: x / length, y: y / length, z: z / length, w: w / length });
  }
  return planes;
};

/** Conservative AABB test against normalized world-space frustum planes. */
export const aabbIntersectsFrustum = (
  planes: readonly Plane[],
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number,
): boolean => {
  for (const plane of planes) {
    const x = plane.x >= 0 ? maxX : minX;
    const y = plane.y >= 0 ? maxY : minY;
    const z = plane.z >= 0 ? maxZ : minZ;
    if (plane.x * x + plane.y * y + plane.z * z + plane.w < 0) return false;
  }
  return true;
};

/** World-space bounds for one 32-cell source tile, including its cell edges. */
export const writeTileWorldBounds = (
  output: Float64Array,
  tileX: number,
  tileY: number,
  span: readonly [number, number],
  meters: number,
  maxHeight: number,
  floor: boolean,
): void => {
  const minCellX = tileX * TILE_CELLS - 0.5;
  const maxCellX = Math.min(span[0], (tileX + 1) * TILE_CELLS) - 0.5;
  const minCellY = tileY * TILE_CELLS - 0.5;
  const maxCellY = Math.min(span[1], (tileY + 1) * TILE_CELLS) - 0.5;
  const centerX = (span[0] - 1) / 2;
  const centerY = (span[1] - 1) / 2;
  const minX = -(maxCellX - centerX) * meters;
  const maxX = -(minCellX - centerX) * meters;
  const minZ = (minCellY - centerY) * meters;
  const maxZ = (maxCellY - centerY) * meters;
  const half = meters * 0.5;
  output[0] = minX;
  output[1] = maxX;
  output[2] = -half;
  output[3] = floor ? half : (maxHeight + 0.5) * meters;
  output[4] = minZ;
  output[5] = maxZ;
};

const shader = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader => {
  const value = gl.createShader(type);
  if (!value) throw new Error("surface-shader-unavailable");
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
    gl.deleteShader(value);
    throw new Error("surface-shader-failed");
  }
  return value;
};

const vertexSource = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in uvec2 aXY;
layout(location=1) in uint aHeight;
layout(location=2) in vec3 aColor;
uniform mat4 uViewProjection;
uniform vec2 uCenter;
uniform float uMetersPerCell;
uniform vec3 uEye;
uniform vec3 uViewDirection;
uniform bool uOrthographic;
uniform int uFaces;
out vec3 vColor;
const vec2 CORNERS[6] = vec2[6](vec2(0,0),vec2(1,0),vec2(1,1),vec2(0,0),vec2(1,1),vec2(0,1));
void main() {
  int face = gl_VertexID / 6;
  vec2 corner = CORNERS[gl_VertexID % 6];
  vec3 center = vec3(-(float(aXY.x)-uCenter.x)*uMetersPerCell,
    float(aHeight)*uMetersPerCell, (float(aXY.y)-uCenter.y)*uMetersPerCell);
  vec3 toward = uOrthographic ? -uViewDirection : uEye-center;
  vec3 low = center-vec3(uMetersPerCell*0.5);
  vec3 high = center+vec3(uMetersPerCell*0.5);
  vec3 world;
  if (uFaces == 1) {
    world = vec3(mix(low.x,high.x,corner.x), center.y, mix(low.z,high.z,corner.y));
  } else if (face == 0) {
    world = vec3(mix(low.x,high.x,corner.x), high.y, mix(low.z,high.z,corner.y));
  } else if (face == 1) {
    float x = toward.x >= 0.0 ? high.x : low.x;
    world = vec3(x, mix(low.y,high.y,corner.y), mix(low.z,high.z,corner.x));
  } else {
    float z = toward.z >= 0.0 ? high.z : low.z;
    world = vec3(mix(low.x,high.x,corner.x), mix(low.y,high.y,corner.y), z);
  }
  gl_Position = uViewProjection*vec4(world,1.0);
  vColor = aColor;
}`;

const fragmentSource = `#version 300 es
precision highp float;
uniform float uSaturation;
in vec3 vColor;
out vec4 outColor;
void main(){
  vec3 colour=pow(vColor,vec3(0.94));
  // The weights of CSS saturate().
  outColor=vec4(mix(vec3(dot(colour,vec3(0.213,0.715,0.072))),colour,uSaturation),1.0);
}`;

const readRuns = (scene: SceneModel): NonNullable<SceneModel["tileIndex"]> | null => {
  const index = scene.tileIndex;
  if (!index || !(index.runs instanceof Uint32Array)
    || !Number.isInteger(scene.total) || scene.total < 0
    || scene.floorCount < 0 || scene.surfaceCount < 0
    || scene.floorCount + scene.surfaceCount !== scene.total
    || index.runs.length % 5 !== 0 || index.runs.length > MAX_TILE_RUNS * 5
    || !Number.isInteger(index.floorRuns) || index.floorRuns < 0
    || index.floorRuns > index.runs.length / 5) return null;
  const count = index.runs.length / 5;
  let expected = 0;
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const offset = ordinal * 5;
    const start = index.runs[offset]!;
    const end = index.runs[offset + 1]!;
    const tileX = index.runs[offset + 2]!;
    const tileY = index.runs[offset + 3]!;
    const maxHeight = index.runs[offset + 4]!;
    const floorRun = ordinal < index.floorRuns;
    const boundary = floorRun ? scene.floorCount : scene.total;
    if (start !== expected || end <= start || end > boundary
      || tileX >= Math.ceil(scene.metadata.span[0] / TILE_CELLS)
      || tileY >= Math.ceil(scene.metadata.span[1] / TILE_CELLS)
      || maxHeight > 255 || (floorRun && maxHeight !== 0)) return null;
    if (!floorRun && ordinal === index.floorRuns && expected !== scene.floorCount) return null;
    expected = end;
  }
  if (scene.floorCount > 0 && index.floorRuns === 0) return null;
  if (scene.surfaceCount > 0 && index.floorRuns === count) return null;
  if (count && expected !== scene.total) return null;
  if (!count && scene.total !== 0) return null;
  return index;
};

export class SurfaceGeometry {
  readonly #gl: WebGL2RenderingContext;
  readonly #program: WebGLProgram;
  readonly #uniforms: {
    matrix: WebGLUniformLocation | null; center: WebGLUniformLocation | null;
    meters: WebGLUniformLocation | null; eye: WebGLUniformLocation | null;
    direction: WebGLUniformLocation | null; ortho: WebGLUniformLocation | null;
    faces: WebGLUniformLocation | null; saturation: WebGLUniformLocation | null;
  };
  #disposed = false;
  readonly #floorRanges = new Uint32Array(MAX_TILE_RUNS * 2);
  readonly #surfaceRanges = new Uint32Array(MAX_TILE_RUNS * 2);
  #floorRangeCount = 0;
  #surfaceRangeCount = 0;
  // A closed or replaced map must not stay alive solely because its tile
  // index was validated while this renderer was zoomed in.
  readonly #validatedRuns = new WeakMap<SceneModel, NonNullable<SceneModel["tileIndex"]> | null>();
  readonly #tileBounds = new Float64Array(6);
  #detail: SurfaceDetail = "complete";
  readonly #onDetail: ((detail: Exclude<SurfaceDetail, "complete"> | null) => void) | undefined;

  /** Whether the current view or source omits original cells. */
  get detail(): SurfaceDetail { return this.#detail; }

  constructor(gl: WebGL2RenderingContext, onDetail?: (detail: Exclude<SurfaceDetail, "complete"> | null) => void) {
    this.#gl = gl;
    this.#onDetail = onDetail;
    const vertex = shader(gl, gl.VERTEX_SHADER, vertexSource);
    let fragment: WebGLShader | null = null;
    let program: WebGLProgram | null = null;
    try {
      fragment = shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      if (!program) throw new Error("surface-program-unavailable");
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("surface-program-failed");
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
    this.#program = program;
    this.#uniforms = {
      matrix: gl.getUniformLocation(program, "uViewProjection"),
      center: gl.getUniformLocation(program, "uCenter"),
      meters: gl.getUniformLocation(program, "uMetersPerCell"),
      eye: gl.getUniformLocation(program, "uEye"),
      direction: gl.getUniformLocation(program, "uViewDirection"),
      ortho: gl.getUniformLocation(program, "uOrthographic"),
      faces: gl.getUniformLocation(program, "uFaces"),
      saturation: gl.getUniformLocation(program, "uSaturation"),
    };
  }

  draw(frame: SurfaceFrame): number {
    if (this.#disposed) return 0;
    const { scene, initializedPoints, qualityScale, maxVisiblePoints } = frame;
    const total = Math.max(0, Math.min(scene.total, Math.trunc(initializedPoints)));
    if (!total || !(scene.metadata.metersPerCell > 0)) {
      this.clearDetail();
      return 0;
    }
    const gl = this.#gl;
    const planes = frustumPlanes(frame.matrix);
    let runs = this.#validatedRuns.get(scene);
    if (runs === undefined) {
      runs = readRuns(scene);
      this.#validatedRuns.set(scene, runs);
    }
    this.#floorRangeCount = 0;
    this.#surfaceRangeCount = 0;
    let visible = 0;
    const append = (
      start: number, rangeEnd: number, floor: boolean,
      tileX?: number, tileY?: number, maxHeight?: number,
    ): void => {
      const end = Math.min(rangeEnd, total);
      if (start >= end) return;
      if (tileX !== undefined && tileY !== undefined && maxHeight !== undefined && planes) {
        const meters = scene.metadata.metersPerCell;
        writeTileWorldBounds(this.#tileBounds, tileX, tileY, scene.metadata.span, meters, maxHeight, floor);
        if (!aabbIntersectsFrustum(
          planes, this.#tileBounds[0]!, this.#tileBounds[1]!, this.#tileBounds[2]!,
          this.#tileBounds[3]!, this.#tileBounds[4]!, this.#tileBounds[5]!,
        )) return;
      }
      const values = floor ? this.#floorRanges : this.#surfaceRanges;
      const count = floor ? this.#floorRangeCount : this.#surfaceRangeCount;
      if (count > 0 && values[count * 2 - 1] === start) {
        values[count * 2 - 1] = end;
      } else {
        if (floor) this.#floorRangeCount += 1;
        else this.#surfaceRangeCount += 1;
        values[count * 2] = start;
        values[count * 2 + 1] = end;
      }
      visible += end - start;
    };
    if (runs) {
      const values = runs.runs;
      const runCount = values.length / 5;
      for (let ordinal = 0; ordinal < runCount; ordinal += 1) {
        const offset = ordinal * 5;
        append(values[offset]!, values[offset + 1]!, ordinal < runs.floorRuns,
          values[offset + 2]!, values[offset + 3]!, values[offset + 4]!);
      }
    } else {
      append(0, scene.floorCount, true);
      append(scene.floorCount, scene.total, false);
    }
    const scale = Number.isFinite(qualityScale) && qualityScale > 0 ? Math.min(qualityScale, 1) : 1;
    const initialCap = Number.isInteger(maxVisiblePoints) && maxVisiblePoints! > 0 ? maxVisiblePoints! : null;
    // In Auto, preserve every visible source cell whenever the current view
    // fits its budget. Sustained slow frames reduce that budget, rather than
    // immediately striding every small scene as soon as the scale drops.
    const adaptiveCap = frame.adaptiveQuality && scale < 1
      ? Math.max(MIN_AUTO_VISIBLE_POINTS, Math.floor(Math.min(visible, initialCap ?? visible) * scale)) : null;
    const cap = adaptiveCap === null ? initialCap : Math.min(initialCap ?? adaptiveCap, adaptiveCap);
    let step = Math.max(frame.adaptiveQuality ? 1 : Math.ceil(1 / scale), cap ? Math.ceil(visible / cap) : 1);
    if (cap) {
      const alignedCount = (items: Uint32Array, rangeCount: number, stride: number): number => {
        let count = 0;
        for (let index = 0; index < rangeCount; index += 1) {
          const start = items[index * 2]!;
          const end = items[index * 2 + 1]!;
          const first = start + ((stride - (start % stride)) % stride);
          if (first < end) count += Math.ceil((end - first) / stride);
        }
        return count;
      };
      while (alignedCount(this.#floorRanges, this.#floorRangeCount, step)
        + alignedCount(this.#surfaceRanges, this.#surfaceRangeCount, step) > cap) step += 1;
    }
    this.#setDetail(scene.metadata.sampleStep > 1 ? "sampled" : step > 1 ? "limited" : "complete");
    gl.useProgram(this.#program);
    gl.uniformMatrix4fv(this.#uniforms.matrix, false, frame.matrix);
    gl.uniform2f(this.#uniforms.center, (scene.metadata.span[0] - 1) / 2, (scene.metadata.span[1] - 1) / 2);
    gl.uniform1f(this.#uniforms.meters, scene.metadata.metersPerCell);
    gl.uniform1f(this.#uniforms.saturation, frame.saturation);
    const { camera } = frame;
    const horizontal = Math.cos(camera.pitch);
    const dx = Math.sin(camera.yaw) * horizontal;
    const dy = Math.sin(camera.pitch);
    const dz = Math.cos(camera.yaw) * horizontal;
    gl.uniform3f(this.#uniforms.eye, camera.targetX + dx * camera.distance, dy * camera.distance,
      camera.targetZ + dz * camera.distance);
    gl.uniform3f(this.#uniforms.direction, -dx, -dy, -dz);
    gl.uniform1i(this.#uniforms.ortho, camera.orthographic ? 1 : 0);
    gl.bindVertexArray(frame.vertexArray);
    let submitted = 0;
    const drawRanges = (items: Uint32Array, rangeCount: number, floor: boolean): void => {
      if (!rangeCount) return;
      gl.uniform1i(this.#uniforms.faces, floor ? FLOOR_FACES : SURFACE_FACES);
      for (let ordinal = 0; ordinal < rangeCount; ordinal += 1) {
        const start = items[ordinal * 2]!;
        const end = items[ordinal * 2 + 1]!;
        const first = start + ((step - (start % step)) % step);
        if (first >= end) continue;
        const count = Math.ceil((end - first) / step);
        gl.bindBuffer(gl.ARRAY_BUFFER, frame.buffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_SHORT, 8 * step, first * 8);
        gl.vertexAttribDivisor(0, 1);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_BYTE, 8 * step, first * 8 + 4);
        gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 8 * step, first * 8 + 5);
        gl.vertexAttribDivisor(2, 1);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, QUAD_VERTICES * (floor ? FLOOR_FACES : SURFACE_FACES), count);
        submitted += count;
      }
    };
    try {
      drawRanges(this.#floorRanges, this.#floorRangeCount, true);
      drawRanges(this.#surfaceRanges, this.#surfaceRangeCount, false);
    } finally {
      for (let location = 0; location < 3; location += 1) gl.vertexAttribDivisor(location, 0);
      gl.bindVertexArray(null);
    }
    return submitted;
  }

  clearDetail(): void { this.#setDetail("complete"); }

  #setDetail(detail: SurfaceDetail): void {
    if (this.#detail === detail) return;
    this.#detail = detail;
    this.#onDetail?.(detail === "complete" ? null : detail);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}
