import { html, nothing } from "lit";
import type { Workflow } from "./contracts";
import { icon, iconChevronRight } from "./icons";

/** A home shelf row that opens one workflow. `described` links a held row to the home reason. */
export const shelfRow = (
  onClick: () => void,
  label: string,
  glyph: string,
  workflow: Workflow,
  detail?: string,
  disabled = false,
  described = false,
  classes = "ms-row",
) => html`
  <button
    class=${classes}
    type="button"
    data-launcher=${workflow}
    aria-disabled=${disabled ? "true" : nothing}
    aria-describedby=${described ? "home-reason" : nothing}
    @click=${onClick}
  >
    <span class="ms-row__lead">${icon(glyph)}</span>
    <span class="ms-row__body"><strong>${label}</strong>${detail ? html`<small>${detail}</small>` : nothing}</span>
    <span class="ms-row__trail">${icon(iconChevronRight, { directional: true })}</span>
  </button>
`;
