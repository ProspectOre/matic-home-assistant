import type { ArchiveBodyReader } from "./archive-request";

// The integration serves robot pictures and photos as WebP, at most 8 MB.
const WEBP_MAX_BYTES = 8 * 1024 * 1024;

export async function webpImageResponse(
  response: Response,
  signal: AbortSignal,
  readBody: ArchiveBodyReader,
  backendError: (code: string, status: number | null) => Error,
  contractError: (code: string) => Error,
): Promise<Blob> {
  if (!response.ok) throw backendError("request-failed", response.status);
  if (response.headers.get("Content-Type")?.split(";", 1)[0] !== "image/webp") throw contractError("invalid-image");
  return new Blob([await readBody(response, signal, WEBP_MAX_BYTES, "invalid-image")], { type: "image/webp" });
}
