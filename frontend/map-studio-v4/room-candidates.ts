import { css, html, nothing, type CSSResult, type TemplateResult } from "lit";
import type { WorkspaceIntent, WorkspaceState } from "./contracts";

export const roomCandidateStyles: CSSResult = css`
  .room-candidates {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    gap: var(--ms-space-2);
    min-inline-size: 0;
    inline-size: min(22rem, 100%);
    max-block-size: min(60vh, 28rem);
    padding: var(--ms-space-3);
    border: 1px solid var(--ms-line);
    border-radius: var(--ms-radius-lg);
    color: var(--ms-text);
    background: var(--ms-surface-card);
    box-shadow: var(--ms-shadow-2);
  }
  .room-candidates__heading {
    display: flex;
    align-items: center;
    gap: var(--ms-space-2);
    min-block-size: var(--ms-control);
    margin: 0;
    font-size: var(--ms-t-md);
    font-weight: var(--ms-w-bold);
  }
  .room-candidates__heading span { flex: 1; min-inline-size: 0; }
  .room-candidates__list {
    display: grid;
    gap: var(--ms-space-1);
    min-block-size: 0;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
    overscroll-behavior: contain;
  }
  .room-candidates__list .ms-btn { justify-content: flex-start; inline-size: 100%; min-block-size: var(--ms-control); text-align: start; }
  .room-candidates__identity-help { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
  .room-candidates__fallback { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-sm); }
  @media (forced-colors: active) {
    .room-candidates { border: 1px solid CanvasText; }
    .room-candidates__list .ms-btn:focus-visible { outline: 2px solid Highlight; }
  }
`;

type Candidate = { readonly roomId: string; readonly name: string };
type Translate = (key: string, fallback: string, placeholders?: Readonly<Record<string, string | number>>) => string;

const candidatesFor = (state: WorkspaceState): Candidate[] => {
  const names = new Map<string, string>();
  for (const room of state.resources.plans.value?.rooms ?? []) names.set(room.roomId, room.name);
  for (const room of state.resources.areas.value?.rooms ?? []) {
    if (!names.has(room.roomId)) names.set(room.roomId, room.name);
  }
  return state.roomCandidates.flatMap((roomId) => {
    const name = names.get(roomId);
    return name ? [{ roomId, name }] : [];
  });
};

/** List of ambiguous map-hit rooms. Same-name candidates are unselectable until their identity is resolved. */
export const renderRoomCandidates = (
  state: WorkspaceState,
  intent: (intent: WorkspaceIntent) => void,
  t: Translate,
): TemplateResult | typeof nothing => {
  if (!state.roomCandidates.length) return nothing;
  const candidates = candidatesFor(state);
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1);
  const hasDuplicateNames = [...counts.values()].some((count) => count > 1);
  const seen = new Map<string, number>();
  const close = () => intent({ type: "show-room-candidates", roomIds: [] });
  return html`
    <section class="room-candidates ms-surface" data-map-control data-room-candidate-picker role="dialog" aria-modal="false" aria-labelledby="room-candidates-title"
      aria-describedby=${hasDuplicateNames ? "room-candidates-identity-help" : nothing} tabindex="-1">
      <h2 class="room-candidates__heading" id="room-candidates-title">
        <span>${t("v4_room_candidates_title", "Choose a room")}</span>
        <button class="ms-btn ms-btn--icon" type="button" aria-label=${t("v4_room_candidates_close", "Close room choices")} @click=${close}>×</button>
      </h2>
      ${hasDuplicateNames ? html`<p class="room-candidates__identity-help" id="room-candidates-identity-help">
        ${t("v4_room_candidates_identity_unresolved", "Matic can't tell these rooms apart. Rename them in the robot app and wait for the updated room names to appear.")}
      </p>` : nothing}
      ${candidates.length ? html`<ul class="room-candidates__list" role="list">
        ${candidates.map((candidate) => {
          const occurrence = (seen.get(candidate.name) ?? 0) + 1;
          seen.set(candidate.name, occurrence);
          const duplicate = (counts.get(candidate.name) ?? 0) > 1;
          const label = duplicate
            ? t("v4_room_candidate_select_numbered", "Select {room}, candidate {number}", { room: candidate.name, number: occurrence })
            : t("v4_room_candidate_select", "Select {room}", { room: candidate.name });
          return html`<li><button class="ms-btn ms-btn--secondary" type="button" data-map-control data-room-candidate=${candidate.roomId}
            ?disabled=${duplicate}
            aria-label=${label}
            aria-describedby=${duplicate ? "room-candidates-identity-help" : nothing}
            @click=${() => {
              if (duplicate) return;
              intent({ type: "toggle-room", roomId: candidate.roomId });
              close();
            }}>${candidate.name}${duplicate ? html`<small>${t("v4_room_candidate_number", "Candidate {number}", { number: occurrence })}</small>` : nothing}</button></li>`;
        })}
      </ul>` : html`<p class="room-candidates__fallback">${t("v4_room_candidates_unavailable", "Room details are no longer available. Close this list and try again.")}</p>`}
      <button class="ms-btn ms-btn--secondary" type="button" @click=${close}>${t("v4_room_candidates_dismiss", "Cancel room choice")}</button>
    </section>
  `;
};
