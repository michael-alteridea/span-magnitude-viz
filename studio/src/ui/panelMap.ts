/**
 * Panneau de réglages en accordéon (étape H) : logique pure, testable sans navigateur.
 * - les quatre sections (Graphique → Récit → Style → Export) et leur résumé d'une ligne. Déploiement 2 (datasets) :
 *   l'ancienne carte « Données » est fondue en tête de « ① Graphique » (Dataset ▾, axes, mesure, filtre de vue,
 *   nombre d'éléments) ; le filtre permanent se règle sur le dataset (panneau gauche, fenêtre Données) ;
 * - la recherche de réglages (sans accents, tous les mots) ;
 * - « toucher un élément du graphique » : élément cliqué → section et réglage à mettre en avant.
 */
import { AGGREGATE_LABELS, CHART_TYPE_LABELS, SIZE_PRESETS, isBarType, isCartesian, isRadial, isSpecial, isVariance, type ChartSpec, type ChartType } from "../spec";
import { PALETTE_LABELS } from "../theme";

export const SECTION_IDS = ["graphique", "recit", "style", "export"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SECTION_TITLES: Record<SectionId, string> = { graphique: "Graphique", recit: "Récit", style: "Style", export: "Export" };
export const DEFAULT_SECTION: SectionId = "graphique";

export const isSectionId = (s: unknown): s is SectionId => typeof s === "string" && (SECTION_IDS as readonly string[]).includes(s);

/** Anciens identifiants (session, liens) : « donnees » → « graphique ». */
export const sectionAlias = (s: unknown): SectionId | null => (s === "donnees" ? "graphique" : isSectionId(s) ? s : null);

/** Texte de recherche normalisé : minuscules, sans accents ni apostrophes typographiques. */
export function normSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tous les mots de la requête figurent dans les mots-clés (préfixes acceptés : « deci » → « décimales »). */
export function searchMatch(keywords: string, query: string): boolean {
  const q = normSearch(query);
  if (!q) return true;
  const k = normSearch(keywords);
  return q.split(" ").every((w) => k.includes(w));
}

const UNIT_SHORT: Record<string, string> = { eur: "€", keur: "k€", meur: "M€", pct: "%", k: "k", M: "M" };
const SORT_LABEL: Record<string, string> = { desc: "tri décroissant", asc: "tri croissant", alpha: "tri alphabétique" };
const BG_LABEL: Record<string, string> = { dark: "Sombre", light: "Clair", custom: "Fond perso" };

export const typeShort = (t: ChartType): string => CHART_TYPE_LABELS[t].replace(/\s*\(.*$/, "");

/** Animation résumée : fixe, entrée animée, 4D (dans le temps). */
export function animKind(spec: ChartSpec): "static" | "build" | "4d" {
  if (spec.mode.kind === "static") return "static";
  if (!isSpecial(spec.type) && spec.mode.fourD.enabled && spec.encoding.time) return "4d";
  return "build";
}
export const ANIM_LABELS = { static: "Fixe", build: "Entrée animée", "4d": "4D" } as const;

/** Les encodages minimaux sont choisis (la section « Données » est « faite »). */
export function dataComplete(spec: ChartSpec, hasData: boolean): boolean {
  if (!hasData) return false;
  const e = spec.encoding;
  if (spec.type === "drill") return !!spec.drill.date;
  if (isVariance(spec.type)) return !!e.x && e.y.length >= 2;
  return !!e.x && e.y.length >= 1;
}

/** Résumé d'une ligne de chaque section (affiché dans l'en-tête, ouvert ou replié). */
export function sectionSummaries(spec: ChartSpec, hasData: boolean): Record<SectionId, string> & { donnees: string } {
  const t = spec.type;
  const e = spec.encoding;
  const s = spec.style;
  /* Données */
  let donnees: string;
  if (!hasData) donnees = "Aucune donnée chargée";
  else if (t === "drill") donnees = `${spec.drill.date ?? "date ?"} → ${spec.drill.label || spec.drill.measure || "nombre de lignes"}${spec.drill.by ? ` · par ${spec.drill.by}` : ""}`;
  else if (isVariance(t)) donnees = `${e.x ?? "catégories ?"} · ${e.y[0] ?? "réel ?"} vs ${e.y[1] ?? "référence ?"}`;
  else if (isSpecial(t)) donnees = `${e.x ?? "début ?"} → ${e.y[0] ?? "magnitude ?"}${e.series ? ` · ${e.series}` : ""}`;
  else {
    donnees = `${e.x ?? "axe X ?"} → ${e.y.length ? e.y.join(", ") : "mesure ?"}`;
    if (t !== "scatter") donnees += ` · ${AGGREGATE_LABELS[e.aggregate]}`;
    if (e.series && !isRadial(t) && e.y.length <= 1) donnees += ` · par ${e.series}`;
  }
  if (hasData && e.topN && (isBarType(t) || isRadial(t) || isVariance(t))) donnees += e.topOrder === "bottom" ? ` · ${e.topN} plus petits` : ` · top ${e.topN}`;
  const nf = spec.transform.filters.length;
  if (hasData && nf) donnees += ` · ${nf} filtre${nf > 1 ? "s" : ""}`;
  /* Graphique */
  const g: string[] = [typeShort(t)];
  if ((isBarType(t) || isRadial(t)) && s.sort !== "none") g.push(SORT_LABEL[s.sort] ?? "");
  if ((t === "groupedBar" || t === "stackedBar") && s.horizontal) g.push("horizontales");
  if (isCartesian(t) && t !== "scatter" && s.valueLabels) g.push("étiquettes");
  if (t === "line" || t === "area" || t === "stackedArea") g.push(s.curve === "monotone" ? "lissée" : s.curve === "step" ? "marches" : "droite");
  if (isCartesian(t) || isRadial(t)) {
    const u = spec.axes.y.unit;
    const lab = u === "custom" ? spec.axes.y.unitCustom : UNIT_SHORT[u];
    if (lab) g.push(lab);
  }
  if (isVariance(t) || (spec.norme.enabled && !isSpecial(t) && t !== "drill")) g.push(spec.variance.polarity === "lower" ? "moins = mieux" : "plus = mieux");
  if ((t === "bar" || t === "barH") && !spec.norme.enabled && s.barCap !== "none") g.push(s.barCap === "icon" ? "icônes" : s.barCap === "picto" ? "pictogrammes" : "objectif");
  if (t === "map") g.push(spec.special.mapRegion === "europe" ? "Europe" : spec.special.mapRegion === "world" ? "Monde" : "France · Belgique");
  if (t === "film") g.push(spec.special.geometry === "arc" ? "arcs" : spec.special.geometry === "bar" ? "barres" : "points");
  /* Récit */
  const n = spec.story.comments.filter((c) => (c ?? "").trim()).length;
  const titre = s.title.trim() ? `Titre ${spec.story.edited.title ? "modifié" : "calculé"}` : "Sans titre";
  let recit = `${titre} · ${n ? `${n} point${n > 1 ? "s" : ""} à retenir` : "aucun point à retenir"}${n && !spec.story.showComments ? " (masqués)" : ""}`;
  if (!spec.norme.enabled && s.focus.key) recit += ` · mise en avant : ${s.focus.key === "@max" ? "la plus grande" : s.focus.key}`;
  /* Style */
  const style = `${BG_LABEL[s.background] ?? s.background} · ${spec.norme.enabled ? "Norme (gris)" : PALETTE_LABELS[s.palette].replace(/\s*\(défaut\)/, "")}`;
  /* Export */
  const size = s.size.preset === "custom" ? `${s.size.width} × ${s.size.height} px` : s.size.preset;
  const exp = `${size} · ${ANIM_LABELS[animKind(spec)]}${s.authQr ? " · QR" : ""}`;
  const ds = spec.dataset ? `${spec.dataset.id}` : "";
  return { donnees, graphique: [ds, g.filter(Boolean).join(" · ")].filter(Boolean).join(" · "), recit, style, export: exp };
}

/** Section et réglage(s) à mettre en avant (premier chemin présent dans le panneau), ou groupe (« axe-y »). */
export interface PanelTarget {
  section: SectionId;
  paths: string[];
  group?: string;
}

/** Réglages des marques (barres, parts, points…) selon le type. */
function markTarget(t: ChartType, norme: boolean): PanelTarget {
  if (isVariance(t) || (norme && !isSpecial(t) && t !== "drill")) return { section: "graphique", paths: ["variance.polarity", "style.sort"] };
  if (t === "line" || t === "area" || t === "stackedArea") return { section: "graphique", paths: ["style.curve", "style.valueLabels"] };
  if (t === "scatter") return { section: "graphique", paths: ["axes.y.unit"] };
  if (isSpecial(t)) return { section: "graphique", paths: ["special.geometry", "special.mapRegion"] };
  return { section: "graphique", paths: ["style.sort", "style.valueLabels", "axes.y.unit"] };
}

/**
 * Élément du graphique touché ou cliqué → réglage correspondant
 * (titre → Récit, axe → Graphique › Plus d'options, barre → Graphique, cartouche → Export…).
 * Les éléments d'exploration (data-drill-kind) et les liens sont traités ailleurs : null.
 */
export function chartTarget(el: Element | null, t: ChartType, norme: boolean): PanelTarget | null {
  if (!el || typeof el.closest !== "function") return null;
  const c = (sel: string) => el.closest(sel);
  if (c("a, [data-drill-kind]")) return null;
  const edit = c("[data-r4d-edit]")?.getAttribute("data-r4d-edit");
  if (edit === "title") return { section: "recit", paths: ["style.title"] };
  if (edit === "subtitle") return { section: "recit", paths: ["style.subtitle"] };
  if (edit?.startsWith("elem:")) return { section: "recit", paths: [`story.elements.${edit.split(":")[1]}`, "story.comments.0"] };
  if (edit?.startsWith("comment:")) return { section: "recit", paths: [`story.comments.${edit.split(":")[1]}`, "story.comments.0"] };
  if (c(".r4d-comments-head, .r4d-comments")) return { section: "recit", paths: ["story.showComments", "story.comments.0"] };
  if (c(".r4d-source, .r4d-map-source")) return { section: "recit", paths: ["style.source"] };
  if (c(".r4d-stamp")) return { section: "export", paths: ["mode.fourD.stamp", "anim"] };
  if (c(".r4d-cartouche, .r4d-qr, .r4d-qr-plate, .r4d-fingerprint")) return { section: "export", paths: ["style.authQr"] };
  if (c(".r4d-accent")) return { section: "style", paths: ["style.accentBar"] };
  if (c(".r4d-callout, .r4d-callout-link")) return { section: "recit", paths: ["style.focus.title", "style.focus.key"], group: "focus" };
  if (c(".r4d-avg")) return { section: "recit", paths: ["style.focus.average", "style.focus.key"], group: "focus" };
  if (c(".r4d-bar-deco, .r4d-cap, .r4d-picto-key")) return { section: "graphique", paths: ["style.barCap"] };
  if (c(".r4d-point-icon, .r4d-legend-icon")) return { section: "graphique", paths: ["style.pointShape"] };
  if (c(".r4d-legend")) return { section: "graphique", paths: ["style.legend"] };
  if (c(".r4d-axis-y2")) return { section: "graphique", paths: ["axes.y2.title"], group: "axe-y2" };
  if (c(".r4d-axis-y")) return { section: "graphique", paths: ["axes.y.show"], group: "axe-y" };
  if (c(".r4d-axis-x")) return { section: "graphique", paths: ["axes.x.show"], group: "axe-x" };
  if (c(".r4d-value, .r4d-value-labels")) return { section: "graphique", paths: ["style.valueLabels", "axes.y.decimals"] };
  if (c("[class*='r4d-variance']")) return { section: "graphique", paths: ["variance.polarity"] };
  if (c(".r4d-scalebar")) return { section: "graphique", paths: ["special.mapRegion"] };
  if (c(".r4d-tickers")) return { section: "graphique", paths: ["special.tickers"] };
  if (c(".r4d-marks, [data-tip], .r4d-hits, .r4d-mark, .r4d-pie-labels, .r4d-cat")) return markTarget(t, norme);
  if (c(".r4d-bg")) return { section: "style", paths: ["style.background"] };
  return null;
}

/** Taille d'export lisible (format perso compris). */
export function sizeNote(spec: ChartSpec): string {
  const p = spec.style.size.preset === "custom" ? { width: spec.style.size.width, height: spec.style.size.height } : SIZE_PRESETS[spec.style.size.preset];
  return `${p.width} × ${p.height} px (PNG 2× = ${p.width * 2} × ${p.height * 2})`;
}
