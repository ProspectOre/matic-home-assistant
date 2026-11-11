import type { SceneModel } from "./backend-contracts";
import type { WorkspaceState } from "./contracts";
import { overlayShapes, type OverlayShape, type Ring } from "./overlay-shapes";
import type { MapPoint } from "./renderer-camera";
import { roomColours, trailVisible } from "./renderer-overlays";
import { rgba, type CanvasPalette } from "./theme-probe";

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
const DISC_VERTEX = `${HEAD}${PROJECT}layout(location=0) in vec3 aDisc;
layout(location=1) in vec3 aColor;
out vec2 vOffset;
out vec3 vColor;
void main() {
  vOffset = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  vColor = aColor;
  gl_Position = project(aDisc.xy + vOffset * aDisc.z);
}`;
// The same falloff as the 2D gradient: .65 at the sample, .4 at 65 % of the
// radius, clear at the edge.
const DISC_FRAGMENT = `${HEAD}in vec2 vOffset;
in vec3 vColor;
out vec4 outColor;
void main() {
  float radius = length(vOffset);
  if (radius >= 1.0) discard;
  outColor = vec4(vColor, radius < 0.65 ? mix(0.65, 0.4, radius / 0.65) : mix(0.4, 0.0, (radius - 0.65) / 0.35));
}`;

const STROKE_FLOATS = 10;
const DISC_FLOATS = 6;
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
  #discs: Program | null = null;
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
      this.#discs = createProgram(gl, DISC_VERTEX, DISC_FRAGMENT, [3, 3]);
    } catch (error) {
      this.dispose();
      throw error;
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
      state.selection.floorId, state.floorTypes, state.wifiSignal, state.wifiScale,
      state.resources.areas.value?.zones, trailVisible(state) ? state.trail : null, state.workflow,
      state.selection.roomIds, state.planDraft.rooms, state.resources.plans.value?.rooms,
      state.resources.areas.value?.rooms);
    if (next.length === this.#inputs.length && next.every((value, index) => value === this.#inputs[index])) return;
    this.#next = this.#inputs;
    this.#inputs = next;
    this.#shapes = overlayShapes(scene, state, palette);
    if (this.#gl) this.#upload(this.#gl);
  }

  #upload(gl: WebGL2RenderingContext): void {
    const fills: number[] = [];
    const strokes: number[] = [];
    const discs: number[] = [];
    // The travel path's two strokes share one set of segments.
    const stroked = new Map<readonly Ring[], { readonly first: number; readonly count: number }>();
    this.#commands = this.#shapes.map((shape) => {
      if (shape.kind === "discs") {
        const first = discs.length / DISC_FLOATS;
        for (const value of shape.discs) discs.push(value);
        return { shape, first, count: shape.discs.length / DISC_FLOATS };
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
    for (const [program, data] of [[this.#fill, fills], [this.#stroke, strokes], [this.#discs, discs]] as const) {
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
      const program = (shape.kind === "fill" ? this.#fill : shape.kind === "stroke" ? this.#stroke : this.#discs)!;
      if (program !== bound) {
        bound = program;
        gl.useProgram(program.program);
        gl.bindVertexArray(program.vertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, program.buffer);
        gl.uniformMatrix4fv(program.uniform("uViewProjection"), false, matrix);
      }
      gl.uniform1f(program.uniform("uHeight"), shape.height);
      if (shape.kind === "discs") {
        gl.stencilMask(0);
        gl.stencilFunc(gl.ALWAYS, 0, 0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, DISC_FLOATS * 4, first * DISC_FLOATS * 4);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, DISC_FLOATS * 4, first * DISC_FLOATS * 4 + 12);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
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
      if (shape.kind === "discs") {
        const { discs, height } = shape;
        for (let offset = 0; offset < discs.length; offset += DISC_FLOATS) {
          const [x, z, radius] = [discs[offset]!, discs[offset + 1]!, discs[offset + 2]!];
          // Derive the local projection near the sample. Projecting the full
          // footprint can cross behind the camera at close zoom and hide it.
          const step = 0.01;
          const centre = project(x, height, z);
          const east = project(x + step, height, z);
          const north = project(x, height, z + step);
          if (!centre || !east || !north) continue;
          const colour = [0, 1, 2].map((channel) => Math.round(discs[offset + 3 + channel]! * 255)).join(",");
          context.save();
          context.transform((east.x - centre.x) * radius / step, (east.y - centre.y) * radius / step,
            (north.x - centre.x) * radius / step, (north.y - centre.y) * radius / step, centre.x, centre.y);
          const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
          gradient.addColorStop(0, `rgba(${colour},.65)`);
          gradient.addColorStop(0.65, `rgba(${colour},.4)`);
          gradient.addColorStop(1, `rgba(${colour},0)`);
          context.fillStyle = gradient;
          context.fillRect(-1, -1, 2, 2);
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
          // A lone observation needs a zero-length line for its round cap.
          if (ring.length === 2) context.lineTo(point.x, point.y);
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
    for (const program of [this.#fill, this.#stroke, this.#discs]) {
      if (!gl || !program) continue;
      gl.deleteProgram(program.program);
      gl.deleteVertexArray(program.vertexArray);
      gl.deleteBuffer(program.buffer);
    }
  }
}
