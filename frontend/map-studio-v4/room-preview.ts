// Room previews start only after a cleaning choice. Keep their FIFO queue,
// deadline and outstanding-wire accounting out of the map startup graph.
import type { HassLike } from "./contracts";
import type { CleaningMode, CoverageSetting, ManualRoomSequencePreview, ManualRoomSequencePreviewRoom } from "./backend-contracts";

type Connection = NonNullable<HassLike["connection"]>;
type Room = { readonly room: string; readonly cleaning_mode: CleaningMode; readonly coverage_setting: CoverageSetting };
const MAX_OUTSTANDING_ROOM_PREVIEW_WIRES = 2;
const roomPreviewWireCountByConnection = new WeakMap<object, number>();

export const requestRoomPreview = async (
  connection: Connection,
  turns: WeakMap<object, Promise<void>>,
  entityId: string,
  rooms: readonly Room[],
  overrideRoomSchedule: boolean,
  signal: AbortSignal | undefined,
  { BackendError, requestFailed, ContractError, objectValue, boundedString, parseNextRunPreview, parseCadenceProgress }: typeof import("./plan-catalog").roomPreviewHelpers & {
    BackendError: typeof import("./backend").BackendError;
    requestFailed: (error: unknown) => void;
  },
): Promise<ManualRoomSequencePreview> => {
  const parseManualRoomSequencePreview = (value: unknown): ManualRoomSequencePreview => {
    const response = objectValue(value, "invalid-room-sequence-preview");
    const entryId = boundedString(response.entry_id, 128, "invalid-room-sequence-preview-entry");
    const floorToken = boundedString(response.floor_token, 128, "invalid-room-sequence-preview-floor");
    const previewToken = boundedString(response.preview_token, 64, "invalid-room-sequence-preview-token");
    if (!/^[0-9a-f]{64}$/u.test(floorToken) || !/^[0-9a-f]{64}$/u.test(previewToken)) {
      throw new ContractError("invalid-room-sequence-preview-token");
    }
    const preview = parseNextRunPreview({
      rooms: response.rooms,
      mission_boundaries: response.mission_boundaries,
      blocker: response.blocker,
      daily_limit_held_rooms: response.daily_limit_held_rooms,
    });
    if (!preview) throw new ContractError("invalid-room-sequence-preview");
    const rawRooms = response.rooms;
    if (!Array.isArray(rawRooms)) throw new ContractError("invalid-room-sequence-preview-rooms");
    const rooms = preview.rooms.map((room, index): ManualRoomSequencePreviewRoom => {
      const source = objectValue(rawRooms[index], "invalid-room-sequence-preview-room");
      const cadenceProgress = parseCadenceProgress(source.cadence_progress, source.cadence_reasons);
      return { ...room, ...(cadenceProgress === undefined ? {} : { cadenceProgress }) };
    });
    return {
      entryId,
      floorToken,
      previewToken,
      rooms,
      missionBoundaries: preview.missionBoundaries,
      blocker: preview.blocker,
      ...(preview.dailyLimitHeldRooms ? { dailyLimitHeldRooms: preview.dailyLimitHeldRooms } : {}),
    };
  };
  let timeout: number | null = null;
  let rejectAbort: (reason: DOMException) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const previous = turns.get(connection);
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolve) => { releaseTurn = resolve; });
  turns.set(connection, turn);
  let turnReleased = false;
  const release = (): void => {
    if (turnReleased) return;
    turnReleased = true;
    releaseTurn();
    if (turns.get(connection) === turn) {
      turns.delete(connection);
    }
  };
  let wireStarted = false;
  const abort = (): void => {
    rejectAbort(new DOMException("Aborted", "AbortError"));
    if (wireStarted) {
      release();
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
    }
  };
  signal?.addEventListener("abort", abort, { once: true });
  // The deadline includes time spent in the FIFO queue. A queued timeout
  // rejects that caller immediately, but only an active wire turn can release
  // itself here; queued turns release after their predecessor in finally.
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = window.setTimeout(() => {
      timeout = null;
      reject(new BackendError("preview-timeout"));
    }, 15_000);
  });
  void deadline.catch(() => {
    if (wireStarted) release();
  });
  try {
    if (previous) {
      await Promise.race([previous, interrupted, deadline]);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    }
    const outstandingWires = roomPreviewWireCountByConnection.get(connection) ?? 0;
    if (outstandingWires >= MAX_OUTSTANDING_ROOM_PREVIEW_WIRES) {
      throw new BackendError("preview-unavailable");
    }
    const wire = connection.sendMessagePromise<unknown>({
        type: "call_service",
        domain: "matic_robot",
        service: "preview_room_sequence",
        target: { entity_id: entityId },
        service_data: {
          rooms: rooms.map((room) => ({
            room: room.room,
            cleaning_mode: room.cleaning_mode,
            coverage_setting: room.coverage_setting,
          })),
          use_room_schedule: true,
          override_room_schedule: overrideRoomSchedule,
        },
        return_response: true,
    });
    // A local preview deadline cannot cancel HA's RPC. Its late access denial
    // still matters to the current owner, while cancelled previews stay inert.
    void wire.catch((error) => { if (!signal?.aborted) requestFailed(error); });
    roomPreviewWireCountByConnection.set(connection, outstandingWires + 1);
    wireStarted = true;
    let wireCountReleased = false;
    const settleWire = (): void => {
      if (!wireCountReleased) {
        wireCountReleased = true;
        const remainingWires = (roomPreviewWireCountByConnection.get(connection) ?? 1) - 1;
        if (remainingWires === 0) roomPreviewWireCountByConnection.delete(connection);
        else roomPreviewWireCountByConnection.set(connection, remainingWires);
      }
      release();
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
    };
    void wire.then(settleWire, settleWire);
    const response = await Promise.race([
      wire,
      interrupted,
      deadline,
    ]);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!response || typeof response !== "object" || Array.isArray(response)
      || !("response" in response)) {
      throw new ContractError("invalid-room-sequence-preview-envelope");
    }
    return parseManualRoomSequencePreview((response as { response: unknown }).response);
  } finally {
    if (!wireStarted) {
      if (previous) void previous.then(release, release);
      else release();
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
    }
    signal?.removeEventListener("abort", abort);
  }
};
