/**
 * Export PowerPoint de l'histoire (pptxgenjs, chargé à la demande) :
 * couverture bleu pétrole (logo Datanime), sommaire, puis une diapositive par snapshot — rôle, titre d'action,
 * sous-titre IBCS, graphique PNG 3× (avec sa signature), commentaires, filet d'accent.
 * Module sans DOM : les images sont fournies par l'appelant (testable sous Node).
 *
 * Option « Transitions Morph » : graphiques en formes natives nommées « !!… » (barres, zones de zoom) posées
 * sur l'image du graphique sans ses barres, séquence de construction facultative (amorce → complet) et
 * transition Morph injectée dans le XML (repli fondu). QR du cartouche et lien de l'image : mode lecture.
 */
import type { ChartSpec } from "../spec";
import { themeFor } from "../theme";
import { ICON_PNG_2X, PLATFORM_URL, PRODUCT_LABEL, PLATFORM_HOST, WORDMARK_PNG, WORDMARK_RATIO } from "../brand";
import { generatedOn } from "./fr";
import { shortFingerprint, verifyInfoFor, verifyUrl, type Provenance } from "../provenance";
import { ROLE_LABELS, type Snapshot, type StoryState } from "./snapshots";
import { addMorphTransitions, type NativeSlide } from "./morph";

export interface SlideImage {
  /** data URL PNG (ou JPEG). */
  data: string;
  width: number;
  height: number;
}

/** Puces « À retenir » colorées d'une diapositive : couleur principale (puces générales), puces par élément. */
export interface SlideBullets {
  main: string;
  elements: { text: string; color: string }[];
}

export interface PptxOptions {
  /** Couleurs des puces et puces par élément (couleur propre ou mise en avant), par snapshot. */
  bullets?: Map<string, SlideBullets>;
  images: Map<string, SlideImage | null>;
  now?: Date;
  outputType?: "blob" | "arraybuffer" | "base64" | "nodebuffer";
  /** Lien profond « mode lecture » de chaque snapshot (lien de l'image, pied de page). */
  links?: Map<string, string>;
  /** Graphiques natifs par snapshot (une entrée par étape de construction) : export Morph. */
  native?: Map<string, NativeSlide[]>;
  /** Transitions Morph (repli fondu) et formes nommées « !! ». */
  morph?: boolean;
}

const PETROL = "0E6E8C";
const PETROL_LIGHT = "3FA7C4";
const PETROL_DARK = "08465A";
const FONT = "Arial";
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const hex = (c: string) => c.replace("#", "").slice(0, 6).toUpperCase();

/** Mot-symbole « Datanime » (image, texte alternatif « Datanime », lien vers la plateforme) ; `h` = hauteur des capitales en pouces. */
function wordmark(slide: any, dark: boolean, x: number, y: number, h: number) {
  slide.addImage({ data: WORDMARK_PNG[dark ? "dark" : "light"], x, y, w: h * WORDMARK_RATIO, h, altText: PRODUCT_LABEL, hyperlink: { url: PLATFORM_URL, tooltip: PLATFORM_HOST } });
}

/** Cartouche « label qualité » d'une diapositive (couverture, sommaire). */
/** Typographie française : espace insécable avant « : ; ! ? » et entre un nombre et son unité (pas de retour à la ligne). */
function frSpaces(t: string): string {
  return t.replace(/ ([:;!?»])/g, "\u00a0$1").replace(/« /g, "«\u00a0").replace(/(\d) (k€|M€|€|%)/g, "$1\u00a0$2");
}

function cartouche(slide: any, opts: { dark: boolean; date: string; source?: string }) {
  const x = SLIDE_W - 4.1;
  const y = SLIDE_H - 0.78;
  // Logo Datanime : PNG 64 px affiché à 0,26 po (≥ 2× à 96 ppp)
  slide.addImage({ data: ICON_PNG_2X, x: x + 0.02, y: y + 0.03, w: 0.26, h: 0.26, altText: PRODUCT_LABEL, hyperlink: { url: PLATFORM_URL, tooltip: PLATFORM_HOST } });
  // Mot-symbole « Datanime » (« a » orange) : PNG 96 px, hauteur des capitales 0,12 po
  wordmark(slide, opts.dark, x + 0.36, y + 0.11, 0.12);
  slide.addText(`${opts.date}${opts.source ? ` · ${opts.source}` : ""} · ${PLATFORM_HOST}`, {
    x: x + 0.36,
    y: y + 0.3,
    w: 3.7,
    h: 0.26,
    fontFace: FONT,
    fontSize: 8.5,
    color: opts.dark ? "BFE3EE" : "71717A",
    margin: 0,
    fit: "shrink",
  });
}

export async function buildPptx(story: StoryState, opts: PptxOptions): Promise<Blob | ArrayBuffer | string | Uint8Array> {
  const mod = (await import("pptxgenjs")) as unknown as { default: new () => any };
  const PptxGenJS = mod.default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = PRODUCT_LABEL;
  pptx.company = "alteridea";
  pptx.title = story.title;
  pptx.subject = `${PRODUCT_LABEL} — ${PLATFORM_URL}`;
  const now = opts.now ?? new Date();
  const date = generatedOn(now);
  const snaps = story.snapshots;
  const stagesOf = (s: Snapshot): (NativeSlide | null)[] => {
    const n = opts.native?.get(s.id);
    return n && n.length ? n : [null];
  };
  const total = 2 + snaps.reduce((a, s) => a + stagesOf(s).length, 0);

  /* ---- couverture */
  const cover = pptx.addSlide();
  cover.background = { color: PETROL_DARK };
  cover.addImage({ data: ICON_PNG_2X, x: 0.8, y: 0.7, w: 0.6, h: 0.6, altText: PRODUCT_LABEL });
  wordmark(cover, true, 1.6, 0.88, 0.24);
  cover.addShape("rect", { x: 0.8, y: 2.35, w: 0.9, h: 0.09, fill: { color: PETROL_LIGHT }, line: { color: PETROL_LIGHT } });
  cover.addText(story.title || "Notre histoire en données", { x: 0.8, y: 2.6, w: 11.5, h: 1.5, fontFace: FONT, fontSize: 40, bold: true, color: "FFFFFF", valign: "top", margin: 0, fit: "shrink" });
  const names = [...new Set(snaps.map((s) => s.dataName).filter(Boolean))].slice(0, 3).join(" · ");
  cover.addText(`${snaps.length} graphique${snaps.length > 1 ? "s" : ""}${names ? ` · ${names}` : ""}`, { x: 0.8, y: 4.15, w: 11.5, h: 0.5, fontFace: FONT, fontSize: 18, color: "BFE3EE", margin: 0 });
  cartouche(cover, { dark: true, date });

  /* ---- sommaire */
  const agenda = pptx.addSlide();
  agenda.background = { color: "FFFFFF" };
  agenda.addShape("rect", { x: 0.6, y: 0.55, w: 0.6, h: 0.07, fill: { color: PETROL }, line: { color: PETROL } });
  agenda.addText("Sommaire", { x: 0.6, y: 0.72, w: 11, h: 0.7, fontFace: FONT, fontSize: 30, bold: true, color: "18181B", margin: 0 });
  const perCol = snaps.length > 8 ? Math.ceil(snaps.length / 2) : snaps.length;
  const rowH = Math.min(0.62, 5.2 / Math.max(1, perCol));
  snaps.forEach((s, i) => {
    const col = i < perCol ? 0 : 1;
    const r = i % perCol;
    const x = 0.6 + col * 6.2;
    const y = 1.75 + r * rowH;
    const w = snaps.length > 8 ? 5.9 : 12;
    agenda.addShape("ellipse", { x, y: y + 0.04, w: 0.36, h: 0.36, fill: { color: PETROL }, line: { color: PETROL } });
    agenda.addText(String(i + 1), { x, y: y + 0.04, w: 0.36, h: 0.36, fontFace: FONT, fontSize: 11, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
    agenda.addText(
      [
        { text: `${ROLE_LABELS[s.role].toUpperCase()}  `, options: { fontSize: 9, bold: true, color: PETROL } },
        { text: s.name || s.title, options: { fontSize: snaps.length > 8 ? 12 : 15, color: "27272A" } },
      ],
      { x: x + 0.5, y, w: w - 0.5, h: rowH - 0.04, fontFace: FONT, valign: "middle", margin: 0, fit: "shrink" }
    );
  });
  agenda.addText(`2 / ${total}`, { x: SLIDE_W - 1.3, y: 0.3, w: 0.8, h: 0.3, fontFace: FONT, fontSize: 9, color: "A1A1AA", align: "right", margin: 0 });
  cartouche(agenda, { dark: false, date });

  /* ---- une diapositive par snapshot */
  let page = 2;
  snaps.forEach((s, i) => {
    for (const native of stagesOf(s)) {
      page += 1;
      addSnapshotSlide(pptx, s, { i, n: snaps.length, page, total, storyTitle: story.title, img: opts.images.get(s.id) ?? null, native, link: opts.links?.get(s.id) ?? null, morph: !!opts.morph, bullets: opts.bullets?.get(s.id) ?? null });
    }
  });

  const outputType = opts.outputType ?? "blob";
  if (!opts.morph) return pptx.write({ outputType, compression: true });
  const raw = (await pptx.write({ outputType: "arraybuffer", compression: true })) as ArrayBuffer;
  return addMorphTransitions(raw, outputType, 2);
}

interface SlideCtx {
  i: number;
  n: number;
  page: number;
  total: number;
  storyTitle: string;
  img: SlideImage | null;
  native: NativeSlide | null;
  link: string | null;
  morph: boolean;
  bullets: SlideBullets | null;
}

function addSnapshotSlide(pptx: any, s: Snapshot, c: SlideCtx) {
  const { i, total, storyTitle, native, link, morph } = c;
  const img: SlideImage | null = native ? native.bg : c.img;
  /** Nom Morph (« !! ») des éléments communs aux diapositives : apparier titre, filet, image… */
  const nm = (name: string) => (morph ? { objectName: `!!${name}` } : {});
  const spec = s.spec as ChartSpec;
  let dark = false;
  let bg = "FFFFFF";
  try {
    const th = themeFor(spec);
    dark = th.dark;
    bg = hex(th.bg);
  } catch {
    /* spec ancien : fond clair */
  }
  const text = dark ? "F4F4F5" : "18181B";
  const muted = dark ? "A1A1AA" : "52525B";
  const accent = dark ? PETROL_LIGHT : PETROL;
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  slide.addShape("rect", { x: 0.5, y: 0.42, w: 0.6, h: 0.07, fill: { color: accent }, line: { color: accent }, ...nm("filet") });
  slide.addText(`${ROLE_LABELS[s.role].toUpperCase()} · ${i + 1}/${c.n}`, { x: 1.25, y: 0.3, w: 6, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: accent, charSpacing: 1, margin: 0, ...nm("role") });
  slide.addText(frSpaces(s.title || s.name), { x: 0.5, y: 0.62, w: 12.3, h: 0.95, fontFace: FONT, fontSize: 26, bold: true, color: text, valign: "top", margin: 0, fit: "shrink", ...nm("titre") });
  if (s.subtitle) slide.addText(s.subtitle, { x: 0.5, y: 1.55, w: 12.3, h: 0.4, fontFace: FONT, fontSize: 13, color: muted, margin: 0, fit: "shrink", ...nm("sous-titre") });
  // puces générales (pastille de la couleur principale) puis puces par élément (pastille de leur couleur)
  const comments = [...s.comments.filter((x) => x.trim()).map((text) => ({ text, color: c.bullets?.main ?? null })), ...(c.bullets?.elements ?? []).filter((x) => x.text.trim())];
  // amorce de la séquence de construction : mêmes positions, commentaires à venir
  const showComments = !native || native.stage === "complet";
  const norme = !!(spec as Partial<ChartSpec>)?.norme?.enabled;
  const area = { x: 0.5, y: 2.1, w: comments.length ? 8.2 : 12.3, h: norme ? 4.4 : 4.75 };
  if (norme) {
    // Légende de notation (mode norme) : scénarios et écarts, au-dessus du pied de page
    const ink = dark ? { ac: "E4E4E7", py: "6B6B73" } : { ac: "2B2B2E", py: "B8B8BD" };
    const o = (color: string, bold = false) => ({ fontFace: FONT, fontSize: 9.5, color, bold });
    slide.addText(
      [
        { text: "Notation inspirée d’IBCS® : ", options: o(muted, true) },
        { text: "■ ", options: o(ink.ac) },
        { text: "Réel (AC)   ", options: o(muted) },
        { text: "■ ", options: o(ink.py) },
        { text: "N-1 (PY)   ", options: o(muted) },
        { text: "□ ", options: o(ink.ac) },
        { text: "Budget (PL)   ", options: o(muted) },
        { text: "▨ ", options: o(ink.ac) },
        { text: "Prévision (FC)   ·   écarts : ", options: o(muted) },
        { text: "■ ", options: o("2E9E4F") },
        { text: "favorable  ", options: o(muted) },
        { text: "■ ", options: o("D62839") },
        { text: "défavorable  ", options: o(muted) },
        { text: "●— ", options: o(muted) },
        { text: "écart en %", options: o(muted) },
      ],
      { x: 0.5, y: 6.6, w: 12.3, h: 0.3, margin: 0, valign: "middle", fit: "shrink" }
    );
  }
  if (img) {
    const k = Math.min(area.w / img.width, area.h / img.height);
    const w = img.width * k;
    const h = img.height * k;
    const x0 = area.x + (comments.length ? 0 : (area.w - w) / 2);
    const y0 = area.y;
    slide.addImage({ data: img.data, x: x0, y: y0, w, h, altText: s.title, ...(link ? { hyperlink: { url: link, tooltip: "Ouvrir ce graphique en mode lecture" } } : {}), ...nm("graphique") });
    // barres natives (Morph) : mêmes positions que dans le rendu SVG
    for (const m of native?.marks ?? []) {
      const tr = Math.round((1 - Math.max(0, Math.min(1, m.opacity))) * 100);
      slide.addShape((m.shape ?? "rect") as "rect", {
        ...(m.angles ? { angleRange: m.angles } : {}),
        ...(m.thickness != null ? { arcThicknessRatio: m.thickness } : {}),
        x: x0 + m.x * w,
        y: y0 + m.y * h,
        w: Math.max(0.002, m.w * w),
        h: Math.max(0.002, m.h * h),
        fill: m.fill ? { color: hex(m.fill), transparency: tr } : { type: "none" },
        line: m.stroke ? { color: hex(m.stroke), width: m.lineWidth ?? 1, dashType: m.dash ? "dash" : "solid", transparency: tr } : { type: "none" },
        objectName: m.name,
      });
    }
  } else {
    slide.addText("Graphique indisponible (rendu non conservé)", { ...area, fontFace: FONT, fontSize: 14, color: muted, align: "center", valign: "middle" });
  }
  if (comments.length && showComments) {
    slide.addText("À RETENIR", { x: 9.0, y: 2.1, w: 3.8, h: 0.35, fontFace: FONT, fontSize: 11, bold: true, color: accent, charSpacing: 1.5, margin: 0, ...nm("a-retenir") });
    slide.addText(
      comments.flatMap((x): { text: string; options: Record<string, unknown> }[] =>
        x.color
          ? [
              // pastille colorée (carré plein) : pptxgenjs ne colore pas les puces natives
              { text: "\u25A0\u2002", options: { color: hex(x.color), fontSize: 13 } },
              { text: frSpaces(x.text), options: { breakLine: true, paraSpaceAfter: 10 } },
            ]
          : [{ text: frSpaces(x.text), options: { bullet: { indent: 14 }, paraSpaceAfter: 10 } }]
      ),
      { x: 9.0, y: 2.5, w: 3.85, h: norme ? 4.0 : 4.3, fontFace: FONT, fontSize: comments.length > 4 ? 13 : 15, color: text, valign: "top", margin: 0, fit: "shrink", ...nm("commentaires") }
    );
  }
  slide.addShape("line", { x: 0.5, y: 7.0, w: 12.33, h: 0, line: { color: dark ? "3F3F46" : "E4E4E7", width: 0.75 }, ...nm("pied") });
  const prov = (spec as Partial<ChartSpec>)?.provenance as Provenance | null | undefined;
  const titleW = (prov ? 6.4 : 8) - (link ? 1.75 : 0);
  slide.addText(storyTitle, { x: 0.5, y: 7.05, w: titleW, h: 0.3, fontFace: FONT, fontSize: 9, color: muted, margin: 0, fit: "shrink" });
  if (link) slide.addText("Mode lecture ›", { x: 0.5 + titleW + 0.1, y: 7.05, w: 1.6, h: 0.3, fontFace: FONT, fontSize: 9, bold: true, color: accent, margin: 0, hyperlink: { url: link, tooltip: "Ouvrir ce graphique en mode lecture (QR du cartouche)" } });
  if (prov && /^[0-9a-f]{64}$/.test(prov.hash ?? "")) {
    // Lien natif « Vérifier l'empreinte » (le QR figure aussi dans le cartouche de l'image)
    const gen = new Date(s.generatedAt || s.createdAt || Date.now());
    const url = verifyUrl(verifyInfoFor(prov, Number.isFinite(gen.getTime()) ? gen : new Date()));
    slide.addText(`Vérifier l'empreinte des données · ${shortFingerprint(prov.hash)}`, { x: 7.0, y: 7.05, w: 3.8, h: 0.3, fontFace: FONT, fontSize: 9, color: muted, align: "right", margin: 0, hyperlink: { url, tooltip: "Vérifier l'empreinte des données" } });
  }
  // Pied : logo Datanime (PNG 2×) + nom (lien plateforme), puis numéro de page aligné à droite
  slide.addImage({ data: ICON_PNG_2X, x: SLIDE_W - 2.42, y: 7.07, w: 0.22, h: 0.22, altText: PRODUCT_LABEL, hyperlink: { url: PLATFORM_URL, tooltip: PLATFORM_HOST } });
  wordmark(slide, dark, SLIDE_W - 2.14, 7.14, 0.1);
  slide.addText(`${c.page} / ${total}`, { x: SLIDE_W - 1.2, y: 7.05, w: 0.7, h: 0.3, fontFace: FONT, fontSize: 9, color: muted, align: "right", margin: 0 });
}
