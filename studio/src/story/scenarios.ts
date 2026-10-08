/**
 * Scénarios « persona » (Directeur commercial, Directeur financier…) : objets déclaratifs, rejouables sur
 * n'importe quel fichier une fois les colonnes associées aux rôles (date, mesure, région, commercial…).
 * Les démos intégrées n'en sont que des instances. Chaque étape décrit une opération d'exploration
 * (zoom sur le décrochage, vue carte / historique / détail…) ; le titre et les commentaires sont calculés
 * sur les données (story/drillStory), avec un gabarit facultatif complété par les faits mesurés.
 * Module pur.
 */
import type { DrillSpec, DrillView, NarrativeRole } from "../spec";
import type { Dataset } from "../data/table";
import { columnOf } from "../data/table";
import { buildDrillModel, drillDefaultView, drillInto, drillTo, drillView, guessDrillDate, guessDrillMeasure, guessLevels, guessNature, guessPersonField, guessRegionField, guessVersion, initDrill, rootGrain, versionPair } from "../data/drill";
import { drillStory, type DrillStory } from "./drillStory";

export type ScenarioRoleId = "date" | "mesure" | "region" | "commercial" | "version" | "ligne" | "nature" | "compte";

export interface ScenarioRole {
  id: ScenarioRoleId;
  label: string;
  /** Type de colonne attendu. */
  type: "date" | "number" | "category";
  required: boolean;
  help?: string;
}

export type ScenarioOp =
  /** Vue de départ (grain automatique : trimestres si 9 mois ou plus). */
  | { op: "root" }
  /** Zoom sur la période qui décroche (la plus forte baisse vs sa référence). */
  | { op: "zoomStandout" }
  /** Change de vue (carte, historique, détail) selon la colonne d'un rôle ; `reset` : depuis la vue de départ. */
  | { op: "view"; view: DrillView; by: ScenarioRoleId; reset?: boolean }
  /** Focalise la catégorie qui explique l'écart (région, commercial…). */
  | { op: "focusStandout" }
  /** Cascade : descend dans le plus fort facteur positif (+1) ou négatif (−1) ; `reset` : depuis la cascade de départ. */
  | { op: "focusImpact"; sign: 1 | -1; reset?: boolean }
  /** Tableau croisé : X (« @month », « @quarter » ou rôle), séries (rôle, « @version » ou rien), mesure et graphique. */
  | { op: "pivot"; x: "@month" | "@quarter" | ScenarioRoleId; series: ScenarioRoleId | "@version" | null; agg: "sum" | "mean" | "count" | "delta"; chart: "bar" | "line" };

export interface ScenarioStep {
  /** Identifiant stable de l'étape (sert à l'identifiant stable du snapshot). */
  id: string;
  /** Nom court (fil du scénario, script de réunion). */
  name: string;
  op: ScenarioOp;
  role: NarrativeRole;
  /** Commentaire ajouté au récit calculé ; {clé} remplacé par les faits mesurés (étape ignorée si une clé manque). */
  note?: string;
  /** Étape sautée (au lieu d'arrêter le scénario) si elle n'a pas de sens sur ces données (rôle facultatif absent…). */
  optional?: boolean;
}

export interface Scenario {
  id: string;
  persona: string;
  /** Libellé de l'interface : « Scénario Directeur commercial ». */
  label: string;
  description: string;
  /** Titre de l'histoire créée. */
  storyTitle: string;
  /** Nom de la mesure (« Pipeline créé »). */
  measureLabel: string;
  roles: ScenarioRole[];
  steps: ScenarioStep[];
  /** Exemple intégré qui l'illustre. */
  sampleId: string | null;
}

export type RoleBinding = Partial<Record<ScenarioRoleId, string | null>>;

export const SCENARIO_DIRCOM: Scenario = {
  id: "dircom",
  persona: "Directeur commercial",
  label: "Scénario Directeur commercial",
  description: "Pipeline créé : trimestre en recul → mois qui décroche → carte des régions → région → commerciaux.",
  storyTitle: "Revue du pipeline — octobre 2026",
  measureLabel: "Pipeline créé",
  roles: [
    { id: "date", label: "Date de création", type: "date", required: true, help: "Date à laquelle l'opportunité est créée" },
    { id: "mesure", label: "Montant", type: "number", required: false, help: "Vide : nombre d'opportunités" },
    { id: "region", label: "Région", type: "category", required: true, help: "Bruxelles, Flandre, Wallonie, régions françaises…" },
    { id: "commercial", label: "Commercial", type: "category", required: true },
  ],
  steps: [
    { id: "01-trimestres", name: "Trimestres", op: { op: "root" }, role: "context" },
    { id: "02-mois", name: "Zoom sur le trimestre", op: { op: "zoomStandout" }, role: "tension" },
    { id: "03-mois-focus", name: "Zoom sur le mois", op: { op: "zoomStandout" }, role: "tension" },
    { id: "04-carte", name: "Répartir dans l'espace", op: { op: "view", view: "map", by: "region" }, role: "revelation" },
    { id: "05-historique", name: "Historique par région", op: { op: "view", view: "history", by: "region" }, role: "revelation" },
    { id: "06-region", name: "Focus région", op: { op: "focusStandout" }, role: "revelation" },
    { id: "07-commerciaux", name: "Détailler par commercial", op: { op: "view", view: "breakdown", by: "commercial" }, role: "recommendation" },
  ],
  sampleId: "demo-pipeline",
};

export const SCENARIO_DAF: Scenario = {
  id: "daf",
  persona: "Directeur financier",
  label: "Scénario Directeur financier",
  description: "Marge : cascade Réel → Budget par ligne métier → revenus et coûts par compte → mois → carte → tableau croisé.",
  storyTitle: "Budget 2026 vs réel 2025 — revue financière",
  measureLabel: "Marge contributive",
  roles: [
    { id: "date", label: "Mois", type: "date", required: true, help: "Mois (ou date) de chaque montant" },
    { id: "mesure", label: "Montant", type: "number", required: true },
    { id: "version", label: "Version (Réel / Budget)", type: "category", required: true, help: "Réel 2025, Budget 2026… : le plus ancien réel est comparé au budget le plus récent" },
    { id: "ligne", label: "Ligne métier", type: "category", required: true, help: "Premier niveau de la cascade (Plateforme, Services…)" },
    { id: "compte", label: "Compte", type: "category", required: true, help: "Second niveau (sous-compte, poste)" },
    { id: "nature", label: "Nature (Revenus / Coûts)", type: "category", required: false, help: "Les coûts sont soustraits ; vide : montants additionnés" },
    { id: "region", label: "Région", type: "category", required: false, help: "Facultatif : étape carte" },
  ],
  steps: [
    { id: "01-cascade", name: "Cascade réel → budget", op: { op: "root" }, role: "context" },
    { id: "02-hausse", name: "Facteur en hausse", op: { op: "focusImpact", sign: 1 }, role: "revelation" },
    { id: "03-hausse-mois", name: "Compte en hausse, par mois", op: { op: "focusImpact", sign: 1 }, role: "revelation" },
    { id: "04-baisse", name: "Facteur en baisse", op: { op: "focusImpact", sign: -1, reset: true }, role: "tension" },
    { id: "05-baisse-mois", name: "Compte en baisse, par mois", op: { op: "focusImpact", sign: -1 }, role: "tension" },
    { id: "06-carte", name: "Répartir dans l'espace", op: { op: "view", view: "map", by: "region", reset: true }, role: "revelation", optional: true },
    { id: "07-tableau-croise", name: "Tableau croisé par trimestre", op: { op: "pivot", x: "@quarter", series: "ligne", agg: "delta", chart: "bar" }, role: "recommendation" },
  ],
  sampleId: "demo-finance",
};

export const SCENARIOS: Scenario[] = [SCENARIO_DIRCOM, SCENARIO_DAF];

export function scenarioById(id: string | null | undefined): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** Colonnes proposées par défaut pour chaque rôle (l'utilisateur peut les changer). */
export function guessBinding(sc: Scenario, ds: Dataset): RoleBinding {
  const out: RoleBinding = {};
  for (const r of sc.roles) {
    if (r.id === "date") out.date = guessDrillDate(ds);
    else if (r.id === "mesure") out.mesure = guessDrillMeasure(ds);
    else if (r.id === "region") out.region = guessRegionField(ds);
    else if (r.id === "commercial") out.commercial = guessPersonField(ds);
    else if (r.id === "version") out.version = guessVersion(ds)?.field ?? null;
    else if (r.id === "nature") out.nature = guessNature(ds);
    else if (r.id === "ligne" || r.id === "compte") {
      const lv = guessLevels(ds, { version: out.version ?? guessVersion(ds)?.field ?? null, nature: guessNature(ds), date: guessDrillDate(ds) });
      out[r.id] = (r.id === "ligne" ? lv[0] : lv[1]) ?? null;
    } else (out as Record<string, string | null>)[r.id] = null;
  }
  return out;
}

/** Rôles obligatoires sans colonne valide. */
export function missingRoles(sc: Scenario, ds: Dataset, b: RoleBinding): ScenarioRole[] {
  return sc.roles.filter((r) => {
    const col = columnOf(ds, b[r.id] ?? null);
    if (!col) return r.required;
    if (r.type === "date") return col.type !== "date";
    if (r.type === "number") return col.type !== "number";
    return false;
  });
}

export interface ScenarioFrame {
  step: ScenarioStep;
  drill: DrillSpec;
  story: DrillStory | null;
  /** Commentaires finaux (récit calculé + note du gabarit). */
  comments: string[];
}

function fill(tpl: string, facts: Record<string, string | number>): string | null {
  let ok = true;
  const out = tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = facts[k];
    if (v == null || v === "") ok = false;
    return v == null ? "" : String(v);
  });
  return ok ? out : null;
}

const NO_TRANSFORM = { calculate: [], filters: [] };

/** Applique une opération ; null si elle n'a pas de sens sur ces données (pas de décrochage, colonne absente…). */
export function applyOp(op: ScenarioOp, d: DrillSpec, ds: Dataset, b: RoleBinding): DrillSpec | null {
  const root = d.date ? rootGrain(ds, d.date) : d.grain;
  if (op.op === "root") return d;
  if (op.op === "view") {
    const col = b[op.by];
    if (!col || !columnOf(ds, col)) return null;
    return drillView(op.reset ? drillTo(d, 0, root) : d, op.view, col);
  }
  if (op.op === "pivot") {
    const x = op.x.startsWith("@") ? op.x : b[op.x as ScenarioRoleId] ?? null;
    const series = op.series === "@version" || op.series == null ? op.series : b[op.series] ?? null;
    if (!x) return null;
    return { ...d, view: "pivot", pivot: { x, series, agg: op.agg, chart: op.chart } };
  }
  if (op.op === "focusImpact") {
    let base = op.reset ? drillTo(d, 0, root) : d;
    if (base.view !== "bridge") base = { ...base, ...drillDefaultView(base, root) };
    const { model: bm } = buildDrillModel({ drill: base, transform: NO_TRANSFORM }, ds);
    if (!bm || bm.view !== "bridge") return null;
    const i = op.sign > 0 ? bm.topPos : bm.topNeg;
    if (i == null) return null;
    return drillInto(base, { kind: "cat", field: bm.field, value: bm.items[i]!.key }, root);
  }
  const { model } = buildDrillModel({ drill: d, transform: NO_TRANSFORM }, ds);
  if (!model) return null;
  if (op.op === "zoomStandout") {
    if (model.view !== "periods" || model.focus == null || model.focusKind !== "standout") return null;
    const bar = model.bars[model.focus]!;
    return drillInto(d, { kind: "period", start: bar.key, grain: model.grain }, root);
  }
  // focusStandout
  if (model.view === "history" && model.standout != null) return drillInto(d, { kind: "cat", field: model.field, value: model.series[model.standout]!.key }, root);
  if ((model.view === "map" || model.view === "breakdown") && model.standout != null) return drillInto(d, { kind: "cat", field: model.field, value: model.stats[model.standout]!.key }, root);
  return null;
}

/** Déroule le scénario sur un jeu de données ; s'arrête à la première étape impossible (avec la raison). */
export function runScenario(sc: Scenario, ds: Dataset, b: RoleBinding): { frames: ScenarioFrame[]; stoppedAt: ScenarioStep | null } {
  const vp = b.version ? versionPair(ds, b.version) : null;
  const versions = vp ? { version: b.version!, from: vp.from, to: vp.to, nature: b.nature ?? null, levels: [b.ligne, b.compte].filter((x): x is string => !!x && !!columnOf(ds, x)) } : {};
  let d: DrillSpec = initDrill(ds, { date: b.date ?? undefined, measure: b.mesure ?? null, label: sc.measureLabel, by: b.region ?? b.commercial ?? null, ...versions });
  const frames: ScenarioFrame[] = [];
  for (const step of sc.steps) {
    const next = applyOp(step.op, d, ds, b);
    if (!next && step.optional) continue;
    if (!next) return { frames, stoppedAt: step };
    d = next;
    const story = drillStory({ drill: d, transform: NO_TRANSFORM }, ds);
    const comments = [...(story?.comments ?? [])];
    if (step.note && story) {
      const n = fill(step.note, story.facts);
      if (n) comments.splice(2, comments.length, n);
    }
    frames.push({ step, drill: d, story, comments: comments.slice(0, 3) });
  }
  return { frames, stoppedAt: null };
}

/** Identifiant stable d'un snapshot de scénario (même scénario, même étape, mêmes données → même id). */
export function scenarioSnapshotId(sc: Scenario, step: ScenarioStep, dataKey: string): string {
  let h = 2166136261;
  for (let i = 0; i < dataKey.length; i++) h = Math.imul(h ^ dataKey.charCodeAt(i), 16777619);
  return `${sc.id}-${step.id}-${(h >>> 0).toString(36)}`;
}
