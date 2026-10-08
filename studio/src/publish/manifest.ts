/**
 * Pont Cadencer — « manifeste de revue » Datanime (contrat : studio/docs/contrat-cadencer.md).
 *
 * Modèle V1 en tirage (pull), sans secret partagé : Datanime publie un JSON statique public par revue
 * (`<base>publie/<revue>/manifeste.json`) et une image PNG 1600 × 900 (avec cartouche) par snapshot ;
 * Cadencer importe le manifeste par URL, côté serveur, et crée un point d'ordre du jour par snapshot
 * (source « datanime »). Toutes les adresses absolues dérivent d'une seule constante (`PLATFORM_URL`).
 *
 * Module pur (aucun accès DOM) : schéma Zod, adresses, construction et empreintes.
 */
import { z } from "zod";
import { PLATFORM_URL } from "../brand";
import { canonicalJson, sha256Hex } from "../provenance";
import { readUrl } from "../story/reading";

export const MANIFEST_FORMAT = "datanime-revue";
export const INDEX_FORMAT = "datanime-index";
export const MANIFEST_VERSION = 1;
/** Dimensions des images publiées (16:9, cartouche compris). */
export const IMAGE_W = 1600;
export const IMAGE_H = 900;
/** Dossier de publication, relatif à la base du Studio. */
export const PUBLISH_DIR = "publie";
export const MANIFEST_FILE = "manifeste.json";
export const INDEX_FILE = "index.json";

/**
 * Histoires publiées à chaque construction (autonomes : recalculées depuis les données de démonstration
 * embarquées) : les deux scénarios intégrés et les deux revues Norvia.
 */
export const PUBLISHED_STORIES = ["demo-dircom", "demo-daf", "norvia-pipeline-oct-2026", "norvia-budget-2026"] as const;

export function isPublished(id: string): boolean {
  return (PUBLISHED_STORIES as readonly string[]).includes(id);
}

/* ------------------------------------------------------------------ adresses */

const enc = encodeURIComponent;
export const publishBase = (base: string = PLATFORM_URL): string => `${base}${PUBLISH_DIR}/`;
export const indexUrl = (base: string = PLATFORM_URL): string => `${publishBase(base)}${INDEX_FILE}`;
export const manifestUrl = (id: string, base: string = PLATFORM_URL): string => `${publishBase(base)}${enc(id)}/${MANIFEST_FILE}`;
export const imageUrl = (id: string, snapId: string, ext: "png" | "svg", base: string = PLATFORM_URL): string => `${publishBase(base)}${enc(id)}/${enc(snapId)}.${ext}`;

/* ------------------------------------------------------------------ schéma */

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HTTP = /^https?:\/\/\S+$/;

const id = z.string().regex(ID, "identifiant : lettres, chiffres, « . », « _ », « - »");
const iso = z.string().regex(ISO, "date ISO 8601 avec fuseau");
const url = z.string().regex(HTTP, "adresse http(s) absolue");
const hex64 = z.string().regex(HEX64, "empreinte SHA-256 (64 caractères hexadécimaux)");
/** Image PNG : adresse publiée (…/<snapshot>.png) ou image intégrée (manifeste téléchargé). */
const png = z.string().refine((s) => /^https?:\/\/\S+\.png$/.test(s) || /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s), "image PNG : adresse …/.png ou data:image/png;base64");

export const manifestSnapshotSchema = z.object({
  id,
  position: z.number().int().min(1),
  titre: z.string().min(1).max(300),
  commentaire_genere: z.string().max(2000),
  commentaire_animateur: z.string().max(2000).nullable(),
  a_retenir: z.array(z.string().max(400)).max(10),
  chemin: z.string().max(400),
  image_png: png,
  image_svg: z.string().regex(/^https?:\/\/\S+\.svg$/).optional(),
  lien_lecture: url,
  empreinte: hex64,
});

export const manifestSchema = z
  .object({
    format: z.literal(MANIFEST_FORMAT),
    version: z.literal(MANIFEST_VERSION),
    id,
    titre: z.string().min(1).max(200),
    persona: z.string().max(120),
    entreprise: z.string().max(120),
    date_reunion: iso.nullable(),
    genere_le: iso,
    source: z.string().max(400),
    empreinte: hex64,
    lien_lecture: url,
    snapshots: z.array(manifestSnapshotSchema).min(1).max(24),
  })
  .superRefine((m, ctx) => {
    m.snapshots.forEach((s, i) => {
      if (s.position !== i + 1) ctx.addIssue({ code: "custom", path: ["snapshots", i, "position"], message: `position attendue : ${i + 1}` });
    });
    const ids = new Set(m.snapshots.map((s) => s.id));
    if (ids.size !== m.snapshots.length) ctx.addIssue({ code: "custom", path: ["snapshots"], message: "identifiants de snapshots en double" });
  });
export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestSnapshot = z.infer<typeof manifestSnapshotSchema>;

export const indexSchema = z.object({
  format: z.literal(INDEX_FORMAT),
  version: z.literal(MANIFEST_VERSION),
  genere_le: iso,
  revues: z.array(z.object({ id, titre: z.string().min(1), persona: z.string(), manifeste: url })),
});
export type ManifestIndex = z.infer<typeof indexSchema>;

/* ------------------------------------------------------------------ construction */

/** Snapshot source (champs utilisés du modèle `Snapshot`). */
export interface SourceSnapshot {
  id: string;
  title: string;
  subtitle: string;
  comments: string[];
  path?: string[] | undefined;
  source: string;
  spec?: unknown;
}

export interface ManifestInput {
  id: string;
  /** Histoire du mode lecture (`#/lire/<readId>`) — par défaut `id`. */
  readId?: string;
  titre: string;
  persona: string;
  entreprise: string;
  date_reunion: string | null;
  genere_le: string;
  snapshots: { snap: SourceSnapshot; note: string | null; png: string; svg?: boolean }[];
}

export interface ManifestOptions {
  /** « publie » : images par adresse (`…/publie/<revue>/<snapshot>.png`) ; « integre » : images data: (téléchargement). */
  images: "publie" | "integre";
  /** Base des adresses publiées (constante unique). */
  base?: string;
  /** Base des liens de lecture (par défaut la base publiée). */
  readBase?: string;
}

/** « Pipeline créé › T2 2026 › Juin 2026 » : mesure (sous-titre sans unité) puis chemin d'exploration. */
export function cheminOf(s: Pick<SourceSnapshot, "subtitle" | "path">): string {
  const measure = (s.subtitle.split(" · ")[0] ?? "").replace(/\s+en\s+\S+$/u, "").trim();
  const path = (s.path ?? []).filter((p) => p && p !== "Tout");
  return [measure, ...path].filter(Boolean).join(" › ");
}

/** Commentaire généré en un paragraphe (les « À retenir » mis bout à bout). */
export function commentaireOf(comments: string[]): string {
  return comments
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => (/[.!?…:]$/.test(c) ? c : `${c}.`))
    .join(" ");
}

function dataHashOf(spec: unknown): string | null {
  const h = (spec as { provenance?: { hash?: unknown } } | null)?.provenance?.hash;
  return typeof h === "string" && HEX64.test(h) ? h : null;
}

/** Empreinte d'un snapshot : SHA-256 du JSON canonique de son contenu (graphique, textes, données). */
export function snapshotFingerprint(s: SourceSnapshot): Promise<string> {
  return sha256Hex(canonicalJson({ id: s.id, title: s.title, subtitle: s.subtitle, comments: s.comments, path: s.path ?? null, spec: s.spec }));
}

/**
 * Empreinte de la revue : empreinte des données (celle du cartouche) quand tous les snapshots viennent du même
 * jeu de données ; sinon SHA-256 des empreintes de données triées (ou des empreintes des snapshots).
 */
export async function reviewFingerprint(snaps: SourceSnapshot[], snapPrints: string[]): Promise<string> {
  const data = [...new Set(snaps.map((s) => dataHashOf(s.spec)).filter((h): h is string => !!h))].sort();
  if (data.length === 1 && snaps.every((s) => dataHashOf(s.spec))) return data[0]!;
  return sha256Hex((data.length ? data : snapPrints).join(","));
}

export async function buildManifest(input: ManifestInput, o: ManifestOptions): Promise<Manifest> {
  const base = o.base ?? PLATFORM_URL;
  const readBase = o.readBase ?? base;
  const readId = input.readId ?? input.id;
  const prints = await Promise.all(input.snapshots.map((x) => snapshotFingerprint(x.snap)));
  const sources = [...new Set(input.snapshots.map((x) => x.snap.source.trim()).filter(Boolean))];
  const m: Manifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    id: input.id,
    titre: input.titre,
    persona: input.persona,
    entreprise: input.entreprise,
    date_reunion: input.date_reunion,
    genere_le: input.genere_le,
    source: sources.join(" ; "),
    empreinte: await reviewFingerprint(
      input.snapshots.map((x) => x.snap),
      prints
    ),
    lien_lecture: readUrl(readBase, readId),
    snapshots: input.snapshots.map(({ snap, note, png, svg }, i) => ({
      id: snap.id,
      position: i + 1,
      titre: snap.title || `Snapshot ${i + 1}`,
      commentaire_genere: commentaireOf(snap.comments),
      commentaire_animateur: note?.trim() ? note.trim() : null,
      a_retenir: snap.comments.map((c) => c.trim()).filter(Boolean),
      chemin: cheminOf(snap),
      image_png: o.images === "publie" ? imageUrl(input.id, snap.id, "png", base) : png,
      ...(o.images === "publie" && svg ? { image_svg: imageUrl(input.id, snap.id, "svg", base) } : {}),
      lien_lecture: readUrl(readBase, readId, snap.id),
      empreinte: prints[i]!,
    })),
  };
  return manifestSchema.parse(m);
}

export function buildIndex(manifests: Manifest[], genere_le: string, base: string = PLATFORM_URL): ManifestIndex {
  return indexSchema.parse({
    format: INDEX_FORMAT,
    version: MANIFEST_VERSION,
    genere_le,
    revues: manifests.map((m) => ({ id: m.id, titre: m.titre, persona: m.persona, manifeste: manifestUrl(m.id, base) })),
  });
}

/** Date ISO locale avec décalage (« 2026-10-08T17:30:00+02:00 »). */
export function isoLocal(d: Date): string {
  const p = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? "+" : "-"}${p(off / 60)}:${p(off % 60)}`;
}

/** Date ISO avec fuseau (telle quelle si déjà au bon format, sinon convertie), null si illisible ou vide. */
export function isoOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  if (ISO.test(s)) return s;
  const t = Date.parse(s);
  return Number.isFinite(t) ? isoLocal(new Date(t)) : null;
}

/** Identifiant de manifeste d'une histoire locale (stable pour une même suite de snapshots). */
export async function localStoryManifestId(snapIds: string[]): Promise<string> {
  return `histoire-${(await sha256Hex(snapIds.join(","))).slice(0, 10)}`;
}

/** Nom du fichier téléchargé. */
export const manifestDownloadName = (id: string): string => `datanime-manifeste-${id}.json`;
