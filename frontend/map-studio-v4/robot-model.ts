import type { Channel } from "./theme-probe";
import { MIN_PIXELS } from "./robot-vector";

export { drawVectorRobot } from "./robot-vector";

// The robot as a lit mesh in the WebGL scene, so it turns with any heading and
// camera, stays sharp at any zoom and is hidden by walls in front of it. The
// shape is original and uses no vendor artwork; its dimensions are the ones
// maticrobots.com/product publishes.
//
// Robot-local metres: x forward, y to the left, z up, origin at the pose.

type Vec3 = readonly [x: number, y: number, z: number];

const BODY_LENGTH = 0.2794;
const BODY_WIDTH = 0.23876;
const BODY_X = -0.057;
const WHEEL_X = 0.01;
const WHEEL_Z = 0.079;
const WHEEL_WIDTH = 0.021;
const DECK = 0.198;
const LID = 0.1965;
/** Back of the body to the front of the cleaning head. */
export const LENGTH = 0.209 - BODY_X + BODY_LENGTH / 2;

const BODY = 0;
const TRIM = 1;
const ACCENT = 2;
const SHADOW = 3;
const CLEAR = 4;

// Cubic sections in (x, z), one row per segment, as the script drew them.
const NECK = [
  [0.050, 0.076, 0.062, 0.077, 0.071, 0.077, 0.075, 0.066],
  [0.075, 0.066, 0.079, 0.052, 0.084, 0.048, 0.101, 0.047],
  [0.101, 0.047, 0.111, 0.047, 0.119, 0.044, 0.121, 0.039],
  [0.121, 0.039, 0.125, 0.028, 0.119, 0.020, 0.109, 0.020],
  [0.109, 0.020, 0.073, 0.022, 0.054, 0.038, 0.050, 0.051],
  [0.050, 0.051, 0.047, 0.063, 0.047, 0.073, 0.050, 0.076],
] as const;
const HEAD = [
  [0.105, 0.025, 0.105, 0.012, 0.109, 0.003, 0.124, 0.003],
  [0.124, 0.003, 0.145, 0.003, 0.175, 0.003, 0.190, 0.005],
  [0.190, 0.005, 0.205, 0.007, 0.209, 0.015, 0.209, 0.030],
  [0.209, 0.030, 0.209, 0.055, 0.204, 0.067, 0.189, 0.074],
  [0.189, 0.074, 0.172, 0.081, 0.142, 0.079, 0.124, 0.077],
  [0.124, 0.077, 0.108, 0.076, 0.105, 0.068, 0.105, 0.054],
  [0.105, 0.054, 0.105, 0.044, 0.105, 0.034, 0.105, 0.025],
] as const;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const mean = (points: readonly Vec3[]): Vec3 => {
  const sum = points.reduce((total, point): Vec3 => [total[0] + point[0], total[1] + point[1], total[2] + point[2]], [0, 0, 0]);
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
};

/** A rounded rectangle, counter-clockwise from above, three facets to a corner. */
const outline = (length: number, width: number, radius: number, x: number, z: number): Vec3[] =>
  [[1, 1], [-1, 1], [-1, -1], [1, -1]].flatMap(([sx, sy], corner) => Array.from({ length: 4 }, (_, step): Vec3 => {
    const angle = (corner + step / 3) * Math.PI / 2;
    return [x + sx! * (length / 2 - radius) + radius * Math.cos(angle), sy! * (width / 2 - radius) + radius * Math.sin(angle), z];
  }));

/** A wheel's rim at `y`, in the x-z plane. */
const circle = (radius: number, y: number): Vec3[] => Array.from({ length: 16 }, (_, i): Vec3 =>
  [WHEEL_X + radius * Math.cos(i * Math.PI / 8), y, WHEEL_Z + radius * Math.sin(i * Math.PI / 8)]);

/** A closed cubic section in (x, z), `samples` points to a segment. */
const section = (segments: readonly (readonly number[])[], samples: number): (readonly [number, number])[] =>
  segments.flatMap((c) => Array.from({ length: samples }, (_, i): readonly [number, number] => {
    const t = i / samples;
    const [a, b, d, e] = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3];
    return [a * c[0]! + b * c[2]! + d * c[4]! + e * c[6]!, a * c[1]! + b * c[3]! + d * c[5]! + e * c[7]!];
  }));

/**
 * Interleaved position, normal and material per vertex, and triangles. Every
 * surface faces away from the `inside` point its part is built around.
 */
export const robotMesh = (): { readonly vertices: Float32Array; readonly indices: Uint16Array } => {
  const vertices: number[] = [];
  const indices: number[] = [];
  const vertex = (point: Vec3, normal: Vec3, material: number): number =>
    vertices.push(...point, ...normal, material) / 7 - 1;
  // A strip between two closed rings, smooth around them.
  const band = (lower: readonly Vec3[], upper: readonly Vec3[], inside: Vec3, material: number, upperMaterial = material): void => {
    const count = lower.length;
    const face = (i: number): Vec3 =>
      unit(cross(sub(lower[(i + 1) % count]!, lower[i]!), sub(upper[i]!, lower[i]!)));
    if (dot(face(0), sub(lower[0]!, inside)) < 0) return band(upper, lower, inside, upperMaterial, material);
    const faces = lower.map((_, i) => face(i));
    const first = vertices.length / 7;
    for (const [ring, kind] of [[lower, material], [upper, upperMaterial]] as const) {
      ring.forEach((point, i) => {
        const [a, b] = [faces[(i + count - 1) % count]!, faces[i]!];
        vertex(point, unit([a[0] + b[0], a[1] + b[1], a[2] + b[2]]), kind);
      });
    }
    for (let i = 0; i < count; i += 1) {
      const j = (i + 1) % count;
      indices.push(first + i, first + j, first + count + j, first + i, first + count + j, first + count + i);
    }
  };
  // A flat fan from the ring's centre; every ring here is star-shaped from it.
  const cap = (ring: readonly Vec3[], inside: Vec3, material: number): void => {
    const centre = mean(ring);
    const facing = cross(sub(ring[0]!, centre), sub(ring[1]!, centre));
    const ordered = dot(facing, sub(centre, inside)) < 0 ? [...ring].reverse() : ring;
    const normal = unit(cross(sub(ordered[0]!, centre), sub(ordered[1]!, centre)));
    const first = vertex(centre, normal, material);
    ordered.forEach((point) => vertex(point, normal, material));
    ordered.forEach((_, i) => indices.push(first, first + 1 + i, first + 1 + (i + 1) % ordered.length));
  };
  // Sections scaled about their centre at each y, closed at both ends.
  const shell = (segments: readonly (readonly number[])[], samples: number,
    sections: readonly (readonly [y: number, scale: number])[]): void => {
    const points = section(segments, samples);
    const xs = points.map(([x]) => x);
    const zs = points.map(([, z]) => z);
    const [x, z] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
    const inside: Vec3 = [x, 0, z];
    const rings = sections.map(([y, scale]) => points.map(([px, pz]): Vec3 => [x + (px - x) * scale, y, z + (pz - z) * scale]));
    rings.slice(1).forEach((ring, i) => band(rings[i]!, ring, inside, BODY));
    cap(rings[0]!, inside, BODY);
    cap(rings.at(-1)!, inside, BODY);
  };

  // A soft contact shadow, drawn first and fading out past the body.
  const below: Vec3 = [0, 0, -1];
  const middle = (0.209 + BODY_X - BODY_LENGTH / 2) / 2;
  const shadow = outline(LENGTH - 0.04, BODY_WIDTH - 0.04, 0.04, middle, 0.004);
  cap(shadow, below, SHADOW);
  band(outline(LENGTH + 0.06, BODY_WIDTH + 0.06, 0.07, middle, 0.004), shadow, below, CLEAR, SHADOW);

  // The shell curves in underneath; the camera chassis and the inset lid sit on top.
  const body: Vec3 = [BODY_X, 0, 0.1];
  const rings = ([[0.024, 0.246, 0.215, 0.036], [0.040, 0.275, 0.237, 0.039], [0.063, BODY_LENGTH, BODY_WIDTH, 0.04],
    [0.169, BODY_LENGTH, BODY_WIDTH, 0.04]] as const).map(([z, length, width, radius]) => outline(length, width, radius, BODY_X, z));
  rings.slice(1).forEach((ring, i) => band(rings[i]!, ring, body, BODY));
  const deck = outline(BODY_LENGTH, BODY_WIDTH, 0.04, BODY_X, DECK);
  const pocket = outline(0.2295, 0.208, 0.035, -0.072, DECK);
  const lid = outline(0.2235, 0.202, 0.032, -0.072, LID);
  band(rings.at(-1)!, deck, body, TRIM);
  band(deck, pocket, body, TRIM);
  // The recessed seam around the lid takes the theme's accent colour.
  band(pocket, lid, body, ACCENT);
  cap(lid, body, BODY);

  // Wheels stand 2 mm proud of the shell's sides so the two never share a plane.
  for (const side of [1, -1]) {
    const [outer, inner] = [side * (BODY_WIDTH / 2 + 0.002), side * (BODY_WIDTH / 2 - WHEEL_WIDTH)];
    const hub: Vec3 = [WHEEL_X, (outer + inner) / 2, WHEEL_Z];
    band(circle(0.079, inner), circle(0.079, outer), hub, TRIM);
    band(circle(0.079, outer), circle(0.0707, outer), hub, TRIM);
    cap(circle(0.0707, outer), hub, BODY);
  }

  // The neck's section is star-shaped from its centre at two samples a segment, not three.
  shell(NECK, 2, [[-0.049, 0.91], [-0.045, 1], [0.045, 1], [0.049, 0.91]]);
  shell(HEAD, 3, [[-BODY_WIDTH / 2, 0.79], [-0.108, 1], [0.108, 1], [BODY_WIDTH / 2, 0.79]]);
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
};

const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aMaterial;
uniform mat4 uViewProjection;
// World x and z of the pose, heading, and scale.
uniform vec4 uPose;
uniform vec3 uAccent;
out vec4 vColor;
// Robot-local to world: the world mirrors map x.
vec3 turn(vec3 local) {
  float c = cos(uPose.z), s = sin(uPose.z);
  return vec3(s * local.y - c * local.x, local.z, s * local.x + c * local.y);
}
void main() {
  gl_Position = uViewProjection * vec4(vec3(uPose.x, 0.0, uPose.y) + turn(aPosition) * uPose.w, 1.0);
  vec4 colors[5] = vec4[5](vec4(0.925, 0.941, 0.949, 1.0), vec4(0.149, 0.196, 0.22, 1.0), vec4(uAccent, 1.0),
    vec4(0.0, 0.0, 0.0, 0.28), vec4(0.0));
  vec4 color = colors[int(aMaterial)];
  // Light from above the map's upper left, as the 2D robot has it.
  float light = min(1.0, 0.68 + 0.4 * max(dot(turn(aNormal), vec3(0.36, 0.8, 0.48)), 0.0));
  vColor = vec4(color.rgb * light, color.a);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }`;

/** The robot's GPU resources; throws when the context cannot build them. */
export class RobotMesh {
  readonly #gl: WebGL2RenderingContext;
  readonly #program: WebGLProgram | null;
  readonly #vertexArray: WebGLVertexArrayObject | null;
  readonly #buffers: readonly (WebGLBuffer | null)[];
  readonly #count: number;
  readonly #viewProjection: WebGLUniformLocation | null;
  readonly #pose: WebGLUniformLocation | null;
  readonly #accentLocation: WebGLUniformLocation | null;
  #accent: Channel | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    const program = gl.createProgram();
    this.#program = program;
    this.#vertexArray = gl.createVertexArray();
    this.#buffers = [gl.createBuffer(), gl.createBuffer()];
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(type);
      if (!program || !shader) continue;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    if (program) gl.linkProgram(program);
    const [vertexBuffer, indexBuffer] = this.#buffers;
    if (!program || !this.#vertexArray || !vertexBuffer || !indexBuffer || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.dispose();
      throw new Error("robot-program-failed");
    }
    this.#viewProjection = gl.getUniformLocation(program, "uViewProjection");
    this.#pose = gl.getUniformLocation(program, "uPose");
    this.#accentLocation = gl.getUniformLocation(program, "uAccent");
    const { vertices, indices } = robotMesh();
    this.#count = indices.length;
    gl.bindVertexArray(this.#vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    for (const [location, size, offset] of [[0, 3, 0], [1, 3, 12], [2, 1, 24]] as const) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 28, offset);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  /**
   * Draws the robot at world (`x`, `z`) with depth. `focal` is CSS pixels per
   * metre at unit depth, which keeps the robot at least MIN_PIXELS long.
   */
  draw(matrix: Float32Array, x: number, z: number, heading: number, focal: number, accent: Channel): void {
    // The pose's clip w: its depth in perspective, 1 in the top view.
    const depth = matrix[3]! * x + matrix[11]! * z + matrix[15]!;
    if (depth <= 0) return;
    const gl = this.#gl;
    gl.useProgram(this.#program);
    if (accent !== this.#accent) {
      this.#accent = accent;
      gl.uniform3f(this.#accentLocation, accent[0] / 255, accent[1] / 255, accent[2] / 255);
    }
    gl.uniformMatrix4fv(this.#viewProjection, false, matrix);
    gl.uniform4f(this.#pose, x, z, heading, Math.max(1, MIN_PIXELS * depth / (LENGTH * focal)));
    gl.bindVertexArray(this.#vertexArray);
    gl.drawElements(gl.TRIANGLES, this.#count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.#gl.deleteProgram(this.#program);
    this.#gl.deleteVertexArray(this.#vertexArray);
    for (const buffer of this.#buffers) this.#gl.deleteBuffer(buffer);
  }
}
