import { MAX_ROOM_SEQUENCE_SIZE, type WorkspaceState } from "./contracts";

/** Ticks or unticks a room in the plan Edit draft. Map taps never change the plan in Run. */
export const togglePlanRoom = (state: WorkspaceState, roomId: string): WorkspaceState => {
  if (state.planView === "run") return state;
  const { rooms, parkedRooms, areas } = state.planDraft;
  const room = rooms.find((candidate) => candidate.roomId === roomId);
  if (!room && rooms.length >= MAX_ROOM_SEQUENCE_SIZE) return state;
  // An unticked room keeps its settings and schedule until Save, so
  // ticking it again restores them.
  const parked = parkedRooms.find((candidate) => candidate.roomId === roomId);
  const others = (list: typeof rooms) => list.filter((candidate) => candidate.roomId !== roomId);
  return {
    ...state,
    planDraft: {
      ...state.planDraft,
      dirty: true,
      rooms: room
        ? others(rooms)
        : [...rooms, parked ?? { roomId, cleaningMode: "vacuum", coverageSetting: "standard" }],
      parkedRooms: room ? [...others(parkedRooms), room] : others(parkedRooms),
      // The custom areas after a removed room keep their place in the run.
      areas: room ? areas.map((area) => area.slot > rooms.indexOf(room) ? { ...area, slot: area.slot - 1 } : area) : areas,
    },
  };
};

/**
 * Moves a plan room a map edit removed to the room now on the map with its
 * name. The room keeps its settings and schedule; its progress belonged to
 * the old room, so the save starts it over.
 */
export const relinkPlanRoom = (state: WorkspaceState, roomId: string, toRoomId: string): WorkspaceState => {
  const { rooms, parkedRooms } = state.planDraft;
  if (state.workflow !== "plan" || state.planView !== "edit"
    || !rooms.some((room) => room.roomId === roomId)
    || rooms.some((room) => room.roomId === toRoomId)) return state;
  return {
    ...state,
    planDraft: {
      ...state.planDraft,
      dirty: true,
      rooms: rooms.map((room) => {
        if (room.roomId !== roomId) return room;
        const { cadenceProgress: _progress, cadenceReasons: _reasons, dailyLimit: _limit, ...settings } = room;
        return { ...settings, roomId: toRoomId };
      }),
      parkedRooms: parkedRooms.filter((room) => room.roomId !== toRoomId),
    },
  };
};
