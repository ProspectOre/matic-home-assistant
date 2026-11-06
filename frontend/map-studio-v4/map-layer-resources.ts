import type { MaticBackend } from "./backend";
import type { ResourceRequests } from "./resource-requests";
import type { WorkspaceStore } from "./state";
import { isAbort } from "./shared-primitives";
import { parseFloorTypes } from "./floor-types";
import { parseWifiSignal } from "./wifi-signal";
import { entryCoherenceIdentity } from "./backend-contracts";
import { CoverageResources } from "./coverage-resources";
export { PoseClock } from "./pose-clock";
export { parsePose } from "./pose-contract";

/** Load and refresh optional Wi-Fi and floor-type layers. */
export class MapLayerResources {
  #timer: number | null = null;
  #wifiTimer: number | null = null;
  #floorGeneration = -1;
  #wifiGeneration = -1;
  #coverage: CoverageResources | null = null;
  constructor(
    readonly store: WorkspaceStore,
    readonly backend: MaticBackend,
    readonly requests: ResourceRequests,
    readonly callbacks: { disposed: () => boolean; pageActive: () => boolean },
  ) {}

  startCoverage(): void {
    this.#coverage ??= new CoverageResources(this.store, this.backend, this.requests, this.callbacks);
    this.#coverage.start();
  }

  stopCoverage(): void {
    this.#coverage?.stop();
  }

  async start(): Promise<void> {
    if (this.#timer !== null) {
      if (this.#floorGeneration !== this.store.value.generation) await this.reload();
      return;
    }
    this.#timer = window.setInterval(() => {
      if (this.callbacks.pageActive()) void this.reload();
    }, 60_000);
    await this.reload();
  }

  stop(): void {
    this.requests.current("floor-types")?.abort();
    if (this.#timer !== null) window.clearInterval(this.#timer);
    this.#timer = null;
    this.#floorGeneration = -1;
  }

  async startWifi(): Promise<void> {
    if (this.#wifiTimer !== null) {
      if (this.#wifiGeneration !== this.store.value.generation) await this.reloadWifi();
      return;
    }
    this.#wifiTimer = window.setInterval(() => {
      if (this.callbacks.pageActive()) void this.reloadWifi();
    }, 30_000);
    await this.reloadWifi();
  }

  stopWifi(): void {
    this.requests.current("wifi-signal")?.abort();
    if (this.#wifiTimer !== null) window.clearInterval(this.#wifiTimer);
    this.#wifiTimer = null;
    this.#wifiGeneration = -1;
  }

  async reloadWifi(): Promise<void> {
    const entry = this.store.value.resources.entry;
    if (!this.store.value.wifiSignal || !entry?.wifiHeatmapUrl) {
      this.stopWifi();
      return;
    }
    const controller = this.requests.begin("wifi-signal");
    const generation = this.store.value.generation;
    this.#wifiGeneration = generation;
    const identity = entryCoherenceIdentity(entry);
    const current = (): boolean => !controller.signal.aborted && !this.callbacks.disposed()
      && Boolean(this.store.value.wifiSignal) && this.store.value.generation === generation
      && this.store.value.dataMode === "live" && this.store.value.selection.floorId === "current"
      && Boolean(this.store.value.resources.entry
        && entryCoherenceIdentity(this.store.value.resources.entry) === identity);
    try {
      const layer = parseWifiSignal(await this.backend.mapLayer("wifiSignal", entry.wifiHeatmapUrl, controller.signal));
      if (current()) this.store.patch({ wifiSignal: layer });
    } catch (error) {
      const shown = this.store.value.wifiSignal;
      if (!isAbort(error) && current() && shown) this.store.patch({ wifiSignal: { ...shown, status: "failed" } });
    } finally {
      this.requests.release("wifi-signal", controller);
    }
  }

  async reload(): Promise<void> {
    const entry = this.store.value.resources.entry;
    if (!this.store.value.floorTypes || !entry?.floorTypesUrl) {
      this.stop();
      return;
    }
    const controller = this.requests.begin("floor-types");
    const generation = this.store.value.generation;
    this.#floorGeneration = generation;
    const identity = entryCoherenceIdentity(entry);
    const current = (): boolean => !controller.signal.aborted && !this.callbacks.disposed()
      && Boolean(this.store.value.floorTypes) && this.store.value.generation === generation
      && this.store.value.dataMode === "live" && this.store.value.selection.floorId === "current"
      && Boolean(this.store.value.resources.entry
        && entryCoherenceIdentity(this.store.value.resources.entry) === identity);
    try {
      const layer = parseFloorTypes(await this.backend.mapLayer("carpetVents", entry.floorTypesUrl, controller.signal));
      if (current()) this.store.patch({ floorTypes: layer });
    } catch (error) {
      const shown = this.store.value.floorTypes;
      if (!isAbort(error) && current() && shown?.status === "loading") {
        this.store.patch({ floorTypes: { ...shown, status: "failed" } });
      }
    } finally {
      this.requests.release("floor-types", controller);
    }
  }
}
