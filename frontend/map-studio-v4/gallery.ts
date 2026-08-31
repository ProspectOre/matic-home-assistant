import { LitElement, css, html } from "lit";
import type { PropertyValues } from "lit";

import type { WorkspaceState } from "./contracts";
import { isWorkspaceIntent } from "./contracts";
import {
  createGalleryState,
  GALLERY_SCENARIOS,
  type GalleryScenario,
} from "./gallery-state";
import "./shell";
import { WorkspaceStore } from "./state";

export class MaticMapStudioGalleryV4 extends LitElement {
  static override properties = {
    scenario: { type: String, reflect: true },
    narrow: { type: Boolean, reflect: true },
    controls: { type: Boolean, reflect: true },
    _workspace: { state: true },
  };

  static override styles = css`
    :host {
      display: block;
      color: #1f2933;
      background: #e8edef;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }

    * { box-sizing: border-box; }
    button { font: inherit; }

    .gallery-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      padding: 0.65rem;
      border-block-end: 1px solid #ccd5da;
      background: #fff;
    }

    .gallery-controls button {
      min-block-size: 2.25rem;
      padding-inline: 0.65rem;
      border: 1px solid #c5cfd5;
      border-radius: 0.55rem;
      color: #26343c;
      background: #f7f9fa;
      cursor: pointer;
      font-size: 0.75rem;
    }

    .gallery-controls button[aria-pressed="true"] {
      color: white;
      border-color: #0678ce;
      background: #0678ce;
    }

    .stage {
      inline-size: 100%;
      block-size: min(46rem, calc(100dvh - 3.6rem));
      min-block-size: 36rem;
      margin: 0 auto;
      background: #f5f7f8;
    }

    :host([narrow]) .stage { max-inline-size: 24.375rem; block-size: 52.75rem; }
    matic-map-shell-v4 { block-size: 100%; }
  `;

  scenario: GalleryScenario = "ready";
  narrow = false;
  controls = true;
  protected _workspace: WorkspaceState = createGalleryState("ready");

  readonly #store = new WorkspaceStore(this._workspace);
  #unsubscribe: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribe = this.#store.subscribe((state) => {
      this._workspace = state;
    });
  }

  override disconnectedCallback(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("scenario")) {
      this.#store.replace({
        ...createGalleryState(this.scenario),
        narrowHint: this.narrow,
      });
    } else if (changed.has("narrow")) {
      this.#store.dispatch({ type: "set-narrow-hint", value: this.narrow });
    }
  }

  setScenario(scenario: GalleryScenario): void {
    if (!GALLERY_SCENARIOS.includes(scenario)) return;
    this.scenario = scenario;
  }

  getWorkspaceSnapshot(): WorkspaceState {
    return structuredClone(this.#store.value);
  }

  replaceWorkspaceState(state: WorkspaceState): void {
    this.#store.replace(structuredClone(state));
  }

  #intent(event: CustomEvent<unknown>): void {
    if (!isWorkspaceIntent(event.detail)) return;
    event.stopPropagation();
    this.#store.dispatch(event.detail);
  }

  protected override render() {
    return html`
      ${this.controls ? html`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${GALLERY_SCENARIOS.map((scenario) => html`
            <button
              type="button"
              aria-pressed=${String(this.scenario === scenario)}
              @click=${() => { this.scenario = scenario; }}
            >${scenario}</button>
          `)}
        </nav>
      ` : null}
      <div class="stage">
        <matic-map-shell-v4
          .state=${this._workspace}
          @matic-workspace-intent=${this.#intent}
        ></matic-map-shell-v4>
      </div>
    `;
  }
}

if (!customElements.get("matic-map-studio-gallery-v0-4-0")) {
  customElements.define(
    "matic-map-studio-gallery-v0-4-0",
    MaticMapStudioGalleryV4,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "matic-map-studio-gallery-v0-4-0": MaticMapStudioGalleryV4;
  }
}
