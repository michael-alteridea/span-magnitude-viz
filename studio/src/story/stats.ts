/** Statistiques descriptives pures (détecteurs d'insights). */

export const finite = (xs: (number | null | undefined)[]): number[] => xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
export function mean(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : NaN;
}
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}
/** Quantile (interpolation linéaire, type 7). */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}
export const median = (xs: number[]) => quantile(xs, 0.5);

/** Coefficient de variation (écart-type / |moyenne|). */
export function cv(xs: number[]): number {
  const m = mean(xs);
  return m ? stdev(xs) / Math.abs(m) : 0;
}

export function zscores(xs: number[]): number[] {
  const m = mean(xs);
  const sd = stdev(xs);
  return xs.map((x) => (sd > 0 ? (x - m) / sd : 0));
}

/** Bornes de Tukey : [Q1 − k·IQR, Q3 + k·IQR]. */
export function iqrFences(xs: number[], k = 1.5): { lo: number; hi: number; q1: number; q3: number; iqr: number } {
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  const iqr = q3 - q1;
  return { lo: q1 - k * iqr, hi: q3 + k * iqr, q1, q3, iqr };
}

/** Taux de croissance annuel moyen entre deux valeurs séparées de `years` années. */
export function cagr(first: number, last: number, years: number): number {
  if (!(first > 0) || !(last > 0) || !(years > 0)) return NaN;
  return Math.pow(last / first, 1 / years) - 1;
}

/** Régression linéaire simple : pente, ordonnée, R². */
export function linreg(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

export function pearson(xs: number[], ys: number[]): number {
  const r2 = linreg(xs, ys).r2;
  const s = linreg(xs, ys).slope;
  return Math.sign(s) * Math.sqrt(r2);
}

/** Parts triées décroissantes + plus petit N atteignant `target` du total. */
export function concentration(values: number[], target = 0.5): { sorted: number[]; total: number; shares: number[]; nForTarget: number; topShare: (n: number) => number } {
  const sorted = values.filter((v) => v > 0).sort((a, b) => b - a);
  const total = sum(sorted);
  const shares = sorted.map((v) => (total ? v / total : 0));
  let acc = 0;
  let nForTarget = sorted.length;
  for (let i = 0; i < shares.length; i++) {
    acc += shares[i]!;
    if (acc >= target) {
      nForTarget = i + 1;
      break;
    }
  }
  return { sorted, total, shares, nForTarget, topShare: (n: number) => sum(shares.slice(0, n)) };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);
