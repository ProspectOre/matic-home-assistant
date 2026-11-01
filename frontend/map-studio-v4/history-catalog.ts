import {
  ContractError,
  SCENE_MAX_POINTS,
  booleanValue,
  boundedInteger,
  boundedString,
  nullableInteger,
  objectValue,
  optionalLabel,
  privatePath,
  type HistoryCatalog,
  type HistoryComparisonFrame,
  type HistoryFloor,
  type HistorySnapshot,
} from "./backend-contracts";

export const parseHistoryComparisonFrame = (value: unknown): HistoryComparisonFrame | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const frame = value as Record<string, unknown>;
  const coverage = frame.coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
  const rawCoverage = coverage as Record<string, unknown>;
  const origin = frame.origin_cells;
  const span = frame.span_cells;
  const digest = rawCoverage.mask_sha256;
  if (!Array.isArray(origin) || origin.length !== 2 || !Array.isArray(span) || span.length !== 2
    || frame.format_version !== 1 || frame.coordinate_version !== 1
    || typeof frame.meters_per_cell !== "number" || !Number.isFinite(frame.meters_per_cell)
    || frame.meters_per_cell <= 0
    || !Number.isInteger(origin[0]) || !Number.isInteger(origin[1])
    || !Number.isInteger(span[0]) || !Number.isInteger(span[1])
    || Number(span[0]) < 1 || Number(span[1]) < 1
    || Number(span[0]) * Number(span[1]) > 4 * 1024 * 1024
    || typeof rawCoverage.status !== "string"
    || !Number.isInteger(rawCoverage.observed_cells)
    || Number(rawCoverage.observed_cells) < 0
    || Number(rawCoverage.observed_cells) > Number(span[0]) * Number(span[1])
    || (digest !== null && digest !== undefined && (typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest)))
    || typeof rawCoverage.diff_eligible !== "boolean"
    || typeof frame.diff_eligible !== "boolean") return null;
  return {
    formatVersion: 1,
    coordinateVersion: 1,
    originCells: [Number(origin[0]), Number(origin[1])],
    metersPerCell: frame.meters_per_cell,
    spanCells: [Number(span[0]), Number(span[1])],
    coverage: {
      status: rawCoverage.status,
      observedCells: Number(rawCoverage.observed_cells),
      maskSha256: typeof digest === "string" ? digest : null,
      diffEligible: rawCoverage.diff_eligible,
    },
    diffEligible: frame.diff_eligible,
  };
};

const parseSnapshot = (value: unknown): HistorySnapshot => {
  const snapshot = objectValue(value, "invalid-history-snapshot");
  const createdAt = boundedString(snapshot.created_at, 64, "invalid-history-time");
  if (!Number.isFinite(Date.parse(createdAt))) throw new ContractError("invalid-history-time");
  return {
    id: boundedString(snapshot.id, 128, "invalid-history-id"),
    contentId: typeof snapshot.content_id === "string"
      ? boundedString(snapshot.content_id, 64, "invalid-history-content-id") : null,
    createdAt,
    revision: boundedInteger(snapshot.revision, 0, Number.MAX_SAFE_INTEGER, "invalid-history-revision"),
    pointCount: boundedInteger(snapshot.point_count, 1, SCENE_MAX_POINTS, "invalid-history-points"),
    sceneUrl: privatePath(snapshot.scene_url, "invalid-history-scene-url"),
    name: optionalLabel(snapshot.name),
    imported: snapshot.imported === undefined ? false : booleanValue(snapshot.imported, "invalid-history-imported"),
    comparisonGroup: typeof snapshot.comparison_group === "string"
      && /^[a-f0-9]{64}$/u.test(snapshot.comparison_group) ? snapshot.comparison_group : null,
    frame: parseHistoryComparisonFrame(snapshot.frame),
  };
};

export const parseHistoryCatalog = (value: unknown): HistoryCatalog => {
  const payload = objectValue(value, "invalid-history");
  if (!Array.isArray(payload.floors) || payload.floors.length < 1 || payload.floors.length > 128) {
    throw new ContractError("invalid-history-floors");
  }
  return {
    entryId: boundedString(payload.entry_id, 128, "invalid-history-entry"),
    liveAvailable: booleanValue(payload.live_available, "invalid-history-live"),
    floors: payload.floors.map((candidate) => {
      const floor = objectValue(candidate, "invalid-history-floor");
      if (!Array.isArray(floor.snapshots) || floor.snapshots.length > 12) {
        throw new ContractError("invalid-history-snapshots");
      }
      return {
        id: boundedString(floor.id, 128, "invalid-history-floor-id"),
        active: booleanValue(floor.active, "invalid-history-floor-active"),
        readOnly: booleanValue(floor.read_only, "invalid-history-floor-read-only"),
        liveAvailable: floor.live_available === undefined
          ? false
          : booleanValue(floor.live_available, "invalid-history-floor-live"),
        label: optionalLabel(floor.label),
        ordinal: floor.ordinal === undefined ? null : nullableInteger(floor.ordinal, 128),
        snapshots: floor.snapshots.map(parseSnapshot),
      } satisfies HistoryFloor;
    }),
  };
};
