/**
 * État de l'application + persistance de la dernière session (localStorage).
 */
import { chartSpecSchema, defaultSpec, parseSpec, type ChartSpec } from "./spec";
import { buildDataset, serializableRaw, type ColumnType, type Dataset } from "./data/table";
import { sampleById } from "./data/samples";
import { emptyStory, loadStory, saveStory, type StoryState } from "./story/snapshots";
import type { Provenance } from "./provenance";

export type ChangeKind = "spec" | "data" | "ui" | "story";

/** Chemins de texte protégés par les drapeaux `story.edited` (saisie utilisateur). */
const EDIT_FLAGS: Record<string, "title" | "subtitle" | "comments"> = {
  "style.title": "title",
  "style.subtitle": "subtitle",
  "story.comments": "comments",
};

export interface UiState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  openSections: Record<string, boolean>;
  /** Panneau de réglages en accordéon : section ouverte (« » = toutes repliées). */
  panelSection?: string;
  pngScale: 1 | 2 | 3;
  includeData: boolean;
}

export interface AppState {
  spec: ChartSpec;
  ds: Dataset | null;
  dsVersion: number;
  sampleId: string | null;
  importNote: string | null;
  sheets: string[] | null;
  sheet: string | null;
  ui: UiState;
  /** Histoire : snapshots ordonnés (persistés à part). */
  story: StoryState;
  /** Provenance des données courantes (empreinte, import) ; recopiée dans `spec.provenance`. */
  provenance: Provenance | null;
  /** Compteur de chargements de données (une empreinte calculée en différé ne s'applique qu'à son jeu). */
  dataSeq: number;
}

const KEY = "reporting-4d-studio:session:v1";
const MAX_DATA_CHARS = 2_500_000;
/** v2 : identité bleu pétrole (palette par défaut « petrole »). */
const SESSION_VERSION = 2;

/**
 * Sessions v1 : « alteridea » y était la palette par défaut (enregistrée explicitement).
 * On bascule ces sessions sur la nouvelle palette par défaut bleu pétrole ; le préréglage
 * « Alteridea (rouge) » reste sélectionnable, et les configurations JSON ouvertes à la main ne sont pas touchées.
 */
export function migrateSessionSpec(spec: unknown, version: number): unknown {
  if (version >= 2 || !spec || typeof spec !== "object") return spec;
  const s = spec as { style?: { palette?: unknown } };
  if (s.style?.palette !== "alteridea") return spec;
  return { ...s, style: { ...s.style, palette: "petrole" } };
}

type Listener = (kinds: Set<ChangeKind>) => void;

export class Store {
  state: AppState;
  private listeners = new Set<Listener>();
  private pending = new Set<ChangeKind>();
  private scheduled = false;
  private saveTimer: number | null = null;
  /** Fichier Excel courant (pour changer de feuille). */
  lastFile: File | null = null;
  /**
   * Crochet appelé juste avant la notification (récit calculé) : peut renvoyer un spec complété
   * (titre, sous-titre, commentaires) qui remplace l'état sans marquer de saisie utilisateur.
   */
  beforeNotify: ((state: AppState, kinds: Set<ChangeKind>) => ChartSpec | null) | null = null;

  constructor() {
    this.state = {
      spec: defaultSpec(),
      ds: null,
      dsVersion: 0,
      sampleId: null,
      importNote: null,
      sheets: null,
      sheet: null,
      ui: { leftCollapsed: false, rightCollapsed: false, openSections: { encodage: true, style: true, recit: true }, pngScale: 2, includeData: true },
      story: emptyStory(),
      provenance: null,
      dataSeq: 0,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: ChangeKind) {
    this.pending.add(kind);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const kinds = new Set(this.pending);
      this.pending.clear();
      if (this.beforeNotify && (kinds.has("spec") || kinds.has("data"))) {
        try {
          const next = this.beforeNotify(this.state, kinds);
          if (next) {
            this.state.spec = next;
            kinds.add("spec");
          }
        } catch (e) {
          console.warn("Récit : génération impossible", e);
        }
      }
      for (const l of this.listeners) l(kinds);
      if (kinds.has("story")) this.saveStoryNow();
      if (kinds.has("spec") || kinds.has("data") || kinds.has("ui")) this.scheduleSave();
    });
  }

  /** Remplace le spec (validé par Zod). Renvoie les erreurs éventuelles. */
  setSpec(next: unknown): string[] {
    const r = parseSpec(next);
    if (!r.ok) return r.issues;
    // La provenance suit les données réellement chargées (jamais celle d'un spec ouvert ou d'un snapshot)
    r.spec.provenance = this.state.provenance;
    this.state.spec = r.spec;
    this.emit("spec");
    return [];
  }

  /** Provenance des données courantes ; `seq` : ignorée si d'autres données ont été chargées entre-temps. */
  setProvenance(p: Provenance | null, seq?: number): void {
    if (seq !== undefined && seq !== this.state.dataSeq) return;
    this.state.provenance = p;
    if (this.state.spec.provenance !== p) {
      this.state.spec = { ...this.state.spec, provenance: p };
      this.emit("spec");
    }
  }

  /**
   * Modifie un chemin du spec (ex. "axes.y.min"). Les textes du récit (titre, sous-titre,
   * commentaires) modifiés ainsi sont marqués comme saisis par l'utilisateur.
   */
  set(path: string, value: unknown): string[] {
    const draft = structuredClone(this.state.spec) as Record<string, unknown>;
    const keys = path.split(".");
    let o: Record<string, unknown> = draft;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys[keys.length - 1]!] = value;
    const flag = EDIT_FLAGS[path] ?? (path.startsWith("story.comments.") ? "comments" : null);
    if (flag) {
      const story = draft.story as { edited: Record<string, boolean> };
      story.edited = { ...story.edited, [flag]: true };
    }
    return this.setSpec(draft);
  }

  /** « Régénérer » : rend la main au calcul pour les textes (tous, ou un seul). */
  regenerate(which?: "title" | "subtitle" | "comments"): void {
    const spec = structuredClone(this.state.spec);
    if (which) spec.story.edited[which] = false;
    else spec.story.edited = { title: false, subtitle: false, comments: false };
    spec.story.auto = true;
    this.state.spec = spec;
    this.emit("spec");
  }

  /* ---------------------------------------------------------------- histoire */

  setStory(next: StoryState): void {
    this.state.story = next;
    this.emit("story");
  }

  private saveStoryNow(): void {
    try {
      const r = saveStory(this.state.story);
      if (r.trimmed) console.info(`Histoire : ${r.trimmed} rendu(s) allégé(s) pour tenir dans le stockage local.`);
    } catch {
      /* stockage indisponible */
    }
  }

  restoreStory(): void {
    this.state.story = loadStory();
  }

  get(path: string): unknown {
    let o: unknown = this.state.spec;
    for (const k of path.split(".")) o = (o as Record<string, unknown>)?.[k];
    return o;
  }

  setDataset(ds: Dataset | null, meta: { sampleId?: string | null; note?: string | null; sheets?: string[] | null; sheet?: string | null; provenance?: Provenance | null } = {}) {
    this.state.ds = ds;
    this.state.dsVersion++;
    this.state.dataSeq++;
    this.setProvenance(meta.provenance ?? null);
    this.state.sampleId = meta.sampleId ?? null;
    this.state.importNote = meta.note ?? null;
    this.state.sheets = meta.sheets ?? null;
    this.state.sheet = meta.sheet ?? null;
    this.emit("data");
  }

  retype(column: string, type: ColumnType) {
    const ds = this.state.ds;
    if (!ds) return;
    const overrides = { ...ds.typeOverrides, [column]: type };
    const col = ds.columns.find((c) => c.name === column);
    if (col?.detected === type) delete overrides[column];
    this.state.ds = buildDataset(ds.name, ds.raw, overrides);
    this.state.dsVersion++;
    this.emit("data");
  }

  setUi(patch: Partial<UiState>) {
    this.state.ui = { ...this.state.ui, ...patch };
    this.emit("ui");
  }

  /* ---------------------------------------------------------------- session */

  private scheduleSave() {
    if (this.saveTimer != null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 400);
  }

  save() {
    try {
      const { spec, ds, sampleId, ui, importNote } = this.state;
      let data: unknown = null;
      if (ds && !sampleId) {
        const raw = JSON.stringify(serializableRaw(ds.raw));
        if (raw.length <= MAX_DATA_CHARS) data = { name: ds.name, raw: JSON.parse(raw), typeOverrides: ds.typeOverrides };
      }
      const typeOverrides = ds && sampleId ? ds.typeOverrides : undefined;
      localStorage.setItem(KEY, JSON.stringify({ v: SESSION_VERSION, spec, sampleId, data, typeOverrides, ui, importNote, savedAt: new Date().toISOString() }));
    } catch {
      /* quota dépassé / navigation privée : on ignore */
    }
  }

  /** Restaure la dernière session ; renvoie false si aucune session valide. */
  restore(): boolean {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const s = JSON.parse(raw) as {
        v?: number;
        spec?: unknown;
        sampleId?: string | null;
        data?: { name: string; raw: Record<string, unknown>[]; typeOverrides?: Record<string, ColumnType> } | null;
        typeOverrides?: Record<string, ColumnType>;
        ui?: Partial<UiState>;
        importNote?: string | null;
      };
      const spec = chartSpecSchema.safeParse(migrateSessionSpec(s.spec ?? {}, s.v ?? 1));
      if (!spec.success) return false;
      this.state.spec = spec.data;
      if (s.ui) this.state.ui = { ...this.state.ui, ...s.ui };
      const sample = sampleById(s.sampleId);
      if (sample) {
        this.setDataset(buildDataset(sample.name, sample.rows(), s.typeOverrides ?? {}), { sampleId: sample.id });
      } else if (s.data?.raw?.length) {
        this.setDataset(buildDataset(s.data.name, s.data.raw, s.data.typeOverrides ?? {}), { note: s.importNote ?? "Session restaurée", provenance: spec.data.provenance ?? null });
      } else return false;
      return true;
    } catch {
      return false;
    }
  }

  clearSession() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
