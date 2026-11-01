import type { Workflow, WorkspaceState } from "./contracts";

export const isMapTask = (workflow: Workflow): boolean =>
  workflow === "rooms" || workflow === "plans" || workflow === "plan"
  || workflow === "areas" || workflow === "draw" || workflow === "areaReview";

export const taskPresentation = (previous: WorkspaceState, next: WorkspaceState): WorkspaceState => {
  // A map hit belongs to the task and room data that produced it. A later
  // click must never apply that choice to a different draft or refreshed map.
  if (next.roomCandidates.length && (
    previous.workflow !== next.workflow || previous.planView !== next.planView
    || previous.selection.planId !== next.selection.planId
    || previous.selection.entryId !== next.selection.entryId
    || previous.selection.floorId !== next.selection.floorId
    || previous.selection.historyId !== next.selection.historyId
    || previous.owner?.userKey !== next.owner?.userKey
    || previous.dataMode !== next.dataMode || previous.pageActive !== next.pageActive
    || previous.host.administrator !== next.host.administrator
    || previous.resources.entry?.mapSessionKey !== next.resources.entry?.mapSessionKey
    || previous.resources.scene.value?.metadata?.rooms !== next.resources.scene.value?.metadata?.rooms
    || previous.resources.plans.value?.rooms !== next.resources.plans.value?.rooms
    || previous.resources.areas.value?.rooms !== next.resources.areas.value?.rooms
  )) next = { ...next, roomCandidates: [] };
  const wasTask = isMapTask(previous.workflow);
  const isTask = isMapTask(next.workflow);
  if (isTask && !wasTask) return {
    ...next,
    homePresentation: { view: previous.view, appearance: previous.appearance },
    view: "top",
    appearance: "rooms",
    followMode: "off",
    roomCandidates: [],
  };
  if (!isTask && wasTask) return {
    ...next,
    view: next.homePresentation?.view ?? next.view,
    appearance: next.homePresentation?.appearance ?? next.appearance,
    homePresentation: null,
    roomCandidates: [],
  };
  if (next.dataMode !== "live" && next.followMode !== "off") return { ...next, followMode: "off" };
  return next;
};
