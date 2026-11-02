import type { ResourceState, ResourceStamp } from "./contracts";

export const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

export const resource = <T>(
  status: "idle" | "loading" | "ready" | "empty" | "error",
  value: T | null,
  problem: string | null = null,
) => ({ status, value, problem } as const);

export const cancelLoading = <T>(value: ResourceState<T>): ResourceState<T> =>
  value.status === "loading" ? resource("idle", value.value) : value;

export const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

export const problemCode = (error: unknown, fallback: string): string => {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return fallback;
};

export const sameCoherenceGeneration = (left: ResourceStamp, right: ResourceStamp): boolean =>
  left.entryKey === right.entryKey
  && left.generation === right.generation
  && left.floorKey === right.floorKey
  && left.missionKey === right.missionKey;
