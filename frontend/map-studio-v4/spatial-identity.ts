import type { SceneRoom } from "./backend-contracts";

export interface CatalogRoomIdentity {
  readonly roomId: string;
  readonly name: string;
}

export type RoomIdentityResult =
  | { readonly status: "resolved"; readonly roomId: string }
  | { readonly status: "ambiguous"; readonly roomIds: readonly string[] }
  | { readonly status: "unmatched" };

const normalizedName = (name: string): string => name.normalize("NFKC").trim().toLocaleLowerCase();

/** Resolve scene labels to selectable catalog IDs without guessing on collisions. */
export const resolveSceneRoom = (
  sceneRoom: Pick<SceneRoom, "id" | "name">,
  catalogRooms: readonly CatalogRoomIdentity[],
): RoomIdentityResult => {
  // The SLAM protocol's room_<16 hex> key is the only stable ID form currently
  // carried by scene-parser; synthetic scene-room-N IDs are deliberately not
  // treated as semantic identity.
  if (/^room_[a-f0-9]{16}$/u.test(sceneRoom.id)
    && catalogRooms.filter((room) => room.roomId === sceneRoom.id).length === 1) {
    return { status: "resolved", roomId: sceneRoom.id };
  }
  const key = normalizedName(sceneRoom.name);
  if (!key) return { status: "unmatched" };
  const candidates = [...new Set(catalogRooms
    .filter((room) => normalizedName(room.name) === key)
    .map((room) => room.roomId))].sort();
  if (candidates.length === 1) return { status: "resolved", roomId: candidates[0]! };
  return candidates.length > 1
    ? { status: "ambiguous", roomIds: candidates }
    : { status: "unmatched" };
};

/** Resolve every polygon hit; overlapping rooms never silently choose the first. */
export const resolveSceneRoomHits = (
  sceneRooms: readonly SceneRoom[],
  hit: (room: SceneRoom) => boolean,
  catalogRooms: readonly CatalogRoomIdentity[],
): RoomIdentityResult => {
  const roomIds = new Set<string>();
  let ambiguous = false;
  for (const room of sceneRooms) {
    if (!hit(room)) continue;
    const identity = resolveSceneRoom(room, catalogRooms);
    if (identity.status === "ambiguous") {
      ambiguous = true;
      identity.roomIds.forEach((id) => roomIds.add(id));
    } else if (identity.status === "resolved") roomIds.add(identity.roomId);
  }
  const candidates = [...roomIds].sort();
  if (candidates.length === 1 && !ambiguous) return { status: "resolved", roomId: candidates[0]! };
  return candidates.length ? { status: "ambiguous", roomIds: candidates } : { status: "unmatched" };
};
