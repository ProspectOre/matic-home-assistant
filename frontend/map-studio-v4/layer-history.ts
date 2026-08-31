import type { WorkspaceState } from "./contracts";
import { WorkspaceStore } from "./state";

const layerDepth = (state: WorkspaceState): number =>
  (state.workflow === "none" ? 0 : 1)
  + (state.fullMap ? 1 : 0)
  + (state.precisionOpen ? 1 : 0)
  + (state.dialog ? 1 : 0);

interface LayerMarker {
  readonly owner: string;
  readonly depth: number;
}

const markerFrom = (value: unknown): LayerMarker | null => {
  if (!value || typeof value !== "object") return null;
  const marker = (value as { maticMapLayer?: unknown }).maticMapLayer;
  if (!marker || typeof marker !== "object") return null;
  const owner = (marker as { owner?: unknown }).owner;
  const depth = (marker as { depth?: unknown }).depth;
  return typeof owner === "string" && Number.isInteger(depth) && Number(depth) >= 0
    ? { owner, depth: Number(depth) }
    : null;
};

export class LayerHistoryController {
  readonly #store: WorkspaceStore;
  readonly #owner = `matic-map-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  #depth = 0;
  #unsubscribe: (() => void) | null = null;
  #handlingPop = false;

  constructor(store: WorkspaceStore) {
    this.#store = store;
  }

  start(): void {
    if (this.#unsubscribe) return;
    this.#depth = layerDepth(this.#store.value);
    this.#unsubscribe = this.#store.subscribe((state) => this.#stateChanged(state));
    window.addEventListener("popstate", this.#popState);
  }

  #stateChanged(state: WorkspaceState): void {
    const next = layerDepth(state);
    if (this.#handlingPop) {
      this.#handlingPop = false;
      this.#depth = next;
      return;
    }
    if (next > this.#depth) {
      for (let depth = this.#depth + 1; depth <= next; depth += 1) {
        const current = history.state && typeof history.state === "object" ? history.state : {};
        history.pushState({
          ...current,
          maticMapLayer: { owner: this.#owner, depth },
        }, "", window.location.href);
      }
    }
    this.#depth = next;
  }

  readonly #popState = (): void => {
    if (this.#depth < 1) return;
    this.#handlingPop = true;
    this.#store.dispatch({ type: "dismiss-top-layer" });
  };

  dismissTop(): boolean {
    if (this.#depth < 1) return false;
    const marker = markerFrom(history.state);
    if (marker?.owner === this.#owner && marker.depth === this.#depth) {
      history.back();
    } else {
      this.#store.dispatch({ type: "dismiss-top-layer" });
    }
    return true;
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    window.removeEventListener("popstate", this.#popState);
    this.#depth = 0;
  }
}

export { layerDepth };
