/**
 * Revues de démonstration (société fictive Norvia) construites à partir des vrais snapshots des scénarios
 * « Directeur commercial » (exemple « Démo : pipeline commercial ») et « Directeur financier »
 * (« Démo : réel vs budget ») : mêmes identifiants stables que dans le Studio, participants, lectures,
 * réactions, commentaires, questions, décisions et actions fictifs.
 */
import { parseSpec, chartSize, type ChartSpec } from "../spec";
import { sampleById } from "../data/samples";
import { buildDataset } from "../data/table";
import { hashRows, makeProvenance } from "../provenance";
import { SAMPLE_TODAY } from "../data/samples";
import { drillPathLabels } from "../data/drill";
import { SCENARIO_DAF, SCENARIO_DIRCOM, guessBinding, runScenario, scenarioSnapshotId, type Scenario } from "../story/scenarios";
import type { Snapshot } from "../story/snapshots";
import { demoStoryDef } from "../story/reading";
import { initials, type Person, type Review, type ReviewComment, type ReviewItem, type Reaction, type ReactionKind } from "./model";

export const DEMO_PIPELINE_ID = "norvia-pipeline-oct-2026";
export const DEMO_FINANCE_ID = "norvia-budget-2026";
export const DEMO_ORG = "Norvia";

const COLORS = ["#0E6E8C", "#2F7F79", "#7A6A58", "#5B5F97", "#4F7CA1", "#8A5A6B", "#3F7D5B", "#6B7A85", "#8B6B3E", "#46677A"];

/** Snapshots d'un scénario sur un exemple intégré (rendu recalculé à l'affichage : svg et vignette vides). */
export async function scenarioSnapshots(sampleId: string, sc: Scenario, generatedAt: string): Promise<{ snaps: Snapshot[]; hash: string }> {
  const sample = sampleById(sampleId);
  if (!sample) throw new Error(`exemple introuvable : ${sampleId}`);
  const rows = sample.rows();
  const ds = buildDataset(sample.name, rows);
  const parsed = parseSpec(sample.spec);
  if (!parsed.ok) throw new Error(`spec invalide : ${sampleId}`);
  const hash = await hashRows(rows);
  const provenance = makeProvenance({ hash, kind: "sample", fileName: sample.name, rows: ds.rows.length, cols: ds.columns.length, asOf: SAMPLE_TODAY, now: new Date(generatedAt) });
  const run = runScenario(sc, ds, guessBinding(sc, ds));
  const base = parsed.spec;
  const snaps = run.frames.map((f): Snapshot => {
    const spec: ChartSpec = {
      ...base,
      type: "drill",
      drill: f.drill,
      provenance,
      style: { ...base.style, title: f.story?.title ?? "", subtitle: f.story?.scope ?? "" },
      story: { ...base.story, auto: true, comments: f.comments, edited: { title: false, subtitle: false, comments: false } },
    } as ChartSpec;
    const { width, height } = chartSize(spec);
    return {
      id: scenarioSnapshotId(sc, f.step, hash),
      name: f.story?.title ?? f.step.name,
      createdAt: generatedAt,
      spec,
      svg: null,
      thumb: null,
      width,
      height,
      title: f.story?.title ?? f.step.name,
      subtitle: f.story?.scope ?? "",
      comments: f.comments,
      source: spec.style.source,
      kind: "drill",
      role: f.story?.role ?? "context",
      sampleId,
      dataName: ds.name,
      generatedAt,
      path: drillPathLabels(f.drill),
      scenario: sc.id,
      step: f.step.id,
    };
  });
  return { snaps, hash };
}

function people(list: [string, string, string][]): Person[] {
  return list.map(([id, name, role], i) => ({ id, name, role, email: `${name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ".")}@norvia.example`, color: COLORS[i % COLORS.length]! }));
}

interface Seed {
  seen: Record<string, [string[] | "all", string]>;
  notes: Record<string, string>;
  reactions: [string, string, ReactionKind][];
  comments: (Omit<ReviewComment, "snapId" | "parentId" | "status" | "supports"> & { step: string; parent?: string; supports?: string[]; status?: ReviewComment["status"] })[];
  items: (Omit<ReviewItem, "snapId"> & { step: string | null })[];
}

function apply(r: Review, seed: Seed): Review {
  const byStep = (step: string | null) => (step ? r.snapshots.find((s) => s.step === step)?.id ?? null : null);
  const seen: Review["seen"] = {};
  for (const [pid, [steps, at]] of Object.entries(seed.seen)) {
    const ids = steps === "all" ? r.snapshots.map((s) => s.id) : steps.map((s) => byStep(s)!).filter(Boolean);
    // horodatages croissants (une minute par snapshot), dernier = `at`
    const t = Date.parse(at);
    seen[pid] = Object.fromEntries(ids.map((id, k) => [id, new Date(t - (ids.length - 1 - k) * 60000).toISOString()]));
  }
  const notes = Object.fromEntries(Object.entries(seed.notes).map(([step, n]) => [byStep(step)!, n]));
  const reactions: Reaction[] = seed.reactions.map(([step, author, kind]) => ({ snapId: byStep(step)!, author, kind }));
  const comments: ReviewComment[] = seed.comments.map((c) => ({ id: c.id, snapId: byStep(c.step)!, author: c.author, text: c.text, at: c.at, parentId: c.parent ?? null, question: c.question, supports: c.supports ?? [], status: c.status ?? "ouverte" }));
  const items: ReviewItem[] = seed.items.map(({ step, ...it }) => ({ ...it, snapId: byStep(step) }));
  return { ...r, seen, notes, reactions, comments, items };
}

/* ------------------------------------------------------------------ revue pipeline (Directeur commercial) */

export async function demoPipelineReview(): Promise<Review> {
  const created = "2026-10-08T06:30:00+02:00";
  const { snaps } = await scenarioSnapshots("demo-pipeline", SCENARIO_DIRCOM, created);
  const ppl = people([
    ["sl", "Sophie Lambert", "Contrôle de gestion commercial"],
    ["md", "Marc Delaunay", "Directeur commercial"],
    ["ib", "Inès Benali", "Resp. grands comptes"],
    ["tg", "Thomas Girard", "Dir. régional Île-de-France"],
    ["cf", "Camille Faure", "Dir. régionale Wallonie"],
    ["hl", "Hugo Lefèvre", "Dir. régional Flandre"],
    ["lm", "Léa Morel", "Sales ops"],
    ["np", "Nicolas Petit", "Dir. régional Hauts-de-France"],
    ["am", "Antoine Mercier", "Avant-vente"],
    ["sc", "Sarah Cohen", "Marketing"],
  ]);
  const base: Review = {
    v: 1,
    id: DEMO_PIPELINE_ID,
    title: "Revue pipeline — octobre 2026",
    org: `${DEMO_ORG} · Direction commerciale`,
    persona: { scenario: SCENARIO_DIRCOM.id, label: SCENARIO_DIRCOM.label, audience: "Directeur commercial" },
    presenter: "sl",
    recipient: "md",
    meetingAt: "2026-10-08T09:00:00+02:00",
    meetingLabel: "Pipe review hebdo",
    status: "terminee",
    createdAt: created,
    updatedAt: "2026-10-08T09:47:00+02:00",
    demo: true,
    snapshots: snaps,
    notes: {},
    people: ppl,
    participants: ["md", "ib", "tg", "cf", "hl", "lm", "np", "am", "sc"],
    seen: {},
    reactions: [],
    comments: [],
    items: [],
    meeting: { startedAt: "2026-10-08T09:00:00+02:00", endedAt: "2026-10-08T09:47:00+02:00", current: 6, present: ["md", "ib", "tg", "cf", "hl", "lm", "np", "am"], seenBefore: { md: 7, ib: 7, tg: 7, cf: 7, hl: 4, lm: 7, np: 7, am: 2, sc: 7 } },
    share: { access: "invites", comments: true, showSeen: true, hideAmounts: false, expires: "2026-11-08" },
  };
  return apply(base, {
    seen: {
      md: ["all", "2026-10-08T07:10:00+02:00"],
      ib: ["all", "2026-10-08T08:12:00+02:00"],
      tg: ["all", "2026-10-08T07:55:00+02:00"],
      cf: ["all", "2026-10-08T06:58:00+02:00"],
      hl: [["01-trimestres", "02-mois", "03-mois-focus", "04-carte", "05-historique", "06-region", "07-commerciaux"], "2026-10-08T09:21:00+02:00"],
      lm: ["all", "2026-10-08T08:41:00+02:00"],
      np: ["all", "2026-10-08T08:47:00+02:00"],
      am: [["01-trimestres", "02-mois", "03-mois-focus", "04-carte"], "2026-10-08T09:30:00+02:00"],
      sc: ["all", "2026-10-08T06:45:00+02:00"],
    },
    notes: {
      "01-trimestres": "Premier trimestre en recul depuis début 2025 : on cherche d'où vient l'écart avant de parler du T4.",
      "02-mois": "Avril et mai sont dans la norme : tout se joue en juin.",
      "03-mois-focus": "Pas d'incident CRM en juin (synchronisation vérifiée avec les sales ops) : l'écart est réel.",
      "04-carte": "La Wallonie concentre toute la baisse ; les quatre autres régions tiennent leur rythme.",
      "05-historique": "Août est bas partout, comme chaque année : ce n'est pas le sujet de la revue.",
      "06-region": "La Wallonie repart dès juillet : l'incident est circonscrit à juin.",
      "07-commerciaux": "Julie M. était absente trois semaines en juin, sans relais sur ses comptes.",
    },
    reactions: [
      ["01-trimestres", "md", "utile"], ["01-trimestres", "np", "accord"], ["01-trimestres", "ib", "accord"],
      ["02-mois", "md", "accord"], ["02-mois", "tg", "accord"], ["02-mois", "lm", "utile"],
      ["04-carte", "md", "attention"], ["04-carte", "cf", "accord"], ["04-carte", "tg", "utile"], ["04-carte", "hl", "utile"],
      ["05-historique", "sc", "accord"], ["05-historique", "lm", "utile"],
      ["06-region", "cf", "accord"], ["06-region", "md", "utile"],
      ["07-commerciaux", "md", "attention"], ["07-commerciaux", "cf", "accord"], ["07-commerciaux", "ib", "clarifier"], ["07-commerciaux", "np", "accord"],
    ],
    comments: [
      { id: "c-p1", step: "01-trimestres", author: "md", text: "Le T3 2026 compense-t-il déjà ce recul ?", at: "2026-10-08T07:02:00+02:00", question: true, supports: ["np", "ib"], status: "repondue" },
      { id: "c-p1r", step: "01-trimestres", author: "sl", parent: "c-p1", text: "Oui : le T3 2026 est le meilleur trimestre de la série (5,2 M€ créés).", at: "2026-10-08T08:05:00+02:00", question: false },
      { id: "c-p2", step: "03-mois-focus", author: "lm", text: "Côté outils, rien d'anormal en juin : les opportunités sont bien remontées chaque jour.", at: "2026-10-08T08:40:00+02:00", question: false },
      { id: "c-p3", step: "04-carte", author: "tg", text: "Peut-on voir la Wallonie hors grands comptes ?", at: "2026-10-08T07:54:00+02:00", question: true, supports: ["md"], status: "en-action" },
      { id: "c-p4", step: "05-historique", author: "hl", text: "Août bas partout, comme en 2025 : rien d'anormal côté Flandre.", at: "2026-10-08T09:20:00+02:00", question: false },
      { id: "c-p5", step: "06-region", author: "cf", text: "Confirmé : reprise dès juillet en Wallonie, l'équipe est au complet.", at: "2026-10-08T06:57:00+02:00", question: false },
      { id: "c-p6", step: "07-commerciaux", author: "md", text: "Quel relais pendant les absences en Wallonie ? Je veux le point en séance.", at: "2026-10-08T07:10:00+02:00", question: true, supports: ["cf", "ib", "np"], status: "en-action" },
      { id: "c-p6r", step: "07-commerciaux", author: "cf", parent: "c-p6", text: "Pas de binôme en juin. Je propose un relais par paire de commerciaux dès novembre.", at: "2026-10-08T08:30:00+02:00", question: false },
      { id: "c-p7", step: "07-commerciaux", author: "ib", text: "Les comptes de Julie M. ont-ils perdu des affaires, ou seulement du décalage ?", at: "2026-10-08T08:12:00+02:00", question: true, supports: ["tg"], status: "ouverte" },
    ],
    items: [
      { id: "i-p1", step: "01-trimestres", kind: "decision", text: "Objectif de pipeline T4 2026 maintenu ; point d'étape à la revue de novembre.", owner: "md", due: null, by: "sl", at: "2026-10-08T09:08:00+02:00" },
      { id: "i-p2", step: "07-commerciaux", kind: "decision", text: "Relais obligatoire par binôme de commerciaux pour toute absence de plus d'une semaine.", owner: "md", due: null, by: "sl", at: "2026-10-08T09:40:00+02:00" },
      { id: "i-p3", step: "04-carte", kind: "action", text: "Vue Wallonie hors grands comptes pour la prochaine revue", owner: "lm", due: "2026-10-15", by: "sl", at: "2026-10-08T09:22:00+02:00", fromQuestion: "c-p3" },
      { id: "i-p4", step: "07-commerciaux", kind: "action", text: "Mettre en place les binômes de relais en Wallonie", owner: "cf", due: "2026-10-31", by: "sl", at: "2026-10-08T09:41:00+02:00", fromQuestion: "c-p6" },
      { id: "i-p5", step: "07-commerciaux", kind: "action", text: "Relancer les comptes de Julie M. restés sans suite en juin", owner: "cf", due: "2026-10-22", by: "sl", at: "2026-10-08T09:43:00+02:00" },
    ],
  });
}

/* ------------------------------------------------------------------ revue financière (Directeur financier) */

export async function demoFinanceReview(): Promise<Review> {
  const created = "2026-10-08T11:30:00+02:00";
  const { snaps } = await scenarioSnapshots("demo-finance", SCENARIO_DAF, created);
  const ppl = people([
    ["sl", "Sophie Lambert", "Contrôle de gestion"],
    ["cv", "Claire Vasseur", "Directrice financière"],
    ["md", "Marc Delaunay", "Directeur commercial"],
    ["pr", "Paul Renaud", "Resp. ligne Cloud"],
    ["im", "Isabelle Martin", "Resp. ligne SN/Legacy"],
    ["kh", "Karim Haddad", "Contrôleur de gestion"],
    ["es", "Élodie Simon", "Directrice générale adjointe"],
  ]);
  const base: Review = {
    v: 1,
    id: DEMO_FINANCE_ID,
    title: "Business review — Budget 2026 vs réel 2025",
    org: `${DEMO_ORG} · Direction financière`,
    persona: { scenario: SCENARIO_DAF.id, label: SCENARIO_DAF.label, audience: "Directrice financière" },
    presenter: "sl",
    recipient: "cv",
    meetingAt: "2026-10-09T14:00:00+02:00",
    meetingLabel: "Comité budget",
    status: "partagee",
    createdAt: created,
    updatedAt: "2026-10-08T15:10:00+02:00",
    demo: true,
    snapshots: snaps,
    notes: {},
    people: ppl,
    participants: ["cv", "md", "pr", "im", "kh", "es"],
    seen: {},
    reactions: [],
    comments: [],
    items: [],
    meeting: { startedAt: null, endedAt: null, current: 0, present: ["cv", "md", "pr", "im", "kh"], seenBefore: {} },
    share: { access: "invites", comments: true, showSeen: true, hideAmounts: false, expires: "2026-11-09" },
  };
  return apply(base, {
    seen: {
      cv: ["all", "2026-10-08T13:05:00+02:00"],
      kh: ["all", "2026-10-08T12:20:00+02:00"],
      im: ["all", "2026-10-08T14:02:00+02:00"],
      es: ["all", "2026-10-08T14:40:00+02:00"],
      pr: [["01-cascade", "02-hausse", "03-hausse-mois"], "2026-10-08T15:05:00+02:00"],
      md: [["01-cascade"], "2026-10-08T15:10:00+02:00"],
    },
    notes: {
      "01-cascade": "Deux lignes expliquent tout l'écart : la perte de SN/Legacy et la croissance de Cloud.",
      "02-hausse": "La hausse Cloud tient surtout aux abonnements SaaS ; les coûts d'hébergement suivent.",
      "03-hausse-mois": "Trois quarts de la hausse SaaS arrivent au second semestre : contrats à sécuriser.",
      "04-baisse": "SN/Legacy : la sous-traitance baisse, mais beaucoup moins que les revenus.",
      "05-baisse-mois": "Le contrat de maintenance d'Île-de-France n'est pas reconduit après février.",
      "06-carte": "L'Île-de-France porte le contrat perdu ; les autres régions progressent.",
      "07-tableau-croise": "Premier semestre tendu : la baisse SN/Legacy arrive avant la hausse Cloud.",
    },
    reactions: [
      ["01-cascade", "cv", "utile"], ["01-cascade", "es", "accord"], ["01-cascade", "kh", "accord"],
      ["03-hausse-mois", "cv", "attention"], ["03-hausse-mois", "pr", "clarifier"],
      ["05-baisse-mois", "im", "accord"], ["05-baisse-mois", "cv", "attention"],
      ["07-tableau-croise", "es", "attention"], ["07-tableau-croise", "cv", "utile"],
    ],
    comments: [
      { id: "c-f1", step: "03-hausse-mois", author: "cv", text: "Quels contrats SaaS sont déjà signés pour juillet ? Je veux le niveau de risque en séance.", at: "2026-10-08T13:02:00+02:00", question: true, supports: ["es", "kh"] },
      { id: "c-f1r", step: "03-hausse-mois", author: "pr", parent: "c-f1", text: "Deux contrats signés sur cinq ; les trois autres sont en négociation finale.", at: "2026-10-08T15:04:00+02:00", question: false },
      { id: "c-f2", step: "05-baisse-mois", author: "im", text: "Le non-renouvellement est confirmé par le client ; un appel d'offres est prévu au T2 2027.", at: "2026-10-08T14:00:00+02:00", question: false },
      { id: "c-f3", step: "05-baisse-mois", author: "es", text: "Peut-on redéployer l'équipe maintenance sur Cloud plutôt que réduire la sous-traitance ?", at: "2026-10-08T14:38:00+02:00", question: true, supports: ["cv"] },
      { id: "c-f4", step: "07-tableau-croise", author: "kh", text: "Au T1 2026, la hausse Cloud (+193 k€) ne couvre pas la baisse SN/Legacy (−302 k€) : à surveiller pour la trésorerie.", at: "2026-10-08T12:18:00+02:00", question: true, supports: [] },
    ],
    items: [],
  });
}

export async function demoReviews(): Promise<Review[]> {
  return [await demoPipelineReview(), await demoFinanceReview()];
}

export { initials };

/**
 * Histoire de lecture d'une démo intégrée (`#/lire/demo-dircom…`), recalculée depuis les données de
 * démonstration embarquées : autonome, le lien s'ouvre sur n'importe quel appareil.
 */
export async function demoReadingStory(id: string): Promise<{ title: string; snapshots: Snapshot[] } | null> {
  const d = demoStoryDef(id);
  if (!d) return null;
  const { snaps } = await scenarioSnapshots(d.sampleId, d.scenario, d.generatedAt);
  return { title: d.scenario.storyTitle, snapshots: snaps };
}
