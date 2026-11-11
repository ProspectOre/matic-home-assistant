export const PERSPECTIVE_FIELD_OF_VIEW = Math.PI / 3.15;

export interface SceneGeometryBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minHeight: number;
  readonly maxHeight: number;
}

export interface PerspectiveFitBounds {
  /** World-space bounds relative to the camera target. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly minHeight: number;
  readonly maxHeight: number;
}

export interface SceneFitBounds {
  readonly floor: SceneGeometryBounds;
  readonly all: SceneGeometryBounds;
}

/** Floor and full-scene bounds from one scan of admitted map points. */
export const sceneGeometryBounds = (
  buffer: ArrayBuffer,
  pointOffset: number,
  floorCount: number,
  totalCount: number,
  fallbackSpan: readonly [number, number],
): SceneFitBounds => {
  type MutableBounds = { minX: number; maxX: number; minY: number; maxY: number; minHeight: number; maxHeight: number };
  const empty = (): MutableBounds => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
    minHeight: Infinity, maxHeight: -Infinity });
  const floor = empty();
  const all = empty();
  const safeTotal = pointOffset < 0 ? 0 : Math.max(0, Math.min(Math.trunc(totalCount), Math.floor((buffer.byteLength - pointOffset) / 8)));
  const safeFloor = Math.max(0, Math.min(Math.trunc(floorCount), safeTotal));
  const include = (bounds: MutableBounds, x: number, y: number, height: number): void => {
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
    bounds.minHeight = Math.min(bounds.minHeight, height); bounds.maxHeight = Math.max(bounds.maxHeight, height);
  };
  if (safeTotal > 0) {
    const points = new DataView(buffer, pointOffset, safeTotal * 8);
    for (let index = 0; index < safeTotal; index += 1) {
      const offset = index * 8;
      const x = points.getUint16(offset, true);
      const y = points.getUint16(offset + 2, true);
      const height = points.getUint8(offset + 4);
      include(all, x, y, height);
      if (index < safeFloor) include(floor, x, y, height);
    }
  }
  const fallback = (): SceneGeometryBounds => ({ minX: 0, maxX: Math.max(0, fallbackSpan[0] - 1), minY: 0,
    maxY: Math.max(0, fallbackSpan[1] - 1), minHeight: 0, maxHeight: 0 });
  const finish = (bounds: MutableBounds): SceneGeometryBounds =>
    Number.isFinite(bounds.minX) ? bounds : fallback();
  return { floor: finish(floor), all: finish(all) };
};

/**
 * Fits the complete world-space box inside a perspective view. The eight box
 * corners are evaluated against the actual view frustum, avoiding the extra
 * room required by a sphere around a flat rectangular floor. Edge padding is
 * expressed as a fraction of each viewport dimension.
 */
export const perspectiveBoundsFitDistance = (
  bounds: PerspectiveFitBounds,
  aspect: number,
  pitch: number,
  yaw = -Math.PI / 4,
  edgePadding = 0.05,
): number => {
  const safeAspect = Math.max(0.2, aspect);
  const safeEdge = Math.max(0.5, 1 - 2 * edgePadding);
  const focal = 1 / Math.tan(PERSPECTIVE_FIELD_OF_VIEW / 2);
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  let distance = 0;
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const z of [bounds.minZ, bounds.maxZ]) {
      for (const height of [bounds.minHeight, bounds.maxHeight]) {
        const cameraRight = x * cosYaw - z * sinYaw;
        const cameraUp = -x * sinYaw * sinPitch + height * cosPitch - z * cosYaw * sinPitch;
        const towardCamera = x * sinYaw * cosPitch + height * sinPitch + z * cosYaw * cosPitch;
        distance = Math.max(
          distance,
          towardCamera + Math.abs(focal * cameraRight / safeAspect) / safeEdge,
          towardCamera + Math.abs(focal * cameraUp) / safeEdge,
        );
      }
    }
  }
  return Math.max(0.1, distance);
};

// The matrix builders write into `out` and return it, so a frame allocates
// none. `out` must not be one of `multiply`'s operands.
export const multiply = (out: Float32Array, left: Float32Array, right: Float32Array): Float32Array => {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += (left[index * 4 + row] ?? 0) * (right[column * 4 + index] ?? 0);
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
};

export const perspective = (out: Float32Array, fieldOfView: number, aspect: number, near: number, far: number): Float32Array => {
  const focal = 1 / Math.tan(fieldOfView / 2);
  out.fill(0);
  out[0] = focal / aspect;
  out[5] = focal;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
};

export const orthographic = (
  out: Float32Array,
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Float32Array => {
  out.fill(0);
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = -2 / (far - near);
  out[12] = -(right + left) / (right - left);
  out[13] = -(top + bottom) / (top - bottom);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
};

/** A view matrix looking from the eye at the target, with the floor's normal up. */
export const lookAt = (
  out: Float32Array,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
): Float32Array => {
  const forwardLength = Math.hypot(eyeX - targetX, eyeY - targetY, eyeZ - targetZ) || 1;
  const zX = (eyeX - targetX) / forwardLength;
  const zY = (eyeY - targetY) / forwardLength;
  const zZ = (eyeZ - targetZ) / forwardLength;
  const rightLength = Math.hypot(zZ, zX) || 1;
  const xX = zZ / rightLength;
  const xZ = -zX / rightLength;
  const yX = zY * xZ;
  const yY = zZ * xX - zX * xZ;
  const yZ = -zY * xX;
  out[0] = xX; out[1] = yX; out[2] = zX; out[3] = 0;
  out[4] = 0; out[5] = yY; out[6] = zY; out[7] = 0;
  out[8] = xZ; out[9] = yZ; out[10] = zZ; out[11] = 0;
  out[12] = -(xX * eyeX + xZ * eyeZ);
  out[13] = -(yX * eyeX + yY * eyeY + yZ * eyeZ);
  out[14] = -(zX * eyeX + zY * eyeY + zZ * eyeZ);
  out[15] = 1;
  return out;
};

export const pointInPolygon = (x: number, y: number, boundary: readonly (readonly [number, number])[]): boolean => {
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
