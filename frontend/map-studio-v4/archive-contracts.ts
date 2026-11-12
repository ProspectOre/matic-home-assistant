import { parseHistoryComparisonFrame } from "./history-catalog";
import { ContractError, isPrivatePath, type HistoryComparisonFrame, type Unchecked } from "./backend-contracts";
import type * as wire from "./backend-schema";

export const ARCHIVE_MAX_RECORDS = 12;
export const ARCHIVE_MAX_COMPRESSED_BYTES = 48 * 1024 * 1024;
export const ARCHIVE_MAX_FILE_BYTES = 68 * 1024 * 1024;
export type ArchiveRetention = "automatic" | "kept" | "trash";
export type ArchiveAction = wire.HistoryAction;

export interface ArchiveRecord {
  readonly id: string;
  readonly contentId: string;
  readonly createdAt: string;
  readonly revision: number;
  readonly pointCount: number;
  readonly sceneUrl: string | null;
  readonly name: string | null;
  readonly retention: ArchiveRetention;
  readonly deletedUntil: string | null;
  readonly imported: boolean;
  readonly comparisonGroup: string | null;
  readonly frame: HistoryComparisonFrame | null;
  readonly compressedBytes: number;
}

export interface ArchiveUsage {
  readonly recordCount: number;
  readonly automaticCount: number;
  readonly keptCount: number;
  readonly trashCount: number;
  readonly compressedBytes: number;
  readonly activeCompressedBytes: number;
  readonly trashCompressedBytes: number;
  readonly reservedBytes: number;
  readonly reservedCount: number;
}

export interface ArchiveCatalog {
  readonly generation: number;
  readonly capturePaused: boolean;
  readonly capacityBlocked: boolean;
  readonly usage: ArchiveUsage;
  readonly records: readonly ArchiveRecord[];
}

export interface ArchiveMutation {
  readonly action: ArchiveAction;
  readonly recordIds: readonly string[];
  readonly expectedGeneration: number;
  readonly requestId: string;
  readonly name?: string;
  readonly allowKept?: boolean;
}

export interface ArchiveAcknowledgement {
  readonly generation: number;
  readonly requestId: string;
  readonly recordIds?: readonly string[];
}

/** An export, or an import file, kept in its wire form for the import body. */
export type ArchiveEnvelope = wire.HistoryArchive;

const fail = (): never => { throw new ContractError("invalid-map-archive"); };
const object = <T>(value: unknown): Unchecked<T> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Unchecked<T> : fail();
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : fail();
const flag = (value: unknown): boolean => typeof value === "boolean" ? value : fail();
const digest = (value: unknown): string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : fail();
const contentId = (value: unknown): string => typeof value === "string" && /^[a-f0-9]{24}$/.test(value) ? value : fail();
const recordId = (value: unknown): string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value) ? value : fail();
const timestamp = (value: unknown): string => typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)) ? value : fail();
const name = (value: unknown): string | null => value === null ? null : typeof value === "string" && value.length <= 128 ? value : fail();

export const archiveRecordIds = (value: readonly string[], allowEmpty = false): readonly string[] => {
  if (!Array.isArray(value) || value.length > ARCHIVE_MAX_RECORDS || (!allowEmpty && value.length === 0)) return fail();
  const ids = value.map(recordId);
  if (new Set(ids).size !== ids.length) return fail();
  return ids;
};

export const parseArchiveCatalog = (value: unknown): ArchiveCatalog => {
  const raw = object<wire.HistoryManagement>(value);
  const usage = object<wire.HistoryUsage>(raw.usage);
  if (!Array.isArray(raw.records) || raw.records.length > ARCHIVE_MAX_RECORDS) return fail();
  const records = raw.records.map((value): ArchiveRecord => {
    const row = object<wire.HistoryRecord>(value);
    const retention = row.retention;
    if (retention !== "automatic" && retention !== "kept" && retention !== "trash") return fail();
    const sceneUrl = row.scene_url === null ? null : typeof row.scene_url === "string" && isPrivatePath(row.scene_url) ? row.scene_url : fail();
    if ((retention === "trash") !== (sceneUrl === null)) return fail();
    return {
      id: recordId(row.id), contentId: contentId(row.content_id), createdAt: timestamp(row.created_at),
      revision: integer(row.revision), pointCount: integer(row.point_count, 1_500_000), sceneUrl,
      name: name(row.name), retention, deletedUntil: row.deleted_until === null ? null : timestamp(row.deleted_until),
      imported: flag(row.imported), comparisonGroup: row.comparison_group === null ? null : digest(row.comparison_group),
      frame: parseHistoryComparisonFrame(row.frame), compressedBytes: integer(row.compressed_bytes, ARCHIVE_MAX_COMPRESSED_BYTES),
    };
  });
  archiveRecordIds(records.map((row) => row.id), true);
  return {
    generation: integer(raw.generation), capturePaused: flag(raw.capture_paused),
    capacityBlocked: flag(raw.capacity_blocked), records,
    usage: {
      recordCount: integer(usage.record_count, ARCHIVE_MAX_RECORDS),
      automaticCount: integer(usage.automatic_count, ARCHIVE_MAX_RECORDS),
      keptCount: integer(usage.kept_count, ARCHIVE_MAX_RECORDS),
      trashCount: integer(usage.trash_count, ARCHIVE_MAX_RECORDS),
      compressedBytes: integer(usage.compressed_bytes, ARCHIVE_MAX_COMPRESSED_BYTES),
      activeCompressedBytes: integer(usage.active_compressed_bytes, ARCHIVE_MAX_COMPRESSED_BYTES),
      trashCompressedBytes: integer(usage.trash_compressed_bytes, ARCHIVE_MAX_COMPRESSED_BYTES),
      reservedBytes: integer(usage.reserved_bytes), reservedCount: integer(usage.reserved_count, ARCHIVE_MAX_RECORDS),
    },
  };
};

export const archiveMutationBody = (request: ArchiveMutation): wire.HistoryMutation => {
  const actions: readonly ArchiveAction[] = ["keep", "unkeep", "rename", "delete", "restore", "permanent_delete", "pause_capture", "resume_capture"];
  if (!actions.includes(request.action)) return fail();
  const policy = request.action === "pause_capture" || request.action === "resume_capture";
  const ids = archiveRecordIds(request.recordIds, policy);
  if ((policy && ids.length !== 0) || (request.action === "rename" && ids.length !== 1)) return fail();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId)) return fail();
  if (request.name !== undefined && (request.action !== "rename" || request.name.length > 128)) return fail();
  if (request.action === "rename" && request.name === undefined) return fail();
  return {
    action: request.action, record_ids: ids, expected_generation: integer(request.expectedGeneration), request_id: request.requestId,
    ...(request.name === undefined ? {} : { name: request.name }),
    ...(request.allowKept === undefined ? {} : { allow_kept: flag(request.allowKept) }),
  } satisfies wire.HistoryMutation;
};

export const parseArchiveAcknowledgement = (value: unknown, requestId: string): ArchiveAcknowledgement => {
  const raw = object<wire.HistoryAcknowledgement>(value);
  if (raw.request_id !== requestId) return fail();
  if (raw.record_ids !== undefined && (!Array.isArray(raw.record_ids) || raw.record_ids.some((id) => typeof id !== "string"))) return fail();
  return { generation: integer(raw.generation), requestId,
    ...(raw.record_ids === undefined ? {} : { recordIds: archiveRecordIds(raw.record_ids as string[]) }),
  };
};

/** Bounds and structure are checked here; the server validates compressed scenes and checksums. */
export const parseArchiveEnvelope = (value: unknown): ArchiveEnvelope => {
  const raw = object<wire.HistoryArchive>(value);
  if (raw.format !== "matic-map-archive" || raw.version !== 1 || !Array.isArray(raw.records) || raw.records.length === 0 || raw.records.length > ARCHIVE_MAX_RECORDS) return fail();
  let encodedBytes = 0;
  const records = raw.records.map((value): wire.HistoryArchiveRecord => {
    const row = object<wire.HistoryArchiveRecord>(value);
    if (typeof row.scene_zlib_base64 !== "string" || row.scene_zlib_base64.length === 0 || row.scene_zlib_base64.length % 4 !== 0) return fail();
    encodedBytes += row.scene_zlib_base64.length;
    if (encodedBytes > Math.ceil(ARCHIVE_MAX_COMPRESSED_BYTES / 3) * 4 || /[^A-Za-z0-9+/=]/.test(row.scene_zlib_base64)) return fail();
    return { source_id: recordId(row.source_id), created_at: timestamp(row.created_at), name: name(row.name),
      sha256: digest(row.sha256), scene_zlib_base64: row.scene_zlib_base64, frame: row.frame ?? null };
  });
  return { format: "matic-map-archive", version: 1, records };
};
