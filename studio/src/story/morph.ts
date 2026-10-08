/**
 * Transitions Morph (PowerPoint) : nommage des formes et injection XML, sans DOM (testable sous Node).
 *
 * PowerPoint apparie d'une diapositive à la suivante les formes de même nom préfixé « !! » et anime
 * leur position, leur taille et leur couleur (barres qui poussent, zoom d'une barre vers le détail).
 * pptxgenjs n'écrit pas les transitions : on ajoute après coup, dans chaque diapositive, une transition
 * Morph avec repli « fondu » (mc:AlternateContent) pour les lecteurs qui ne la connaissent pas
 * (LibreOffice, anciennes versions).
 */
import type { ChartSpec } from "../spec";

/** Rectangle natif (fractions de l'image du graphique, 0–1). */
export interface NativeMark {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Couleur de remplissage (#RRGGBB) ou null (contour seul). */
  fill: string | null;
  /** Opacité 0–1 (remplissage et contour). */
  opacity: number;
  stroke: string | null;
  dash: boolean;
}

export interface NativeSlide {
  /** Graphique sans ses barres (axes, libellés, cartouche avec QR) : PNG. */
  bg: { data: string; width: number; height: number };
  marks: NativeMark[];
  /** Étape de construction : « amorce » (barres à zéro, sans commentaires) ou « complet ». */
  stage: "amorce" | "complet";
}

export const MORPH_PREFIX = "!!";
export const MORPH_DURATION_MS = 1600;

/** Transition Morph (objets) avec repli fondu. */
export const MORPH_TRANSITION_XML =
  `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
  `<mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159">` +
  `<p:transition xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" spd="slow" p14:dur="${MORPH_DURATION_MS}"><p159:morph option="byObject"/></p:transition>` +
  `</mc:Choice>` +
  `<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback>` +
  `</mc:AlternateContent>`;

/** Ajoute la transition Morph à une diapositive (après p:clrMapOvr, avant p:timing) ; idempotent. */
export function injectMorphTransition(xml: string): string {
  if (xml.includes("p159:morph")) return xml;
  const clr = xml.indexOf("</p:clrMapOvr>");
  if (clr >= 0) {
    const at = clr + "</p:clrMapOvr>".length;
    return xml.slice(0, at) + MORPH_TRANSITION_XML + xml.slice(at);
  }
  const timing = xml.indexOf("<p:timing");
  if (timing >= 0) return xml.slice(0, timing) + MORPH_TRANSITION_XML + xml.slice(timing);
  const end = xml.lastIndexOf("</p:sld>");
  if (end < 0) throw new Error("diapositive sans </p:sld>");
  return xml.slice(0, end) + MORPH_TRANSITION_XML + xml.slice(end);
}

/** Numéro des fichiers ppt/slides/slideN.xml. */
export function slideNumber(path: string): number | null {
  const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path);
  return m ? Number(m[1]) : null;
}

/**
 * Post-traitement JSZip du fichier .pptx : transition Morph sur toutes les diapositives à partir de `from`
 * (la couverture garde l'apparition simple). Renvoie le zip régénéré dans le format demandé.
 */
export async function addMorphTransitions(data: ArrayBuffer | Uint8Array, outputType: "blob" | "arraybuffer" | "base64" | "nodebuffer", from = 2): Promise<Blob | ArrayBuffer | string | Uint8Array> {
  const JSZip = ((await import("jszip")) as unknown as { default: any }).default;
  const zip = await JSZip.loadAsync(data);
  const files = Object.keys(zip.files).filter((p) => (slideNumber(p) ?? 0) >= from);
  for (const p of files) zip.file(p, injectMorphTransition(await zip.file(p).async("string")));
  return zip.generateAsync({ type: outputType === "nodebuffer" ? "nodebuffer" : outputType, compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

/** Nom Morph d'une marque : type, clés de données des groupes parents, rang parmi les marques de même clé. */
export function markName(kind: string, keys: string[], idx: number): string {
  const clean = (t: string) => t.replace(/[\s"<>&]+/g, "_").slice(0, 60);
  return `${MORPH_PREFIX}${clean(kind)}${keys.length ? `:${keys.map(clean).join("/")}` : ""}#${idx}`;
}

/** Noms uniques sur une diapositive (suffixe ~2, ~3… en cas de doublon). */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : `${n}~${k}`;
  });
}

/** Étape ajoutée au chemin d'exploration entre deux snapshots consécutifs (zoom), sinon null. */
export function drillStepAdded(a: unknown, b: unknown): ChartSpec["drill"]["path"][number] | null {
  const sa = a as Partial<ChartSpec> | null;
  const sb = b as Partial<ChartSpec> | null;
  if (sa?.type !== "drill" || sb?.type !== "drill" || !sa.drill || !sb.drill) return null;
  const pa = sa.drill.path;
  const pb = sb.drill.path;
  if (pb.length !== pa.length + 1 || !pa.every((s, k) => JSON.stringify(s) === JSON.stringify(pb[k]))) return null;
  return pb[pb.length - 1] ?? null;
}

/** Nom partagé entre la barre cliquée (diapositive N) et la zone du détail (diapositive N+1). */
export function zoomName(k: number): string {
  return `${MORPH_PREFIX}zoom-${k}`;
}

/** Couleur CSS calculée (rgb(…), #…) en #RRGGBB, ou null (none, url(…), transparente). */
export function cssColorHex(c: string | null | undefined): string | null {
  if (!c) return null;
  const t = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(t)) return ("#" + t.slice(1).split("").map((x) => x + x).join("")).toUpperCase();
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(t);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  return "#" + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("").toUpperCase();
}
