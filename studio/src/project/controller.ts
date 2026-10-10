/**
 * Projet ouvert : enregistrement sur l'appareil, état « modifié », ouverture, réinitialisations.
 * La copie de travail reste la session du Studio (localStorage, rechargée au démarrage) ;
 * le projet enregistré (IndexedDB) sert de référence pour « modifiée » et « Réinitialiser ».
 */
import type { Store } from "../state";
import type { Snapshot } from "../story/snapshots";
import { serializableRaw } from "../data/table";
import {
  CURRENT_PROJECT_KEY,
  defaultProjectName,
  hhmm,
  newProjectId,
  projectSig,
  resetScene,
  sceneStates,
  sequenceToStory,
  uniqueName,
  type Project,
  type ProjectSource,
  type SceneState,
  type WorkingState,
} from "./project";
import type { ProjectRepo } from "./repo";

export interface ControllerDeps {
  store: Store;
  repo: ProjectRepo;
  morph(): boolean;
  setMorph(on: boolean): void;
  /** Vignette JPEG du graphique courant (si aucune scène). */
  chartThumb(): Promise<string | null>;
  /** Charge la source d'un projet dans le Studio (exemple ou lignes), puis le spec. */
  applySource(src: ProjectSource | null, spec: unknown): Promise<void>;
  /** Projet vide : exemple par défaut. */
  loadDefault(): void;
  /** Attend la fin des rendus en cours. */
  settle(): Promise<void>;
  onChange(): void;
}

function readPointer(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  } catch {
    return null;
  }
}

function writePointer(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_PROJECT_KEY, id);
    else localStorage.removeItem(CURRENT_PROJECT_KEY);
  } catch {
    /* stockage indisponible */
  }
}

export class ProjectController {
  /** Projet enregistré correspondant à la copie de travail (null : jamais enregistré). */
  saved: Project | null = null;
  /** Signature de la copie de travail au dernier enregistrement / ouverture. */
  private baseline: string | null = null;
  private sigCache: { key: unknown[]; sig: string } | null = null;
  ready = false;

  constructor(private d: ControllerDeps) {}

  /** Source de la copie de travail (sans les lignes : identité seulement). */
  private workingSource(): WorkingState["source"] {
    const { ds, sampleId, provenance } = this.d.store.state;
    if (!ds) return null;
    return { name: ds.name, sampleId, rowCount: ds.rows.length, colCount: ds.columns.length, typeOverrides: ds.typeOverrides ?? {}, provenance };
  }

  working(): WorkingState {
    const st = this.d.store.state;
    return { source: this.workingSource(), spec: st.spec, sequence: { title: st.story.title, snapshots: st.story.snapshots, sameScale: !!st.story.sameScale, film: { morph: this.d.morph(), access: st.story.access ?? "mail" } }, datasets: st.datasets };
  }

  /** Signature courante (mémorisée tant que spec / données / séquence n'ont pas changé d'objet). */
  sig(): string {
    const st = this.d.store.state;
    const key = [st.spec, st.dsVersion, st.ds, st.provenance, st.story, this.d.morph(), st.datasets];
    if (this.sigCache && this.sigCache.key.every((k, i) => k === key[i])) return this.sigCache.sig;
    const sig = projectSig(this.working());
    this.sigCache = { key, sig };
    return sig;
  }

  get dirty(): boolean {
    if (!this.ready) return false;
    if (!this.saved) return this.d.store.state.story.snapshots.length > 0;
    return this.sig() !== this.baseline;
  }

  get savedAt(): string | null {
    return this.saved ? hhmm(this.saved.updatedAt) : null;
  }

  sceneStates(): Map<string, SceneState> {
    return sceneStates(this.d.store.state.story.snapshots, this.saved ? this.saved.sequence.snapshots : null);
  }

  /** Démarrage : rouvre le pointeur ; migration de l'histoire existante en « Mon projet ». */
  async init(): Promise<void> {
    try {
      const id = readPointer();
      const p = id ? await this.d.repo.get(id) : null;
      if (p) {
        this.saved = p;
        // signature recalculée depuis l'enregistrement (règles de comparaison à jour, champs récents par défaut ignorés)
        this.baseline = projectSig({ source: p.source, spec: p.spec, sequence: p.sequence, datasets: p.datasets ?? [] });
      } else {
        writePointer(null);
        const story = this.d.store.state.story;
        if (story.snapshots.length && !(await this.d.repo.list()).length) {
          this.ready = true;
          await this.save({ name: defaultProjectName(story.title, []), quiet: true });
        }
      }
    } catch {
      /* stockage indisponible : le Studio reste utilisable, sans projets */
    }
    this.ready = true;
    this.d.onChange();
  }

  /** Construit l'enregistrement complet de la copie de travail. */
  async snapshotProject(base: Partial<Project> = {}): Promise<Project> {
    const st = this.d.store.state;
    const now = new Date().toISOString();
    const ds = st.ds;
    const source: ProjectSource | null = ds
      ? {
          name: ds.name,
          sampleId: st.sampleId,
          rows: st.sampleId ? null : serializableRaw(ds.raw),
          typeOverrides: { ...(ds.typeOverrides ?? {}) },
          provenance: st.provenance,
          note: st.importNote,
          rowCount: ds.rows.length,
          colCount: ds.columns.length,
        }
      : null;
    const snaps = structuredClone(st.story.snapshots) as Snapshot[];
    const thumb = snaps.find((s) => s.thumb)?.thumb ?? (await this.d.chartThumb().catch(() => null));
    return {
      id: base.id ?? newProjectId(),
      name: base.name ?? DEFAULT_NAME,
      createdAt: base.createdAt ?? now,
      updatedAt: now,
      source,
      spec: structuredClone(st.spec),
      sequence: { title: st.story.title, snapshots: snaps, sameScale: !!st.story.sameScale, film: { morph: this.d.morph(), access: st.story.access ?? "mail" } },
      datasets: structuredClone(st.datasets),
      thumb,
      sig: this.sig(),
    };
  }

  /** « Enregistrer » : met à jour le projet ouvert, ou en crée un. */
  async save(o: { name?: string; asNew?: boolean; quiet?: boolean } = {}): Promise<Project> {
    await this.d.settle();
    const cur = o.asNew ? null : this.saved;
    const taken = cur ? [] : (await this.d.repo.list()).map((m) => m.name);
    const name = o.name ?? cur?.name ?? defaultProjectName(this.d.store.state.story.title, taken);
    const p = await this.snapshotProject({ id: cur?.id, createdAt: cur?.createdAt, name });
    await this.d.repo.put(p);
    this.saved = p;
    this.baseline = p.sig ?? null;
    writePointer(p.id);
    this.d.onChange();
    return p;
  }

  /** Ouvre un projet enregistré (ou importé) dans le Studio. */
  async open(p: Project): Promise<void> {
    await this.load(p);
    this.saved = p;
    writePointer(p.id);
    await this.d.settle();
    // référence = l'état réellement chargé (spec normalisé, provenance recalculée)
    this.sigCache = null;
    this.baseline = this.sig();
    if (p.sig !== this.baseline) {
      p.sig = this.baseline;
      await this.d.repo.put(p).catch(() => undefined);
    }
    this.d.onChange();
  }

  private async load(p: Project): Promise<void> {
    // Projets du déploiement 1 : pas de datasets (la source entière sert de dataset par défaut)
    this.d.store.setDatasets(structuredClone(p.datasets ?? []));
    await this.d.applySource(p.source, p.spec);
    this.d.setMorph(!!p.sequence.film?.morph);
    this.d.store.setStory(sequenceToStory(p.sequence));
  }

  /** « Revenir au dernier enregistrement ». */
  async revert(): Promise<boolean> {
    if (!this.saved) return false;
    const p = (await this.d.repo.get(this.saved.id)) ?? this.saved;
    await this.open(p);
    return true;
  }

  /** « Vider la séquence » : garde la source et le graphique. */
  clearSequence(): void {
    const st = this.d.store.state.story;
    this.d.store.setStory({ ...st, snapshots: [] });
  }

  /** « Tout réinitialiser » : projet vide (exemple par défaut, séquence vide), détaché du projet enregistré. */
  resetAll(): void {
    this.detach();
    this.d.store.clearSession();
    this.d.store.setDatasets([]);
    this.d.store.setStory({ title: "Notre histoire en données", snapshots: [], sameScale: false });
    this.d.loadDefault();
    this.d.onChange();
  }

  /** La copie de travail n'est plus liée à un projet enregistré (les projets restent dans « Mes projets »). */
  detach(): void {
    this.saved = null;
    this.baseline = null;
    writePointer(null);
  }

  /** « ↺ Réinitialiser la scène ». */
  resetScene(id: string): boolean {
    if (!this.saved) return false;
    const st = this.d.store.state.story;
    if (!this.saved.sequence.snapshots.some((s) => s.id === id)) return false;
    this.d.store.setStory({ ...st, snapshots: resetScene(st.snapshots, this.saved.sequence.snapshots, id) });
    return true;
  }

  async duplicate(id: string): Promise<Project | null> {
    const p = await this.d.repo.get(id);
    if (!p) return null;
    const taken = (await this.d.repo.list()).map((m) => m.name);
    const now = new Date().toISOString();
    const copy: Project = { ...structuredClone(p), id: newProjectId(), name: uniqueName(`${p.name} (copie)`, taken), createdAt: now, updatedAt: now };
    await this.d.repo.put(copy);
    return copy;
  }

  async rename(id: string, name: string): Promise<void> {
    const p = await this.d.repo.get(id);
    if (!p) return;
    p.name = name;
    await this.d.repo.put(p);
    if (this.saved?.id === id) this.saved = { ...this.saved, name };
    this.d.onChange();
  }

  async remove(id: string): Promise<void> {
    await this.d.repo.delete(id);
    if (this.saved?.id === id) this.detach();
    this.d.onChange();
  }

  /**
   * Ouvre un projet d'exemple intégré : rouvre la copie déjà enregistrée si elle est restée identique à l'exemple
   * (pas de doublon à chaque visite du lien), sinon l'importe comme un fichier `.datanime` (les modifications
   * enregistrées d'une copie précédente sont gardées, sous leur propre nom).
   */
  async openExample(p: Project): Promise<Project> {
    const ref = (x: Project) => projectSig({ source: x.source, spec: x.spec, sequence: x.sequence, datasets: x.datasets ?? [] });
    const existing = await this.d.repo.get(p.id).catch(() => null);
    const q = existing && ref(existing) === ref(p) ? existing : await this.importProject(p);
    await this.open(q);
    return q;
  }

  /** Importe un projet (.datanime) : nouvel identifiant si déjà présent, nom unique. */
  async importProject(p: Project): Promise<Project> {
    const list = await this.d.repo.list();
    const clash = list.some((m) => m.id === p.id);
    const q: Project = { ...p, id: clash ? newProjectId() : p.id, name: uniqueName(p.name, list.map((m) => m.name)), updatedAt: new Date().toISOString() };
    delete q.sig;
    await this.d.repo.put(q);
    return q;
  }
}

const DEFAULT_NAME = "Mon projet";
