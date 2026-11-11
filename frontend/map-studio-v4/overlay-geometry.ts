import type { SceneModel } from "./backend-contracts";
import type { WorkspaceState } from "./contracts";
import { overlayShapes, type OverlayShape, type Ring } from "./overlay-shapes";
import type { MapPoint } from "./renderer-camera";
import { roomColours, trailVisible } from "./renderer-overlays";
import { rgba, type CanvasPalette } from "./theme-probe";
import { WIFI_BANDS, wifiBand } from "./wifi-scale";

const HEAD = `#version 300 es
precision highp float;
`;
const PROJECT = `uniform mat4 uViewProjection;
uniform float uHeight;
vec4 project(vec2 point) { return uViewProjection * vec4(point.x, uHeight, point.y, 1.0); }
`;
const FILL_VERTEX = `${HEAD}${PROJECT}layout(location=0) in vec2 aPoint;
void main() { gl_Position = project(aPoint); }`;
const FILL_FRAGMENT = `${HEAD}uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;
// A segment is drawn as a screen-space box around it, in two passes. The
// first blends the pixels the stroke covers fully and marks them in the
// stencil, so a path that crosses itself keeps one opacity. The second blends
// the antialiased edge, which only the nearest of a segment and its two
// neighbours draws, so a joint is covered once. Ends behind the camera are cut
// at the near plane (0.02, as in the camera's projection).
const STROKE_VERTEX = `${HEAD}${PROJECT}layout(location=0) in vec4 aPreviousStart;
layout(location=1) in vec4 aEndNext;
layout(location=2) in vec2 aArc;
uniform vec2 uViewport;
uniform float uReach;
flat out vec2 vPrevious;
flat out vec2 vStart;
flat out vec2 vEnd;
flat out vec2 vNext;
flat out vec2 vArc;
vec2 screen(vec4 point) { return (point.xy / point.w * 0.5 + 0.5) * uViewport; }
void main() {
  vec4 previous = project(aPreviousStart.xy);
  vec4 start = project(aPreviousStart.zw);
  vec4 end = project(aEndNext.xy);
  vec4 next = project(aEndNext.zw);
  vArc = aArc;
  if (start.w < 0.02 && end.w < 0.02) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (start.w < 0.02) {
    float cut = (0.02 - start.w) / (end.w - start.w);
    start = mix(start, end, cut);
    vArc.x = mix(aArc.x, aArc.y, cut);
    previous = start;
  }
  if (end.w < 0.02) {
    float cut = (0.02 - end.w) / (start.w - end.w);
    end = mix(end, start, cut);
    vArc.y = mix(aArc.y, aArc.x, cut);
    next = end;
  }
  if (previous.w < 0.02) previous = start;
  if (next.w < 0.02) next = end;
  vPrevious = screen(previous);
  vStart = screen(start);
  vEnd = screen(end);
  vNext = screen(next);
  vec2 along = vEnd - vStart;
  float span = length(along);
  along = span > 0.0001 ? along / span : vec2(1.0, 0.0);
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vec2 point = mix(vStart - along * uReach, vEnd + along * uReach, corner.x)
    + vec2(-along.y, along.x) * uReach * (corner.y * 2.0 - 1.0);
  gl_Position = vec4(point / uViewport * 2.0 - 1.0, 0.0, 1.0);
}`;
const STROKE_FRAGMENT = `${HEAD}flat in vec2 vPrevious;
flat in vec2 vStart;
flat in vec2 vEnd;
flat in vec2 vNext;
flat in vec2 vArc;
uniform vec4 uColor;
uniform float uHalfWidth;
uniform vec3 uDash;
uniform bool uEdge;
out vec4 outColor;
float along(vec2 point, vec2 start, vec2 end) {
  vec2 line = end - start;
  return clamp(dot(point - start, line) / max(dot(line, line), 0.00000001), 0.0, 1.0);
}
float distanceTo(vec2 point, vec2 start, vec2 end) {
  return length(point - mix(start, end, along(point, start, end)));
}
void main() {
  vec2 point = gl_FragCoord.xy;
  float distance = distanceTo(point, vStart, vEnd);
  float alpha = clamp(uHalfWidth + 0.5 - distance, 0.0, 1.0);
  if (uDash.y > 0.0) {
    float dash = mod(mix(vArc.x, vArc.y, along(point, vStart, vEnd)) * uDash.z + 0.5, uDash.y) - 0.5;
    alpha *= clamp(min(dash, uDash.x - dash) + 0.5, 0.0, 1.0);
  }
  if (uEdge ? alpha <= 0.0 || alpha >= 1.0
    || (vPrevious != vStart && distanceTo(point, vPrevious, vStart) <= distance)
    || distanceTo(point, vEnd, vNext) < distance : alpha < 1.0) discard;
  outColor = vec4(uColor.rgb, uColor.a * alpha);
}`;
const SURFACE_VERTEX = `${HEAD}${PROJECT}layout(location=0) in vec2 aPoint;
out vec2 vTexel;
void main() {
  vTexel = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  gl_Position = project(aPoint);
}`;
// Filtering the premultiplied mean between texels and banding it per pixel
// keeps band edges smooth; a band starts half a dBm early, as rounding does.
const SURFACE_FRAGMENT = `${HEAD}uniform sampler2D uImage;
in vec2 vTexel;
out vec4 outColor;
void main() {
  vec2 value = texture(uImage, vTexel).rg;
  if (value.g <= 0.0) discard;
  float dbm = value.r / value.g;
  outColor = vec4(${WIFI_BANDS.map(({ from, colour }) => `${Number.isFinite(from) ? `dbm >= ${(from - 0.5).toFixed(1)} ? ` : ""}vec3(${colour.map((channel) => (channel / 255).toFixed(4)).join(", ")})`).join(" : ")}, value.g);
}`;
// The 2D painter maps each square of this many texels on its own, so a tilted
// view bends the image only at their seams.
const TILE = 32;

const STROKE_FLOATS = 10;
// Fills use the stencil's top bit for the even-odd rule; strokes number
// themselves in the other seven.
const FILL_BIT = 0x80;
const STROKE_BITS = 0x7f;

interface Program {
  readonly program: WebGLProgram;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly buffer: WebGLBuffer;
  readonly uniform: (name: string) => WebGLUniformLocation | null;
}

interface Command {
  readonly shape: OverlayShape;
  readonly first: number;
  readonly count: number;
}

const createProgram = (gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string, attributes: readonly number[]): Program => {
  const program = gl.createProgram();
  const vertexArray = gl.createVertexArray();
  const buffer = gl.createBuffer();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
    const shader = gl.createShader(type);
    if (!program || !shader) continue;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  if (program) gl.linkProgram(program);
  if (!program || !vertexArray || !buffer || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteVertexArray(vertexArray);
    gl.deleteBuffer(buffer);
    throw new Error("overlay-program-failed");
  }
  // More than one attribute means one instance per element.
  const stride = attributes.reduce((sum, size) => sum + size, 0) * 4;
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  let offset = 0;
  attributes.forEach((size, location) => {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    if (attributes.length > 1) gl.vertexAttribDivisor(location, 1);
    offset += size * 4;
  });
  gl.bindVertexArray(null);
  const locations = new Map<string, WebGLUniformLocation | null>();
  return { program, vertexArray, buffer, uniform: (name) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name) ?? null;
  } };
};

/**
 * Rooms, floor types, Wi-Fi signal, zones and the travel path as floor-plane
 * geometry. Buffers change only when a shape does, so a camera move is a new
 * matrix and nothing else. Without WebGL the same shapes are painted in 2D.
 */
export class OverlayGeometry {
  readonly #gl: WebGL2RenderingContext | null;
  #fill: Program | null = null;
  #stroke: Program | null = null;
  #surface: Program | null = null;
  #texture: WebGLTexture | null = null;
  /** The surface for the 2D painter, and its tiles that hold any colour. */
  #image: { readonly canvas: HTMLCanvasElement; readonly tiles: readonly (readonly [number, number])[] } | null = null;
  #shapes: readonly OverlayShape[] = [];
  #commands: Command[] = [];
  #inputs: unknown[] = [];
  #next: unknown[] = [];

  /** Throws when the context cannot build the overlay programs. */
  constructor(gl: WebGL2RenderingContext | null) {
    this.#gl = gl;
    if (!gl) return;
    try {
      this.#fill = createProgram(gl, FILL_VERTEX, FILL_FRAGMENT, [2]);
      this.#stroke = createProgram(gl, STROKE_VERTEX, STROKE_FRAGMENT, [4, 4, 2]);
      this.#surface = createProgram(gl, SURFACE_VERTEX, SURFACE_FRAGMENT, [2]);
    } catch (error) {
      this.dispose();
      throw error;
    }
    this.#texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) {
      gl.texParameteri(gl.TEXTURE_2D, name, value);
    }
  }

  /** True when the shapes are painted on the 2D canvas, not drawn in WebGL. */
  get painted(): boolean {
    return this.#gl === null;
  }

  /** Rebuilds the shapes when anything they are made from changed. */
  update(scene: SceneModel, state: WorkspaceState, palette: CanvasPalette): void {
    const next = this.#next;
    next.length = 0;
    next.push(scene.metadata, palette, state.labelsVisible, roomColours(state), state.dataMode, state.floor.readOnly,
      state.selection.floorId, state.floorTypes, state.wifiSignal,
      state.resources.areas.value?.zones, trailVisible(state) ? state.trail : null, state.workflow,
      state.selection.roomIds, state.planDraft.rooms, state.resources.plans.value?.rooms,
      state.resources.areas.value?.rooms);
    if (next.length === this.#inputs.length && next.every((value, index) => value === this.#inputs[index])) return;
    this.#next = this.#inputs;
    this.#inputs = next;
    this.#shapes = overlayShapes(scene, state, palette);
    if (this.#gl) this.#upload(this.#gl);
    else this.#image = paintable(this.#shapes);
  }

  #upload(gl: WebGL2RenderingContext): void {
    const fills: number[] = [];
    const strokes: number[] = [];
    const surface: number[] = [];
    // The travel path's two strokes share one set of segments.
    const stroked = new Map<readonly Ring[], { readonly first: number; readonly count: number }>();
    this.#commands = this.#shapes.map((shape) => {
      if (shape.kind === "surface") {
        const [x, z, rowX, rowZ, columnX, columnZ] = shape.corners;
        surface.push(x!, z!, rowX!, rowZ!, columnX!, columnZ!, rowX! + columnX! - x!, rowZ! + columnZ! - z!);
        gl.bindTexture(gl.TEXTURE_2D, this.#texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, shape.columns, shape.rows, 0, gl.RG, gl.FLOAT, shape.values);
        return { shape, first: 0, count: 4 };
      }
      if (shape.kind === "fill") {
        const first = fills.length / 2;
        // A fan from each ring's first vertex; the stencil's even-odd count
        // turns the overlapping triangles into the polygon and its holes.
        for (const ring of shape.rings) {
          for (let index = 2; index + 3 < ring.length; index += 2) {
            fills.push(ring[0]!, ring[1]!, ring[index]!, ring[index + 1]!, ring[index + 2]!, ring[index + 3]!);
          }
        }
        return { shape, first, count: fills.length / 2 - first };
      }
      let range = stroked.get(shape.rings);
      if (!range) {
        const first = strokes.length / STROKE_FLOATS;
        for (const ring of shape.rings) {
          const points = ring.length / 2;
          const at = (index: number): number =>
            (shape.closed ? (index + points) % points : Math.max(0, Math.min(points - 1, index))) * 2;
          let arc = 0;
          // A lone point is one segment of no length, drawn as a dot.
          for (let index = 0; index < Math.max(1, points - (shape.closed ? 0 : 1)); index += 1) {
            const [previous, start, end, next] = [at(index - 1), at(index), at(index + 1), at(index + 2)];
            const length = Math.hypot(ring[end]! - ring[start]!, ring[end + 1]! - ring[start + 1]!);
            strokes.push(ring[previous]!, ring[previous + 1]!, ring[start]!, ring[start + 1]!,
              ring[end]!, ring[end + 1]!, ring[next]!, ring[next + 1]!, arc, arc + length);
            arc += length;
          }
        }
        range = { first, count: strokes.length / STROKE_FLOATS - first };
        stroked.set(shape.rings, range);
      }
      return { shape, ...range };
    });
    for (const [program, data] of [[this.#fill, fills], [this.#stroke, strokes], [this.#surface, surface]] as const) {
      gl.bindBuffer(gl.ARRAY_BUFFER, program!.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    }
  }

  /**
   * Draws over whatever the scene already holds, without depth, as the 2D
   * overlay did. `ratio` is device pixels per CSS pixel and `pixelsPerMeter`
   * the scale at the camera target, which sets the dash length.
   */
  draw(matrix: Float32Array, width: number, height: number, ratio: number, pixelsPerMeter: number): void {
    const gl = this.#gl;
    if (!gl || !this.#commands.length) return;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.STENCIL_TEST);
    let bound: Program | null = null;
    let strokeId = 0;
    for (const { shape, first, count } of this.#commands) {
      if (!count) continue;
      const program = (shape.kind === "fill" ? this.#fill : shape.kind === "stroke" ? this.#stroke : this.#surface)!;
      if (program !== bound) {
        bound = program;
        gl.useProgram(program.program);
        gl.bindVertexArray(program.vertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, program.buffer);
        gl.uniformMatrix4fv(program.uniform("uViewProjection"), false, matrix);
      }
      gl.uniform1f(program.uniform("uHeight"), shape.height);
      if (shape.kind === "surface") {
        gl.stencilMask(0);
        gl.stencilFunc(gl.ALWAYS, 0, 0);
        gl.bindTexture(gl.TEXTURE_2D, this.#texture);
        gl.drawArrays(gl.TRIANGLE_STRIP, first, count);
        continue;
      }
      const [red, green, blue] = shape.colour;
      gl.uniform4f(program.uniform("uColor"), red / 255, green / 255, blue / 255, shape.alpha);
      if (shape.kind === "fill") {
        gl.stencilMask(FILL_BIT);
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 0, 0);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        gl.drawArrays(gl.TRIANGLES, first, count);
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.NOTEQUAL, 0, FILL_BIT);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
        gl.drawArrays(gl.TRIANGLES, first, count);
        continue;
      }
      gl.stencilMask(STROKE_BITS);
      strokeId += 1;
      if (strokeId > STROKE_BITS) {
        gl.clear(gl.STENCIL_BUFFER_BIT);
        strokeId = 1;
      }
      gl.stencilFunc(gl.NOTEQUAL, strokeId, STROKE_BITS);
      const halfWidth = shape.width * ratio / 2;
      gl.uniform2f(program.uniform("uViewport"), width, height);
      gl.uniform1f(program.uniform("uHalfWidth"), halfWidth);
      gl.uniform1f(program.uniform("uReach"), halfWidth + 1);
      gl.uniform3f(program.uniform("uDash"), 5 * ratio, shape.dashed ? 9 * ratio : 0, pixelsPerMeter);
      const offset = first * STROKE_FLOATS * 4;
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, STROKE_FLOATS * 4, offset);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STROKE_FLOATS * 4, offset + 16);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STROKE_FLOATS * 4, offset + 32);
      gl.uniform1i(program.uniform("uEdge"), 0);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.uniform1i(program.uniform("uEdge"), 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
    gl.bindVertexArray(null);
    gl.stencilMask(0xff);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.DEPTH_TEST);
  }

  /** The Canvas 2D rendering of the same shapes, for a browser without WebGL2. */
  paint(context: CanvasRenderingContext2D, project: (x: number, height: number, z: number) => MapPoint | null): void {
    context.save();
    for (const shape of this.#shapes) {
      if (shape.kind === "surface") {
        if (!this.#image) continue;
        const { corners, columns, rows, height } = shape;
        const at = (column: number, row: number): MapPoint | null => project(
          corners[0]! + (corners[2]! - corners[0]!) * column / columns + (corners[4]! - corners[0]!) * row / rows, height,
          corners[1]! + (corners[3]! - corners[1]!) * column / columns + (corners[5]! - corners[1]!) * row / rows);
        for (const [column, row] of this.#image.tiles) {
          const [width, depth] = [Math.min(TILE, columns - column), Math.min(TILE, rows - row)];
          const [origin, across, down] = [at(column, row), at(column + width, row), at(column, row + depth)];
          if (!origin || !across || !down) continue;
          context.save();
          context.transform((across.x - origin.x) / width, (across.y - origin.y) / width,
            (down.x - origin.x) / depth, (down.y - origin.y) / depth, origin.x, origin.y);
          context.drawImage(this.#image.canvas, column, row, width, depth, 0, 0, width, depth);
          context.restore();
        }
        continue;
      }
      const closed = shape.kind === "fill" || shape.closed;
      context.beginPath();
      for (const ring of shape.rings) {
        let started = false;
        for (let offset = 0; offset < ring.length; offset += 2) {
          const point = project(ring[offset]!, shape.height, ring[offset + 1]!);
          if (!point) continue;
          if (started) context.lineTo(point.x, point.y);
          else context.moveTo(point.x, point.y);
          // A lone observation is a dot: the round caps of a line 0.05 px long.
          // WebKit draws no caps on a line of no length.
          if (ring.length === 2) context.lineTo(point.x + 0.05, point.y);
          started = true;
        }
        if (started && closed) context.closePath();
      }
      if (shape.kind === "fill") {
        context.fillStyle = rgba(shape.colour, shape.alpha);
        context.fill("evenodd");
      } else {
        context.lineWidth = shape.width;
        context.lineJoin = "round";
        context.lineCap = shape.dashed ? "butt" : "round";
        context.setLineDash(shape.dashed ? [5, 4] : []);
        context.strokeStyle = rgba(shape.colour, shape.alpha);
        context.stroke();
      }
    }
    context.restore();
  }

  dispose(): void {
    const gl = this.#gl;
    for (const program of [this.#fill, this.#stroke, this.#surface]) {
      if (!gl || !program) continue;
      gl.deleteProgram(program.program);
      gl.deleteVertexArray(program.vertexArray);
      gl.deleteBuffer(program.buffer);
    }
    gl?.deleteTexture(this.#texture);
    this.#image = null;
  }
}

/** The surface as a canvas the 2D painter can draw from, with its tiles that hold any colour. */
const paintable = (shapes: readonly OverlayShape[]): { canvas: HTMLCanvasElement; tiles: [number, number][] } | null => {
  const surface = shapes.find((shape) => shape.kind === "surface");
  if (!surface) return null;
  const { values, columns, rows } = surface;
  const pixels = new Uint8ClampedArray(columns * rows * 4);
  for (let index = 0; index < columns * rows; index += 1) {
    const alpha = values[index * 2 + 1]!;
    if (alpha) pixels.set([...wifiBand(values[index * 2]! / alpha).colour, alpha * 255], index * 4);
  }
  const canvas = Object.assign(document.createElement("canvas"), { width: columns, height: rows });
  canvas.getContext("2d")?.putImageData(new ImageData(pixels, columns, rows), 0, 0);
  const tiles: [number, number][] = [];
  for (let row = 0; row < rows; row += TILE) {
    for (let column = 0; column < columns; column += TILE) {
      let filled = false;
      for (let j = row; j < Math.min(rows, row + TILE) && !filled; j += 1) {
        for (let i = column; i < Math.min(columns, column + TILE) && !filled; i += 1) filled = pixels[(j * columns + i) * 4 + 3]! > 0;
      }
      if (filled) tiles.push([column, row]);
    }
  }
  return { canvas, tiles };
};
