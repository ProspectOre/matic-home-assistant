/** Bound the offset between the server clock and the browser's monotonic clock. */
export class PoseClock {
  #clock: { low: number; high: number; at: number } | null = null;

  transit(timestamp: unknown, started: number, received: number, serverMs: number): number {
    if (typeof timestamp !== "number" || !(timestamp > 0 && timestamp < 1e11)) {
      return Math.max(0, received - started - serverMs);
    }
    const measured = timestamp * 1_000;
    const low = measured - received - 1;
    const high = measured - started - serverMs + 1;
    const previous = this.#clock && received - this.#clock.at <= 5_000 ? this.#clock : null;
    const drift = previous ? 1 + Math.max(0, received - previous.at) * 0.0001 : 0;
    const nextLow = previous ? Math.max(low, previous.low - drift) : low;
    const nextHigh = previous ? Math.min(high, previous.high + drift) : high;
    this.#clock = nextLow <= nextHigh
      ? { low: nextLow, high: nextHigh, at: received }
      : { low, high, at: received };
    return Math.max(0, received + this.#clock.high - measured) + 1;
  }
}
