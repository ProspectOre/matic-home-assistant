import { archiveMutationBody, type ArchiveAction, type ArchiveCatalog, type ArchiveMutation, type ArchiveRecord } from "./archive-contracts";

export interface ArchiveConfirmation {
  readonly action: "delete" | "permanent_delete" | "unkeep";
  readonly generation: number;
  readonly records: readonly ArchiveRecord[];
  readonly requestId: string;
}

export const prepareArchiveConfirmation = (
  catalog: ArchiveCatalog, action: ArchiveConfirmation["action"], ids: readonly string[], requestId: string,
): ArchiveConfirmation => {
  const records = ids.map((id) => catalog.records.find((row) => row.id === id));
  if (!ids.length || new Set(ids).size !== ids.length || records.some((row) => !row
    || (action === "permanent_delete" ? row.retention !== "trash"
      : action === "unkeep" ? row.retention !== "kept" : row.retention === "trash"))) throw new Error("archive-selection-changed");
  return { action, generation: catalog.generation, records: records as ArchiveRecord[], requestId };
};

export const confirmArchiveAction = (
  confirmation: ArchiveConfirmation, catalog: ArchiveCatalog, allowKept: boolean,
): ArchiveMutation => {
  if (confirmation.generation !== catalog.generation || confirmation.records.some((row) =>
    !catalog.records.some((current) => current.id === row.id && current.contentId === row.contentId && current.retention === row.retention))) throw new Error("archive-selection-changed");
  const hasKept = confirmation.records.some((row) => row.retention === "kept");
  if (confirmation.action === "delete" && hasKept && !allowKept) throw new Error("archive-kept-confirmation-required");
  return {
    action: confirmation.action, recordIds: confirmation.records.map((row) => row.id),
    expectedGeneration: confirmation.generation, requestId: confirmation.requestId,
    ...(confirmation.action === "delete" ? { allowKept: hasKept && allowKept } : {}),
  };
};

export const archiveAction = (catalog: ArchiveCatalog, action: ArchiveAction, recordIds: readonly string[], requestId: string, name?: string): ArchiveMutation => {
  const request = { action, recordIds, expectedGeneration: catalog.generation, requestId, ...(name === undefined ? {} : { name }) };
  archiveMutationBody(request);
  return request;
};
