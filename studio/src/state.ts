/**
 * État de l'application + persistance de la dernière session (localStorage).
 */
import { chartSpecSchema, defaultSpec, parseSpec, type ChartSpec } from "./spec";
import { buildDataset, serializableRaw, type ColumnType, type Dataset } from "./data/table";
import { sampleById } from "./data/samples";

export type ChangeKind = "spec" | "data" | "ui";

export interface UiState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  openSections: Record<string, boolean>;
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
}

const KEY = "reporting-4d-studio:session:v1";
const MAX_DATA_CHARS = 2_500_000;

type Listener = (kinds: Set<ChangeKind>) => void;

export class Store {
  state: AppState;
  private listeners = new Set<Listener>();
  private pending = new Set<ChangeKind>();
  private scheduled = false;
  private saveTimer: number | null = null;
  /** Fichier Excel courant (pour changer de feuille). */
  lastFile: File | null = null;

  constructor() {
    this.state = {
      spec: defaultSpec(),
      ds: null,
      dsVersion: 0,
      sampleId: null,
      importNote: null,
      sheets: null,
      sheet: null,
      ui: { leftCollapsed: false, rightCollapsed: false, openSections: { encodage: true, style: true }, pngScale: 2, includeData: true },
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
      for (const l of this.listeners) l(kinds);
      this.scheduleSave();
    });
  }

  /** Remplace le spec (validé par Zod). Renvoie les erreurs éventuelles. */
  setSpec(next: unknown): string[] {
    const r = parseSpec(next);
    if (!r.ok) return r.issues;
    this.state.spec = r.spec;
    this.emit("spec");
    return [];
  }

  /** Modifie un chemin du spec (ex. "axes.y.min"). */
  set(path: string, value: unknown): string[] {
    const draft = structuredClone(this.state.spec) as Record<string, unknown>;
    const keys = path.split(".");
    let o: Record<string, unknown> = draft;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys[keys.length - 1]!] = value;
    return this.setSpec(draft);
  }

  get(path: string): unknown {
    let o: unknown = this.state.spec;
    for (const k of path.split(".")) o = (o as Record<string, unknown>)?.[k];
    return o;
  }

  setDataset(ds: Dataset | null, meta: { sampleId?: string | null; note?: string | null; sheets?: string[] | null; sheet?: string | null } = {}) {
    this.state.ds = ds;
    this.state.dsVersion++;
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
      localStorage.setItem(KEY, JSON.stringify({ v: 1, spec, sampleId, data, typeOverrides, ui, importNote, savedAt: new Date().toISOString() }));
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
        spec?: unknown;
        sampleId?: string | null;
        data?: { name: string; raw: Record<string, unknown>[]; typeOverrides?: Record<string, ColumnType> } | null;
        typeOverrides?: Record<string, ColumnType>;
        ui?: Partial<UiState>;
        importNote?: string | null;
      };
      const spec = chartSpecSchema.safeParse(s.spec ?? {});
      if (!spec.success) return false;
      this.state.spec = spec.data;
      if (s.ui) this.state.ui = { ...this.state.ui, ...s.ui };
      const sample = sampleById(s.sampleId);
      if (sample) {
        this.setDataset(buildDataset(sample.name, sample.rows(), s.typeOverrides ?? {}), { sampleId: sample.id });
      } else if (s.data?.raw?.length) {
        this.setDataset(buildDataset(s.data.name, s.data.raw, s.data.typeOverrides ?? {}), { note: s.importNote ?? "Session restaurée" });
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
