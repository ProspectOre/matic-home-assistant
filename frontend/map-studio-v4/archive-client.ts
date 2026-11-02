import type { MaticBackend } from "./backend";
import type { Localize } from "./contracts";
import { translate } from "./localize";
import {
  ARCHIVE_MAX_FILE_BYTES, archiveMutationBody, archiveRecordIds, parseArchiveAcknowledgement,
  parseArchiveCatalog, parseArchiveEnvelope, type ArchiveAcknowledgement, type ArchiveCatalog,
  type ArchiveEnvelope, type ArchiveMutation,
} from "./archive-contracts";

/** Lazy resource client. The workspace owns authorization, pending state and readback publication. */
export class ArchiveClient {
  constructor(private readonly backend: Pick<MaticBackend, "archiveRequest">) {}

  async catalog(entryId: string, signal?: AbortSignal): Promise<ArchiveCatalog> {
    return parseArchiveCatalog(await this.backend.archiveRequest(entryId, "manage", undefined, signal));
  }

  async mutate(entryId: string, request: ArchiveMutation, signal?: AbortSignal): Promise<ArchiveAcknowledgement> {
    return parseArchiveAcknowledgement(await this.backend.archiveRequest(entryId, "manage", archiveMutationBody(request), signal), request.requestId);
  }

  async exportArchive(entryId: string, ids: readonly string[], generation: number, signal?: AbortSignal): Promise<ArchiveEnvelope> {
    this.#generation(generation);
    return parseArchiveEnvelope(await this.backend.archiveRequest(entryId, "export", {
      record_ids: archiveRecordIds(ids), expected_generation: generation,
    }, signal));
  }

  async importArchive(entryId: string, input: File | string, generation: number, requestId: string, signal?: AbortSignal): Promise<ArchiveAcknowledgement> {
    this.#generation(generation);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new Error("invalid-map-archive");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (typeof input !== "string" && input.size > ARCHIVE_MAX_FILE_BYTES) throw new Error("archive-file-too-large");
    const text = typeof input === "string" ? input : await input.text();
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (text.length > ARCHIVE_MAX_FILE_BYTES || new Blob([text]).size > ARCHIVE_MAX_FILE_BYTES) throw new Error("archive-file-too-large");
    let value: unknown;
    try { value = JSON.parse(text) as unknown; } catch { throw new Error("invalid-map-archive"); }
    const archive = parseArchiveEnvelope(value);
    return parseArchiveAcknowledgement(await this.backend.archiveRequest(entryId, "import", {
      archive, expected_generation: generation, request_id: requestId,
    }, signal), requestId);
  }

  #generation(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid-map-archive");
  }
}

/** Only fixed copy is shown; server payloads never become visible error text. */
export const archiveErrorMessage = (error: unknown, localize?: Localize): string => {
  const status = error !== null && typeof error === "object" && "status" in error ? error.status : null;
  const code = error !== null && typeof error === "object" && "code" in error ? error.code : error instanceof Error ? error.message : null;
  if (status === 401 || status === 403) return translate(localize, "v4_archive_access_required", "Administrator access is required. Sign in again, then refresh saved maps.");
  if (code === "history-quota-exceeded") return translate(localize, "v4_archive_quota_error", "Saved-map storage is full. Export maps you need, then permanently remove selected maps from Recently deleted before importing or capturing more.");
  if (code === "history-trash-expired") return translate(localize, "v4_archive_expired_error", "The 24-hour restore period has ended. Refresh to see which maps remain available.");
  if (code === "history-kept-record-requires-explicit-delete") return translate(localize, "v4_archive_kept_error", "This selection includes kept maps. Review it and explicitly confirm their inclusion.");
  if (code === "history-record-not-found" || code === "history-record-in-trash" || code === "history-record-already-deleted") return translate(localize, "v4_archive_missing_error", "A selected map is no longer available here. Refresh and select from the current saved maps.");
  if (code === "history-store-closed") return translate(localize, "v4_archive_unavailable_error", "This robot integration is restarting or unavailable. Wait for reconnection, then refresh.");
  if (code === "invalid-history-archive" || code === "invalid-history-archive-record") return translate(localize, "v4_archive_damaged_error", "Home Assistant can’t read this archive. Export it again from a supported version.");
  if (code === "invalid-history-name") return translate(localize, "v4_archive_name_error", "The map name can’t be saved. Use at most 128 characters without control characters.");
  if (status === 409) return translate(localize, "v4_archive_changed_error", "Saved maps changed. Refresh, review the current selection, and try again.");
  if (status === 413) return translate(localize, "v4_archive_size_error", "This archive exceeds the map storage or import size limit. Choose a smaller archive or remove saved maps you no longer need.");
  if (status === 507) return translate(localize, "v4_archive_storage_error", "Storage is full or unavailable. Free space, then refresh before retrying.");
  if (code === "archive-file-too-large") return translate(localize, "v4_archive_file_error", "The archive is too large to import. Choose a file no larger than 68 MiB.");
  if (code === "invalid-map-archive") return translate(localize, "v4_archive_format_error", "Home Assistant can’t read this archive. Export it again from a supported version.");
  return translate(localize, "v4_archive_unconfirmed_error", "The operation could not be confirmed. Refresh saved maps before retrying; no additional action has been sent.");
};
