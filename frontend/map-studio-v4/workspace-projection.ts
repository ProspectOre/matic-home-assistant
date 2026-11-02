import { entryFloorKey, entryMissionKey, type MapEntry } from "./backend-contracts";

export const entryCoherenceIdentity = (entry: MapEntry): string => [
  entry.entryId,
  entryFloorKey(entry),
  entryMissionKey(entry),
  entry.mapSceneEpoch ?? "",
].join("|");

export const entryManagedLock = (entry: MapEntry): boolean =>
  entry.runnerLocked
  || entry.stopSettlePending
  || entry.activePlan
  || entry.nativeReconciliationPending
  || entry.nativeSessionActive === true;

export const entryBoundaryKey = (entry: MapEntry): string => [
  entry.entryId,
  entry.selectedFloorOrdinal ?? 0,
  entry.mapFloorOrdinal ?? 0,
].join("|");

export const entryIdentity = (entry: MapEntry): string => [
  entryCoherenceIdentity(entry),
  entry.mapRevision,
].join("|");
