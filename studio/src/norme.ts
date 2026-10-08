/**
 * « Mode norme » — notation inspirée d'IBCS® et de la notation ISO 24896 (« Notation for business reporting »).
 * Module pur (sans DOM) : détection des scénarios, styles de notation, signe et couleur des écarts,
 * types déconseillés, orientation (temps → colonnes, structure → barres horizontales), sous-titre
 * qui · quoi · quand, formats de nombres unifiés, clé d'échelle commune.
 *
 * Formulation : « inspiré d'IBCS® / de la notation ISO 24896 ». IBCS® est une marque déposée ;
 * Tell4D n'est pas affilié à l'IBCS Association ni à l'ISO.
 */
import type { AxisSpec, ChartSpec, ChartType } from "./spec";
import { isBarType, isRadial, isSpecial } from "./spec";
import type { Dataset } from "./data/table";
import { columnOf } from "./data/table";
import { valueFormatter } from "./format";
import { VARIANCE_NEG, VARIANCE_POS, normeGreys, normeInk, type Theme } from "./theme";

export { normeGreys, normeInk };

export type ScenarioCode = "AC" | "PY" | "PL" | "FC";
export const SCENARIO_CODES: readonly ScenarioCode[] = ["AC", "PY", "PL", "FC"];
export const SCENARIO_NAMES: Record<ScenarioCode, string> = { AC: "Réel", PY: "N-1", PL: "Budget", FC: "Prévision" };
export const SCENARIO_HELP: Record<ScenarioCode, string> = {
  AC: "Réel (Actual) : aplat foncé plein",
  PY: "N-1 (Previous year) : gris clair plein",
  PL: "Budget / plan : contour, sans remplissage",
  FC: "Prévision (Forecast) : hachuré",
};
export const NORME_WORDING = "inspiré d’IBCS® et de la notation ISO 24896";
/** Accord au féminin (« notation inspirée d’IBCS® … »). */
export const NORME_WORDING_F = "inspirée d’IBCS® et de la notation ISO 24896";
export const DISCOURAGED_TYPES: readonly ChartType[] = ["pie", "donut", "radialBar"];
export const DISCOURAGED_TIP = "déconseillé par la notation IBCS — utilisez des barres";

/* ------------------------------------------------------------------ scénarios */

/** Ordre de test : N-1 et prévision d'abord (« Réel N-1 », « Prévision budget » ne sont pas du réel / budget). */
const SCENARIO_RE: [ScenarioCode, RegExp][] = [
  ["PY", /\bn\s*-\s*1\b|\bpy\b|ann[ée]e\s+pr[ée]c[ée]dente|ann[ée]e\s+derni[èe]re|an\s+dernier|prior\s+year|previous\s+year|last\s+year|\bly\b/i],
  ["FC", /pr[ée]vision|forecast|\bfcst\b|\bfc\b|landing|atterrissage|estim[ée]/i],
  ["PL", /budget|\bplan\b|\bpl\b|objectif|target|\bbu?dg?\b/i],
  ["AC", /r[ée]el(?![a-zà-ÿ])|r[ée]alis[ée]|\bactuals?\b|\bact\b|\bac\b/i],
];

/** Scénario d'un nom de colonne ou de série (Réel / Actual / AC, Budget / Plan / PL, N-1 / PY, Prévision / Forecast / FC). */
export function detectScenario(name: string | null | undefined): ScenarioCode | null {
  if (!name) return null;
  for (const [code, re] of SCENARIO_RE) if (re.test(name)) return code;
  return null;
}

export type ScenarioOverrides = Record<string, ScenarioCode | "none">;

/** Scénario effectif : choix manuel (encodages) sinon détection automatique. */
export function scenarioOf(name: string, overrides: ScenarioOverrides = {}): ScenarioCode | null {
  const o = overrides[name];
  if (o === "none") return null;
  if (o) return o;
  return detectScenario(name);
}

export interface ScenarioStyle {
  code: ScenarioCode;
  fill: string;
  stroke: string;
  /** Remplissage hachuré (motif SVG) — prévision. */
  hatch: boolean;
  /** Pointillés pour les lignes. */
  dash: string | null;
  /** Couleur « d'encre » (traits, hachures, libellés). */
  ink: string;
}

export function scenarioStyle(code: ScenarioCode, theme: Pick<Theme, "dark">, hatchUrl = ""): ScenarioStyle {
  const ink = normeInk(theme);
  switch (code) {
    case "AC":
      return { code, fill: ink.ac, stroke: "none", hatch: false, dash: null, ink: ink.ac };
    case "PY":
      return { code, fill: ink.py, stroke: "none", hatch: false, dash: null, ink: ink.py };
    case "PL":
      return { code, fill: "none", stroke: ink.ac, hatch: false, dash: "6 4", ink: ink.ac };
    case "FC":
      return { code, fill: hatchUrl || "none", stroke: ink.ac, hatch: true, dash: "2 3", ink: ink.ac };
  }
}

/* ------------------------------------------------------------------ écarts */

/** Un écart est-il favorable ? « Hausse = défavorable » (coûts) inverse le sens. */
export function isGood(delta: number, upIsBad: boolean): boolean {
  return upIsBad ? delta <= 0 : delta >= 0;
}

/** Couleur d'un écart : vert favorable, rouge défavorable (seul usage de ces couleurs). */
export function varianceColor(delta: number, polarity: "higher" | "lower"): string {
  return isGood(delta, polarity === "lower") ? VARIANCE_POS : VARIANCE_NEG;
}

/** Écart absolu et relatif (rel = NaN sans référence). */
export function varianceOf(main: number, ref: number): { delta: number; rel: number } {
  const delta = main - ref;
  return { delta, rel: ref ? delta / Math.abs(ref) : NaN };
}

/** Libellé d'écart IBCS : ΔPL, ΔPY, ΔFC. */
export function deltaLabel(ref: ScenarioCode | null): string {
  return ref ? `Δ${ref}` : "Δ";
}

/* ------------------------------------------------------------------ types et orientation */

export function isDiscouraged(t: ChartType): boolean {
  return DISCOURAGED_TYPES.includes(t);
}

export interface NormeAdvice {
  patch: { type?: ChartType; style?: Partial<ChartSpec["style"]> };
  notice: string;
  /** Avis sans bascule (bascule automatique désactivée). */
  soft?: boolean;
}

/**
 * Conseil d'orientation en mode norme : types déconseillés → barres horizontales (toujours) ;
 * catégories (structure) → barres horizontales, temps → colonnes (si bascule automatique, sinon simple avis).
 */
export function normeAdvice(spec: ChartSpec, ds: Dataset | null): NormeAdvice | null {
  if (!spec.norme.enabled) return null;
  const t = spec.type;
  if (isRadial(t)) return { patch: { type: "barH", style: { sort: spec.style.sort === "none" ? "desc" : spec.style.sort } }, notice: `Mode norme : « ${t === "pie" ? "Camembert" : t === "donut" ? "Donut" : "Arcs radiaux"} » est ${DISCOURAGED_TIP} — remplacé par des barres horizontales.` };
  if (isSpecial(t) || !ds) return null;
  const x = columnOf(ds, spec.encoding.x);
  if (!x) return null;
  const isTime = x.type === "date" || (x.type === "number" && /ann[ée]e|year|mois|month/i.test(x.name));
  const auto = spec.norme.autoSwitch;
  if (isBarType(t)) {
    const horizontal = t === "barH" || (spec.style.horizontal && t !== "bar");
    if (!isTime && !horizontal) {
      const patch = t === "bar" ? { type: "barH" as ChartType } : { style: { horizontal: true } };
      return { patch: auto ? patch : {}, soft: !auto, notice: "Mode norme : la structure (catégories) se lit à la verticale — barres horizontales." };
    }
    if (isTime && horizontal) {
      const patch = t === "barH" ? { type: "bar" as ChartType } : { style: { horizontal: false } };
      return { patch: auto ? patch : {}, soft: !auto, notice: "Mode norme : le temps se lit à l'horizontale — colonnes." };
    }
    return null;
  }
  if ((t === "line" || t === "area" || t === "stackedArea") && !isTime) {
    return { patch: auto ? { type: "barH" } : {}, soft: !auto, notice: "Mode norme : des catégories (structure) se lisent en barres horizontales, les lignes sont réservées au temps." };
  }
  return null;
}

/* ------------------------------------------------------------------ formats */

/** Décimales unifiées : choix de l'axe, sinon 0 (1 en M / M€). */
export function normeDecimals(axis: Pick<AxisSpec, "unit" | "decimals">): number {
  return axis.decimals ?? (axis.unit === "meur" || axis.unit === "M" ? 1 : 0);
}

/** Valeurs sans unité (l'unité est dans le sous-titre), décimales identiques partout. */
export function normeFormatter(axis: Pick<AxisSpec, "unit" | "unitCustom" | "decimals">): (v: number) => string {
  return valueFormatter({ ...axis, decimals: normeDecimals(axis) }, undefined, { suffix: false });
}

/** Écart signé sans unité : « +12 », « −320 ». */
export function normeDeltaFormatter(axis: Pick<AxisSpec, "unit" | "unitCustom" | "decimals">): (v: number) => string {
  const f = normeFormatter(axis);
  return (v) => (v > 0 ? "+" : "") + f(v).replace(/^-/, "\u2212");
}

const UNIT_TXT: Record<string, string> = { eur: "€", keur: "k€", meur: "M€", pct: "%", k: "milliers", M: "millions", none: "" };

export function unitText(axis: Pick<AxisSpec, "unit" | "unitCustom">): string {
  return axis.unit === "custom" ? axis.unitCustom.trim() : UNIT_TXT[axis.unit] ?? "";
}

/* ------------------------------------------------------------------ sous-titre qui · quoi · quand */

/** Quoi : mesure déduite (« Réel (€) » → rien → « Montant »), sauf saisie. */
export function normeMeasure(spec: ChartSpec): string {
  if (spec.norme.measure.trim()) return spec.norme.measure.trim();
  if (spec.encoding.aggregate === "count") return "Nombre";
  const y = spec.encoding.y[0];
  if (!y) return "Valeur";
  const stripped = y
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/r[ée]el|r[ée]alis[ée]|actual|budget|\bplan\b|pr[ée]vision|forecast|\bn\s*-\s*1\b|\bpy\b|\bpl\b|\bfc\b|\bac\b/gi, " ")
    .replace(/[€%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "Montant";
  return stripped.charAt(0).toLocaleUpperCase("fr-FR") + stripped.slice(1);
}

/** Scénarios affichés : « Réel + Prévision vs Budget, N-1 ». */
export function scenarioPhrase(codes: ScenarioCode[]): string {
  const set = [...new Set(codes)];
  const mains = (["AC", "FC"] as const).filter((c) => set.includes(c));
  const refs = (["PL", "PY"] as const).filter((c) => set.includes(c));
  const m = mains.map((c) => SCENARIO_NAMES[c]).join(" + ");
  const r = refs.map((c) => SCENARIO_NAMES[c]).join(", ");
  if (m && r) return `${m} vs ${r}`;
  return m || r;
}

/** Scénarios des mesures (ou des valeurs de série) d'un spec. */
export function specScenarios(spec: ChartSpec, ds: Dataset | null): ScenarioCode[] {
  const ov = spec.encoding.scenarios;
  const names = [...spec.encoding.y];
  if (spec.encoding.y.length <= 1 && spec.encoding.series && ds) {
    const vals = new Set<string>();
    for (const r of ds.rows) {
      const v = r[spec.encoding.series];
      if (v != null && v !== "") vals.add(String(v));
      if (vals.size > 12) break;
    }
    names.push(...vals);
  }
  return names.map((n) => scenarioOf(n, ov)).filter((c): c is ScenarioCode => !!c);
}

/**
 * Sous-titre structuré (message IBCS) : qui · quoi en unité · quand + scénarios.
 * Ex. « Alteridea SA · Chiffre d’affaires en k€ · 2026 Réel vs Budget ».
 */
export function normeSubtitle(spec: ChartSpec, opts: { entity?: string; period?: string; scenarios: ScenarioCode[] }): string {
  const who = spec.norme.entity.trim() || opts.entity || "";
  const unit = spec.encoding.aggregate === "count" ? "" : unitText(spec.axes.y);
  const what = `${normeMeasure(spec)}${unit ? ` en ${unit}` : ""}`;
  const when = [opts.period ?? "", scenarioPhrase(opts.scenarios)].filter(Boolean).join(" ");
  return [who, what, when].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------------ échelles communes */

/**
 * Clé d'échelle : deux graphiques de même mesure (et même unité, même agrégat) peuvent partager l'échelle.
 * null pour les types sans échelle de valeurs comparable (film, carte, circulaires, 100 %, log).
 */
export function scaleKey(spec: ChartSpec): string | null {
  const t = spec.type;
  if (isSpecial(t) || isRadial(t) || t === "scatter") return null;
  if (spec.style.normalize && (t === "stackedBar" || t === "stackedArea")) return null;
  if (spec.axes.y.scale === "log") return null;
  const y = spec.encoding.y[0];
  if (!y && spec.encoding.aggregate !== "count") return null;
  const measure = spec.encoding.aggregate === "count" && t !== "variance" ? "#count" : y;
  return JSON.stringify([measure, spec.axes.y.unit, spec.encoding.aggregate]);
}

export interface ScaleInfo {
  key: string;
  /** Nombre de graphiques de l'histoire partageant la mesure. */
  size: number;
  /** Maximum commun (même échelle). */
  max: number;
  /** Maximum propre au graphique. */
  own: number;
  /** Échelles différentes d'un graphique à l'autre (sans « même échelle »). */
  differs: boolean;
}

/** Regroupe les graphiques par mesure ; un groupe de 2+ graphiques aux maxima différents a des échelles différentes. */
export function scaleGroups(items: { id: string; key: string | null; max: number | null }[]): Map<string, ScaleInfo> {
  const groups = new Map<string, { id: string; max: number }[]>();
  for (const it of items) {
    if (!it.key || it.max == null || !Number.isFinite(it.max) || it.max <= 0) continue;
    const g = groups.get(it.key) ?? [];
    g.push({ id: it.id, max: it.max });
    groups.set(it.key, g);
  }
  const out = new Map<string, ScaleInfo>();
  for (const [key, g] of groups) {
    if (g.length < 2) continue;
    const max = Math.max(...g.map((x) => x.max));
    const min = Math.min(...g.map((x) => x.max));
    const differs = max > 0 && (max - min) / max > 0.02;
    for (const x of g) out.set(x.id, { key, size: g.length, max, own: x.max, differs });
  }
  return out;
}
