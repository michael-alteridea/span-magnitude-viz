import type { NormalizedMark, TickerState } from "./types.js";

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

/**
 * Build a staggered reveal timeline:
 * first `slowFirst` marks get a slow annotated window; rest cascade.
 */
export function buildRevealSchedule(
  marks: NormalizedMark[],
  options: { durationMs?: number; slowFirst?: number } = {}
): RevealSchedule {
  const n = marks.length;
  const slowFirst = Math.min(options.slowFirst ?? 2, n);
  const durationMs =
    options.durationMs ??
    Math.min(22000, Math.max(6000, 4000 + n * 120));

  if (n === 0) {
    return { entries: [], durationMs };
  }

  // Map revealAt domain to a base order already sorted.
  const entries: RevealSchedule["entries"] = [];

  // Slow phase: first k marks occupy ~28% of timeline
  const slowEnd = slowFirst > 0 ? 0.28 : 0;
  for (let i = 0; i < slowFirst; i++) {
    const slot = slowFirst === 1 ? 0 : i / (slowFirst - 1);
    const t0 = slot * slowEnd * 0.85;
    const t1 = Math.min(1, t0 + 0.08);
    entries.push({ id: marks[i].id, t0, t1, mark: marks[i] });
  }

  // Cascade: remaining marks from slowEnd → 0.95
  const rest = marks.slice(slowFirst);
  const cascadeStart = slowEnd;
  const cascadeEnd = 0.95;
  for (let i = 0; i < rest.length; i++) {
    const u = rest.length === 1 ? 0 : i / (rest.length - 1);
    // ease-in density: more marks later
    const eased = u * u;
    const t0 = cascadeStart + eased * (cascadeEnd - cascadeStart);
    const t1 = Math.min(1, t0 + 0.025);
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
  // smoothstep
  return u * u * (3 - 2 * u);
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
