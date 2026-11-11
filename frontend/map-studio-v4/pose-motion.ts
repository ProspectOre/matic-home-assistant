import type { PoseModel } from "./backend-contracts";

// A step takes as long as the samples are apart, up to this long.
const MAX_STEP_MS = 1_000;
// A longer step is a relocation, not motion, so the robot jumps.
const MAX_STEP_METERS = 1;

/** The map canvas asks its panel for the motion with this event. */
export const POSE_MOTION_EVENT = "matic-pose-motion";
export type PoseMotionRequest = CustomEvent<(motion: PoseMotion) => void>;

const turn = (from: number, to: number, t: number): number => {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return Math.atan2(Math.sin(from + delta * t), Math.cos(from + delta * t));
};

/**
 * Moves the robot from where it is drawn to each new pose over the time
 * between samples, so it moves on every frame whatever the robot's rate.
 */
export class PoseMotion {
  #from: PoseModel | null = null;
  #to: PoseModel | null = null;
  #start = 0;
  #duration = 0;
  #arrival = -Infinity;
  readonly #listeners = new Set<() => void>();

  /** Starts a step to `pose`; a pose where the robot already is changes nothing. */
  push(pose: PoseModel, now = performance.now()): void {
    const interval = now - this.#arrival;
    this.#arrival = now;
    const to = this.#to;
    if (to && pose.mapSessionKey === to.mapSessionKey && pose.heading === to.heading
      && pose.position?.[0] === to.position?.[0] && pose.position?.[1] === to.position?.[1]) return;
    const from = this.at(now);
    this.#from = from?.position && pose.position && from.mapSessionKey === pose.mapSessionKey
      && Math.hypot(pose.position[0] - from.position[0], pose.position[1] - from.position[1]) <= MAX_STEP_METERS
      ? from : null;
    this.#to = pose;
    this.#start = now;
    this.#duration = Math.min(interval, MAX_STEP_MS);
    for (const listener of this.#listeners) listener();
  }

  /** The pose to draw at `now`: a new object while stepping, then the last sample itself. */
  at(now: number): PoseModel | null {
    const from = this.#from;
    const to = this.#to;
    const t = (now - this.#start) / this.#duration;
    if (!from?.position || !to?.position || !(t < 1)) return to;
    const progress = Math.max(0, t);
    return {
      ...to,
      position: [
        from.position[0] + (to.position[0] - from.position[0]) * progress,
        from.position[1] + (to.position[1] - from.position[1]) * progress,
      ],
      heading: from.heading !== null && to.heading !== null ? turn(from.heading, to.heading, progress) : to.heading,
    };
  }

  clear(): void {
    if (!this.#to) return;
    this.#from = this.#to = null;
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
