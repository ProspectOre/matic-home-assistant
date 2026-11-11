import { pointInPolygon } from "./renderer-math";
import type { SceneModel } from "./backend-contracts";
import type { WorkspaceState } from "./contracts";
import type { RoomIdentityResult } from "./spatial-identity";
import type { MapPoint } from "./renderer-camera";

const catalogRoomIdentities = (state: WorkspaceState): readonly { readonly roomId: string; readonly name: string }[] => {
  const rooms = [
    ...(state.resources.plans.value?.rooms ?? []),
    ...(state.resources.areas.value?.rooms ?? []),
  ];
  return [...new Map(rooms.map((room) => [room.roomId, { roomId: room.roomId, name: room.name }])).values()];
};

/** The catalog room under a map point, when exactly one scene room contains it. */
export const roomAt = (scene: SceneModel, state: WorkspaceState, map: MapPoint): string | null => {
  const cellX = map.x / scene.metadata.metersPerCell - scene.metadata.origin[0];
  const cellY = map.y / scene.metadata.metersPerCell - scene.metadata.origin[1];
  const hits = scene.metadata.rooms.filter((room) => pointInPolygon(cellX, cellY, room.boundary));
  if (hits.length !== 1) return null;
  const hit = hits[0]!;
  const catalogRooms = catalogRoomIdentities(state);
  const exact = catalogRooms.filter((item) => item.roomId === hit.id);
  if (/^room_[a-f0-9]{16}$/u.test(hit.id) && exact.length === 1) return hit.id;
  const key = hit.name.normalize("NFKC").trim().toLocaleLowerCase();
  if (!key) return null;
  const candidates = [...new Set(catalogRooms.filter((item) => item.name.normalize("NFKC").trim().toLocaleLowerCase() === key).map((item) => item.roomId))];
  return candidates.length === 1 ? candidates[0]! : null;
};

export const roomCandidatesAt = async (scene: SceneModel, state: WorkspaceState, map: MapPoint): Promise<RoomIdentityResult> => {
  const cellX = map.x / scene.metadata.metersPerCell - scene.metadata.origin[0];
  const cellY = map.y / scene.metadata.metersPerCell - scene.metadata.origin[1];
  const { resolveSceneRoomHits } = await import("./spatial-identity");
  return resolveSceneRoomHits(scene.metadata.rooms,
    (room) => pointInPolygon(cellX, cellY, room.boundary), catalogRoomIdentities(state));
};

export const containsMapPoint = (scene: SceneModel, point: MapPoint): boolean => {
  const cellX = point.x / scene.metadata.metersPerCell - scene.metadata.origin[0];
  const cellY = point.y / scene.metadata.metersPerCell - scene.metadata.origin[1];
  return scene.metadata.rooms.some((room) => pointInPolygon(cellX, cellY, room.boundary));
};

/** Lower-cased names of the rooms the current workflow has selected. */
export const selectedRoomNames = (state: WorkspaceState): Set<string> => {
  const rooms = state.resources.plans.value?.rooms || state.resources.areas.value?.rooms || [];
  // Rooms and plan draw their own selections; home draws none (R9).
  const selectedRoomIds = new Set(state.workflow === "plan"
    ? state.planDraft.rooms.map((room) => room.roomId)
    : state.workflow === "rooms" ? state.selection.roomIds : []);
  const selectedNames = new Set<string>();
  for (const room of rooms) {
    if (selectedRoomIds.has(room.roomId)) selectedNames.add(room.name.toLocaleLowerCase());
  }
  return selectedNames;
};
