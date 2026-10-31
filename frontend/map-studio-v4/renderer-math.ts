export const PERSPECTIVE_FIELD_OF_VIEW = Math.PI / 3.15;
const FIT_PADDING = 1.08;

export const perspectiveFitDistance = (radius: number, aspect: number): number => {
  const halfVertical = PERSPECTIVE_FIELD_OF_VIEW / 2;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * Math.max(0.2, aspect));
  return radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * FIT_PADDING;
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
