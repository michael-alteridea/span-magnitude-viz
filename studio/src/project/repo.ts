/**
 * Stockage des projets sur l'appareil : IndexedDB (plusieurs Mo par projet ; localStorage plafonne vers 5 Mo).
 * Deux magasins : « projets » (complet) et « resumes » (liste rapide sans lignes ni rendus).
 * Rien n'est envoyé : tout reste dans le navigateur. `MemoryProjectRepo` sert aux tests et au repli
 * (navigation privée sans IndexedDB).
 */
import { projectMeta, type Project, type ProjectMeta } from "./project";

export interface ProjectRepo {
  readonly persistent: boolean;
  list(): Promise<ProjectMeta[]>;
  get(id: string): Promise<Project | null>;
  put(p: Project): Promise<ProjectMeta>;
  delete(id: string): Promise<void>;
}

const sortMeta = (a: ProjectMeta, b: ProjectMeta) => b.updatedAt.localeCompare(a.updatedAt);

export class MemoryProjectRepo implements ProjectRepo {
  readonly persistent = false;
  private m = new Map<string, Project>();
  async list(): Promise<ProjectMeta[]> {
    return [...this.m.values()].map((p) => projectMeta(p, JSON.stringify(p).length)).sort(sortMeta);
  }
  async get(id: string): Promise<Project | null> {
    const p = this.m.get(id);
    return p ? structuredClone(p) : null;
  }
  async put(p: Project): Promise<ProjectMeta> {
    this.m.set(p.id, structuredClone(p));
    return projectMeta(p, JSON.stringify(p).length);
  }
  async delete(id: string): Promise<void> {
    this.m.delete(id);
  }
}

const DB = "datanime-studio";
const VERSION = 1;
const FULL = "projets";
const META = "resumes";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error("IndexedDB"));
  });
}

export class IdbProjectRepo implements ProjectRepo {
  readonly persistent = true;
  private db: Promise<IDBDatabase>;
  constructor(name = DB) {
    this.db = new Promise((res, rej) => {
      const o = indexedDB.open(name, VERSION);
      o.onupgradeneeded = () => {
        const db = o.result;
        if (!db.objectStoreNames.contains(FULL)) db.createObjectStore(FULL, { keyPath: "id" });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      };
      o.onsuccess = () => res(o.result);
      o.onerror = () => rej(o.error ?? new Error("IndexedDB indisponible"));
      o.onblocked = () => rej(new Error("IndexedDB bloquée"));
    });
  }
  private async tx(stores: string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
    return (await this.db).transaction(stores, mode);
  }
  async list(): Promise<ProjectMeta[]> {
    const t = await this.tx([META], "readonly");
    return ((await req(t.objectStore(META).getAll())) as ProjectMeta[]).sort(sortMeta);
  }
  async get(id: string): Promise<Project | null> {
    const t = await this.tx([FULL], "readonly");
    return ((await req(t.objectStore(FULL).get(id))) as Project | undefined) ?? null;
  }
  async put(p: Project): Promise<ProjectMeta> {
    const meta = projectMeta(p, JSON.stringify(p).length);
    const t = await this.tx([FULL, META], "readwrite");
    t.objectStore(FULL).put(p);
    t.objectStore(META).put(meta);
    await new Promise<void>((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error ?? new Error("Enregistrement impossible"));
      t.onabort = () => rej(t.error ?? new Error("Enregistrement interrompu (stockage plein ?)"));
    });
    return meta;
  }
  async delete(id: string): Promise<void> {
    const t = await this.tx([FULL, META], "readwrite");
    t.objectStore(FULL).delete(id);
    t.objectStore(META).delete(id);
    await new Promise<void>((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error ?? new Error("Suppression impossible"));
    });
  }
}

/** IndexedDB si disponible, sinon mémoire (le projet reste exportable en .datanime). */
export async function openProjectRepo(): Promise<ProjectRepo> {
  if (typeof indexedDB === "undefined") return new MemoryProjectRepo();
  try {
    const r = new IdbProjectRepo();
    await r.list();
    return r;
  } catch {
    return new MemoryProjectRepo();
  }
}

/** Occupation du stockage du navigateur (octets), si l'API est disponible. */
export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && typeof e.usage === "number" ? { usage: e.usage, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
