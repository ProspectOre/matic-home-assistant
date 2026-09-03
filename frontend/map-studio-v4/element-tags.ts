const buildToken = (() => {
  const match = import.meta.url.match(
    /\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u,
  );
  return match?.[1] ?? "dev";
})();
const suffix = buildToken === "dev" ? "" : `-${buildToken}`;

// Home Assistant retains previously registered extra-module URLs. Version
// every custom element so a newer content-addressed module tree cannot be
// shadowed by an older constructor already present in the page registry.
export const MAP_CANVAS_TAG = `matic-map-canvas-v4${suffix}`;
export const PRECISION_CONTROLS_TAG = `matic-precision-controls-v4${suffix}`;
export const WORKFLOW_TAG = `matic-map-workflow-v4${suffix}`;
export const SHELL_TAG = `matic-map-shell-v4${suffix}`;
export const PANEL_TAG = `matic-map-panel-v0-4-0${suffix}`;
