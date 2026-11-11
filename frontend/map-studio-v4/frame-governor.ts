// Animation-frame timestamps are aligned to the display's refresh: a frame
// that takes 24 ms on a 60 Hz display arrives 16.7 or 33.3 ms after the one
// before it, never 24. Frame time is the mean interval over a sample.
const SAMPLE_FRAMES = 4;
// A sample is slow when its frame time is over the limit: 24 ms is under 42
// frames a second, 40 ms is under 25, a touch device missing its 30
// (docs/performance-frame-cost.md). Under four fifths of the limit it is on
// time; the band between is inconclusive.
const SLOW_FRAME_MS = 24;
const SLOW_TOUCH_FRAME_MS = 40;
const ON_TIME_RATIO = 0.8;
// One long frame, such as a collection or a chunk compiling, is one slow sample.
const SLOW_SAMPLES_TO_REDUCE = 2;
const ON_TIME_SAMPLES_TO_RECOVER = 30;
const MAX_ON_TIME_SAMPLES_TO_RECOVER = ON_TIME_SAMPLES_TO_RECOVER * 16;
const REDUCTION_RATIO = 0.75;
const RECOVERY_STEP = 0.25;
const MIN_SCALE = 0.25;
// Thinning a small scene buys no frame time, so Auto leaves at least this many
// points. The surface chunk keeps as many cells.
const MIN_POINTS = 50_000;

/**
 * Auto quality from the intervals between presented frames. JavaScript time
 * cannot see a frame the GPU finishes late, so each timed frame is timed by
 * the animation frame after it. Only frames that move the camera are timed:
 * motion is what a slow frame spoils, and a still map's frames are slow from
 * page work that less detail does not buy back.
 */
export class FrameGovernor {
  /** The share of the scene's detail to draw, from 0.25 to 1. */
  scale = 1;
  /** The last sample's frame time, in milliseconds. */
  frameMs = 0;
  readonly #touch: boolean;
  #slowSamples = 0;
  #sampleMs = 0;
  #sampleFrames = 0;
  #onTimeSamples = 0;
  #recoverAfter = ON_TIME_SAMPLES_TO_RECOVER;
  #raised = false;
  #drawnAt: number | null = null;
  #idleAt: number | null = null;
  #refreshMs = 0;
  #auto = false;
  #timed = false;

  constructor(touch: boolean) {
    this.#touch = touch;
  }

  /** Starts over at the scale a quality setting asks for. */
  reset(scale: number): void {
    this.scale = scale;
    this.#slowSamples = 0;
    this.#sampleMs = 0;
    this.#sampleFrames = 0;
    this.#onTimeSamples = 0;
    this.#recoverAfter = ON_TIME_SAMPLES_TO_RECOVER;
    this.#raised = false;
  }

  /** The stride that thins `points` to the scale without leaving under 50,000. */
  stride(points: number): number {
    return Math.max(1, Math.min(Math.ceil(1 / this.scale), Math.floor(points / MIN_POINTS)));
  }

  /** Forgets the frame being timed, because animation frames stopped. */
  pause(): void {
    this.#drawnAt = null;
    this.#idleAt = null;
  }

  /**
   * Opens an animation frame with its timestamp. `auto` is false when the
   * quality is fixed or the scene is not drawn with WebGL. Returns true when
   * the scale changed, so the scene needs drawing again.
   */
  begin(time: number, auto: boolean): boolean {
    const drawnAt = this.#drawnAt;
    const idleAt = this.#idleAt;
    this.pause();
    this.#auto = auto;
    this.#timed = auto && drawnAt !== null;
    if (!auto) {
      this.reset(this.scale);
      return false;
    }
    // Two frames with nothing drawn between them give the display's own
    // interval. One that refreshes slower than the target, as a 30 Hz
    // power-saving mode does, is not a slow frame.
    if (idleAt !== null) this.#refreshMs = time - idleAt;
    if (drawnAt === null) return false;
    this.#sampleMs += time - drawnAt;
    this.#sampleFrames += 1;
    if (this.#sampleFrames < SAMPLE_FRAMES) return false;
    this.frameMs = this.#sampleMs / SAMPLE_FRAMES;
    this.#sampleMs = 0;
    this.#sampleFrames = 0;
    const limit = Math.max(this.#touch ? SLOW_TOUCH_FRAME_MS : SLOW_FRAME_MS, this.#refreshMs * 1.5);
    const scale = this.scale;
    if (this.frameMs > limit) {
      this.#slowSamples += 1;
      this.#onTimeSamples = 0;
      if (this.#slowSamples >= SLOW_SAMPLES_TO_REDUCE) {
        this.scale = Math.max(MIN_SCALE, scale * REDUCTION_RATIO);
        this.#slowSamples = 0;
        // On-time frames do not show headroom. When a recovery is undone,
        // wait twice as long before the next one.
        if (this.#raised) this.#recoverAfter = Math.min(this.#recoverAfter * 2, MAX_ON_TIME_SAMPLES_TO_RECOVER);
        this.#raised = false;
      }
    } else if (this.frameMs < limit * ON_TIME_RATIO) {
      this.#onTimeSamples += 1;
      this.#slowSamples = 0;
      if (this.#onTimeSamples >= this.#recoverAfter) {
        if (this.#raised) this.#recoverAfter = ON_TIME_SAMPLES_TO_RECOVER;
        this.scale = Math.min(1, scale + RECOVERY_STEP);
        this.#raised = this.scale !== scale;
        this.#onTimeSamples = 0;
      }
    } else {
      // Break both runs instead of letting boundary noise flap the detail tier.
      this.#slowSamples = 0;
      this.#onTimeSamples = 0;
    }
    return this.scale !== scale;
  }

  /**
   * Closes the frame `begin` opened. `drew` says the scene was drawn in it
   * from a camera that moved, `idle` that nothing was drawn. Returns true when
   * the next animation frame is needed: to time this one, or after a timed one
   * to time the display.
   */
  end(time: number, drew: boolean, idle: boolean): boolean {
    if (!this.#auto) return false;
    if (drew) this.#drawnAt = time;
    else if (idle && this.#timed) this.#idleAt = time;
    else return false;
    return true;
  }
}
