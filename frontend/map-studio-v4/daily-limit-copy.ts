import type { DailyLimitHeldRoom, DailyRoomLimit } from "./backend-contracts";

export type DailyLimitTranslate = (
  key: string,
  fallback: string,
  placeholders?: Readonly<Record<string, string | number>>,
) => string;

export const dailyLimitReasonCopy = (reason: string, t: DailyLimitTranslate): string => {
  switch (reason) {
    case "invalid_policy":
      return t("v4_daily_limit_reason_invalid_policy", "Home Assistant can't confirm this room's limit.");
    case "room_identity_unconfirmed":
      return t("v4_daily_limit_reason_room_identity_unconfirmed", "Home Assistant can't match this room on the map.");
    case "timezone_unavailable":
      return t("v4_daily_limit_reason_timezone_unavailable", "Home Assistant can't confirm the local day.");
    case "completion_history_unverified":
      return t("v4_daily_limit_reason_completion_history_unverified", "Home Assistant can't confirm this room's completed cleans.");
    default:
      return t("v4_daily_limit_reason_unknown", "Home Assistant can't confirm this room limit.");
  }
};

export const dailyLimitProgressCopy = (
  limit: Pick<DailyRoomLimit, "completedToday" | "limit">,
  t: DailyLimitTranslate,
  count: (value: number) => string,
): string => t("v4_daily_limit_progress", "{completed} of {limit} completed today", {
  completed: count(limit.completedToday),
  limit: count(limit.limit ?? limit.completedToday),
});

export const dailyLimitStatusCopy = (
  limit: DailyRoomLimit,
  t: DailyLimitTranslate,
  count: (value: number) => string,
): string => limit.reason
  ? t("v4_daily_limit_held_reason", "Daily limit held · {reason}", { reason: dailyLimitReasonCopy(limit.reason, t) })
  : t("v4_daily_limit_reached", "Daily limit reached · {progress}", { progress: dailyLimitProgressCopy(limit, t, count) });

export const dailyLimitHeldRoomCopy = (
  room: DailyLimitHeldRoom,
  t: DailyLimitTranslate,
  count: (value: number) => string,
): string => room.reason
  ? t("v4_daily_limit_room_uncertain", "{room}: held because {reason}", {
    room: room.name,
    reason: dailyLimitReasonCopy(room.reason, t),
  })
  : t("v4_daily_limit_room_progress", "{room}: {progress}", {
    room: room.name,
    progress: dailyLimitProgressCopy(room, t, count),
  });

export const dailyLimitHeldSummaryCopy = (
  rooms: string,
  t: DailyLimitTranslate,
): string => t(
  "v4_daily_limit_held_rooms",
  "Held by daily clean limits: {rooms}. Change a room limit or refresh room details. Home Assistant keeps each room on hold until it can match the room on the map and confirm today's clean count.",
  { rooms },
);
