import type { NormalizedMark, PersistenceMode, TickerState } from "./types.js";

export interface RevealSchedule {
  /** mark id → reveal progress start/end on [0,1] clock */
  entries: Array<{
    id: string;
    t0: number;
    t1: number;
    mark: NormalizedMark;
  }>;
  durationMs: number;
}

export interface RevealScheduleOptions {
  durationMs?: number;
  slowFirst?: number;
  /** Fraction of timeline for the slow open (0–0.5). Default 0.28. */
  slowOpen?: number;
  /** Cascade packing after the slow open. Default `"normal"`. */
  cascadeSpeed?: "slow" | "normal" | "fast";
}

/**
 * Build a staggered reveal timeline:
 * first `slowFirst` marks get a slow annotated window; rest cascade.
 * Film rhythm: ease-in density on the cascade, optional slower open / faster cascade.
 */
export function buildRevealSchedule(
  marks: NormalizedMark[],
  options: RevealScheduleOptions = {}
): RevealSchedule {
  const n = marks.length;
  const slowFirst = Math.min(options.slowFirst ?? 2, n);
  const durationMs =
    options.durationMs ??
    Math.min(22000, Math.max(6000, 4000 + n * 120));

  if (n === 0) {
    return { entries: [], durationMs };
  }

  const entries: RevealSchedule["entries"] = [];

  const slowOpen = Math.max(0, Math.min(0.5, options.slowOpen ?? 0.28));
  const speed = options.cascadeSpeed ?? "normal";
  // Per-mark draw window (clock fraction)
  const slowWindow = speed === "fast" ? 0.055 : speed === "slow" ? 0.1 : 0.08;
  const cascadeWindow =
    speed === "fast" ? 0.016 : speed === "slow" ? 0.038 : 0.025;
  // Ease power: higher → denser finish (faster cascade feel)
  const easePower = speed === "fast" ? 2.6 : speed === "slow" ? 1.35 : 2;

  const slowEnd = slowFirst > 0 ? slowOpen : 0;
  for (let i = 0; i < slowFirst; i++) {
    const slot = slowFirst === 1 ? 0 : i / (slowFirst - 1);
    // Ease-out on the open so the first beat breathes
    const easedSlot = 1 - Math.pow(1 - slot, 1.4);
    const t0 = easedSlot * slowEnd * 0.82;
    const t1 = Math.min(1, t0 + slowWindow);
    entries.push({ id: marks[i].id, t0, t1, mark: marks[i] });
  }

  const rest = marks.slice(slowFirst);
  const cascadeStart = slowEnd;
  const cascadeEnd = 0.95;
  for (let i = 0; i < rest.length; i++) {
    const u = rest.length === 1 ? 0 : i / (rest.length - 1);
    const eased = Math.pow(u, easePower);
    const t0 = cascadeStart + eased * (cascadeEnd - cascadeStart);
    const t1 = Math.min(1, t0 + cascadeWindow);
    entries.push({ id: rest[i].id, t0, t1, mark: rest[i] });
  }

  return { entries, durationMs };
}

/** Mark visibility / draw progress at clock t ∈ [0,1]. */
export function markProgress(
  schedule: RevealSchedule,
  id: string,
  t: number
): number {
  const e = schedule.entries.find((x) => x.id === id);
  if (!e) return 0;
  if (t < e.t0) return 0;
  if (t >= e.t1) return 1;
  const u = (t - e.t0) / (e.t1 - e.t0);
  // smootherstep (film ease)
  return u * u * u * (u * (u * 6 - 15) + 10);
}

/** Fraction of timeline where finale scatter reappears (PersistenceMode `"finale"`). */
export const FINALE_START = 0.92;

/**
 * Multiplier on mark opacity after the draw window, for persistence modes.
 * - `keep`: always 1 (marks stay)
 * - `ephemeral`: 1 through reveal, then fades to 0
 * - `finale`: like ephemeral during the film, then all marks ramp back in at the end
 */
export function persistenceFactor(
  schedule: RevealSchedule,
  id: string,
  t: number,
  mode: PersistenceMode = "keep"
): number {
  if (mode === "keep") return 1;

  const e = schedule.entries.find((x) => x.id === id);
  if (!e) return 0;

  if (mode === "finale" && t >= FINALE_START) {
    const u = (t - FINALE_START) / Math.max(1e-6, 1 - FINALE_START);
    const s = Math.max(0, Math.min(1, u));
    return s * s * (3 - 2 * s);
  }

  // Ephemeral (and finale before scatter): fade after each reveal window
  const fadeDur = 0.055;
  if (t < e.t1) return 1;
  const fadeT = (t - e.t1) / fadeDur;
  if (fadeT >= 1) return 0;
  return Math.max(0, 1 - fadeT);
}

/**
 * Effective draw progress for sizing/dash, boosting to full size during finale scatter.
 */
export function effectiveDrawProgress(
  schedule: RevealSchedule,
  id: string,
  t: number,
  mode: PersistenceMode = "keep"
): number {
  const draw = markProgress(schedule, id, t);
  if (mode === "finale" && t >= FINALE_START) {
    return Math.max(draw, persistenceFactor(schedule, id, t, mode));
  }
  return draw;
}

export function tickerAt(
  schedule: RevealSchedule,
  t: number
): TickerState {
  let count = 0;
  let magnitudeSum = 0;
  let spanSum = 0;
  for (const e of schedule.entries) {
    const p = markProgress(schedule, e.id, t);
    if (p > 0.5) {
      count += 1;
      magnitudeSum += e.mark.magnitude;
      spanSum += e.mark.spanLength;
    } else if (p > 0) {
      magnitudeSum += e.mark.magnitude * p;
      spanSum += e.mark.spanLength * p;
    }
  }
  return {
    count,
    magnitudeSum,
    spanSum,
    progress: t,
  };
}

export interface AnimationController {
  play(): void;
  pause(): void;
  reset(): void;
  setProgress(t: number): void;
  getProgress(): number;
  destroy(): void;
  readonly playing: boolean;
}

export function createAnimation(
  schedule: RevealSchedule,
  onFrame: (t: number, state: TickerState) => void,
  onComplete?: () => void
): AnimationController {
  let raf = 0;
  let playing = false;
  let t = 0;
  let lastTs = 0;

  const tick = (ts: number) => {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    t = Math.min(1, t + dt / schedule.durationMs);
    onFrame(t, tickerAt(schedule, t));
    if (t >= 1) {
      playing = false;
      onComplete?.();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  return {
    get playing() {
      return playing;
    },
    play() {
      if (playing) return;
      if (t >= 1) t = 0;
      playing = true;
      lastTs = 0;
      raf = requestAnimationFrame(tick);
    },
    pause() {
      playing = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    reset() {
      this.pause();
      t = 0;
      onFrame(0, tickerAt(schedule, 0));
    },
    setProgress(next: number) {
      t = Math.max(0, Math.min(1, next));
      onFrame(t, tickerAt(schedule, t));
      if (t >= 1) onComplete?.();
    },
    getProgress() {
      return t;
    },
    destroy() {
      this.pause();
    },
  };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
