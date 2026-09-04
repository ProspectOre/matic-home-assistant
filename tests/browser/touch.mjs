// Touch-input helpers shared by the browser specs. Dependency-free.
//
// All coordinates passed to `touchDrag` and `twoFingerPinch` are client pixels
// relative to the locator's bounding-box origin (top-left corner); they are
// translated to viewport clientX/clientY before dispatch.

export function pointer(type, pointerId, x, y) {
  return { type, init: { bubbles: true, cancelable: true, pointerId, pointerType: "touch", isPrimary: pointerId === 11, button: 0, clientX: x, clientY: y } };
}

async function origin(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("touch helper: locator has no bounding box");
  return box;
}

async function dispatch(locator, event) {
  await locator.dispatchEvent(event.type, event.init);
}

function wait(page, ms) {
  return ms > 0 ? page.waitForTimeout(ms) : Promise.resolve();
}

/**
 * Single-finger drag: pointerdown at points[0], pointermove through the rest
 * spaced `stepMs` apart, then pointerup at the final point.
 */
export async function touchDrag(page, locator, points, { pointerId = 11, stepMs = 16 } = {}) {
  if (!points?.length) throw new Error("touchDrag: at least one point is required");
  const box = await origin(locator);
  const at = ([x, y]) => [box.x + x, box.y + y];
  const [x0, y0] = at(points[0]);
  await dispatch(locator, pointer("pointerdown", pointerId, x0, y0));
  for (const point of points.slice(1)) {
    await wait(page, stepMs);
    const [x, y] = at(point);
    await dispatch(locator, pointer("pointermove", pointerId, x, y));
  }
  const [xn, yn] = at(points[points.length - 1]);
  await dispatch(locator, pointer("pointerup", pointerId, xn, yn));
}

/**
 * Two-finger gesture: pointers 11 (a) and 12 (b) go down at `from`, move in
 * `steps` interpolated increments to `to`, then both lift.
 */
export async function twoFingerPinch(page, locator, from, to, steps = 8) {
  const box = await origin(locator);
  const lerp = (a, b, t) => [box.x + a[0] + (b[0] - a[0]) * t, box.y + a[1] + (b[1] - a[1]) * t];
  const [ax0, ay0] = lerp(from.a, to.a, 0);
  const [bx0, by0] = lerp(from.b, to.b, 0);
  await dispatch(locator, pointer("pointerdown", 11, ax0, ay0));
  await dispatch(locator, pointer("pointerdown", 12, bx0, by0));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await wait(page, 16);
    const [ax, ay] = lerp(from.a, to.a, t);
    const [bx, by] = lerp(from.b, to.b, t);
    await dispatch(locator, pointer("pointermove", 11, ax, ay));
    await dispatch(locator, pointer("pointermove", 12, bx, by));
  }
  const [ax1, ay1] = lerp(from.a, to.a, 1);
  const [bx1, by1] = lerp(from.b, to.b, 1);
  await dispatch(locator, pointer("pointerup", 11, ax1, ay1));
  await dispatch(locator, pointer("pointerup", 12, bx1, by1));
}
