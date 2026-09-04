import type { WorkspaceIntent, WorkspaceState } from "./contracts";

// Keep navigation protection shared by toolbar actions, nested workflows and
// browser Back. Display-only layers can close without throwing away edits.
export const needsDraftConfirmation = (state: WorkspaceState, intent: WorkspaceIntent): boolean => {
  const plan = state.workflow === "plan" && state.planDraft.dirty;
  const area = (state.workflow === "draw" || state.workflow === "areaReview")
    && (state.draw.dirty || state.areaDraft.dirty);
  if (!plan && !area) return false;
  switch (intent.type) {
    case "open-workflow":
      return plan ? intent.workflow !== "plan"
        : intent.workflow !== "draw" && intent.workflow !== "areaReview";
    case "select-plan": return plan;
    case "select-area": return area;
    case "set-floor": return intent.floorId !== state.selection.floorId;
    case "select-entry": return intent.entryId !== state.selection.entryId;
    case "set-history": return true;
    case "dismiss-top-layer":
      return !state.dialog && !state.precisionOpen && !state.fullMap;
    default: return false;
  }
};
