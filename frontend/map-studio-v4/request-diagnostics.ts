/** Bounded, process-local aggregates for private HTTP requests. */

export const BACKEND_REQUEST_OPERATIONS = [
  "catalog",
  "scene",
  "sceneDelta",
  "pose",
  "history",
  "plans",
  "areas",
  "areaSave",
  "areaDelete",
] as const;

export type BackendRequestOperation = typeof BACKEND_REQUEST_OPERATIONS[number];
export type BackendRequestOutcome = "completed" | "failed" | "aborted" | "timedOut";

export interface BackendRequestOperationDiagnostics {
  /** Settled operations admitted to #request; excludes in-flight and rejected-before-admission calls. */
  readonly requests: number;
  readonly completed: number;
  readonly failed: number;
  readonly aborted: number;
  readonly timedOut: number;
  readonly totalDurationMs: number;
  readonly maxDurationMs: number;
}

export type BackendRequestDiagnostics = Readonly<Record<BackendRequestOperation, BackendRequestOperationDiagnostics>>;

const MAX_COUNT = 1_000_000_000;
const MAX_DURATION_MS = 1_000_000_000_000;

interface MutableOperationDiagnostics {
  requests: number;
  completed: number;
  failed: number;
  aborted: number;
  timedOut: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

const emptyOperation = (): MutableOperationDiagnostics => ({
  requests: 0,
  completed: 0,
  failed: 0,
  aborted: 0,
  timedOut: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
});

const boundedIncrement = (value: number): number => Math.min(MAX_COUNT, value + 1);
const boundedDuration = (value: number): number => Number.isFinite(value)
  ? Math.min(MAX_DURATION_MS, Math.max(0, value))
  : 0;

/** One bounded aggregate; callers own the fixed keys associated with each instance. */
export class BoundedRequestMetric {
  readonly #value = emptyOperation();
  #disposed = false;

  record(outcome: BackendRequestOutcome, durationMs: number): void {
    if (this.#disposed) return;
    const duration = Math.round(boundedDuration(durationMs) * 100) / 100;
    this.#value.requests = boundedIncrement(this.#value.requests);
    this.#value[outcome] = boundedIncrement(this.#value[outcome]);
    this.#value.totalDurationMs = boundedDuration(this.#value.totalDurationMs + duration);
    this.#value.maxDurationMs = Math.max(this.#value.maxDurationMs, duration);
  }

  snapshot(): BackendRequestOperationDiagnostics {
    return Object.freeze({ ...this.#value });
  }

  reset(): void {
    if (this.#disposed) return;
    Object.assign(this.#value, emptyOperation());
  }

  dispose(): void {
    this.#disposed = true;
    Object.assign(this.#value, emptyOperation());
  }
}

/** Holds aggregate-only measurements under the module's closed operation set. */
export class BackendRequestDiagnosticsStore {
  readonly #operations = Object.fromEntries(
    BACKEND_REQUEST_OPERATIONS.map((operation) => [operation, new BoundedRequestMetric()]),
  ) as Record<BackendRequestOperation, BoundedRequestMetric>;
  #disposed = false;

  record(operation: BackendRequestOperation, outcome: BackendRequestOutcome, durationMs: number): void {
    if (this.#disposed) return;
    this.#operations[operation].record(outcome, durationMs);
  }

  snapshot(): BackendRequestDiagnostics {
    const result = Object.fromEntries(BACKEND_REQUEST_OPERATIONS.map((operation) => [
      operation,
      this.#operations[operation].snapshot(),
    ])) as Record<BackendRequestOperation, BackendRequestOperationDiagnostics>;
    return Object.freeze(result);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const operation of BACKEND_REQUEST_OPERATIONS) this.#operations[operation].dispose();
  }
}
