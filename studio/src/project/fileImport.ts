/**
 * Sélection et lecture d'un fichier projet `.datanime` (aussi `.datanime.txt`, `.json`).
 *
 * iOS / iPadOS : Safari traduit `accept` en types de fichiers (UTI) ; une extension inconnue comme
 * `.datanime` n'a pas d'UTI, et le fichier apparaît grisé (non sélectionnable) dans Fichiers. Sur ces
 * appareils, aucun filtre n'est donc posé ; le contenu est vérifié après la sélection.
 */
import { PROJECT_FILE_KIND } from "./project";

/** Filtre du sélecteur sur ordinateur (inchangé, plus `.txt` / `text/plain` pour les fichiers renommés). */
export const PROJECT_FILE_ACCEPT_DESKTOP = ".datanime,.json,.txt,application/json,text/plain";

/** iPhone, iPad (y compris iPadOS qui se présente comme un Mac tactile), iPod. */
export function isAppleMobile(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return (nav.platform === "MacIntel" || /Macintosh/.test(ua)) && (nav.maxTouchPoints ?? 0) > 1;
}

/** Valeur de l'attribut `accept` (null : aucun filtre, sur iOS / iPadOS). */
export function projectFileAccept(nav?: Parameters<typeof isAppleMobile>[0]): string | null {
  return isAppleMobile(nav) ? null : PROJECT_FILE_ACCEPT_DESKTOP;
}

/** Pose (ou retire) le filtre sur un `<input type="file">`. */
export function applyProjectFileAccept(input: HTMLInputElement, nav?: Parameters<typeof isAppleMobile>[0]): void {
  const a = projectFileAccept(nav);
  if (a) input.setAttribute("accept", a);
  else input.removeAttribute("accept");
}

const notDatanime = (name: string, why: string) => new Error(`« ${name} » n'est pas un fichier Datanime (${why}). Choisissez un projet exporté depuis le Studio (.datanime).`);

/**
 * Lit le texte d'un fichier choisi : JSON obligatoire (BOM toléré).
 * `requireProject` : exige un projet Datanime (`kind: "datanime-project"`) ; sinon le JSON est rendu tel quel
 * (ancienne configuration `.r4d.json`, traitée par l'appelant).
 */
export function parseDatanimeText(text: string, fileName: string, requireProject = false): { project: boolean; raw: unknown } {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (!t) throw notDatanime(fileName, "fichier vide");
  if (t[0] !== "{" && t[0] !== "[") throw notDatanime(fileName, "contenu non JSON");
  let raw: unknown;
  try {
    raw = JSON.parse(t);
  } catch {
    throw notDatanime(fileName, "JSON illisible ou incomplet");
  }
  const project = !!raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).kind === PROJECT_FILE_KIND;
  if (requireProject && !project) throw notDatanime(fileName, `type « ${PROJECT_FILE_KIND} » absent`);
  return { project, raw };
}
