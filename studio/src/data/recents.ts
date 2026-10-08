/**
 * Données récentes (fenêtre « Données › Récents ») : les ~10 derniers jeux ouverts ou importés, gardés dans ce
 * navigateur uniquement (localStorage) — rien n'est jamais envoyé. Les lignes brutes ne sont gardées que si leur
 * taille reste raisonnable ; sinon l'entrée invite à réimporter le fichier.
 */
export type RecentKind = "file" | "paste" | "sample" | "public";

export interface RecentEntry {
  /** Clé stable : type + nom (+ fichier) — un même jeu rouvert remonte en tête au lieu d'être dupliqué. */
  id: string;
  kind: RecentKind;
  name: string;
  fileName?: string;
  /** Exemple ou donnée publique : identifiant de l'exemple (rechargé tel quel). */
  sampleId?: string;
  /** ISO 8601. */
  at: string;
  rows: number;
  cols: number;
  /** Tableau brut en TSV (en-tête + lignes) si assez petit ; absent → « réimportez le fichier ». */
  tsv?: string;
  /** Empreinte de la source (vérification), reprise à la réouverture. */
  hash?: string | null;
}

export const RECENTS_KEY = "reporting-4d-studio:recents:v1";
export const RECENTS_MAX = 10;
/** Taille maximale du tableau gardé par entrée (caractères TSV ≈ octets). */
export const RECENT_MAX_CHARS = 300_000;

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const cell = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v).replace(/[\t\r\n]+/g, " ");
};

/** Lignes brutes → TSV (null si trop volumineux). */
export function rowsToTsv(columns: string[], raw: Record<string, unknown>[], max = RECENT_MAX_CHARS): string | null {
  let out = columns.map(cell).join("\t");
  for (const r of raw) {
    out += "\n" + columns.map((c) => cell(r[c])).join("\t");
    if (out.length > max) return null;
  }
  return out;
}

export function recentId(kind: RecentKind, name: string, extra = ""): string {
  return `${kind}:${name}${extra ? ":" + extra : ""}`;
}

export function loadRecents(kv: KV | null): RecentEntry[] {
  if (!kv) return [];
  try {
    const v = JSON.parse(kv.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((e) => e && typeof e.id === "string" && typeof e.name === "string").slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

/** Enregistre (quota dépassé → on retire d'abord les tableaux des entrées les plus anciennes). */
export function saveRecents(kv: KV | null, list: RecentEntry[]): RecentEntry[] {
  if (!kv) return list;
  const cur = list.slice(0, RECENTS_MAX).map((e) => ({ ...e }));
  for (let drop = cur.length; drop >= 0; drop--) {
    try {
      kv.setItem(RECENTS_KEY, JSON.stringify(cur));
      return cur;
    } catch {
      // quota : retirer le tableau de l'entrée la plus ancienne qui en a un
      const i = [...cur].reverse().findIndex((e) => e.tsv);
      if (i < 0) break;
      delete cur[cur.length - 1 - i]!.tsv;
    }
  }
  return cur;
}

/** Ajoute ou remonte une entrée en tête (même id = même jeu). */
export function pushRecent(list: RecentEntry[], e: RecentEntry): RecentEntry[] {
  return [e, ...list.filter((x) => x.id !== e.id)].slice(0, RECENTS_MAX);
}

export function removeRecent(list: RecentEntry[], id: string): RecentEntry[] {
  return list.filter((x) => x.id !== id);
}

/** L'entrée peut-elle être rouverte d'un geste ? */
export const canReopen = (e: RecentEntry): boolean => !!(e.sampleId || e.tsv);

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
/** « 8 oct. 2026, 23:30 » (heure locale). */
export function recentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const RECENT_KIND_LABEL: Record<RecentKind, string> = { file: "Fichier", paste: "Tableau collé", sample: "Exemple", public: "Données publiques" };
