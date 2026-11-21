import type { PoseModel } from "./backend-contracts";

// The robot is drawn a moment in the past on its own clock, so every frame
// falls between two samples however unevenly they reach the browser. The
// moment is the longest recent sample interval plus the latest arrival.

/** Samples kept for the clock offset and the delay. */
const WINDOW = 32;
/** A longer interval is a rest, then a step of at most this long. */
const MAX_STEP_MS = 1_000;
/** A longer step is a relocation, not motion, so the robot jumps. */
const MAX_STEP_METERS = 1;
const MARGIN_MS = 20;
// The playhead runs a little slower or faster than real time while the delay
// changes, so the robot never moves backwards or leaps.
const MIN_RATE = 0.9;
const MAX_RATE = 1.25;
const CATCH_UP_MS = 2_000;

/** The map canvas asks its panel for the motion with this event. */
export const POSE_MOTION_EVENT = "matic-pose-motion";
export type PoseMotionRequest = CustomEvent<(motion: PoseMotion) => void>;

interface Sample {
  readonly pose: PoseModel;
  /** x and y in metres and the heading, unwrapped against the sample before so turns take the short way; NaN without one. */
  readonly value: readonly number[];
  /** Robot time in milliseconds, or the arrival time when the pose has none. */
  readonly time: number;
  readonly arrival: number;
  /** Rates of `value` per millisecond on arrival at this sample. */
  readonly rate: readonly number[];
}

const wrap = (value: number): number => Math.atan2(Math.sin(value), Math.cos(value));
const same = (a: readonly number[], b: readonly number[]): boolean => a.every((value, k) => Object.is(value, b[k]));

// Cubic Hermite between a and b over `span`, with end slopes held to at most
// twice the mean slope so the robot does not overshoot a stop.
const hermite = (a: number, b: number, ma: number, mb: number, span: number, u: number): number => {
  const most = 2 * Math.abs(b - a) / span;
  const limit = (slope: number): number => Math.max(-most, Math.min(most, slope));
  return (2 * u ** 3 - 3 * u ** 2 + 1) * a + (u ** 3 - 2 * u ** 2 + u) * span * limit(ma)
    + (3 * u ** 2 - 2 * u ** 3) * b + (u ** 3 - u ** 2) * span * limit(mb);
};

/**
 * Plays the pushed poses back on a short delay along a smooth curve through
 * them, so the robot moves on every frame at an even pace. Each segment's
 * shape depends only on the samples up to its end, so a new sample never
 * bends the part being drawn.
 */
export class PoseMotion {
  #samples: Sample[] = [];
  #robotClock = false;
  /** Robot time being drawn. */
  #playhead = 0;
  /** Local time the playhead was last advanced to. */
  #playedAt = 0;
  readonly #listeners = new Set<() => void>();

  /** Adds a sample; one that repeats the newest changes nothing. */
  push(pose: PoseModel, now = performance.now()): void {
    const newest = this.#samples.at(-1);
    const robotClock = pose.observedAt != null;
    const time = robotClock ? pose.observedAt! * 1_000 : now;
    if (newest && robotClock && this.#robotClock && time <= newest.time) return;
    if (!pose.position) return this.clear();
    const [x, y] = pose.position;
    const heading = pose.heading ?? NaN;
    const continues = newest && robotClock === this.#robotClock && newest.pose.mapSessionKey === pose.mapSessionKey
      && Math.hypot(x - newest.value[0]!, y - newest.value[1]!) <= MAX_STEP_METERS;
    if (!continues) {
      this.#samples = [{ pose, value: [x, y, heading], time, arrival: now, rate: [0, 0, 0] }];
      this.#robotClock = robotClock;
      this.#playhead = time;
      this.#playedAt = now;
      return this.#notify();
    }
    const value = [x, y, newest.value[2]! + wrap(heading - newest.value[2]!) || heading];
    const still = same(value, newest.value);
    if (still && !robotClock) return;
    const span = Math.min(time - newest.time, MAX_STEP_MS);
    const starved = this.#playhead >= newest.time;
    this.#samples.push({ pose, value, time, arrival: now, rate: value.map((v, k) => (v - newest.value[k]!) / span) });
    if (this.#samples.length > WINDOW) this.#samples.shift();
    if (starved) {
      // The robot was held at the last sample. Skip the rest before this step
      // and count time from now, so the step plays whole.
      this.#playhead = Math.max(this.#playhead, time - span);
      this.#playedAt = now;
    }
    this.#playhead = Math.max(this.#playhead, this.#samples[0]!.time);
    if (!still) this.#notify();
  }

  /**
   * The pose to draw at `now`, advancing the playhead: a new object while the
   * robot is between samples, and the same object again while it is still.
   */
  at(now: number): PoseModel | null {
    const samples = this.#samples;
    const newest = samples.at(-1);
    if (!newest) return null;
    this.#advance(now);
    if (this.#playhead >= newest.time) return newest.pose;
    const index = samples.findIndex((sample) => sample.time > this.#playhead);
    const a = samples[index - 1]!;
    const b = samples[index]!;
    const span = Math.min(b.time - a.time, MAX_STEP_MS);
    const u = Math.max(0, (this.#playhead - (b.time - span)) / span);
    // A still robot is drawn as the same object, so it draws nothing new.
    if (u === 0 || same(a.value, b.value)) return a.pose;
    // A step out of a rest starts from rest.
    const [x, y, heading] = a.value.map((v, k) =>
      hermite(v, b.value[k]!, b.time - a.time > MAX_STEP_MS ? 0 : a.rate[k]!, b.rate[k]!, span, u));
    return { ...b.pose, position: [x!, y!], heading: Number.isNaN(heading) ? b.pose.heading : wrap(heading!) };
  }

  /** Whether the playhead is still short of the newest sample. */
  moving(): boolean {
    const newest = this.#samples.at(-1);
    return this.#samples.length > 1 && newest !== undefined && this.#playhead < newest.time;
  }

  clear(): void {
    if (this.#samples.length === 0) return;
    this.#samples = [];
    this.#notify();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #advance(now: number): void {
    const elapsed = now - this.#playedAt;
    if (elapsed <= 0) return;
    this.#playedAt = now;
    const samples = this.#samples;
    let offset = Infinity;
    for (const sample of samples) offset = Math.min(offset, sample.arrival - sample.time);
    let interval = 0;
    let late = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i]!;
      late = Math.max(late, sample.arrival - sample.time - offset);
      if (i > 0) interval = Math.max(interval, Math.min(sample.time - samples[i - 1]!.time, MAX_STEP_MS));
    }
    const target = now - offset - interval - late - MARGIN_MS;
    const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, 1 + (target - this.#playhead) / CATCH_UP_MS));
    this.#playhead = Math.min(this.#playhead + elapsed * rate, samples.at(-1)!.time);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
