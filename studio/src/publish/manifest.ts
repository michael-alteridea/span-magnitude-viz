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
/** Révision du contrat (ajouts compatibles, `version` reste 1). */
export const CONTRACT_REVISION = "1.1";
/** Image intégrée (manifeste téléchargé) : 800 000 caractères au plus par adresse data:. */
export const DATA_URL_MAX_CHARS = 800_000;
/** Manifeste téléchargé (images intégrées) : 12 Mo au plus (12 000 000 octets). */
export const MANIFEST_MAX_BYTES = 12_000_000;
/** Longueur du suffixe de version des images publiées (`?v=` + 12 premiers caractères de l'empreinte du snapshot). */
export const IMAGE_VERSION_LEN = 12;
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
/**
 * Adresse publiée d'une image. `version` (empreinte du snapshot) ajoute `?v=<12 hex>` : une image republiée
 * change d'adresse et ne sort jamais d'un cache périmé (Firebase garde jusqu'à 1 h).
 */
export const imageUrl = (id: string, snapId: string, ext: "png" | "svg", base: string = PLATFORM_URL, version?: string): string =>
  `${publishBase(base)}${enc(id)}/${enc(snapId)}.${ext}${version ? `?v=${version.slice(0, IMAGE_VERSION_LEN)}` : ""}`;
/** Nom du fichier d'une adresse d'image publiée (sans le suffixe `?v=`). */
export const imageFileOf = (u: string): string => decodeURIComponent((u.split("?")[0] ?? "").split("/").pop() ?? "");

/* ------------------------------------------------------------------ schéma */

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HTTP = /^https?:\/\/\S+$/;

const id = z.string().regex(ID, "identifiant : lettres, chiffres, « . », « _ », « - »");
const iso = z.string().regex(ISO, "date ISO 8601 avec fuseau");
const url = z.string().regex(HTTP, "adresse http(s) absolue");
const hex64 = z.string().regex(HEX64, "empreinte SHA-256 (64 caractères hexadécimaux)");
const PNG_URL = /^https?:\/\/[^\s?]+\.png(\?v=[0-9a-f]{12})?$/;
const PNG_DATA = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
/** Image PNG : adresse publiée (…/<snapshot>.png?v=…) ou image intégrée (manifeste téléchargé, ≤ 800 000 caractères). */
const png = z
  .string()
  .refine((s) => PNG_URL.test(s) || PNG_DATA.test(s), "image PNG : adresse …/.png ou data:image/png;base64")
  .refine((s) => !s.startsWith("data:") || s.length <= DATA_URL_MAX_CHARS, `image intégrée : ${DATA_URL_MAX_CHARS.toLocaleString("fr-FR")} caractères au plus`);

export const manifestSnapshotSchema = z.object({
  id,
  position: z.number().int().min(1),
  titre: z.string().min(1).max(300),
  /** Synthèse narrative en une phrase (message du snapshot) ; distincte des puces « À retenir ». */
  commentaire_genere: z.string().max(2000),
  commentaire_animateur: z.string().max(2000).nullable(),
  a_retenir: z.array(z.string().max(400)).max(10),
  chemin: z.string().max(400),
  image_png: png,
  image_svg: z.string().regex(/^https?:\/\/[^\s?]+\.svg(\?v=[0-9a-f]{12})?$/).optional(),
  /** Texte alternatif de l'image (français) : type de graphique, périmètre, chiffre clé. */
  alt: z.string().min(1).max(1000),
  /** Lien https partageable ; null dans un manifeste téléchargé (liens propres à l'appareil, non partagés). */
  lien_lecture: url.nullable(),
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
    /** Empreinte des données (celle du cartouche) — ajout compatible 1.1 ; `empreinte` couvre le contenu publié. */
    empreinte_donnees: hex64.optional(),
    lien_lecture: url.nullable(),
    snapshots: z.array(manifestSnapshotSchema).min(1).max(24),
  })
  .superRefine((m, ctx) => {
    m.snapshots.forEach((s, i) => {
      if (s.position !== i + 1) ctx.addIssue({ code: "custom", path: ["snapshots", i, "position"], message: `position attendue : ${i + 1}` });
      const bullets = s.a_retenir.map((x) => x.trim());
      const g = s.commentaire_genere.trim();
      if (g && (bullets.includes(g) || (bullets.length && g === bullets.join(" ")))) ctx.addIssue({ code: "custom", path: ["snapshots", i, "commentaire_genere"], message: "commentaire_genere doit être une synthèse distincte des puces « À retenir »" });
      const published = /^https?:/.test(s.image_png);
      if (published && !s.lien_lecture) ctx.addIssue({ code: "custom", path: ["snapshots", i, "lien_lecture"], message: "revue publiée : lien de lecture https obligatoire" });
      if (published && !/\?v=[0-9a-f]{12}$/.test(s.image_png)) ctx.addIssue({ code: "custom", path: ["snapshots", i, "image_png"], message: "image publiée : suffixe de version ?v=<12 hex> attendu" });
      if (published && !s.image_png.endsWith(`?v=${s.empreinte.slice(0, IMAGE_VERSION_LEN)}`)) ctx.addIssue({ code: "custom", path: ["snapshots", i, "image_png"], message: "image publiée : ?v= doit reprendre l'empreinte du snapshot" });
    });
    if (m.snapshots.some((s) => /^https?:/.test(s.image_png)) && !m.lien_lecture) ctx.addIssue({ code: "custom", path: ["lien_lecture"], message: "revue publiée : lien de lecture https obligatoire" });
    const ids = new Set(m.snapshots.map((s) => s.id));
    if (ids.size !== m.snapshots.length) ctx.addIssue({ code: "custom", path: ["snapshots"], message: "identifiants de snapshots en double" });
  });
export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestSnapshot = z.infer<typeof manifestSnapshotSchema>;

export const indexSchema = z.object({
  format: z.literal(INDEX_FORMAT),
  version: z.literal(MANIFEST_VERSION),
  genere_le: iso,
  revues: z.array(
    z.object({
      id,
      titre: z.string().min(1),
      persona: z.string(),
      manifeste: url,
      empreinte: hex64,
      empreinte_donnees: hex64.optional(),
      genere_le: iso,
      nb_snapshots: z.number().int().min(1).max(24),
    })
  ),
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
  /** Rôle narratif (contexte, tension, révélation, recommandation). */
  role?: string | null;
  /**
   * Puces par élément (couleur propre ou mise en avant), calculées ou saisies : publiées à la suite des puces
   * générales dans `a_retenir`. Absentes ou vides = empreinte inchangée.
   */
  elements?: string[];
}

/** Puces « À retenir » publiées : générales, puis puces par élément (10 au plus, contrat). */
export function aRetenirOf(s: Pick<SourceSnapshot, "comments" | "elements">): string[] {
  return [...s.comments, ...(s.elements ?? [])].map((c) => c.trim()).filter(Boolean).slice(0, 10);
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
  /** « publie » : images par adresse (`…/publie/<revue>/<snapshot>.png?v=…`) ; « integre » : images data: (téléchargement, liens de lecture null). */
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

const ROLE_LEADS: Record<string, string> = {
  context: "Pour situer",
  tension: "Point d'attention",
  revelation: "Ce que montre l'analyse",
  recommendation: "À décider",
};

const sentence = (t: string): string => {
  const x = t.trim().replace(/[ \t\r\n]+/g, " ");
  return !x ? "" : /[.!?…]$/.test(x) ? x : `${x}.`;
};

/** Phrase avec un nombre (montant, pourcentage, effectif) : sert de chiffre clé. */
const HAS_NUMBER = /\d/;

/**
 * Commentaire généré : synthèse narrative en une phrase, le message du snapshot (titre d'action) introduit par son
 * rôle dans le récit et son périmètre (« Point d'attention (Pipeline créé › T2 2026) — Juin 2026 décroche… »).
 * Les puces « À retenir » restent dans `a_retenir` (jamais recopiées ici).
 */
export function commentaireOf(s: Pick<SourceSnapshot, "title" | "subtitle" | "path" | "role" | "comments">): string {
  const title = s.title.trim();
  if (!title) return "";
  const lead = ROLE_LEADS[s.role ?? ""] ?? "Message";
  const scope = cheminOf(s);
  const out = sentence(`${lead}${scope ? ` (${scope})` : ""} — ${title}`);
  const bullets = s.comments.map((c) => c.trim());
  return bullets.includes(out) ? `${lead} — ${out}` : out;
}

/** Description courte du type de graphique d'un snapshot (texte alternatif). */
export function chartKindOf(spec: unknown): string {
  const sp = (spec ?? {}) as { type?: string; drill?: { view?: string }; special?: { mapRegion?: string } };
  const t = sp.type ?? "";
  if (t === "drill") {
    const v = sp.drill?.view ?? "periods";
    return (
      {
        periods: "Graphique en barres par période",
        month: "Courbe du cumul jour par jour comparé au rythme moyen",
        map: "Carte des régions France · Belgique",
        history: "Petits multiples mensuels par région",
        breakdown: "Graphique en barres par catégorie",
        bridge: "Cascade des écarts",
        compare: "Barres comparées avec écarts",
        pivot: "Tableau croisé en graphique",
      } as Record<string, string>
    )[v] ?? "Graphique d'exploration";
  }
  if (t === "map") return sp.special?.mapRegion === "europe" ? "Carte d'Europe" : sp.special?.mapRegion === "world" ? "Carte du monde" : sp.special?.mapRegion === "burundi" ? "Carte du Burundi (provinces)" : "Carte France · Belgique";
  return (
    {
      bar: "Graphique en barres verticales",
      barH: "Graphique en barres horizontales",
      groupedBar: "Graphique en barres groupées",
      stackedBar: "Graphique en barres empilées",
      line: "Graphique en courbes",
      area: "Graphique en aires",
      stackedArea: "Graphique en aires empilées",
      scatter: "Nuage de points",
      pie: "Camembert",
      donut: "Graphique en anneau",
      radialBar: "Arcs radiaux",
      variance: "Graphique des écarts",
      film: "Film animé des montants dans le temps",
    } as Record<string, string>
  )[t] ?? "Graphique";
}

/**
 * Texte alternatif (français) : type de graphique, périmètre, message et chiffre clé — titre d'action, complété par
 * la première puce chiffrée quand le titre n'a pas de nombre.
 */
export function altOf(s: Pick<SourceSnapshot, "title" | "subtitle" | "path" | "comments" | "spec">): string {
  const scope = cheminOf(s);
  const parts = [sentence(`${chartKindOf(s.spec)}${scope ? ` : ${scope}` : ""}`), sentence(s.title)];
  if (!HAS_NUMBER.test(s.title)) {
    const k = s.comments.map((c) => c.trim()).find((c) => HAS_NUMBER.test(c));
    if (k) parts.push(sentence(`Chiffre clé : ${k}`));
  }
  const out = parts.filter(Boolean).join(" ");
  return out.length > 1000 ? `${out.slice(0, 997)}…` : out || "Graphique Datanime";
}

function dataHashOf(spec: unknown): string | null {
  const h = (spec as { provenance?: { hash?: unknown } } | null)?.provenance?.hash;
  return typeof h === "string" && HEX64.test(h) ? h : null;
}

/**
 * Réglages ajoutés après la publication des premières revues : omis de l'empreinte tant qu'ils gardent leur valeur
 * par défaut, pour qu'une nouvelle version du Studio ne signale pas « contenu changé » sur des graphiques identiques
 * (étape I : extrémité des barres, icônes par catégorie, mise en avant).
 */
export function fingerprintSpec(spec: unknown): unknown {
  const fd0 = (spec as { mode?: { fourD?: Record<string, unknown> } } | null)?.mode?.fourD;
  if (fd0 && typeof fd0 === "object" && fd0.stampStyle === "watermark") {
    // Forme du tampon 4D : filigrane par défaut absent de l'empreinte (empreintes publiées inchangées)
    const fourD = { ...fd0 };
    delete fourD.stampStyle;
    spec = { ...(spec as object), mode: { ...(spec as { mode: object }).mode, fourD } };
  }
  const enc0 = (spec as { encoding?: Record<string, unknown> } | null)?.encoding;
  if (enc0 && typeof enc0 === "object" && enc0.topOrder === "top") {
    // « Nombre d'éléments » (étape filtres) : classement par défaut absent de l'empreinte (empreintes publiées inchangées)
    const encoding = { ...enc0 };
    delete encoding.topOrder;
    spec = { ...(spec as object), encoding };
  }
  if (spec && typeof spec === "object" && "dataset" in spec && (spec as { dataset?: unknown }).dataset == null) {
    // Dataset dérivé : absent (source entière) = hors empreinte (empreintes publiées inchangées)
    const { dataset: _d, ...rest } = spec as Record<string, unknown>;
    spec = rest;
  }
  const st = (spec as { style?: Record<string, unknown> } | null)?.style;
  if (!st || typeof st !== "object") return spec;
  const style = { ...st };
  if (style.barCap === "none") delete style.barCap;
  if (style.capIcons && typeof style.capIcons === "object" && !Object.keys(style.capIcons).length) delete style.capIcons;
  // « Forme des points » (nuage) : valeurs par défaut absentes de l'empreinte (empreintes publiées inchangées)
  if (style.pointShape === "circle") delete style.pointShape;
  if (style.pointIcon === "") delete style.pointIcon;
  if (style.pointIcons && typeof style.pointIcons === "object" && !Object.keys(style.pointIcons).length) delete style.pointIcons;
  // Surcharges par élément (sélection par touchers) : vides = hors empreinte (empreintes publiées inchangées)
  if (style.overrides && typeof style.overrides === "object" && !Object.keys(style.overrides).length) delete style.overrides;
  const f = style.focus as { key?: unknown; title?: unknown; note?: unknown; average?: unknown } | undefined;
  if (f && f.key == null && !f.title && !f.note && f.average !== false) delete style.focus;
  return { ...(spec as object), style };
}

/** Note de l'animateur·rice telle que publiée (`commentaire_animateur`) : texte nettoyé, ou null. */
export const noteOf = (note: string | null | undefined): string | null => (note?.trim() ? note.trim() : null);

/**
 * Empreinte d'un snapshot : SHA-256 du JSON canonique de son contenu (identifiant, titres, puces, chemin, rôle,
 * spécification du graphique et données, d'où l'image est rendue) ET de tous les textes publiés dans le manifeste
 * (`titre`, `a_retenir`, `commentaire_genere`, `commentaire_animateur`, `chemin`, `alt`). Une note d'animateur·rice
 * modifiée seule change donc l'empreinte (et le `?v=` des images) : Cadencer rafraîchit le point d'ordre du jour.
 */
export function snapshotFingerprint(s: SourceSnapshot, note: string | null = null): Promise<string> {
  return sha256Hex(
    canonicalJson({
      id: s.id,
      title: s.title,
      subtitle: s.subtitle,
      comments: s.comments,
      path: s.path ?? null,
      role: s.role ?? null,
      spec: fingerprintSpec(s.spec),
      publie: {
        titre: s.title,
        a_retenir: aRetenirOf(s),
        commentaire_genere: commentaireOf(s),
        commentaire_animateur: noteOf(note),
        chemin: cheminOf(s),
        alt: altOf(s),
      },
    })
  );
}

/**
 * Empreinte des données de la revue (celle du cartouche, ex. `d923·bd5f`) quand tous les snapshots viennent du même
 * jeu de données ; sinon SHA-256 des empreintes de données triées ; null sans provenance.
 */
export async function reviewDataFingerprint(snaps: SourceSnapshot[]): Promise<string | null> {
  const data = [...new Set(snaps.map((s) => dataHashOf(s.spec)).filter((h): h is string => !!h))].sort();
  if (!data.length) return null;
  if (data.length === 1 && snaps.every((s) => dataHashOf(s.spec))) return data[0]!;
  return sha256Hex(data.join(","));
}

/**
 * Empreinte de la revue : SHA-256 du JSON canonique des champs de la revue (titre, destinataire, entreprise, date de
 * réunion, source, empreinte des données) et de la suite ordonnée (id, empreinte) de ses snapshots. Change dès qu'un
 * snapshot change (note comprise), qu'un snapshot est ajouté, retiré ou déplacé : l'index suffit à détecter une revue
 * modifiée.
 */
export function reviewFingerprint(
  r: { id: string; titre: string; persona: string; entreprise: string; date_reunion: string | null; source: string },
  dataPrint: string | null,
  snaps: { id: string; empreinte: string }[]
): Promise<string> {
  return sha256Hex(
    canonicalJson({
      id: r.id,
      titre: r.titre,
      persona: r.persona,
      entreprise: r.entreprise,
      date_reunion: r.date_reunion,
      source: r.source,
      empreinte_donnees: dataPrint,
      snapshots: snaps.map((s) => [s.id, s.empreinte]),
    })
  );
}

export async function buildManifest(input: ManifestInput, o: ManifestOptions): Promise<Manifest> {
  const base = o.base ?? PLATFORM_URL;
  const readBase = o.readBase ?? base;
  const readId = input.readId ?? input.id;
  const publie = o.images === "publie";
  const prints = await Promise.all(input.snapshots.map((x) => snapshotFingerprint(x.snap, x.note)));
  const sources = [...new Set(input.snapshots.map((x) => x.snap.source.trim()).filter(Boolean))];
  const source = sources.join(" ; ");
  const dataPrint = await reviewDataFingerprint(input.snapshots.map((x) => x.snap));
  const empreinte = await reviewFingerprint(
    { id: input.id, titre: input.titre, persona: input.persona, entreprise: input.entreprise, date_reunion: input.date_reunion, source },
    dataPrint,
    input.snapshots.map((x, i) => ({ id: x.snap.id, empreinte: prints[i]! }))
  );
  const m: Manifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    id: input.id,
    titre: input.titre,
    persona: input.persona,
    entreprise: input.entreprise,
    date_reunion: input.date_reunion,
    genere_le: input.genere_le,
    source,
    empreinte,
    ...(dataPrint ? { empreinte_donnees: dataPrint } : {}),
    // Manifeste téléchargé : les liens de cet appareil ne sont pas partagés (null) ; seuls les liens https publiés circulent.
    lien_lecture: publie ? readUrl(readBase, readId) : null,
    snapshots: input.snapshots.map(({ snap, note, png, svg }, i) => ({
      id: snap.id,
      position: i + 1,
      titre: snap.title || `Snapshot ${i + 1}`,
      commentaire_genere: commentaireOf(snap),
      commentaire_animateur: noteOf(note),
      a_retenir: aRetenirOf(snap),
      chemin: cheminOf(snap),
      image_png: publie ? imageUrl(input.id, snap.id, "png", base, prints[i]) : png,
      ...(publie && svg ? { image_svg: imageUrl(input.id, snap.id, "svg", base, prints[i]) } : {}),
      alt: altOf(snap),
      lien_lecture: publie ? readUrl(readBase, readId, snap.id) : null,
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
    revues: manifests.map((m) => ({ id: m.id, titre: m.titre, persona: m.persona, manifeste: manifestUrl(m.id, base), empreinte: m.empreinte, ...(m.empreinte_donnees ? { empreinte_donnees: m.empreinte_donnees } : {}), genere_le: m.genere_le, nb_snapshots: m.snapshots.length })),
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
