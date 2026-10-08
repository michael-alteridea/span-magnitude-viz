/**
 * Stockage des revues derrière une petite interface : localStorage aujourd'hui (partage local, même appareil),
 * Firestore demain (même interface : liste, lecture, écriture, suppression, abonnement aux changements).
 */
import type { Review } from "./model";

export interface ReviewStorage {
  list(): Review[];
  get(id: string): Review | null;
  save(r: Review): void;
  remove(id: string): void;
  /** Remplace tout le contenu (réinitialisation de la démo). */
  replaceAll(reviews: Review[]): void;
  /** Changements (y compris depuis un autre onglet) ; renvoie la fonction de désabonnement. */
  subscribe(fn: () => void): () => void;
  /** Identité locale du participant (« Vous êtes … ») pour une revue. */
  me(reviewId: string): string | null;
  setMe(reviewId: string, personId: string): void;
  /** La démo a-t-elle déjà été installée sur cet appareil ? */
  seeded(): boolean;
}

export const REVIEWS_KEY = "datanime:revues:v1";
const ME_KEY = "datanime:revues:moi:v1";

interface Kv {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Mémoire seule (tests, navigation privée sans stockage). */
export function memoryKv(): Kv {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

export class LocalReviewStorage implements ReviewStorage {
  private cache: Review[] | null = null;
  private listeners = new Set<() => void>();

  constructor(private kv: Kv = window.localStorage, events = typeof window !== "undefined") {
    if (events)
      window.addEventListener("storage", (e) => {
        if (e.key === REVIEWS_KEY || e.key === null) {
          this.cache = null;
          this.emit();
        }
      });
  }

  private read(): Review[] {
    if (this.cache) return this.cache;
    try {
      const raw = this.kv.getItem(REVIEWS_KEY);
      const o = raw ? (JSON.parse(raw) as { reviews?: unknown }) : null;
      this.cache = Array.isArray(o?.reviews) ? (o!.reviews as Review[]).filter((r) => r && r.v === 1 && typeof r.id === "string") : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  private write(list: Review[]): void {
    this.cache = list;
    const payload = JSON.stringify({ v: 1, reviews: list });
    try {
      this.kv.setItem(REVIEWS_KEY, payload);
    } catch {
      // stockage saturé : on retire les rendus conservés (le graphique est recalculé depuis les données)
      const light = list.map((r) => ({ ...r, snapshots: r.snapshots.map((s) => ({ ...s, svg: null, thumb: r.demo ? null : s.thumb })) }));
      try {
        this.kv.setItem(REVIEWS_KEY, JSON.stringify({ v: 1, reviews: light }));
        this.cache = light;
      } catch {
        /* mémoire seule pour cette session */
      }
    }
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  list(): Review[] {
    return [...this.read()].sort((a, b) => b.meetingAt.localeCompare(a.meetingAt));
  }

  get(id: string): Review | null {
    return this.read().find((r) => r.id === id) ?? null;
  }

  save(r: Review): void {
    const list = this.read();
    const i = list.findIndex((x) => x.id === r.id);
    this.write(i >= 0 ? list.map((x, k) => (k === i ? r : x)) : [...list, r]);
  }

  remove(id: string): void {
    this.write(this.read().filter((r) => r.id !== id));
  }

  replaceAll(reviews: Review[]): void {
    try {
      this.kv.removeItem(ME_KEY);
    } catch {
      /* rien */
    }
    this.write(reviews);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private meMap(): Record<string, string> {
    try {
      return JSON.parse(this.kv.getItem(ME_KEY) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  }

  me(reviewId: string): string | null {
    return this.meMap()[reviewId] ?? null;
  }

  setMe(reviewId: string, personId: string): void {
    try {
      this.kv.setItem(ME_KEY, JSON.stringify({ ...this.meMap(), [reviewId]: personId }));
    } catch {
      /* rien */
    }
  }

  seeded(): boolean {
    return this.kv.getItem(REVIEWS_KEY) != null;
  }
}
