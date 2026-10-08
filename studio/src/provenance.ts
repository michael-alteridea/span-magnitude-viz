/**
 * Empreinte des données et lien de vérification (QR d'empreinte des données), 100 % côté navigateur.
 *
 * Règles d'empreinte (SHA-256, WebCrypto) — identiques dans le Studio et dans `verifier.html` :
 *  - fichier déposé / choisi : octets bruts du fichier ;
 *  - texte collé : texte UTF-8 normalisé (BOM retiré, fins de ligne LF, espaces de fin de ligne
 *    et blancs de fin de texte retirés — les tabulations de fin de ligne, qui sont des cellules, restent) ;
 *  - exemples intégrés et configurations sans fichier d'origine : JSON canonique des lignes (clés triées).
 *
 * Le QR encode une URL courte vers la page de vérification ; les informations sont dans le fragment (#…),
 * qui n'est jamais envoyé au serveur. Forme compacte (mode alphanumérique du QR, version 6-M) :
 *   <VERIFY_URL>#1.<type>.<32 hex de l'empreinte>.<import AAAAMMJJ>.<génération AAAAMMJJ>.<lignes>.<colonnes>
 * Forme longue acceptée aussi : #h=<32 hex>&i=AAAAMMJJ&g=AAAAMMJJ&n=<lignes>&c=<colonnes>[&k=F|P|E|C]
 */
/** Domaine de la plateforme (domaine personnalisé reporting.alteridea.com en attente : changer cette ligne). */
export const VERIFY_BASE = "https://alteridea-dashboard.web.app";
/** Page de vérification (publiée avec le Studio, dans le même dossier). */
export const VERIFY_URL = `${VERIFY_BASE}/reporting/verifier.html`;

export type ProvenanceKind = "file" | "paste" | "sample" | "config";

/** Provenance du jeu de données (enregistrée dans le spec : `spec.provenance`). */
export interface Provenance {
  /** SHA-256 complet (64 hex minuscules). */
  hash: string;
  kind: ProvenanceKind;
  /** Horodatage ISO de l'import (ou du chargement de l'exemple). */
  importedAt: string;
  fileName: string;
  rows: number;
  cols: number;
  /** Exemples : date des données (AAAA-MM-JJ). */
  asOf: string | null;
  /** Classeurs : feuille importée. */
  sheet: string | null;
}

const KIND_CODE: Record<ProvenanceKind, string> = { file: "F", paste: "P", sample: "E", config: "C" };
const CODE_KIND: Record<string, ProvenanceKind> = { F: "file", P: "paste", E: "sample", C: "config" };

/* ------------------------------------------------------------------ empreintes */

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** WebCrypto disponible (contexte sécurisé : https, localhost, file://). */
export function cryptoAvailable(): boolean {
  return typeof globalThis.crypto !== "undefined" && !!globalThis.crypto.subtle;
}

/** SHA-256 hexadécimal d'octets ou d'un texte (encodé en UTF-8). */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  return toHex(await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
}

/** Normalisation du texte collé avant empreinte (voir l'en-tête). */
export function normalizePastedText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \u00a0]+$/gm, "")
    .replace(/\s+$/, "");
}

/** JSON canonique : clés triées à tous les niveaux, dates en ISO, nombres non finis → null. */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return JSON.stringify(Number.isFinite(v.getTime()) ? v.toISOString() : null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "number") return Number.isFinite(v) ? JSON.stringify(v) : "null";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export const hashFileBytes = (buf: ArrayBuffer | Uint8Array): Promise<string> => sha256Hex(buf);
export const hashPastedText = (text: string): Promise<string> => sha256Hex(normalizePastedText(text));
export const hashRows = (rows: unknown): Promise<string> => sha256Hex(canonicalJson(rows));

export function makeProvenance(p: { hash: string; kind: ProvenanceKind; fileName?: string; rows: number; cols: number; asOf?: string | null; sheet?: string | null; now?: Date }): Provenance {
  return {
    hash: p.hash,
    kind: p.kind,
    importedAt: (p.now ?? new Date()).toISOString(),
    fileName: p.fileName ?? "",
    rows: p.rows,
    cols: p.cols,
    asOf: p.asOf ?? null,
    sheet: p.sheet ?? null,
  };
}

/* ------------------------------------------------------------------ dates */

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const NBSP = "\u00a0";

/** AAAAMMJJ (date locale). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function validYmd(s: string): boolean {
  if (!/^\d{8}$/.test(s)) return false;
  const y = +s.slice(0, 4);
  const m = +s.slice(4, 6);
  const d = +s.slice(6, 8);
  if (y < 2000 || y > 2199 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** « 8 oct. 2026 » depuis AAAAMMJJ. */
export function frDateYmd(s: string): string {
  const day = +s.slice(6, 8);
  return `${day === 1 ? "1er" : day}${NBSP}${MONTHS_SHORT[+s.slice(4, 6) - 1]} ${s.slice(0, 4)}`;
}

/** Date d'import affichée (AAAAMMJJ) : date des données pour les exemples, sinon date locale de l'import. */
export function importYmd(p: Provenance): string {
  if (p.kind === "sample" && p.asOf && /^\d{4}-\d{2}-\d{2}$/.test(p.asOf)) return p.asOf.replace(/-/g, "");
  const t = new Date(p.importedAt);
  return ymd(Number.isFinite(t.getTime()) ? t : new Date());
}

/** Lignes du cartouche décrivant les données (2 lignes courtes). */
export function provenanceLines(p: Provenance): [string, string] {
  const d = frDateYmd(importYmd(p));
  if (p.kind === "sample") return ["Données d'exemple", `au ${d}`];
  if (p.kind === "paste") return ["Données collées le", d];
  return ["Données importées le", d];
}

/** Empreinte courte affichée : « 3f9a·c21e ». */
export function shortFingerprint(hash: string): string {
  return `${hash.slice(0, 4)}·${hash.slice(4, 8)}`;
}

/* ------------------------------------------------------------------ lien de vérification */

export interface VerifyInfo {
  /** 32 premiers caractères hexadécimaux (minuscules) de l'empreinte. */
  h: string;
  /** Date d'import AAAAMMJJ. */
  i: string;
  /** Date de génération AAAAMMJJ. */
  g: string;
  n: number;
  c: number;
  kind: ProvenanceKind | null;
}

export function verifyInfoFor(p: Provenance, generated: Date): VerifyInfo {
  return { h: p.hash.slice(0, 32).toLowerCase(), i: importYmd(p), g: ymd(generated), n: p.rows, c: p.cols, kind: p.kind };
}

/** Fragment compact (sans « # »), en majuscules : tient dans le mode alphanumérique du QR. */
export function verifyCode(v: VerifyInfo): string {
  return ["1", v.kind ? KIND_CODE[v.kind] : "X", v.h.toUpperCase(), v.i, v.g, String(v.n), String(v.c)].join(".");
}

export function verifyUrl(v: VerifyInfo, base = VERIFY_URL): string {
  return `${base}#${verifyCode(v)}`;
}

/** Lit le fragment d'une URL de vérification (compact ou long) ; null si incomplet ou illisible. */
export function parseVerifyFragment(fragment: string): VerifyInfo | null {
  let f = (fragment ?? "").trim();
  const at = f.indexOf("#");
  if (at >= 0) f = f.slice(at + 1);
  try {
    f = decodeURIComponent(f);
  } catch {
    return null;
  }
  if (!f) return null;
  let raw: { h?: string; i?: string; g?: string; n?: string; c?: string; k?: string };
  if (/^1\./.test(f)) {
    const parts = f.split(".");
    if (parts.length !== 7) return null;
    const [, k, h, i, g, n, c] = parts;
    raw = { k, h, i, g, n, c };
  } else {
    const q = new URLSearchParams(f);
    raw = { h: q.get("h") ?? undefined, i: q.get("i") ?? undefined, g: q.get("g") ?? undefined, n: q.get("n") ?? undefined, c: q.get("c") ?? undefined, k: q.get("k") ?? undefined };
  }
  const h = (raw.h ?? "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return null;
  if (!raw.i || !raw.g || !validYmd(raw.i) || !validYmd(raw.g)) return null;
  if (!/^\d{1,9}$/.test(raw.n ?? "") || !/^\d{1,6}$/.test(raw.c ?? "")) return null;
  const kind = raw.k ? CODE_KIND[raw.k.toUpperCase()] ?? null : null;
  return { h, i: raw.i, g: raw.g, n: Number(raw.n), c: Number(raw.c), kind };
}
