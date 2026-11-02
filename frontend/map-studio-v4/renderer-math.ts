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

export const multiply = (left: Float32Array, right: Float32Array): Float32Array => {
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

export const perspective = (fieldOfView: number, aspect: number, near: number, far: number): Float32Array => {
  const focal = 1 / Math.tan(fieldOfView / 2);
  const result = new Float32Array(16);
  result[0] = focal / aspect;
  result[5] = focal;
  result[10] = (far + near) / (near - far);
  result[11] = -1;
  result[14] = (2 * far * near) / (near - far);
  return result;
};

export const orthographic = (
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

export const lookAt = (eye: readonly number[], target: readonly number[]): Float32Array => {
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
