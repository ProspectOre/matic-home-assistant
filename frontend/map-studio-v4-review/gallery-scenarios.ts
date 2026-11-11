import type { DialogKind, WorkspaceNotice } from "../map-studio-v4/contracts";

export type GalleryScenario =
  | "ready"
  | "cleaning"
  | "paused"
  | "returning"
  | "recharging"
  | "rooms"
  | "draw"
  | "draw-points"
  | "draw-saved"
  | "draw-redraw"
  | "history"
  | "history-floors"
  | "transition"
  | "problem"
  | "ha-offline"
  | "robot-offline"
  | "access"
  | "empty"
  | "unsupported"
  | "multi-robot"
  | "plans"
  | "plan-saved-intelligent"
  | "plan-saved-ordered"
  | "plan-run-paused"
  | "plan-run-blocked"
  | "plan-run-parts"
  | "plan-edit-ordered"
  | "plan-new"
  | "plan-dirty"
  | "plan-cadence-shared"
  | "plan-cadence-blocked"
  | "plan-schedule-conflict"
  | "plan-schedule-available"
  | "plan-schedule-joining"
  | "plan-legacy-oversized"
  | "area-review-new"
  | "area-review-saved"
  | "area-review-rebind"
  | "area-review-stale"
  | "support"
  | "runs"
  | "full-map"
  | "full-map-cleaning"
  | "full-map-locating"
  | "starting"
  | "starting-command"
  | "stopping"
  | "stopping-command"
  | "task-in-progress"
  | "map-unavailable"
  | "map-limited"
  | "room-limit"
  | "rooms-ready"
  | "rooms-busy"
  | "rooms-failed"
  | "rooms-empty"
  | "home-plan-due"
  | "home-plan-paused"
  | "home-plan-blocked"
  | "home-plan-due-full"
  | "home-shortcuts"
  | "home-unpinned"
  | "home-shortcut-blocked"
  | "home-shortcut-running"
  | "home-pins-error"
  | "areas-list"
  | "areas-empty"
  | "areas-stale"
  | "plan-run-areas"
  | "plan-run-areas-only"
  | "plan-edit-areas"
  | "plan-edit-areas-rotation"
  | "plan-edit-area-stale"
  | "areas-in-plans"
  | "area-delete-refused"
  | "home-shortcut-areas";

export const GALLERY_SCENARIOS: readonly GalleryScenario[] = [
  "ready",
  "cleaning",
  "paused",
  "returning",
  "recharging",
  "rooms",
  "draw",
  "history",
  "history-floors",
  "transition",
  "problem",
  "ha-offline",
  "robot-offline",
  "access",
  "empty",
  "unsupported",
  "multi-robot",
  "plans",
  "plan-saved-intelligent",
  "plan-saved-ordered",
  "plan-run-paused",
  "plan-run-blocked",
  "plan-run-parts",
  "plan-edit-ordered",
  "plan-new",
  "plan-dirty",
  "plan-cadence-shared",
  "plan-cadence-blocked",
  "plan-schedule-conflict",
  "plan-schedule-available",
  "plan-schedule-joining",
  "plan-legacy-oversized",
  "draw-points",
  "draw-saved",
  "draw-redraw",
  "area-review-new",
  "area-review-saved",
  "area-review-rebind",
  "area-review-stale",
  "support",
  "runs",
  "full-map",
  "full-map-cleaning",
  "full-map-locating",
  "starting",
  "starting-command",
  "stopping",
  "stopping-command",
  "task-in-progress",
  "map-unavailable",
  "map-limited",
  "room-limit",
  "rooms-ready",
  "rooms-busy",
  "rooms-failed",
  "rooms-empty",
  "home-plan-due",
  "home-plan-paused",
  "home-plan-blocked",
  "home-plan-due-full",
  "home-shortcuts",
  "home-unpinned",
  "home-shortcut-blocked",
  "home-shortcut-running",
  "home-pins-error",
  "areas-list",
  "areas-empty",
  "areas-stale",
  "plan-run-areas",
  "plan-run-areas-only",
  "plan-edit-areas",
  "plan-edit-areas-rotation",
  "plan-edit-area-stale",
  "areas-in-plans",
  "area-delete-refused",
  "home-shortcut-areas",
];

/** Every dialog the shell can show; the UX audit captures each one. */
export const GALLERY_DIALOGS: readonly DialogKind[] = [
  "discardDraft",
  "confirmDeletePlan",
  "confirmDeleteArea",
  "confirmResetCadence",
];

/** Every notice tone the workflow panels render. */
export const GALLERY_NOTICE_TONES: readonly WorkspaceNotice["tone"][] = [
  "info",
  "success",
  "warning",
  "error",
];
