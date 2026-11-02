import type { ArchiveBodyReader } from "./archive-request";

const THUMBNAIL_MAX_BYTES = 8 * 1024 * 1024;

export async function runThumbnailResponse(
  response: Response,
  signal: AbortSignal,
  readBody: ArchiveBodyReader,
  backendError: (code: string, status: number | null) => Error,
  contractError: (code: string) => Error,
): Promise<Blob> {
  if (!response.ok) throw backendError("request-failed", response.status);
  if (response.headers.get("Content-Type")?.split(";", 1)[0] !== "image/webp") throw contractError("invalid-thumbnail");
  return new Blob([await readBody(response, signal, THUMBNAIL_MAX_BYTES, "invalid-thumbnail")], { type: "image/webp" });
}
