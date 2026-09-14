/**
 * TimingObject — lightweight replacement for TIMINGSRC.TimingObject
 *
 * Tracks a playhead (position) that advances at a given velocity (seconds/sec).
 * Supports `update()`, `query()`, and an event emitter for 'timeupdate' / 'change'.
 * Clamps position to [range[0], range[1]] and auto-loops back to range[0].
 *
 * Replaces: https://webtiming.github.io/timingsrc/lib/timingsrc-v2.js
 */

type TimingEvent = 'timeupdate' | 'change';
type TimingCallback = () => void;

export interface TimingState {
  position: number;
  velocity: number;
}

export interface TimingUpdateOptions {
  position?: number;
  velocity?: number;
}

export class TimingObject {
  private _position: number;
  private _velocity: number;
  private _range: [number, number];
  /** Wall-clock reference point (seconds) matching _position */
  private _wallRef: number;
  private _listeners: Map<TimingEvent, Set<TimingCallback>>;
  private _intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options: { range: [number, number] }) {
    this._range = options.range;
    this._position = options.range[0];
    this._velocity = 0;
    this._wallRef = this._now();
    this._listeners = new Map([
      ['timeupdate', new Set()],
      ['change', new Set()],
    ]);
  }

  // ─── Public API (mirrors TIMINGSRC) ────────────────────────────────────────

  /**
   * Returns the current { position, velocity } snapshot, advancing position
   * by the time elapsed since the last update.
   */
  query(): TimingState {
    if (this._velocity !== 0) {
      const elapsed = this._now() - this._wallRef;
      let next = this._position + this._velocity * elapsed;
      // Clamp + auto-loop at end of range
      if (next >= this._range[1]) {
        next = this._range[0];
      } else if (next < this._range[0]) {
        next = this._range[0];
      }
      this._position = next;
      this._wallRef = this._now();
    }
    return { position: this._position, velocity: this._velocity };
  }

  /**
   * Update position and/or velocity.
   * Calls `query()` first to advance position before applying the new values,
   * so callers never see a stale position after a velocity change.
   */
  update(opts: TimingUpdateOptions): void {
    // Advance before changing state
    this.query();

    if (opts.position !== undefined) {
      this._position = Math.max(this._range[0], Math.min(this._range[1], opts.position));
    }
    if (opts.velocity !== undefined) {
      this._velocity = opts.velocity;
    }
    // Reset wall-clock reference to now
    this._wallRef = this._now();
    this._emit('change');
    this._emit('timeupdate');
  }

  on(event: TimingEvent, cb: TimingCallback): void {
    this._listeners.get(event)?.add(cb);
  }

  off(event: TimingEvent, cb: TimingCallback): void {
    this._listeners.get(event)?.delete(cb);
  }

  // ─── Update loop ────────────────────────────────────────────────────────────

  /**
   * Start the background loop that fires 'timeupdate' at the given interval.
   * Also handles auto-looping when position reaches range[1].
   * Call once after map init.
   */
  startUpdateLoop(intervalMs = 200): void {
    if (this._intervalId !== null) return;
    this._intervalId = setInterval(() => {
      if (this._velocity === 0) return;
      const { position } = this.query();
      this._emit('timeupdate');
      // Auto-loop
      if (position >= this._range[1]) {
        this._position = this._range[0];
        this._wallRef = this._now();
      }
    }, intervalMs);
  }

  stopUpdateLoop(): void {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  destroy(): void {
    this.stopUpdateLoop();
    this._listeners.forEach((s) => s.clear());
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _now(): number {
    return performance.now() / 1000;
  }

  private _emit(event: TimingEvent): void {
    this._listeners.get(event)?.forEach((cb) => cb());
  }
}
