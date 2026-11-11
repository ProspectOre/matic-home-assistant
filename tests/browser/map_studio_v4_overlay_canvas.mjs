/**
 * Leaves the renderer without WebGL2, so it paints the overlay shapes on the
 * 2D canvas, where a test can record the calls. WebGL draws the same shapes
 * from the same model; map_studio_v4_overlay_geometry.spec.mjs reads those
 * back as pixels.
 */
export const paintOverlayOnCanvas = (page) => page.addInitScript(() => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    return kind === "webgl2" ? null : getContext.call(this, kind, ...rest);
  };
});
