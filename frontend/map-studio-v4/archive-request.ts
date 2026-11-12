import type { Unchecked } from "./backend-contracts";
import type { HistoryError } from "./backend-schema";

export type ArchiveBodyReader = (
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
  invalidCode?: string,
) => Promise<ArrayBuffer>;

export type ArchiveErrorFactory = (code: string, status: number | null) => Error;

/** Consume the bounded JSON response for the optional history archive API. */
export async function decodeArchiveResponse(
  response: Response,
  signal: AbortSignal,
  readBody: ArchiveBodyReader,
  makeError: ArchiveErrorFactory,
): Promise<unknown> {
  if (!response.ok) {
    let code = "archive-request-failed";
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(await readBody(response, signal, 4096)));
      const error = value && typeof value === "object" ? (value as Unchecked<HistoryError>).error : undefined;
      if (typeof error === "string" && /^[a-z0-9-]{1,80}$/u.test(error)) code = error;
    } catch { /* Keep bounded generic failure when the error body is unavailable. */ }
    throw makeError(code, response.status);
  }
  const bytes = await readBody(response, signal, 72 * 1024 * 1024, "archive-response-too-large");
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
