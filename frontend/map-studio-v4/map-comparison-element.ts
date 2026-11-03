import { LitElement, css, html, nothing } from "lit";
import { html as staticHtml, unsafeStatic } from "lit/static-html.js";
import "./map-canvas";
import type { MaticMapCanvasV4 } from "./map-canvas";
import type { ArchiveCatalog, ArchiveRecord } from "./archive-contracts";
import type { MaticBackend } from "./backend";
import type { SceneModel } from "./backend-contracts";
import type { DateFormat, Localize, NoticePlaceholders, WorkspaceState } from "./contracts";
import { initialWorkspaceState } from "./state";
import { MAP_CANVAS_TAG, MAP_COMPARISON_TAG } from "./element-tags";
import { classifyStructuralGrid, comparisonDecision, decodeCoverageMask, enrichComparisonScene, framesRegistered, synchronizedCamera, type ComparisonCamera, type ComparisonGrid } from "./map-comparison";
import { formatDateTime, translate } from "./localize";

const mapCanvasTag = unsafeStatic(MAP_CANVAS_TAG);

type RecordPair = readonly [string, string];
type CompareStatus = "idle" | "loading" | "ready" | "unavailable";
type ComparisonStatusCopy = { readonly key: string; readonly fallback: string; readonly placeholders?: NoticePlaceholders | undefined };

export class MaticMapComparisonV4 extends LitElement {
  static override properties = {
    backend: { attribute: false }, state: { attribute: false }, catalog: { attribute: false },
    recordIds: { attribute: false }, onSelectionChange: { attribute: false }, onClose: { attribute: false },
    localize: { attribute: false }, dates: { attribute: false },
  };
  static override styles = css`
    :host { display: block; min-block-size: 0; color: var(--primary-text-color, #222); }
    .wrap { display: grid; gap: 12px; min-block-size: 0; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .toolbar h2 { margin: 0 auto 0 0; font-size: 1rem; }
    .view { display: inline-flex; gap: 4px; }
    button, select { min-block-size: 44px; font: inherit; color: inherit; }
    .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; min-block-size: 240px; }
    .pane { display: grid; grid-template-rows: auto minmax(220px, 1fr); gap: 6px; min-inline-size: 0; min-block-size: 0; }
    .select { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; }
    select { inline-size: 100%; min-inline-size: 0; }
    .map-preview { display: block; min-block-size: 220px; block-size: 100%; border: 1px solid var(--divider-color, #888); border-radius: 10px; overflow: hidden; }
    .result, .status { padding: 8px 10px; border-radius: 8px; background: var(--card-background-color, #f6f6f6); }
    .counts { display: flex; flex-wrap: wrap; gap: 12px; }
    .counts span { white-space: nowrap; }
    .changed::before, .unchanged::before, .unknown::before { content: ""; display: inline-block; inline-size: .75em; block-size: .75em; margin-inline-end: .35em; border: 1px solid currentColor; }
    .changed::before { background: #c9514e; }
    .unchanged::before { background: #739b76; }
    .unknown::before { background: repeating-linear-gradient(45deg,#999 0 2px,transparent 2px 4px); }
    .status[hidden] { display: none; }
    @media (max-width: 680px) { .pair { grid-template-columns: 1fr; } .pane { min-block-size: 280px; } }
  `;

  backend: Pick<MaticBackend, "scene"> | null = null;
  state: WorkspaceState = initialWorkspaceState();
  catalog: ArchiveCatalog | null = null;
  recordIds: RecordPair | null = null;
  localize?: Localize;
  dates?: DateFormat;
  onSelectionChange?: (ids: RecordPair | null) => void;
  onClose?: () => void;

  #selected: RecordPair | null = null;
  #selectionInitialized = false;
  #pairScenes: readonly [SceneModel, SceneModel] | null = null;
  #pairRecords: readonly [ArchiveRecord, ArchiveRecord] | null = null;
  #loadingPair: readonly [ArchiveRecord, ArchiveRecord] | null = null;
  #status: CompareStatus = "idle";
  #statusCopy: ComparisonStatusCopy = {
    key: "v4_comparison_choose_maps", fallback: "Choose two saved maps to compare.",
  };
  #grid: ComparisonGrid | null = null;
  #registered = false;
  #view: "top" | "three" = "top";
  #controller: AbortController | null = null;
  #requestSerial = 0;
  #identity = "";
  #identityInitialized = false;
  #boundCanvases: readonly [MaticMapCanvasV4 | null, MaticMapCanvasV4 | null] = [null, null];

  #t(key: string, fallback: string, placeholders?: NoticePlaceholders): string {
    return translate(this.localize, key, fallback, placeholders, this.dates);
  }

  #setStatus(copy: ComparisonStatusCopy): void {
    this.#statusCopy = copy;
  }

  #statusText(): string {
    return this.#t(this.#statusCopy.key, this.#statusCopy.fallback, this.#statusCopy.placeholders);
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    const previousStatus = this.#status;
    const previousStatusCopy = this.#statusCopy;
    const previousSelected = this.#selected?.join("|") ?? null;
    let selectionNeedsLoad = false;
    const nextIdentity = `${this.state.owner?.userKey ?? ""}|${this.state.selection.entryId ?? ""}|${this.state.host.administrator}|${this.state.host.connected}|${this.state.pageActive}|${Boolean(this.backend)}`;
    if (nextIdentity !== this.#identity) {
      const firstIdentity = !this.#identityInitialized;
      this.#identityInitialized = true;
      this.#identity = nextIdentity;
      this.#clearPair(this.#hasAccess()
        ? { key: "v4_comparison_context_changed", fallback: "Your selected robot or Home Assistant user changed, so the comparison was cleared. Select two saved maps again." }
        : { key: "v4_comparison_access_required", fallback: "You need administrator access and two saved maps to compare maps. Sign in as an administrator, then select two saved maps." });
      this.#selected = null;
      this.#selectionInitialized = !firstIdentity || !this.#hasAccess();
      if (!firstIdentity) this.onSelectionChange?.(null);
    }
    if (changed.has("recordIds")) {
      if (this.recordIds) {
        this.#selected = [...this.recordIds];
        this.#selectionInitialized = true;
        selectionNeedsLoad = true;
      } else if (changed.get("recordIds") !== undefined) {
        this.#selected = null;
        this.#selectionInitialized = true;
        this.#clearPair({ key: "v4_comparison_choose_maps", fallback: "Choose two saved maps to compare." });
      }
    }
    const activeRecords = this.#activeRecords();
    if (this.#selected && this.#selected.some((id) => !activeRecords.some((record) => record.id === id))) {
      this.#clearPair({ key: "v4_comparison_map_missing", fallback: "One selected saved map is no longer available. Refresh saved maps, then choose two maps again." });
      this.#selected = null;
      this.#selectionInitialized = true;
      this.onSelectionChange?.(null);
    }
    if (!this.#selected && !this.#selectionInitialized) {
      this.#selected = this.#defaultPair(activeRecords);
      this.#selectionInitialized = true;
      if (this.#selected) {
        selectionNeedsLoad = true;
        this.onSelectionChange?.(this.#selected);
      }
    }
    if (this.#selected) {
      const pair = this.#recordsFor(this.#selected);
      if (pair && selectionNeedsLoad
        && !(this.#status === "loading" && this.#loadingPair && this.#samePair(pair, this.#loadingPair))) void this.#loadPair(pair);
      else if (pair && this.#pairRecords && !this.#samePair(pair, this.#pairRecords)) void this.#loadPair(pair);
    }
    if (changed.has("state") || changed.has("catalog") || changed.has("recordIds") || changed.has("backend")) {
      this.#publishPreviews();
    }
    if (previousStatus !== this.#status || previousStatusCopy.key !== this.#statusCopy.key
      || previousSelected !== (this.#selected?.join("|") ?? null)) this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#clearPair({ key: "v4_comparison_closed", fallback: "Comparison closed." });
    super.disconnectedCallback();
  }

  #activeRecords(): readonly ArchiveRecord[] {
    return (this.catalog?.records ?? []).filter((record) => record.retention !== "trash" && record.sceneUrl !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  #hasAccess(): boolean {
    return Boolean(this.backend && this.state.host.administrator && this.state.host.connected
      && this.state.pageActive && this.state.owner && this.state.selection.entryId);
  }

  #defaultPair(records: readonly ArchiveRecord[]): RecordPair | null {
    if (records.length < 2) return null;
    const newest = records[0]!;
    const priorCompatible = records.slice(1).find((record) => framesRegistered(record, newest));
    const second = priorCompatible ?? records[1]!;
    return [second.id, newest.id];
  }

  #recordsFor(ids: RecordPair): readonly [ArchiveRecord, ArchiveRecord] | null {
    const records = this.#activeRecords();
    const first = records.find((record) => record.id === ids[0]);
    const second = records.find((record) => record.id === ids[1]);
    return first && second && first.id !== second.id ? [first, second] : null;
  }

  #samePair(left: readonly [ArchiveRecord, ArchiveRecord], right: readonly [ArchiveRecord, ArchiveRecord]): boolean {
    return left[0].id === right[0].id && left[0].contentId === right[0].contentId && left[0].sceneUrl === right[0].sceneUrl
      && left[1].id === right[1].id && left[1].contentId === right[1].contentId && left[1].sceneUrl === right[1].sceneUrl;
  }

  #clearPair(copy: ComparisonStatusCopy): void {
    this.#requestSerial += 1;
    this.#controller?.abort();
    this.#controller = null;
    this.#pairScenes = null;
    this.#pairRecords = null;
    this.#loadingPair = null;
    this.#grid = null;
    this.#registered = false;
    this.#status = "unavailable";
    this.#setStatus(copy);
    const blank = initialWorkspaceState();
    const blankPreview: WorkspaceState = {
      ...blank,
      pageActive: true,
      dataMode: "history",
      workflow: "history",
      comparisonActive: false,
      floor: { ...blank.floor, readOnly: true },
      map: { ...blank.map, available: false, exactPose: false },
      resources: {
        ...blank.resources,
        scene: { status: "idle", value: null, problem: null },
        pose: { status: "idle", value: null, problem: null },
      },
    };
    for (const canvas of this.#previewElements()) {
      if (!canvas) continue;
      canvas.cameraChanged = () => {};
      canvas.state = blankPreview;
    }
  }

  async #loadPair(records: readonly [ArchiveRecord, ArchiveRecord]): Promise<void> {
    const backend = this.backend;
    if (!backend || !this.#hasAccess()
      || !records[0].sceneUrl || !records[1].sceneUrl) {
      this.#clearPair({ key: "v4_comparison_access_required", fallback: "You need administrator access and two saved maps to compare maps. Sign in as an administrator, then select two saved maps." });
      this.requestUpdate();
      return;
    }
    this.#controller?.abort();
    const controller = this.#controller = new AbortController();
    const serial = ++this.#requestSerial;
    this.#loadingPair = records;
    this.#pairScenes = null;
    this.#pairRecords = null;
    this.#grid = null;
    this.#registered = framesRegistered(records[0], records[1]);
    this.#status = "loading";
    this.#setStatus({ key: "v4_comparison_loading", fallback: "Loading the two selected saved maps…" });
    this.requestUpdate();
    try {
      const [firstResponse, secondResponse] = await Promise.all([
        backend.scene(records[0].sceneUrl!, records[0].revision, true, "history", controller.signal),
        backend.scene(records[1].sceneUrl!, records[1].revision, true, "history", controller.signal),
      ]);
      if (controller.signal.aborted || serial !== this.#requestSerial) return;
      const firstSource = firstResponse.scene, secondSource = secondResponse.scene;
      if (!firstSource || !secondSource || firstSource.revision !== records[0].revision || secondSource.revision !== records[1].revision
        || firstSource.source !== "history" || secondSource.source !== "history") throw new Error("comparison-scene-unavailable");
      const first = enrichComparisonScene(firstSource), second = enrichComparisonScene(secondSource);
      this.#pairScenes = [first, second];
      this.#pairRecords = records;
      const decision = comparisonDecision(records[0], records[1]);
      if (decision.eligible && this.#recordFrameMatches(records[0], first) && this.#recordFrameMatches(records[1], second)) {
        const coverageA = first.metadata.coverage, coverageB = second.metadata.coverage;
        if (coverageA && coverageB) {
          const [maskA, maskB] = await Promise.all([decodeCoverageMask(coverageA), decodeCoverageMask(coverageB)]);
          if (controller.signal.aborted || serial !== this.#requestSerial) return;
          this.#grid = classifyStructuralGrid(first, second, maskA, maskB);
        }
      }
      if (controller.signal.aborted || serial !== this.#requestSerial) return;
      this.#status = "ready";
      this.#setStatus(this.#grid
        ? { key: "v4_comparison_ready", fallback: "The maps line up and show the same parts of the floor." }
        : this.#registered
          ? { key: "v4_comparison_aligned_no_shared", fallback: "The maps line up, but don't show enough of the same floor to count differences." }
          : { key: "v4_comparison_unaligned", fallback: "These maps can be viewed side by side. They don't line up, so differences can't be counted." });
      this.requestUpdate();
      await this.updateComplete;
      this.#publishPreviews();
    } catch {
      if (controller.signal.aborted || serial !== this.#requestSerial) return;
      this.#pairScenes = null;
      this.#pairRecords = null;
      this.#grid = null;
      this.#status = "unavailable";
      this.#setStatus({ key: "v4_comparison_load_error", fallback: "These saved maps could not be loaded. Refresh saved maps, then choose both maps again." });
      this.requestUpdate();
    } finally {
      if (this.#loadingPair === records) this.#loadingPair = null;
      if (this.#controller === controller) this.#controller = null;
    }
  }

  #recordFrameMatches(record: ArchiveRecord, scene: SceneModel): boolean {
    const frame = record.frame, coverage = scene.metadata.coverage;
    return Boolean(frame && coverage && frame.formatVersion === 1 && frame.coordinateVersion === 1
      && frame.originCells[0] === coverage.originCells[0] && frame.originCells[1] === coverage.originCells[1]
      && frame.metersPerCell === coverage.metersPerCell
      && frame.spanCells[0] === coverage.spanCells[0] && frame.spanCells[1] === coverage.spanCells[1]
      && frame.coverage.status === coverage.status
      && frame.coverage.observedCells === coverage.observedCells
      && frame.coverage.maskSha256 === coverage.maskSha256
      && frame.coverage.diffEligible === coverage.diffEligible);
  }

  #previewState(scene: SceneModel, record: ArchiveRecord): WorkspaceState {
    const state = this.state;
    return {
      ...state,
      comparisonActive: false,
      dataMode: "history",
      workflow: "history",
      view: this.#view,
      followMode: "off",
      historyCameras: {},
      cameraKey: null,
      taskCameraKey: null,
      floor: { ...state.floor, displayName: this.#t("v4_comparison_unspecified_floor", "an unspecified floor"), readOnly: true },
      map: { ...state.map, available: true, exactPose: false },
      resources: {
        ...state.resources,
        scene: { status: "ready", value: scene, problem: null },
        pose: { status: "idle", value: null, problem: null },
      },
      selection: { ...state.selection, historyId: record.id },
    };
  }

  #previewElements(): readonly [MaticMapCanvasV4 | null, MaticMapCanvasV4 | null] {
    const nodes = this.renderRoot.querySelectorAll<MaticMapCanvasV4>(".map-preview");
    return [nodes[0] ?? null, nodes[1] ?? null];
  }

  async #publishPreviews(): Promise<void> {
    if (!this.#pairScenes || this.#status !== "ready") return;
    const canvases = this.#previewElements();
    this.#boundCanvases = canvases;
    for (const [index, canvas] of canvases.entries()) {
      if (!canvas) continue;
      canvas.comparisonMode = true;
      canvas.cameraChanged = (camera, zoom) => this.#syncCamera(index as 0 | 1, camera, zoom);
      canvas.state = this.#previewState(this.#pairScenes[index as 0 | 1], this.#pairRecords![index as 0 | 1]);
    }
    await Promise.all(canvases.map((canvas) => canvas?.updateComplete));
    const first = canvases[0]?.rendererController;
    const camera = first?.camera;
    if (camera && this.#registered) this.#syncCamera(0, camera,
      first.diagnostics().fitDistance / Math.max(0.01, first.diagnostics().cameraDistance));
  }

  #syncCamera(sourceIndex: 0 | 1, camera: ComparisonCamera, zoom: number): void {
    if (!this.#registered || !this.#pairScenes) return;
    const source = this.#pairScenes[sourceIndex]!.metadata;
    const targetIndex = sourceIndex === 0 ? 1 : 0;
    const targetCanvas = this.#boundCanvases[targetIndex];
    const targetRenderer = targetCanvas?.rendererController;
    const target = this.#pairScenes[targetIndex]!.metadata;
    if (!targetRenderer) return;
    const diagnostics = targetRenderer.diagnostics();
    const synchronized = synchronizedCamera(camera, source, target, zoom, this.#registered, diagnostics.fitDistance);
    if (synchronized) targetRenderer.setCamera(synchronized, false);
  }

  #select(index: 0 | 1, id: string): void {
    const records = this.#activeRecords();
    if (!records.some((record) => record.id === id)) return;
    const current = this.#selected ?? this.#defaultPair(records);
    if (!current) return;
    const next: RecordPair = index === 0 ? [id, current[1]] : [current[0], id];
    if (next[0] === next[1]) { this.requestUpdate(); return; }
    this.#selected = next;
    this.#clearPair({ key: "v4_comparison_selection_changed", fallback: "The selected map changed. Loading the selected maps…" });
    this.onSelectionChange?.(next);
    this.requestUpdate();
    const pair = this.#recordsFor(next);
    if (pair) void this.#loadPair(pair);
  }

  #setView(view: "top" | "three"): void {
    if (this.#view === view) return;
    this.#view = view;
    this.requestUpdate();
    void this.updateComplete.then(() => this.#publishPreviews());
  }

  #date(record: ArchiveRecord): string {
    return formatDateTime(record.createdAt, this.dates);
  }

  #renderSelect(index: 0 | 1, label: string, selected: string, records: readonly ArchiveRecord[]) {
    return html`<label class="select"><span>${label}</span><select .value=${selected} aria-label=${label}
      @change=${(event: Event) => this.#select(index, (event.currentTarget as HTMLSelectElement).value)}>
      ${records.map((record) => html`<option value=${record.id}>${record.name || this.#date(record)}</option>`)}
    </select></label>`;
  }

  override render() {
    const records = this.#activeRecords();
    const selected = this.#selected;
    const pair = selected ? this.#recordsFor(selected) : null;
    const labels = pair?.map((record) => this.#t("v4_comparison_record_label", "{name} · {date}", {
      name: record.name || this.#t("v4_comparison_saved_map", "Saved map"), date: { date: record.createdAt },
    })) ?? [this.#t("v4_comparison_map_a", "Map A"), this.#t("v4_comparison_map_b", "Map B")];
    return html`<section class="wrap" aria-label=${this.#t("v4_comparison_aria", "Compare saved maps")}>
      <header class="toolbar">
        <h2>${this.#t("v4_comparison_title", "Compare saved maps")}</h2>
        <div class="view" role="group" aria-label=${this.#t("v4_comparison_view", "Comparison view")}>
          <button type="button" aria-pressed=${String(this.#view === "top")} @click=${() => this.#setView("top")}>${this.#t("v4_comparison_2d", "2D")}</button>
          <button type="button" aria-pressed=${String(this.#view === "three")} @click=${() => this.#setView("three")}>${this.#t("v4_comparison_3d", "3D")}</button>
        </div>
        <button type="button" @click=${() => this.onClose?.()}>${this.#t("v4_comparison_close", "Close comparison")}</button>
      </header>
      ${records.length < 2 && this.#statusCopy.key !== "v4_comparison_map_missing"
        ? html`<p class="status" role="status">${this.#t("v4_comparison_need_two", "Save at least two maps to compare them.")}</p>` : nothing}
      <div class="pair">
        ${[0, 1].map((index) => html`<article class="pane">
          ${this.#renderSelect(index as 0 | 1, index === 0 ? this.#t("v4_comparison_map_a", "Map A") : this.#t("v4_comparison_map_b", "Map B"), selected?.[index] ?? "", records)}
          ${staticHtml`<${mapCanvasTag} class="map-preview"></${mapCanvasTag}>`}
        </article>`)}
      </div>
      <p class="status" role="status">${this.#statusText()}</p>
      ${this.#grid ? html`<section class="result" aria-label=${this.#t("v4_comparison_observed_aria", "Observed map differences")}>
        <strong>${this.#t("v4_comparison_observed_title", "Observed map differences")}</strong>
        <div class="counts">
          <span class="changed">${this.#t("v4_comparison_changed", "Changed {count}", { count: this.#grid.changed })}</span>
          <span class="unchanged">${this.#t("v4_comparison_unchanged", "Unchanged {count}", { count: this.#grid.unchanged })}</span>
          <span class="unknown">${this.#t("v4_comparison_unknown", "Unknown {count}", { count: this.#grid.unknown })}</span>
        </div>
        <p>${this.#t("v4_comparison_unknown_explainer", "Only map cells observed in both saved maps are counted. Unknown cells may have changed.")}</p>
      </section>` : nothing}
      ${this.#pairRecords ? html`<p class="sr-only">${this.#t("v4_comparison_compared_with", "{first} compared with {second}", {
        first: labels[0]!, second: labels[1]!,
      })}</p>` : nothing}
    </section>`;
  }
}

if (!customElements.get(MAP_COMPARISON_TAG)) customElements.define(MAP_COMPARISON_TAG, MaticMapComparisonV4);
