/**
 * Narration : titre affirmatif, sous-titre IBCS (entité · mesure, unité · période) et 1 à 3
 * commentaires chiffrés, pour n'importe quel spec (Explorer ou création manuelle).
 *
 * Module pur. Point d'extension : `NarrativeRewriter` (réécriture LLM facultative, non implémentée) —
 * il reçoit le récit déterministe + les faits chiffrés et ne doit jamais inventer de chiffres.
 */
import type { ChartSpec, NarrativeRole } from "../spec";
import { isRadial } from "../spec";
import type { Dataset } from "../data/table";
import { columnOf } from "../data/table";
import { effectiveDataset } from "../data/transform";
import { analyzeGoal, ANALYZERS, basisOf, makeCtx, type Analysis, type Ctx, type InsightKind, type StoryContext } from "./insights";
import { capitalize, clip, dayMonthYear, measureLabel, periodLabel } from "./fr";
import { SCENARIO_LABELS } from "./roles";
import { normeSubtitle, specScenarios } from "../norme";

export interface Narrative {
  title: string;
  subtitle: string;
  comments: string[];
  kind: InsightKind;
  role: NarrativeRole;
  why: string;
  facts: Record<string, string | number>;
}

/** Réécriture facultative (ex. LLM) : même structure, mêmes chiffres. */
export interface NarrativeRewriter {
  rewrite(input: { narrative: Narrative; spec: ChartSpec; locale: "fr-FR" }): Promise<Pick<Narrative, "title" | "subtitle" | "comments">>;
}

const UNIT_TXT: Record<string, string> = { eur: "€", keur: "k€", meur: "M€", pct: "%", k: "milliers", M: "millions" };

function generic(spec: ChartSpec, eff: Dataset): InsightKind[] {
  const t = spec.type;
  const xCol = columnOf(eff, spec.encoding.x);
  if (t === "drill") return ["drill"];
  if (t === "variance") return ["variance"];
  if (t === "map") return ["geo", "total"];
  if (t === "film") return ["film"];
  if (t === "scatter") return xCol?.type === "date" ? ["outlier", "total"] : ["correlation", "outlier", "total"];
  if (xCol?.type === "date") return ["trend", "total"];
  if (isRadial(t)) return ["concentration", "ranking", "total"];
  if (xCol) return ["concentration", "ranking", "total"];
  return ["total"];
}

/** Choix concentration vs classement pour un graphique manuel : la concentration si elle est marquée. */
function pickGeneric(kinds: InsightKind[], spec: ChartSpec, eff: Dataset, ctx: Ctx): Analysis | null {
  const results: Analysis[] = [];
  for (const k of kinds) {
    const a = ANALYZERS[k](spec, eff, ctx);
    if (a) results.push(a);
    if (a && k !== "concentration") break;
  }
  if (!results.length) return null;
  if (results[0]!.kind === "concentration" && results[1]?.kind === "ranking" && results[0]!.effect < 0.35) return results[1]!;
  return results[0]!;
}

export function subtitleFor(spec: ChartSpec, eff: Dataset, ctx: Ctx, a: Analysis | null): string {
  const parts: string[] = [];
  if (spec.type === "drill" && a?.scope) return clip(a.scope, 300);
  if (ctx.entity) parts.push(ctx.entity);
  const y = spec.encoding.y;
  const unit = UNIT_TXT[spec.axes.y.unit];
  if (spec.type === "variance" && y.length >= 2) {
    const sc = (n: string) => {
      for (const [k, v] of Object.entries(SCENARIO_LABELS)) if (new RegExp(v.replace("-", "\\s*-\\s*"), "i").test(n)) return SCENARIO_LABELS[k as keyof typeof SCENARIO_LABELS];
      return capitalize(measureLabel(n));
    };
    parts.push(`${a?.scope ?? `${sc(y[0]!)} vs ${sc(y[1]!)}`}${unit ? ` en ${unit}` : ""}`);
  } else if (spec.encoding.aggregate === "count") parts.push("Nombre de lignes");
  else if (y[0]) {
    const agg = spec.encoding.aggregate === "mean" ? "moyenne" : spec.encoding.aggregate === "max" ? "maximum" : spec.encoding.aggregate === "min" ? "minimum" : "";
    const showAgg = agg && spec.axes.y.unit !== "pct";
    parts.push(`${capitalize(measureLabel(y[0]))}${showAgg ? ` (${agg})` : ""}${unit ? ` en ${unit}` : ""}`);
  }
  // Période : étendue des dates (axe X si date, sinon date principale) dans le périmètre affiché
  const dateField = columnOf(eff, spec.encoding.x)?.type === "date" ? spec.encoding.x : (spec.story.params.date as string | undefined) ?? ctx.roles.mainDate?.name;
  let period = "";
  if (dateField && columnOf(eff, dateField)?.type === "date") {
    let lo = Infinity;
    let hi = -Infinity;
    const yf = spec.type === "variance" ? y[0] : null;
    let yearly = true;
    for (const r of eff.rows) {
      const t = r[dateField];
      if (typeof t !== "number") continue;
      if (yf && typeof r[yf] !== "number") continue;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
      if (yearly) {
        const d = new Date(t);
        yearly = d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0;
      }
    }
    // données annuelles (1er janvier) : « 2024 » ou « 2000 – 2025 » plutôt que « janv. 2024 »
    if (lo <= hi) period = yearly ? (new Date(lo).getUTCFullYear() === new Date(hi).getUTCFullYear() ? String(new Date(lo).getUTCFullYear()) : `${new Date(lo).getUTCFullYear()} – ${new Date(hi).getUTCFullYear()}`) : periodLabel(lo, hi);
  }
  if (spec.norme?.enabled) {
    // Message IBCS : qui · quoi en unité · quand + scénarios (« Alteridea SA · Chiffre d’affaires en k€ · 2026 Réel vs Budget »)
    const year = spec.transform.filters.map((f) => f.label).find((l) => /^\d{4}$/.test(l));
    const scen = specScenarios(spec, eff);
    return clip(normeSubtitle(spec, { entity: ctx.entity, period: year ?? (period || `au ${dayMonthYear(ctx.today)}`), scenarios: spec.type === "variance" ? scen.slice(0, 2) : scen }), 300);
  }
  const scope = a?.scope && spec.type !== "variance" ? a.scope : "";
  if (scope) parts.push(scope);
  else {
    // période filtrée sur une colonne de dates (« Année : 2024 », bornes ≥ / <) : déjà dite par la période
    const periodFilter = (f: (typeof spec.transform.filters)[number]) => f.op !== "in" && f.op !== "notIn" && f.op !== "notNull" && columnOf(eff, f.field)?.type === "date" && /\d{4}/.test(f.label);
    const labels = [...new Set(spec.transform.filters.filter((f) => !periodFilter(f)).map((f) => f.label).filter((l) => l && !/^\d{4}$/.test(l)))];
    if (labels.length) parts.push(labels.join(", "));
  }
  if (period && !/au \d/.test(scope)) parts.push(period);
  else if (!period && !scope) parts.push(`au ${dayMonthYear(ctx.today)}`);
  return clip(parts.join(" · "), 300);
}

/** Récit d'un graphique. Renvoie null sans données exploitables. */
export function narrate(spec: ChartSpec, ds: Dataset | null, sc: StoryContext): Narrative | null {
  if (!ds || !ds.rows.length) return null;
  const eff = effectiveDataset(spec, ds);
  if (!eff.rows.length) return null;
  const ctx = makeCtx(ds, sc);
  let a: Analysis | null = null;
  try {
    const k = spec.story.kind as InsightKind | null;
    if ((spec.type === "bar" || spec.type === "barH") && spec.style.barCap === "goal" && !spec.norme?.enabled) a = analyzeGoal(spec, eff, ctx);
    if (!a && k && ANALYZERS[k] && spec.story.basis === basisOf(spec)) a = ANALYZERS[k](spec, eff, ctx);
    if (!a) a = pickGeneric(generic(spec, eff), spec, eff, ctx);
  } catch {
    a = null;
  }
  if (!a) return null;
  return {
    title: clip(a.title, 200),
    subtitle: subtitleFor(spec, eff, ctx, a),
    comments: a.comments.slice(0, 3).map((c) => clip(c, 300)),
    kind: a.kind,
    role: a.role,
    why: a.why,
    facts: a.facts,
  };
}

/** Clé de recalcul du récit (ne dépend pas des textes affichés). */
export function narrativeKey(spec: ChartSpec, dsVersion: number, sc: StoryContext): string {
  return JSON.stringify([dsVersion, sc.today, sc.entity, spec.type, spec.encoding, spec.transform, spec.variance, spec.axes.y.unit, spec.axes.y.unitCustom, spec.story.kind, spec.story.params, spec.story.basis, spec.norme, spec.style.barCap, spec.type === "drill" ? spec.drill : null]);
}

/**
 * Applique un récit au spec en respectant les saisies utilisateur (drapeaux `edited`).
 * Renvoie le spec modifié (copie) ou null si rien ne change.
 */
export function applyNarrative(spec: ChartSpec, n: Narrative | null): ChartSpec | null {
  if (!n || !spec.story.auto) return null;
  const ed = spec.story.edited;
  const title = ed.title ? spec.style.title : n.title;
  const subtitle = ed.subtitle ? spec.style.subtitle : n.subtitle;
  const comments = ed.comments ? spec.story.comments : n.comments;
  if (title === spec.style.title && subtitle === spec.style.subtitle && JSON.stringify(comments) === JSON.stringify(spec.story.comments)) return null;
  return { ...spec, style: { ...spec.style, title, subtitle }, story: { ...spec.story, comments } };
}
