export function dailyLimitRequest(
  entryId: string,
  floorToken: string,
  roomId: string,
  limit: number | null,
  invalid: () => Error,
): {
  readonly path: string;
  readonly init: RequestInit;
} {
  if (!entryId || !floorToken || !roomId || (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 100))) {
    throw invalid();
  }
  return {
    path: `/api/matic_robot/plans/${encodeURIComponent(entryId)}/daily_limit`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_id: roomId, floor_token: floorToken, limit }),
    },
  };
}
