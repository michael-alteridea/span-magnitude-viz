/**
 * Projets (modèle « dataset d'abord », étape 1) : un projet = la source de données courante + l'état du graphique
 * (spec) + la séquence (scènes ordonnées + réglages du film). Enregistré sur l'appareil (IndexedDB, voir repo.ts),
 * exporté / importé en fichier `.datanime` (JSON).
 *
 * Contrat Cadencer inchangé : les scènes sont les snapshots d'origine (mêmes identifiants, même schéma, même spec) ;
 * l'état « modifiée » se calcule en comparant à l'enregistrement, il n'est jamais écrit dans un snapshot ni dans le spec.
 * Module pur (aucun accès DOM ni stockage) : testé par vitest.
 */
import type { ColumnType } from "../data/table";
import type { Provenance } from "../provenance";
import { parseStory, type Snapshot, type StoryState } from "../story/snapshots";
import { parseDatasets, type DatasetRecipe } from "../data/datasets";

export const PROJECT_FILE_KIND = "datanime-project";
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_EXT = ".datanime";
/** Pointeur vers le projet ouvert (petit : reste dans localStorage). */
export const CURRENT_PROJECT_KEY = "datanime:projet-courant:v1";
export const DEFAULT_PROJECT_NAME = "Mon projet";

/** Source du projet : un exemple intégré (référencé), ou des lignes importées (copiées). */
export interface ProjectSource {
  name: string;
  sampleId: string | null;
  /** Lignes brutes sérialisables (null pour un exemple, ou si l'export a été fait sans les données). */
  rows: Record<string, unknown>[] | null;
  typeOverrides: Record<string, ColumnType>;
  provenance: Provenance | null;
  note: string | null;
  rowCount: number;
  colCount: number;
}

export interface Sequence {
  title: string;
  snapshots: Snapshot[];
  sameScale: boolean;
  /** Réglages du film et du PowerPoint. */
  film: { morph: boolean };
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: ProjectSource | null;
  spec: unknown;
  sequence: Sequence;
  /** Datasets dérivés de la source (recettes ; absent dans les projets du déploiement 1 = aucun). */
  datasets?: DatasetRecipe[];
  /** Vignette JPEG (data URL) : 1re scène, sinon le graphique courant. */
  thumb: string | null;
  /** Signature de l'état enregistré (référence de « modifiée » ; recalculée à l'ouverture). */
  sig?: string;
}

/** Résumé pour la liste « Mes projets » (sans les lignes ni les rendus). */
export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  scenes: number;
  sourceName: string;
  rowCount: number;
  thumb: string | null;
  /** Taille approximative de l'enregistrement (caractères JSON). */
  size: number;
}

export function newProjectId(): string {
  return `prj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function projectMeta(p: Project, size = 0): ProjectMeta {
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    scenes: p.sequence.snapshots.length,
    sourceName: p.source?.name ?? "",
    rowCount: p.source?.rowCount ?? 0,
    thumb: p.thumb,
    size,
  };
}

/** Nom libre le plus proche (« Mon projet », « Mon projet 2 »…). */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const b = base.trim() || DEFAULT_PROJECT_NAME;
  if (!set.has(b.toLowerCase())) return b;
  for (let i = 2; i < 1000; i++) if (!set.has(`${b} ${i}`.toLowerCase())) return `${b} ${i}`;
  return `${b} ${Date.now().toString(36)}`;
}

/** Nom d'un nouveau projet : titre de la séquence s'il a été changé, sinon « Mon projet ». */
export function defaultProjectName(seqTitle: string, taken: Iterable<string>): string {
  const t = seqTitle.trim();
  return uniqueName(t && t !== "Notre histoire en données" ? t : DEFAULT_PROJECT_NAME, taken);
}

/* ------------------------------------------------------------------ signatures (état « modifié ») */

/** Ce qui compte pour « la scène a changé » : contenu du graphique et textes (pas les rendus ni les dates). */
export function sceneSig(s: Snapshot): string {
  return JSON.stringify([s.id, s.name, s.role, stripProvenance(s.spec), s.title, s.subtitle, s.comments, s.source, s.path ?? [], s.scenario ?? null, s.step ?? null, s.sampleId, s.dataName]);
}

/**
 * Spec comparé pour « modifiée » : sans la provenance (recalculée) ni les champs ajoutés depuis, à leur valeur par
 * défaut (dataset, forme des points) — un projet enregistré avant leur arrivée ne paraît pas modifié.
 */
function stripProvenance(spec: unknown): unknown {
  if (!spec || typeof spec !== "object") return spec;
  const { provenance: _p, ...rest } = spec as Record<string, unknown>;
  if (rest.dataset == null) delete rest.dataset;
  const st = rest.style as Record<string, unknown> | undefined;
  const emptyRec = (v: unknown) => !!v && typeof v === "object" && !Object.keys(v as object).length;
  if (st && typeof st === "object" && (st.pointShape === "circle" || st.pointIcon === "" || emptyRec(st.pointIcons) || emptyRec(st.overrides))) {
    const style = { ...st };
    if (emptyRec(style.overrides)) delete style.overrides;
    if (style.pointShape === "circle") delete style.pointShape;
    if (style.pointIcon === "") delete style.pointIcon;
    if (style.pointIcons && typeof style.pointIcons === "object" && !Object.keys(style.pointIcons as object).length) delete style.pointIcons;
    rest.style = style;
  }
  return rest;
}

/** Identité de la source (sans relire les lignes) : exemple, ou nom + dimensions + empreinte + types forcés. */
export function sourceKey(src: Pick<ProjectSource, "name" | "sampleId" | "rowCount" | "colCount" | "typeOverrides" | "provenance"> | null): string {
  if (!src) return "∅";
  if (src.sampleId) return `E:${src.sampleId}:${JSON.stringify(src.typeOverrides ?? {})}`;
  return `D:${src.name}:${src.rowCount}x${src.colCount}:${src.provenance?.hash ?? ""}:${JSON.stringify(src.typeOverrides ?? {})}`;
}

export interface WorkingState {
  source: Pick<ProjectSource, "name" | "sampleId" | "rowCount" | "colCount" | "typeOverrides" | "provenance"> | null;
  spec: unknown;
  sequence: Pick<Sequence, "title" | "snapshots" | "sameScale" | "film">;
  datasets?: readonly DatasetRecipe[];
}

/** Signature globale : différente ⇔ modifications non enregistrées. */
export function projectSig(w: WorkingState): string {
  return JSON.stringify([sourceKey(w.source), stripProvenance(w.spec), w.sequence.title, !!w.sequence.sameScale, !!w.sequence.film?.morph, w.sequence.snapshots.map(sceneSig), ...(w.datasets?.length ? [w.datasets.map((d) => [d.id, d.name, d.version, d.filters, d.columns, d.formulas, d.source])] : [])]);
}

export type SceneState = "saved" | "modified" | "new";

/** État de chaque scène par rapport au dernier enregistrement. */
export function sceneStates(current: readonly Snapshot[], saved: readonly Snapshot[] | null): Map<string, SceneState> {
  const ref = new Map((saved ?? []).map((s) => [s.id, sceneSig(s)]));
  const out = new Map<string, SceneState>();
  for (const s of current) {
    const r = ref.get(s.id);
    out.set(s.id, r == null ? "new" : r === sceneSig(s) ? "saved" : "modified");
  }
  return out;
}

/** « Réinitialiser la scène » : la scène reprend son état enregistré, à sa place. */
export function resetScene(current: readonly Snapshot[], saved: readonly Snapshot[], id: string): Snapshot[] {
  const s = saved.find((x) => x.id === id);
  if (!s) return current.slice();
  return current.map((x) => (x.id === id ? structuredClone(s) : x));
}

/** Séquence d'un projet → état d'histoire du Studio. */
export function sequenceToStory(seq: Sequence): StoryState {
  return { title: seq.title, snapshots: seq.snapshots.map((s) => structuredClone(s)), sameScale: !!seq.sameScale };
}

/* ------------------------------------------------------------------ fichier .datanime */

export interface ProjectFile {
  kind: typeof PROJECT_FILE_KIND;
  version: number;
  exportedAt: string;
  /** Les lignes importées sont-elles incluses ? (les exemples intégrés sont toujours référencés) */
  withData: boolean;
  project: Project;
}

export function toProjectFile(p: Project, withData = true, now = new Date()): ProjectFile {
  const project: Project = structuredClone(p);
  if (!withData && project.source && !project.source.sampleId) project.source = { ...project.source, rows: null };
  return { kind: PROJECT_FILE_KIND, version: PROJECT_FILE_VERSION, exportedAt: now.toISOString(), withData: withData || !p.source || !!p.source.sampleId, project };
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

/**
 * Lecture tolérante d'un fichier `.datanime`. Renvoie `{ legacy: true }` pour une ancienne configuration
 * `.r4d.json` (kind « reporting-4d-studio » ou spec nu), traitée par l'import historique.
 */
export function parseProjectFile(input: unknown): { project: Project; withData: boolean } | { legacy: true } {
  if (!input || typeof input !== "object") throw new Error("Fichier illisible");
  const o = input as Record<string, unknown>;
  if (o.kind !== PROJECT_FILE_KIND) return { legacy: true };
  if (typeof o.version === "number" && o.version > PROJECT_FILE_VERSION) throw new Error(`Version ${o.version} non prise en charge (mettez le Studio à jour)`);
  const p = (o.project ?? {}) as Record<string, unknown>;
  const seqIn = (p.sequence ?? {}) as Record<string, unknown>;
  const story = parseStory({ title: seqIn.title, snapshots: seqIn.snapshots, sameScale: seqIn.sameScale });
  const film = (seqIn.film ?? {}) as Record<string, unknown>;
  const srcIn = p.source as Record<string, unknown> | null | undefined;
  let source: ProjectSource | null = null;
  if (srcIn && typeof srcIn === "object") {
    const rows = Array.isArray(srcIn.rows) ? (srcIn.rows.filter((r) => r && typeof r === "object") as Record<string, unknown>[]) : null;
    source = {
      name: str(srcIn.name, "Données"),
      sampleId: typeof srcIn.sampleId === "string" ? srcIn.sampleId : null,
      rows,
      typeOverrides: srcIn.typeOverrides && typeof srcIn.typeOverrides === "object" ? (srcIn.typeOverrides as Record<string, ColumnType>) : {},
      provenance: srcIn.provenance && typeof srcIn.provenance === "object" ? (srcIn.provenance as Provenance) : null,
      note: typeof srcIn.note === "string" ? srcIn.note : null,
      rowCount: typeof srcIn.rowCount === "number" ? srcIn.rowCount : rows?.length ?? 0,
      colCount: typeof srcIn.colCount === "number" ? srcIn.colCount : 0,
    };
  }
  const now = new Date().toISOString();
  const project: Project = {
    id: str(p.id) || newProjectId(),
    name: str(p.name).slice(0, 200) || story.title || DEFAULT_PROJECT_NAME,
    createdAt: str(p.createdAt, now),
    updatedAt: str(p.updatedAt, now),
    source,
    spec: p.spec ?? null,
    sequence: { title: story.title, snapshots: story.snapshots, sameScale: !!story.sameScale, film: { morph: film.morph === true } },
    datasets: parseDatasets(p.datasets),
    thumb: typeof p.thumb === "string" && p.thumb.startsWith("data:image/") ? p.thumb : null,
  };
  return { project, withData: o.withData !== false };
}

/** Nom de fichier d'export (« ventes-export-norvia.datanime »). */
export function projectFileName(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${s || "projet"}${PROJECT_EXT}`;
}

/** Taille lisible (« 2,4 Mo », « 830 Ko »). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 Ko";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}\u00a0Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")}\u00a0Mo`;
}

/** Date courte d'un enregistrement : « aujourd'hui à 23:12 », « hier à 9:05 », « 06/10/2026 à 10:05 ». */
export function savedLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day(d) === day(now)) return `aujourd'hui à ${hm}`;
  if (day(d) === day(y)) return `hier à ${hm}`;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} à ${hm}`;
}

/** Heure seule (« 23:12 ») pour la ligne d'état de la séquence. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
