/**
 * Commentaires par élément (puces colorées « À retenir ») : chaque barre, part, point ou série qui a sa propre
 * couleur — surcharge de la sélection (`style.overrides[clé].color`) ou mise en avant (`style.focus.key`) — reçoit
 * une puce dont la pastille a sa couleur, suivie d'un commentaire calculé à partir des données
 * (« Belgique : 14,9 %, −11 pts vs la moyenne ; 2e plus faible »). Le texte saisi par l'utilisateur
 * (`style.overrides[clé].comment`) remplace le texte calculé ; l'effacer rétablit le texte calculé.
 *
 * Regroupement : les éléments de MÊME couleur propre (et de même commentaire saisi, ou tous calculés) partagent
 * une seule puce (« Belgique et Pays-Bas : 14,9 % et 13,2 % ; 2e plus faible et le plus faible »). Un élément dont
 * on saisit un commentaire différent sort du groupe et a sa propre puce.
 *
 * Module pur (aucun accès DOM), résultat mis en cache par jeu de données.
 */
import type { ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import { effectiveDataset } from "../data/transform";
import { allRows, buildCatModel, buildPointModel } from "../data/model";
import { elemKey, markColor, seriesKey } from "../charts/overrides";
import { focusKindOf, pointKey, resolveFocus } from "../charts/focus";
import { paletteColors, themeFor } from "../theme";
import { formatInUnit, formatRate, makeCtx, measureUnitOf, type Ctx, type MUnit } from "./insights";
import { formatPct, formatPoints, formatSignedPct, joinList, measureLabel } from "./fr";

/** Une puce « À retenir » propre à un ou plusieurs éléments de même couleur. */
export interface ElementNote {
  /** Clés de surcharge des éléments regroupés (« e:… », « s:… »). */
  keys: string[];
  /** Noms affichés des éléments. */
  labels: string[];
  /** Couleur de la pastille (#RRGGBB). */
  color: string;
  /** Texte calculé à partir des données. */
  auto: string;
  /** Texte affiché : saisi, sinon calculé. */
  text: string;
  /** Texte saisi par l'utilisateur. */
  edited: boolean;
  /** Puce due seulement à la mise en avant (aucun élément du groupe n'a de couleur propre). */
  focus: boolean;
}

/** Puces par élément affichées au plus (au-delà, la colonne « À retenir » déborderait). */
export const ELEMENT_NOTES_MAX = 6;

const SUPPORTED = new Set(["bar", "barH", "groupedBar", "stackedBar", "line", "area", "stackedArea", "pie", "donut", "radialBar", "scatter"]);
const LINEISH = new Set(["line", "area", "stackedArea"]);
const RADIAL = new Set(["pie", "donut", "radialBar"]);

/** Élément décrit : nom, valeur, et liste comparable (même série / mêmes éléments) pour le rang et la moyenne. */
interface Cand {
  key: string;
  label: string;
  names: string[];
  values: number[];
  k: number;
  when: string;
  share: boolean;
  /** Couleur de base (palette) de l'élément, avant surcharge. */
  base: string;
  ek: string | null;
  sk: string | null;
}

/** « le plus élevé », « 2e plus élevé », « 2e plus faible », « le plus faible ». */
export function rankPhrase(rank: number, n: number): string {
  if (n <= 1 || rank < 1) return "";
  if (rank === 1) return "le plus élevé";
  if (rank === n) return "le plus faible";
  return rank <= n / 2 ? `${rank}e plus élevé` : `${n - rank + 1}e plus faible`;
}

interface Figures {
  vTxt: string;
  tail: string;
  rank: string;
}

function figures(c: Cand, u: MUnit, ml: string): Figures | null {
  const v = c.values[c.k];
  if (v == null || !Number.isFinite(v)) return null;
  const others = c.values.filter((x, i) => i !== c.k && Number.isFinite(x));
  const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : null;
  const total = c.values.filter(Number.isFinite).reduce((a, b) => a + b, 0);
  const vTxt = u === "pct" ? formatRate(v) : `${formatInUnit(v, u)}${ml && ml.length <= 32 && !/[()]/.test(ml) ? ` ${ml}` : ""}`;
  let tail = "";
  if (c.share && u !== "pct" && total > 0 && v >= 0) tail = `${formatPct(v / total)} du total`;
  else if (avg != null && u === "pct") tail = `${formatPoints(v - avg)} vs la moyenne`;
  else if (avg != null && avg !== 0 && Math.sign(avg) === Math.sign(v || avg)) {
    const r = v / avg - 1;
    tail = Math.abs(r) < 0.005 ? "au niveau de la moyenne" : `${formatSignedPct(r)} vs la moyenne`;
  }
  const ranked = c.values.map((x, i) => [x, i] as const).filter(([x]) => Number.isFinite(x)).sort((a, b) => b[0] - a[0]);
  const rank = rankPhrase(ranked.findIndex(([, i]) => i === c.k) + 1, ranked.length);
  return { vTxt: `${vTxt}${c.when ? ` (${c.when})` : ""}`, tail, rank };
}

/** Texte calculé d'un ou plusieurs éléments (même couleur). */
function autoText(labels: string[], figs: Figures[]): string {
  if (figs.length === 1) {
    const f = figs[0]!;
    return `${labels[0]}\u00a0: ${f.vTxt}${f.tail ? `, ${f.tail}` : ""}${f.rank ? ` ; ${f.rank}` : ""}`;
  }
  const ranks = figs.map((f) => f.rank).filter(Boolean);
  return `${joinList(labels)}\u00a0: ${joinList(figs.map((f) => f.vTxt))}${ranks.length === figs.length ? ` ; ${joinList(ranks)}` : ""}`;
}

/** Tous les éléments commentables du graphique (clé de surcharge → description). */
function candidates(spec: ChartSpec, eff: Dataset, colors: string[]): { cands: Map<string, Cand>; focus: string | null } {
  const cands = new Map<string, Cand>();
  const col = (i: number) => colors[((i % colors.length) + colors.length) % colors.length]!;
  const fkey = spec.style.focus?.key ?? null;
  let focus: string | null = null;
  const additive = spec.encoding.aggregate === "sum" || spec.encoding.aggregate === "count";
  if (spec.type === "scatter") {
    const m = buildPointModel(spec, eff, allRows(eff));
    const names = m.points.map(pointKey);
    const values = m.points.map((p) => p.y);
    m.points.forEach((p, k) => {
      const key = elemKey(pointKey(p));
      if (cands.has(key)) return;
      const si = Math.max(0, m.series.indexOf(p.series));
      cands.set(key, { key, label: names[k]!, names, values, k, when: "", share: false, base: col(si), ek: key, sk: seriesKey(p.series || m.series[0] || "") });
    });
    const fk = resolveFocus(fkey, names, values);
    if (fk != null) focus = elemKey(names[fk]!);
    return { cands, focus };
  }
  const m = buildCatModel(spec, eff, allRows(eff));
  const nS = m.series.length;
  const radial = RADIAL.has(spec.type);
  const lineish = LINEISH.has(spec.type);
  if (radial || nS <= 1) {
    const values = radial ? m.labels.map((_, k) => m.values.reduce((a, row) => a + (Number.isFinite(row[k]!) ? row[k]! : 0), 0)) : [...(m.values[0] ?? [])];
    const names = [...m.labels];
    const sk = radial ? null : seriesKey(m.series[0] ?? "");
    names.forEach((n, k) => {
      const key = elemKey(n);
      cands.set(key, { key, label: n, names, values, k, when: "", share: additive && !lineish, base: col(radial ? k : 0), ek: key, sk });
    });
  } else {
    m.series.forEach((s, si) => {
      const values = [...(m.values[si] ?? [])];
      const names = [...m.labels];
      names.forEach((n, k) => {
        const key = elemKey(n, s);
        cands.set(key, { key, label: `${n} (${s})`, names, values, k, when: "", share: additive && !lineish, base: col(si), ek: key, sk: seriesKey(s) });
      });
    });
  }
  if (nS > 1 && !radial) {
    const lastOf = (row: number[]) => {
      for (let i = row.length - 1; i >= 0; i--) if (Number.isFinite(row[i]!)) return i;
      return -1;
    };
    const values = lineish ? m.values.map((row) => row[lastOf(row)] ?? NaN) : m.values.map((row) => row.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0));
    const li = lineish ? Math.max(...m.values.map(lastOf)) : -1;
    const when = li >= 0 ? m.labels[li] ?? "" : "";
    const names = [...m.series];
    names.forEach((s, si) => {
      const key = seriesKey(s);
      cands.set(key, { key, label: s, names, values, k: si, when, share: additive && !lineish, base: col(si), ek: null, sk: key });
    });
  }
  const fkind = focusKindOf(spec, nS);
  if (fkey && fkind) {
    if (fkind === "series") {
      const c = [...cands.values()].filter((x) => x.key.startsWith("s:"));
      const i = resolveFocus(fkey, c.map((x) => x.label), c.map((x) => x.values[x.k]!));
      if (i != null) focus = c[i]!.key;
    } else if (nS <= 1 || radial) {
      const c = [...cands.values()].filter((x) => x.key.startsWith("e:"));
      const i = resolveFocus(fkey, c.map((x) => x.label), c.map((x) => x.values[x.k]!));
      if (i != null) focus = c[i]!.key;
    }
  }
  return { cands, focus };
}

function supported(spec: ChartSpec): boolean {
  return SUPPORTED.has(spec.type) && !spec.norme?.enabled;
}

const ctxCache = new WeakMap<Dataset, Ctx>();
function ctxOf(ds: Dataset): Ctx {
  let c = ctxCache.get(ds);
  if (!c) ctxCache.set(ds, (c = makeCtx(ds, { today: Date.UTC(2026, 0, 1) })));
  return c;
}

/** Tout ce qui fait varier les puces par élément (hors textes du récit). */
function cacheKey(spec: ChartSpec): string {
  const { title: _t, subtitle: _s, ...style } = spec.style;
  return JSON.stringify([spec.type, spec.encoding, spec.transform, spec.dataset ?? null, spec.axes.y.unit, spec.norme?.enabled ?? false, style]);
}
const cache = new WeakMap<Dataset, Map<string, ElementNote[]>>();

/**
 * Puces par élément d'un graphique, dans l'ordre du graphique (éléments puis séries), regroupées par couleur.
 * Vide sans élément de couleur propre ni mise en avant, sans données ou pour un type non pris en charge
 * (exploration, carte, film, course, écarts, mode norme).
 */
export function elementNotes(spec: ChartSpec, ds: Dataset | null): ElementNote[] {
  if (!ds || !ds.rows.length || !supported(spec)) return [];
  const o = spec.style.overrides ?? {};
  const fkey = spec.style.focus?.key ?? null;
  if (!fkey && !Object.values(o).some((x) => x.color)) return [];
  const ck = cacheKey(spec);
  let per = cache.get(ds);
  const hit = per?.get(ck);
  if (hit) return hit;
  let out: ElementNote[] = [];
  try {
    out = computeNotes(spec, ds);
  } catch {
    out = [];
  }
  if (!per) cache.set(ds, (per = new Map()));
  if (per.size > 40) per.clear();
  per.set(ck, out);
  return out;
}

function computeNotes(spec: ChartSpec, ds: Dataset): ElementNote[] {
  const eff = effectiveDataset(spec, ds);
  if (!eff.rows.length) return [];
  const colors = paletteColors(spec, themeFor(spec));
  const { cands, focus } = candidates(spec, eff, colors);
  const o = spec.style.overrides ?? {};
  const ctx = ctxOf(ds);
  const yField = spec.encoding.y[0];
  const u = measureUnitOf(spec, yField, ctx);
  const ml = yField && u === "plain" ? measureLabel(yField) : "";
  const groups = new Map<string, { keys: string[]; labels: string[]; figs: Figures[]; color: string; comment: string | null; own: boolean }>();
  for (const c of cands.values()) {
    const own = o[c.key]?.color;
    if (!own && c.key !== focus) continue;
    const color = (own ?? markColor(spec, c.base, c.ek, c.sk)).toUpperCase();
    const f = figures(c, u, ml);
    if (!f) continue;
    const comment = o[c.key]?.comment?.trim() || null;
    const gk = `${color}\u0000${comment ?? ""}`;
    const g = groups.get(gk);
    if (g) (g.keys.push(c.key), g.labels.push(c.label), g.figs.push(f), (g.own ||= !!own));
    else groups.set(gk, { keys: [c.key], labels: [c.label], figs: [f], color, comment, own: !!own });
  }
  return [...groups.values()].slice(0, ELEMENT_NOTES_MAX).map((g) => {
    const auto = autoText(g.labels, g.figs);
    return { keys: g.keys, labels: g.labels, color: g.color, auto, text: g.comment ?? auto, edited: !!g.comment, focus: !g.own };
  });
}

/**
 * Texte calculé d'un seul élément (placeholder du champ « Commentaire » du panneau de sélection), même s'il n'a
 * pas encore de couleur propre ; "" si l'élément n'est pas commentable.
 */
export function elementAutoText(spec: ChartSpec, ds: Dataset | null, key: string): string {
  if (!ds || !ds.rows.length || !supported(spec)) return "";
  try {
    const eff = effectiveDataset(spec, ds);
    const { cands } = candidates(spec, eff, paletteColors(spec, themeFor(spec)));
    const c = cands.get(key);
    if (!c) return "";
    const yField = spec.encoding.y[0];
    const u = measureUnitOf(spec, yField, ctxOf(ds));
    const f = figures(c, u, yField && u === "plain" ? measureLabel(yField) : "");
    return f ? autoText([c.label], [f]) : "";
  } catch {
    return "";
  }
}

/** Couleur principale du graphique : pastille des puces générales (première couleur de la palette). */
export function mainColor(spec: ChartSpec): string {
  return paletteColors(spec, themeFor(spec))[0] ?? themeFor(spec).accent;
}
