import {
  ContractError, objectValue, boundedString, boundedInteger, boundedNumber,
  selectedId, booleanValue, mapSessionKey, type PoseModel,
} from "./backend-contracts";

const point = (value: unknown, code: string): readonly [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) throw new ContractError(code);
  return [
    boundedNumber(value[0], -1_000_000, 1_000_000, code),
    boundedNumber(value[1], -1_000_000, 1_000_000, code),
  ];
};

export const parsePose = (value: unknown): PoseModel => {
  const payload = objectValue(value, "invalid-pose");
  const rawPosition = payload.position;
  const position = rawPosition === null ? null : point(rawPosition, "invalid-pose-position");
  const freshness = payload.pose_freshness;
  if (freshness !== "live" && freshness !== "coordinator_fallback") {
    throw new ContractError("invalid-pose-freshness");
  }
  const age = payload.pose_age_seconds;
  const nativeObservationAgeSeconds = Object.hasOwn(payload, "pose_age_seconds")
    ? typeof age === "number" && age >= -2 && age <= 5 ? age : null
    : undefined;
  const processing = payload.pose_processing_seconds;
  const poseProcessingSeconds = typeof processing === "number" && processing >= 0 && processing <= 60 ? processing : undefined;
  return {
    position,
    source: boundedString(payload.source, 64, "invalid-pose-source"),
    revision: boundedInteger(payload.revision, 0, Number.MAX_SAFE_INTEGER, "invalid-pose-revision"),
    sceneRevision: payload.scene_revision == null ? null
      : boundedInteger(payload.scene_revision, 0, Number.MAX_SAFE_INTEGER, "invalid-pose-revision"),
    sceneEpoch: selectedId(payload.scene_epoch, "invalid-scene-epoch"),
    poseRevision: boundedInteger(payload.pose_revision, 0, Number.MAX_SAFE_INTEGER, "invalid-pose-sequence"),
    floorCoherent: booleanValue(payload.map_floor_coherent, "invalid-pose-floor"),
    mapSessionKey: mapSessionKey(payload.map_session_key),
    freshness,
    ...(nativeObservationAgeSeconds === undefined ? {} : { nativeObservationAgeSeconds }),
    ...(poseProcessingSeconds === undefined ? {} : { poseProcessingSeconds }),
    poseMeasuredAt: payload.pose_measured_at,
    heading: position !== null && typeof payload.heading === "number"
      && Math.abs(payload.heading) <= Math.PI + 1e-3 ? payload.heading : null,
  };
};
