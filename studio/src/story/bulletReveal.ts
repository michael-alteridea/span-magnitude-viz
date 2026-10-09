/**
 * Apparition des puces « À retenir » (film, mode lecture) : TOUTES les puces — générales puis puces colorées par
 * élément — arrivent une à une, dans l'ordre, quel que soit leur nombre. Au-delà d'un budget total, l'écart entre
 * deux puces se resserre, sans descendre sous un minimum (jamais d'apparition simultanée).
 *
 * Module pur (testé) : instants d'apparition et nombre de puces visibles à un instant donné.
 */

/** Écart normal entre deux puces (ms). */
export const BULLET_STEP_MS = 1100;
/** Écart minimal entre deux puces (ms), même avec beaucoup de puces. */
export const BULLET_MIN_STEP_MS = 450;
/** Durée totale visée pour faire apparaître toutes les puces (ms) ; au-delà, l'écart se resserre. */
export const BULLET_BUDGET_MS = 4400;

/** Écart entre deux puces pour `n` puces : normal, resserré pour tenir le budget, jamais sous le minimum. */
export function bulletStep(n: number): number {
  if (n <= 1) return BULLET_STEP_MS;
  return Math.max(BULLET_MIN_STEP_MS, Math.min(BULLET_STEP_MS, BULLET_BUDGET_MS / n));
}

/** Instants d'apparition (ms) des `n` puces, la première à `start` : strictement croissants. */
export function bulletTimes(n: number, start = 0): number[] {
  const step = bulletStep(n);
  return Array.from({ length: Math.max(0, n) }, (_, i) => start + i * step);
}

/** Nombre de puces visibles à l'instant `t` (0 avant la première). */
export function bulletsShownAt(t: number, n: number, start = 0): number {
  if (n <= 0 || t < start) return 0;
  return Math.min(n, Math.floor((t - start) / bulletStep(n)) + 1);
}

/** Durée d'apparition de toutes les puces (depuis la première) ; l'animation se termine un écart après la dernière. */
export function bulletsDuration(n: number): number {
  return n <= 0 ? 0 : n * bulletStep(n);
}
