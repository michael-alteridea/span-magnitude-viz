/**
 * Mode « Reel » : plan d'un mini-film pour les réseaux sociaux (module pur, sans DOM).
 *
 * - Formats : 9:16 (1080 × 1920), 1:1 (1080 × 1080), 16:9 (1920 × 1080), avec zones de sécurité
 *   (interface Instagram / TikTok : barre du haut, colonne d'icônes à droite, légende en bas).
 * - Scènes : un snapshot = un titre court (éditable), un chiffre clé qui compte, le graphique re-rendu pour
 *   le cadre, un cartouche ; carte de fin (mot-symbole, accroche, lien, QR) obligatoire en offre gratuite.
 * - Durées : calculées d'après le contenu (lecture du titre, construction du graphique), ajustables,
 *   total entre 15 et 30 s.
 */

export type ReelFormatKey = "9x16" | "1x1" | "16x9";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReelFormat {
  key: ReelFormatKey;
  label: string;
  hint: string;
  w: number;
  h: number;
  /** Zone de sécurité : rien d'important en dehors. */
  safe: Box;
}

export const REEL_FORMATS: Record<ReelFormatKey, ReelFormat> = {
  "9x16": { key: "9x16", label: "Vertical 9:16", hint: "Reels, TikTok, Shorts · 1080 × 1920", w: 1080, h: 1920, safe: { x: 72, y: 220, w: 858, h: 1300 } },
  "1x1": { key: "1x1", label: "Carré 1:1", hint: "LinkedIn, fil Instagram · 1080 × 1080", w: 1080, h: 1080, safe: { x: 64, y: 64, w: 952, h: 952 } },
  "16x9": { key: "16x9", label: "Paysage 16:9", hint: "LinkedIn, YouTube, écran · 1920 × 1080", w: 1920, h: 1080, safe: { x: 96, y: 72, w: 1728, h: 936 } },
};

export const REEL_FPS = 30;
export const REEL_MIN_S = 15;
export const REEL_MAX_S = 30;
export const REEL_MIN_SCENES = 3;
export const REEL_MAX_SCENES = 5;
export const SCENE_MIN_S = 2.5;
export const SCENE_MAX_S = 8;
export const END_CARD_S = 3;

/** Animation d'une scène (secondes depuis son début). */
export const T = {
  textIn: 0.45,
  numberFrom: 0.3,
  numberTo: 1.5,
  chartFrom: 0.45,
  chartTo: 2.0,
  fadeOut: 0.3,
  /** Transition « zoom dans la marque » (exploration parent → enfant), fin de la scène parente / début de l'enfant. */
  dive: 0.5,
  emerge: 0.5,
} as const;

/* ------------------------------------------------------------------ chiffre clé */

export interface KeyNumber {
  /** Texte affiché à la fin (« 59 % », « 4 sur 6 », « −2,1 M€ »). */
  text: string;
  /** Valeur numérique qui compte (première du texte). */
  value: number;
  decimals: number;
  /** Signe « + » explicite (écart favorable). */
  plus: boolean;
  /** Texte avant / après le nombre qui compte. */
  prefix: string;
  suffix: string;
}

const NUM = String.raw`[+\-−]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:,\d+)?|[+\-−]?\d+(?:,\d+)?`;
const UNIT = String.raw`(?:[ \u00a0\u202f]?(?:%|pts?\b|points?\b|Md€|M€|k€|€|Md\$|M\$|k\$|\$|Mds?\b|millions?\b|milliards?\b|fois\b))`;
const TOKEN = new RegExp(String.raw`(×[ \u00a0]?)?(${NUM})(${UNIT})?(?:[ \u00a0]sur[ \u00a0](\d+))?`, "g");

/** Analyse un chiffre clé saisi (« 59 % », « ×10 », « 4 sur 6 ») ; null s'il n'y a pas de nombre. */
export function parseKeyNumber(text: string): KeyNumber | null {
  const t = text.trim();
  if (!t) return null;
  TOKEN.lastIndex = 0;
  const m = TOKEN.exec(t);
  if (!m) return null;
  const raw = m[2]!;
  const neg = /^[\-−]/.test(raw);
  const digits = raw.replace(/^[+\-−]/, "").replace(/[ \u00a0\u202f]/g, "");
  const value = Number(digits.replace(",", ".")) * (neg ? -1 : 1);
  if (!Number.isFinite(value)) return null;
  const decimals = digits.includes(",") ? digits.split(",")[1]!.length : 0;
  const start = m.index + (m[1]?.length ?? 0);
  return { text: t, value, decimals, plus: raw.startsWith("+"), prefix: t.slice(0, start), suffix: t.slice(start + raw.length) };
}

/**
 * Chiffre clé d'un titre (ou des commentaires) : un nombre avec unité de préférence (« 59 % », « 412 k€ »),
 * sinon « N sur M » ; les années seules (2026) et les numéros de trimestre ne comptent pas.
 */
export function extractKeyNumber(...texts: string[]): string | null {
  let fallback: string | null = null;
  for (const text of texts) {
    if (!text) continue;
    TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 1), m.index);
      if (/[A-Za-zÀ-ÿ]/.test(before)) continue; // « T3 », « S2 »
      const raw = m[2]!;
      const plain = raw.replace(/[ \u00a0\u202f]/g, "");
      const unit = (m[3] ?? "").trim();
      if (!unit && !m[1] && !m[4] && /^\d{4}$/.test(plain) && +plain >= 1900 && +plain <= 2100) continue;
      const tok = m[0].trim().replace(/[ \u202f]/g, "\u00a0");
      if (unit || m[1]) return tok;
      if (m[4] && !fallback) fallback = tok;
    }
    // « 4 commerciaux sur 6 » → « 4 sur 6 »
    const so = /(?:^|[^\d,])(\d+)[ \u00a0]+(?:[A-Za-zÀ-ÿ'’-]+[ \u00a0]+){0,2}sur[ \u00a0]+(\d+)\b/.exec(text);
    if (so && !fallback) fallback = `${so[1]}\u00a0sur\u00a0${so[2]}`;
  }
  return fallback;
}

/** Texte du chiffre clé à la progression p ∈ [0, 1] (compte à partir de 0, format français, décimales d'origine). */
export function countUpText(k: KeyNumber, p: number): string {
  const e = 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 3);
  const v = k.value * e;
  if (p >= 1) return k.text;
  const abs = Math.abs(v);
  const fixed = abs.toFixed(k.decimals);
  const [int, dec] = fixed.split(".");
  const grouped = int!.length > 3 ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") : int!;
  const sign = v < 0 && +fixed !== 0 ? "−" : k.plus ? "+" : "";
  const num = sign + grouped + (dec ? `,${dec}` : "");
  return k.prefix + num + k.suffix;
}

/* ------------------------------------------------------------------ titres */

/** Titre court d'une scène : première proposition du titre, sinon coupé sur un mot (≤ max caractères). */
export function shortTitle(title: string, max = 56): string {
  const t = title.replace(/\s+/g, " ").trim().replace(/[.。]$/, "");
  if (t.length <= max) return t;
  for (const sep of [" : ", " — ", " – ", " ; ", ", "]) {
    const i = t.indexOf(sep);
    if (i >= 16 && i <= max) return t.slice(0, i).trim();
  }
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:–—-]+$/, "") + "…";
}

/* ------------------------------------------------------------------ durées */

export interface SceneTextInput {
  title: string;
  number: string | null;
  caption: string;
  /** Nombre approximatif de marques (barres, points…) : un graphique chargé reste un peu plus longtemps. */
  marks?: number;
}

/** Durée automatique d'une scène (s) : construction du graphique + temps de lecture. */
export function autoSceneDuration(s: SceneTextInput): number {
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  // construction du graphique (~2 s) + lecture du titre (≈ 4,5 mots / s) + survol de la légende + chiffre clé
  const d = 2.4 + words(s.title) * 0.22 + words(s.caption) * 0.08 + (s.number ? 0.4 : 0) + Math.min(0.8, (s.marks ?? 6) / 20);
  return round1(Math.max(3.5, Math.min(7, d)));
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Ajuste des durées de scène pour que le total (carte de fin comprise) reste entre 15 et 30 s. */
export function fitDurations(durs: number[], endS = END_CARD_S, min = REEL_MIN_S, max = REEL_MAX_S): number[] {
  if (!durs.length) return [];
  const sum = durs.reduce((a, b) => a + b, 0);
  const total = sum + endS;
  let k = 1;
  if (total < min) k = (min - endS) / sum;
  else if (total > max) k = (max - endS) / sum;
  let out = durs.map((d) => Math.max(SCENE_MIN_S, Math.min(SCENE_MAX_S, d * k)));
  // arrondi au dixième, puis correction du dernier pour tomber dans les bornes
  out = out.map(round1);
  const t = out.reduce((a, b) => a + b, 0) + endS;
  if (t < min) out[out.length - 1] = round1(out[out.length - 1]! + (min - t));
  if (t > max) out[out.length - 1] = round1(Math.max(SCENE_MIN_S, out[out.length - 1]! - (t - max)));
  return out;
}

/* ------------------------------------------------------------------ plan */

export type DrillLink = "in" | "out" | null;

export interface ReelScene {
  /** Identifiant du snapshot d'origine. */
  id: string;
  kicker: string;
  title: string;
  /** Chiffre clé affiché (texte libre) ; null : pas de chiffre. */
  number: string | null;
  caption: string;
  duration: number;
  /** Lien d'exploration avec la scène précédente (zoom dans la marque). */
  linkIn: DrillLink;
  /** Lien d'exploration avec la scène suivante. */
  linkOut: DrillLink;
}

export interface ReelPlan {
  format: ReelFormatKey;
  fps: number;
  scenes: ReelScene[];
  endDuration: number;
  /** Source et licence des données (cartouche). */
  source: string;
  licence: string;
  /** Date de génération (cartouche). */
  generatedAt: string;
}

export function totalDuration(p: Pick<ReelPlan, "scenes" | "endDuration">): number {
  return round1(p.scenes.reduce((a, s) => a + s.duration, 0) + p.endDuration);
}

export function frameCount(p: Pick<ReelPlan, "scenes" | "endDuration" | "fps">): number {
  return Math.round(totalDuration(p) * p.fps);
}

export type Locate = { kind: "scene"; index: number; t: number; dur: number } | { kind: "end"; t: number; dur: number };

/** Scène affichée à l'instant t (s). */
export function locate(p: Pick<ReelPlan, "scenes" | "endDuration">, t: number): Locate {
  let start = 0;
  for (let i = 0; i < p.scenes.length; i++) {
    const d = p.scenes[i]!.duration;
    if (t < start + d) return { kind: "scene", index: i, t: Math.max(0, t - start), dur: d };
    start += d;
  }
  return { kind: "end", t: Math.max(0, Math.min(p.endDuration, t - start)), dur: p.endDuration };
}

/** Début de chaque scène (s). */
export function sceneStarts(p: Pick<ReelPlan, "scenes">): number[] {
  const out: number[] = [];
  let s = 0;
  for (const sc of p.scenes) {
    out.push(s);
    s += sc.duration;
  }
  return out;
}

/** Problèmes bloquants avant l'export (messages en français). */
export function reelProblems(p: ReelPlan): string[] {
  const out: string[] = [];
  if (!p.scenes.length) out.push("Choisissez au moins un snapshot.");
  if (p.scenes.length > REEL_MAX_SCENES) out.push(`Un Reel raconte ${REEL_MAX_SCENES} snapshots au plus : décochez-en ${p.scenes.length - REEL_MAX_SCENES}.`);
  if (!p.source.trim()) out.push("Indiquez la source des données : elle figure dans le cartouche de chaque scène.");
  if (!p.licence.trim()) out.push("Indiquez la licence des données (par exemple « CC BY 4.0 » ou « Données internes »).");
  const tot = totalDuration(p);
  if (tot < REEL_MIN_S - 0.05 || tot > REEL_MAX_S + 0.05) out.push(`Durée totale ${fmtS(tot)} : elle doit rester entre ${REEL_MIN_S} et ${REEL_MAX_S} s.`);
  for (const [i, s] of p.scenes.entries()) if (!s.title.trim()) out.push(`Scène ${i + 1} : titre vide.`);
  return out;
}

/** « 21,5 s ». */
export function fmtS(v: number): string {
  return `${(Math.round(v * 10) / 10).toString().replace(".", ",")}\u00a0s`;
}

/* ------------------------------------------------------------------ mise en page */

export interface SceneLayout {
  kicker: { x: number; y: number; fs: number };
  title: { x: number; y: number; w: number; fs: number; lh: number; maxLines: number };
  number: { x: number; y: number; fs: number } | null;
  caption: { x: number; y: number; w: number; fs: number; lh: number; maxLines: number } | null;
  chart: Box;
  cartouche: Box;
  /** Échelle des textes du graphique (police d'axe ≈ 13 × s px dans le cadre). */
  chartTextPx: number;
}

/** Hauteur réservée au cartouche (bas droite de la zone de sécurité). */
export function cartoucheBox(f: ReelFormat): Box {
  const h = f.key === "9x16" ? 140 : f.key === "1x1" ? 108 : 112;
  const w = f.key === "9x16" ? 580 : f.key === "1x1" ? 480 : 520;
  return { x: f.safe.x + f.safe.w - w, y: f.safe.y + f.safe.h - h, w, h };
}

/**
 * Mise en page d'une scène pour un format, selon le nombre de lignes du titre et de la légende du chiffre.
 * Tout reste dans la zone de sécurité ; le graphique prend la place restante.
 */
export function sceneLayout(fk: ReelFormatKey, titleLines: number, hasNumber: boolean, captionLines: number): SceneLayout {
  const f = REEL_FORMATS[fk];
  const s = f.safe;
  const cart = cartoucheBox(f);
  if (fk === "16x9") {
    const colW = 680;
    const kicker = { x: s.x, y: s.y + 44, fs: 26 };
    const title = { x: s.x, y: kicker.y + 40, w: colW, fs: 70, lh: 1.08, maxLines: 4 };
    let y = title.y + Math.max(1, titleLines) * title.fs * title.lh;
    let number: SceneLayout["number"] = null;
    if (hasNumber) {
      number = { x: s.x, y: y + 40 + 150 * 0.74, fs: 150 };
      y = number.y + 34;
    }
    const caption = captionLines ? { x: s.x, y: y + 30, w: colW, fs: 30, lh: 1.3, maxLines: 3 } : null;
    const cx = s.x + colW + 70;
    const chart = { x: cx, y: s.y + 10, w: s.x + s.w - cx, h: cart.y - 24 - (s.y + 10) };
    return { kicker, title, number, caption, chart, cartouche: cart, chartTextPx: 23 };
  }
  const sq = fk === "1x1";
  const kicker = { x: s.x, y: s.y + (sq ? 30 : 34), fs: sq ? 24 : 30 };
  const title = { x: s.x, y: kicker.y + (sq ? 30 : 40), w: s.w, fs: sq ? 58 : 80, lh: 1.1, maxLines: sq ? 2 : 3 };
  let y = title.y + Math.max(1, titleLines) * title.fs * title.lh;
  let number: SceneLayout["number"] = null;
  let caption: SceneLayout["caption"] = null;
  if (sq) {
    // carré : chiffre et légende sur une même rangée
    if (hasNumber) {
      number = { x: s.x, y: y + 18 + 96 * 0.74, fs: 96 };
      if (captionLines) caption = { x: s.x, y: number.y + 16 + 26 * 0.8, w: s.w, fs: 26, lh: 1.28, maxLines: 2 };
      y = (caption ? caption.y + (Math.min(2, captionLines) - 1) * 26 * 1.28 + 10 : number.y + 14);
    } else if (captionLines) {
      caption = { x: s.x, y: y + 12 + 26 * 0.8, w: s.w, fs: 26, lh: 1.28, maxLines: 2 };
      y = caption.y + (Math.min(2, captionLines) - 1) * 26 * 1.28 + 10;
    }
    const top = y + 20;
    const chart = { x: s.x - 8, y: top, w: s.w + 16, h: cart.y - 16 - top };
    return { kicker, title, number, caption, chart, cartouche: cart, chartTextPx: 21 };
  }
  if (hasNumber) {
    number = { x: s.x, y: y + 30 + 168 * 0.74, fs: 168 };
    y = number.y + 18;
  }
  if (captionLines) {
    caption = { x: s.x, y: y + 16 + 34 * 0.8, w: s.w, fs: 34, lh: 1.28, maxLines: 2 };
    y = caption.y + (Math.min(2, captionLines) - 1) * 34 * 1.28 + 12;
  }
  const top = y + 36;
  const chart = { x: s.x - 12, y: top, w: s.w + 24, h: cart.y - 24 - top };
  return { kicker, title, number, caption, chart, cartouche: cart, chartTextPx: 25 };
}
