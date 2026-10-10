/**
 * Liens « Rejouer » : liens de lecture universels des projets d'exemple intégrés, cible du QR du Reel, lien
 * « commercial » vers la présentation de la plateforme, paramètre d'origine `src`.
 *
 * - `?projet=<id>&lecture=1[&scene=N][&src=qr|reel|partage]` : ouvre l'exemple livré avec le Studio puis le mode
 *   lecture plein écran à la scène N (1 par défaut) — fonctionne sur n'importe quel appareil (le fichier est servi
 *   avec le site). Sans `lecture`, `?projet=<id>` garde son comportement : l'exemple s'ouvre dans le Studio.
 * - `src` dit seulement d'où vient le visiteur (lisible dans les journaux du serveur) : aucun script de mesure.
 * - Projets locaux (ni exemple, ni démo, ni revue publiée) : pas de lien universel (null), l'appelant garde le lien
 *   `#/lire/…` de cet appareil.
 *
 * Module pur (aucun accès DOM ni stockage) : testé par vitest.
 */
import { DISCOVER_URL, PLATFORM_HOST, PLATFORM_URL } from "../brand";
import type { ReelLinks } from "../reel/plan";
import { EXAMPLE_PROJECTS, exampleProjectById, type ExampleProject } from "./examples";

export type { ReelLinks };

/** Origine d'un lien partagé (QR des images / diapositives, QR du Reel, bouton « Partager »). */
export type LinkSrc = "qr" | "reel" | "partage";
export const LINK_SOURCES: readonly LinkSrc[] = ["qr", "reel", "partage"];

/** Lien de lecture universel d'un projet d'exemple (scène N, 1-indexée ; la scène 1 est implicite). */
export function exampleReadUrl(id: string, o: { scene?: number | null; src?: LinkSrc | null; base?: string } = {}): string {
  const q = new URLSearchParams();
  q.set("projet", id);
  q.set("lecture", "1");
  if (o.scene && Number.isInteger(o.scene) && o.scene > 1) q.set("scene", String(o.scene));
  if (o.src) q.set("src", o.src);
  return `${o.base ?? PLATFORM_URL}?${q.toString()}`;
}

/** Exemple intégré auquel appartient une scène (identifiant livré), avec son numéro (1-indexé), sinon null. */
export function exampleSceneOf(snapId: string): { example: ExampleProject; scene: number } | null {
  for (const e of EXAMPLE_PROJECTS) {
    const k = e.scenes.indexOf(snapId);
    if (k >= 0) return { example: e, scene: k + 1 };
  }
  return null;
}

/** Lien universel d'une scène d'exemple ; null pour une scène locale (lien de cet appareil à garder). */
export function exampleSnapshotUrl(snapId: string, src: LinkSrc | null = null, base: string = PLATFORM_URL): string | null {
  const m = exampleSceneOf(snapId);
  return m ? exampleReadUrl(m.example.id, { scene: m.scene, src, base }) : null;
}

/** Exemple intégré dont viennent toutes les scènes (Reel, film d'une séquence), sinon null. */
export function exampleOfScenes(snapIds: readonly string[]): ExampleProject | null {
  if (!snapIds.length) return null;
  const ids = new Set(snapIds.map((s) => exampleSceneOf(s)?.example.id ?? ""));
  const [only] = [...ids];
  return ids.size === 1 && only ? exampleProjectById(only) : null;
}

export interface LectureRequest {
  /** Exemple demandé (`?projet=`), tel quel. */
  projet: string | null;
  /** Ouvrir le mode lecture (`lecture=1`, `lecture=true`, `lecture` seul). */
  lecture: boolean;
  /** Scène demandée (1-indexée), null si absente ou invalide. */
  scene: number | null;
  src: LinkSrc | null;
}

/** Lecture des paramètres d'un lien partagé (`location.search`). */
export function parseLectureParams(search: string): LectureRequest {
  const p = new URLSearchParams(search);
  const l = p.get("lecture");
  const raw = p.get("scene");
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  const src = p.get("src") as LinkSrc | null;
  return {
    projet: p.get("projet"),
    lecture: l !== null && !/^(0|false|non|no)$/i.test(l.trim()),
    scene: Number.isInteger(n) && n >= 1 ? n : null,
    src: src && LINK_SOURCES.includes(src) ? src : null,
  };
}

/** Adresse sans les paramètres de lien partagé (projet, lecture, scene, src) ; les autres et le fragment sont gardés. */
export function withoutShareParams(href: string): string {
  const u = new URL(href);
  for (const k of ["projet", "lecture", "scene", "src"]) u.searchParams.delete(k);
  return u.pathname + u.search + u.hash;
}

/** Libellé visible d'une adresse (sans https:// ni barre finale). */
export const shortUrl = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Lien du Studio (« Créez le vôtre ») avec son origine. */
export const studioUrl = (src: LinkSrc | null = null): string => (src ? `${PLATFORM_URL}?src=${src}` : PLATFORM_URL);

/** Lien « commercial » : présentation de la plateforme. */
export const discoverUrl = (src: LinkSrc | null = null): string => (src ? `${DISCOVER_URL}?src=${src}` : DISCOVER_URL);

/**
 * Liens de la carte de fin du Reel : le film du projet quand ses scènes viennent d'un exemple intégré
 * (`?projet=<id>&lecture=1&src=reel`), sinon la page du Studio (`?src=reel`) ; une petite ligne vers la présentation.
 */
export function reelLinks(example: Pick<ExampleProject, "id"> | null): ReelLinks {
  const pitchUrl = discoverUrl("reel");
  const pitch = `Découvrir Datanime : ${shortUrl(DISCOVER_URL)}`;
  if (!example) return { qr: studioUrl("reel"), label: [PLATFORM_HOST], cta: "Scannez pour essayer", pitch, pitchUrl };
  const visible = exampleReadUrl(example.id);
  const q = visible.indexOf("?");
  return { qr: exampleReadUrl(example.id, { src: "reel" }), label: [visible.slice(0, q).replace(/^https?:\/\//, ""), visible.slice(q)], cta: "Scannez pour rejouer le film", pitch, pitchUrl };
}
