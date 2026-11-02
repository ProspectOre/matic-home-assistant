import { clamp } from "./shared-primitives";
import type { CameraPreference, WorkspaceState } from "./contracts";
import { isMapTask } from "./task-presentation";

const cameraValue = (value: number, fallback: number, minimum: number, maximum: number): number =>
  clamp(Number.isFinite(value) ? value : fallback, minimum, maximum);

export const normalizeCamera = (camera: CameraPreference): CameraPreference => ({
  yaw: cameraValue(camera.yaw, 0, -Math.PI, Math.PI),
  pitch: cameraValue(camera.pitch, Math.PI / 2 - 0.018, 0.18, Math.PI / 2 - 0.018),
  zoom: cameraValue(camera.zoom, 1, 0.01, 100),
  targetX: cameraValue(camera.targetX, 0, -10_000, 10_000),
  targetZ: cameraValue(camera.targetZ, 0, -10_000, 10_000),
});

export const mapCameraIdentity = (state: WorkspaceState): string => {
  const entry = state.resources.entry;
  return JSON.stringify([state.owner?.userKey, entry?.entryId, entry?.selectedFloorOrdinal,
    entry?.mapFloorOrdinal, entry?.mapSessionKey]);
};

/** A held snapshot cannot claim the camera of the live map being verified. */
export const liveCameraKey = (state: WorkspaceState | null): string | null => {
  const entry = state?.resources.entry;
  return state && entry && state.dataMode === "live" && !state.floor.readOnly
    && state.selection.floorId === "current" && state.selection.entryId === entry.entryId
    && (state.coherence === "current" || state.coherence === "degraded")
    && state.resources.scene.value?.source === "live"
    && state.map.floorCoherent && state.map.sessionVerified
    && entry.mapFloorCoherent && entry.mapSessionVerified && entry.mapSessionKey
    ? mapCameraIdentity(state)
    : null;
};

export const cameraPreferences = (state: WorkspaceState): WorkspaceState["cameras"] => {
  if (state.dataMode === "history") return state.historyCameras;
  const key = liveCameraKey(state);
  if (isMapTask(state.workflow)) return key && state.taskCameraKey === key ? state.taskCameras : {};
  return key && state.cameraKey === key ? state.cameras : {};
};
