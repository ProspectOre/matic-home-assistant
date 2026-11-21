import { html, nothing } from "lit";
import type { WorkspaceState } from "./contracts";

/** The live map did not load: nothing is shown, or a saved map stands in for it. */
export const liveMapFailed = (state: WorkspaceState): boolean =>
  state.dataMode === "live" && state.coherence === "degraded"
  && state.resources.scene.status !== "loading" && state.resources.scene.value?.source !== "live";

/** Home's Try again, which reads the map again; a failed live map says what failed. */
export const homeRetry = (
  state: WorkspaceState,
  t: (key: string, fallback: string) => string,
  recheck: () => void,
) => {
  const button = html`
    <button class="ms-btn ms-btn--secondary" type="button"
      aria-disabled=${state.rechecking ? "true" : nothing}
      @click=${() => { if (!state.rechecking) recheck(); }}
    >${t("v4_retry", "Try again")}</button>`;
  return liveMapFailed(state)
    ? html`<div class="problem home-actions" role="alert"><p>${t("v4_map_load_failed", "Home Assistant couldn't load the map.")}</p>${button}</div>`
    : html`<div class="home-actions">${button}</div>`;
};
