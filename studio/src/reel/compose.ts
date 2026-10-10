/**
 * Mode « Reel » : composition d'une image (SVG autonome) à l'instant t — fond, titre court, chiffre clé qui compte,
 * graphique de la scène (fourni par `ChartFrame`), cartouche (logo, date de génération, source, licence, QR) et
 * carte de fin (mot-symbole, accroche, lien, QR). Aucune horloge : tout est fonction de t (rendu déterministe,
 * identique dans l'aperçu et dans la vidéo).
 */
import { stripLicence } from "../data/licence";
import { DISCOVER_URL, PLATFORM_HOST, PLATFORM_URL, tell4dIconMarkup, wordmarkMarkup, WORDMARK_RATIO } from "../brand";
import { qrMatrix, qrPath } from "../qr";
import { measure, wrap, ellipsize } from "../charts/text";
import { countUpText, locate, parseKeyNumber, REEL_FORMATS, sceneLayout, timingsFor, type KeyNumber, type ReelLinks, type ReelPlan, type SceneLayout } from "./plan";

export const REEL_TITLE_FONT = "'R4D Poppins', 'R4D Inter', system-ui, sans-serif";
export const REEL_TEXT_FONT = "'R4D Inter', system-ui, sans-serif";
export const REEL_TAGLINE = "Vos données. Racontées.";
export const REEL_COLORS = { bg0: "#0a2b36", bg1: "#04141a", text: "#f4f7f8", muted: "#a9bec6", accent: "#3FA7C4", petrol: "#0E6E8C", line: "rgba(255,255,255,0.14)" } as const;

/** Graphique d'une scène à l'instant local t (s) : SVG imbriqué (balisage complet `<svg …>…</svg>`). */
export type ChartFrame = (index: number, t: number, dur: number, box: { w: number; h: number; textPx: number }) => string;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** Liens par défaut (sans projet d'exemple) : page du Studio, ligne de présentation de la plateforme. */
export const DEFAULT_REEL_LINKS: ReelLinks = {
  qr: PLATFORM_URL,
  label: [PLATFORM_HOST],
  cta: "Scannez pour essayer",
  pitch: `Découvrir Datanime : ${DISCOVER_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")}`,
  pitchUrl: DISCOVER_URL,
};
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** Espaces insécables entre un nombre et son unité (« −0,4 M€ » ne se coupe jamais). */
export function glueUnits(t: string): string {
  return t.replace(/(\d)[ \u202f](?=(?:%|pts?\b|points?\b|Md€|M€|k€|€|Md\$|M\$|k\$|\$|fois\b))/g, "$1\u00a0").replace(/([×−+]) (?=\d)/g, "$1\u00a0");
}

/** Coupure équilibrée : plus petite largeur qui garde le même nombre de lignes (pas de mot orphelin). */
export function balancedWrap(t: string, w: number, fs: number, font: string, wt: number, maxL: number): string[] {
  const ref = wrap(t, w, fs, font, wt, maxL);
  if (ref.length < 2 || ref[ref.length - 1]!.endsWith("…")) return ref;
  let lo = w * 0.4;
  let hi = w;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const l = wrap(t, mid, fs, font, wt, maxL);
    if (l.length === ref.length && l.join(" ") === ref.join(" ")) hi = mid;
    else lo = mid;
  }
  return wrap(t, hi, fs, font, wt, maxL);
}

interface SceneText {
  lay: SceneLayout;
  kicker: string;
  title: string[];
  caption: string[];
  number: KeyNumber | null;
}

export interface ComposeOptions {
  /** CSS @font-face (polices en base64) — obligatoire pour la vidéo (une image SVG ne charge rien). */
  fontCss: string;
  chart: ChartFrame;
}

export class ReelComposer {
  private texts = new Map<number, SceneText>();
  private qrD: { d: string; n: number } | null = null;

  constructor(
    private plan: ReelPlan,
    private o: ComposeOptions
  ) {}

  get width(): number {
    return REEL_FORMATS[this.plan.format].w;
  }

  get height(): number {
    return REEL_FORMATS[this.plan.format].h;
  }

  /** Mise en page (lignes de titre, chiffre, légende) d'une scène ; calculée une fois. */
  sceneText(i: number): SceneText {
    const hit = this.texts.get(i);
    if (hit) return hit;
    const sc = this.plan.scenes[i]!;
    const fk = this.plan.format;
    // première passe pour connaître les largeurs, puis lignes définitives
    const probe = sceneLayout(fk, 1, !!sc.number, sc.caption ? 1 : 0);
    const title = balancedWrap(glueUnits(sc.title), probe.title.w, probe.title.fs, REEL_TITLE_FONT, 800, probe.title.maxLines);
    const capW = probe.caption?.w ?? probe.title.w;
    const capFs = probe.caption?.fs ?? 30;
    const caption = sc.caption ? wrap(glueUnits(sc.caption), capW, capFs, REEL_TEXT_FONT, 400, probe.caption?.maxLines ?? 2) : [];
    const lay = sceneLayout(fk, title.length, !!sc.number, caption.length);
    const kicker = ellipsize(sc.kicker.toUpperCase(), lay.title.w, lay.kicker.fs, REEL_TEXT_FONT, 700);
    const st: SceneText = { lay, kicker, title, caption, number: sc.number ? parseKeyNumber(sc.number) ?? { text: sc.number, value: NaN, decimals: 0, plus: false, prefix: sc.number, suffix: "" } : null };
    this.texts.set(i, st);
    return st;
  }

  /** Image complète à l'instant t (s). */
  frameSvg(t: number): string {
    const f = REEL_FORMATS[this.plan.format];
    const at = locate(this.plan, t);
    const body = at.kind === "end" ? this.endCard(at.t) : this.scene(at.index, at.t, at.dur);
    const css = `${this.o.fontCss}\ntext{font-family:${REEL_TEXT_FONT};}`;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}" data-reel-t="${f2(t)}">` +
      `<defs><style type="text/css">${css}</style>` +
      `<radialGradient id="reel-bg" cx="30%" cy="18%" r="95%"><stop offset="0" stop-color="${REEL_COLORS.bg0}"/><stop offset="1" stop-color="${REEL_COLORS.bg1}"/></radialGradient></defs>` +
      `<rect class="reel-bg" width="${f.w}" height="${f.h}" fill="url(#reel-bg)"/>` +
      body +
      `</svg>`
    );
  }

  private scene(i: number, t: number, dur: number): string {
    const sc = this.plan.scenes[i]!;
    const st = this.sceneText(i);
    const { lay } = st;
    // textes : entrée (montée + fondu), sortie (fondu) ; la première scène entre aussi depuis le noir
    const T = timingsFor(this.plan.rhythm);
    const tin = easeOut(t / T.textIn);
    const tout = 1 - clamp01((t - (dur - T.fadeOut)) / T.fadeOut);
    const textA = Math.min(tin, tout);
    const rise = (1 - tin) * 26;
    // graphique : fondu entrant / sortant, sauf liaison d'exploration (le zoom fait la transition)
    const chartIn = sc.linkIn ? 1 : clamp01(t / T.chartFade);
    const chartOut = sc.linkOut ? 1 : tout;
    let out = `<g class="reel-scene" data-scene="${i}">`;
    out += `<g class="reel-texts" opacity="${f2(textA)}" transform="translate(0 ${f2(rise)})">`;
    out += `<text class="reel-kicker" x="${lay.kicker.x}" y="${lay.kicker.y}" font-size="${lay.kicker.fs}" font-weight="700" letter-spacing="${f2(lay.kicker.fs * 0.12)}" fill="${REEL_COLORS.accent}">${esc(st.kicker)}</text>`;
    // filet d'accent au-dessus du titre (signature Datanime)
    st.title.forEach((l, k) => {
      out += `<text class="reel-title" x="${lay.title.x}" y="${f2(lay.title.y + lay.title.fs * 0.8 + k * lay.title.fs * lay.title.lh)}" font-family="${REEL_TITLE_FONT}" font-size="${lay.title.fs}" font-weight="800" letter-spacing="-0.5" fill="${REEL_COLORS.text}">${esc(l)}</text>`;
    });
    if (lay.number && st.number) {
      const p = clamp01((t - T.numberFrom) / (T.numberTo - T.numberFrom));
      const txt = Number.isFinite(st.number.value) ? countUpText(st.number, p) : st.number.text;
      const nA = clamp01((t - T.numberFrom + 0.1) / 0.2);
      out += `<text class="reel-number" x="${lay.number.x}" y="${f2(lay.number.y)}" font-family="${REEL_TITLE_FONT}" font-size="${lay.number.fs}" font-weight="800" letter-spacing="-2" fill="${REEL_COLORS.accent}" opacity="${f2(nA)}">${esc(txt)}</text>`;
    }
    if (lay.caption)
      st.caption.forEach((l, k) => {
        out += `<text class="reel-caption" x="${lay.caption!.x}" y="${f2(lay.caption!.y + k * lay.caption!.fs * lay.caption!.lh)}" font-size="${lay.caption!.fs}" fill="${REEL_COLORS.muted}">${esc(l)}</text>`;
      });
    out += `</g>`;
    const c = lay.chart;
    const chart = this.o.chart(i, t, dur, { w: c.w, h: c.h, textPx: lay.chartTextPx });
    out += `<g class="reel-chart" opacity="${f2(Math.min(chartIn, chartOut))}" transform="translate(${f2(c.x)} ${f2(c.y)})">${chart}</g>`;
    out += `</g>`;
    // cartouche : présent sur toutes les scènes (fondu à la première)
    const cartA = i === 0 ? clamp01(t / 0.6) : 1;
    out += this.cartouche(lay, cartA);
    return out;
  }

  private qr(): { d: string; n: number } {
    if (!this.qrD) {
      const m = qrMatrix(this.links.qr);
      this.qrD = { d: qrPath(m), n: m.size };
    }
    return this.qrD;
  }

  /** QR (fond blanc, marge de silence) en (x, y), côté `size`. */
  private qrMarkup(x: number, y: number, size: number, cls: string): string {
    const q = this.qr();
    const quiet = 2;
    const k = size / (q.n + quiet * 2);
    return `<g class="${cls}" data-qr="${esc(this.links.qr)}"><rect x="${f2(x)}" y="${f2(y)}" width="${f2(size)}" height="${f2(size)}" rx="${f2(size * 0.06)}" fill="#ffffff"/><path transform="translate(${f2(x + quiet * k)} ${f2(y + quiet * k)}) scale(${(k).toFixed(4)})" d="${q.d}" fill="#0b0b0c"/></g>`;
  }

  private cartouche(lay: SceneLayout, a: number): string {
    const b = lay.cartouche;
    const pad = 14;
    const qs = b.h - pad * 2;
    const tx = b.x + pad;
    const tw = b.w - pad * 3 - qs;
    const fs = this.plan.format === "9x16" ? 20 : 16;
    const lh = fs * 1.32;
    const logo = fs * 1.9;
    const wmH = fs * 1.15;
    let out = `<g class="reel-cartouche" opacity="${f2(a)}">`;
    out += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="rgba(4,20,26,0.72)" stroke="${REEL_COLORS.line}" stroke-width="1.5"/>`;
    // Ligne de licence propre : retirée de la source quand elle y figure déjà (« … · Licence : CC BY 4.0 »)
    const source = this.plan.licence ? stripLicence(this.plan.source) : this.plan.source;
    const lines = [this.plan.generatedAt, source, this.plan.licence ? `Licence des données : ${this.plan.licence}` : ""].filter(Boolean);
    const blockH = logo + 6 + lines.length * lh;
    let y = b.y + (b.h - blockH) / 2;
    const icon = tell4dIconMarkup(`reel-ic`, Math.round(logo), 'aria-hidden="true"').replace(/^<svg/, `<svg x="${f2(tx)}" y="${f2(y)}"`);
    out += icon;
    const wm = wordmarkMarkup("dark", wmH, "reel-wordmark").replace(/^<svg/, `<svg x="${f2(tx + logo + 8)}" y="${f2(y + (logo - wmH) / 2)}"`);
    out += wm;
    y += logo + 6;
    for (const l of lines) {
      y += lh;
      out += `<text class="reel-cart-line" x="${f2(tx)}" y="${f2(y - lh * 0.28)}" font-size="${fs}" fill="${REEL_COLORS.muted}">${esc(ellipsize(l, tw, fs, REEL_TEXT_FONT))}</text>`;
    }
    out += this.qrMarkup(b.x + b.w - pad - qs, b.y + pad, qs, "reel-cart-qr");
    out += `</g>`;
    return out;
  }

  /** Liens du QR et de la carte de fin (film du projet d'exemple, sinon Studio). */
  private get links(): ReelLinks {
    return this.plan.links ?? DEFAULT_REEL_LINKS;
  }

  /** Lien visible (une ou deux lignes) ajusté à la largeur `w` ; renvoie le balisage et la hauteur occupée. */
  private linkLines(x: number, y: number, w: number, fs: number, anchor: "start" | "middle"): { svg: string; h: number } {
    const L = this.links.label;
    const one = L.join("");
    // une seule ligne si elle tient, sinon les deux morceaux (adresse, puis paramètres), taille réduite au besoin
    const lines = measure(one, fs, REEL_TEXT_FONT, 700) <= w ? [one] : L;
    const widest = Math.max(...lines.map((l) => measure(l, fs, REEL_TEXT_FONT, 700)));
    const k = Math.max(0.6, Math.min(1, w / widest));
    const f = Math.round(fs * k);
    let svg = "";
    lines.forEach((l, i) => (svg += `<text class="reel-link" x="${f2(x)}" y="${f2(y + i * f * 1.2)}" text-anchor="${anchor}" font-size="${f}" font-weight="700" fill="${REEL_COLORS.accent}">${esc(l)}</text>`));
    return { svg, h: (lines.length - 1) * f * 1.2 };
  }

  /** Ligne « commerciale » (présentation de la plateforme), discrète. */
  private pitchLine(x: number, y: number, w: number, fs: number, anchor: "start" | "middle"): string {
    const f = Math.round(fs * Math.max(0.75, Math.min(1, w / measure(this.links.pitch, fs, REEL_TEXT_FONT))));
    const t = ellipsize(this.links.pitch, w, f, REEL_TEXT_FONT);
    return `<text class="reel-pitch" data-href="${esc(this.links.pitchUrl)}" x="${f2(x)}" y="${f2(y)}" text-anchor="${anchor}" font-size="${f}" fill="${REEL_COLORS.muted}" opacity="0.9">${esc(t)}</text>`;
  }

  private endCard(t: number): string {
    const f = REEL_FORMATS[this.plan.format];
    const s = f.safe;
    const wide = this.plan.format === "16x9";
    const sq = this.plan.format === "1x1";
    const a1 = easeOut(t / 0.5);
    const a2 = easeOut((t - 0.25) / 0.5);
    const a3 = easeOut((t - 0.5) / 0.5);
    const cx = s.x + s.w / 2;
    const wmH = wide ? 92 : sq ? 84 : 104;
    const wmW = wmH * WORDMARK_RATIO;
    const icon = wmH * 1.55;
    const tagFs = wide ? 64 : sq ? 56 : 74;
    const qr = wide ? 300 : sq ? 270 : 360;
    let out = `<g class="reel-end" data-end="1">`;
    if (wide) {
      // paysage : marque et accroche à gauche, QR à droite
      const lx = s.x + 60;
      const cy = s.y + s.h / 2;
      const by = cy - 150;
      out += `<g opacity="${f2(a1)}" transform="translate(0 ${f2((1 - a1) * 20)})">`;
      out += tell4dIconMarkup("reel-end-ic", Math.round(icon), 'aria-hidden="true"').replace(/^<svg/, `<svg x="${f2(lx)}" y="${f2(by)}"`);
      out += wordmarkMarkup("dark", wmH, "reel-end-wordmark").replace(/^<svg/, `<svg x="${f2(lx + icon + 26)}" y="${f2(by + (icon - wmH) / 2)}"`);
      out += `</g>`;
      out += `<text class="reel-tagline" x="${lx}" y="${f2(cy + 60)}" font-family="${REEL_TITLE_FONT}" font-size="${tagFs}" font-weight="800" fill="${REEL_COLORS.text}" opacity="${f2(a2)}">${esc(REEL_TAGLINE)}</text>`;
      const qx = s.x + s.w - 60 - qr;
      const qy = cy - qr / 2 - 20;
      const ll = this.linkLines(lx, cy + 140, qx - lx - 60, 34, "start");
      out += `<g opacity="${f2(a3)}">${ll.svg}${this.pitchLine(lx, cy + 140 + ll.h + 56, qx - lx - 60, 26, "start")}</g>`;
      out += `<g opacity="${f2(a3)}">${this.qrMarkup(qx, qy, qr, "reel-end-qr")}<text class="reel-cta" x="${f2(qx + qr / 2)}" y="${f2(qy + qr + 48)}" text-anchor="middle" font-size="28" fill="${REEL_COLORS.muted}">${esc(this.links.cta)}</text></g>`;
      return out + `</g>`;
    }
    let y = s.y + (sq ? 40 : 150);
    const rowW = icon + 26 + wmW;
    out += `<g opacity="${f2(a1)}" transform="translate(0 ${f2((1 - a1) * 24)})">`;
    out += tell4dIconMarkup("reel-end-ic", Math.round(icon), 'aria-hidden="true"').replace(/^<svg/, `<svg x="${f2(cx - rowW / 2)}" y="${f2(y)}"`);
    out += wordmarkMarkup("dark", wmH, "reel-end-wordmark").replace(/^<svg/, `<svg x="${f2(cx - rowW / 2 + icon + 26)}" y="${f2(y + (icon - wmH) / 2)}"`);
    out += `</g>`;
    y += icon + (sq ? 80 : 150);
    const tag = wrap(REEL_TAGLINE, s.w, tagFs, REEL_TITLE_FONT, 800, 2);
    out += `<g opacity="${f2(a2)}">`;
    tag.forEach((l, k) => (out += `<text class="reel-tagline" x="${f2(cx)}" y="${f2(y + k * tagFs * 1.12)}" text-anchor="middle" font-family="${REEL_TITLE_FONT}" font-size="${tagFs}" font-weight="800" fill="${REEL_COLORS.text}">${esc(l)}</text>`));
    out += `</g>`;
    y += (tag.length - 1) * tagFs * 1.12 + (sq ? 44 : 80);
    out += `<g opacity="${f2(a3)}">`;
    const qs = sq ? qr - 40 : qr;
    out += this.qrMarkup(cx - qs / 2, y, qs, "reel-end-qr");
    y += qs + (sq ? 44 : 64);
    const ll = this.linkLines(cx, y, s.w, sq ? 32 : 38, "middle");
    out += ll.svg;
    y += ll.h + (sq ? 40 : 52);
    out += `<text class="reel-cta" x="${f2(cx)}" y="${f2(y)}" text-anchor="middle" font-size="${sq ? 24 : 30}" fill="${REEL_COLORS.muted}">${esc(this.links.cta)}</text>`;
    y += sq ? 44 : 64;
    out += this.pitchLine(cx, y, s.w, sq ? 22 : 26, "middle");
    out += `</g>`;
    void measure;
    void easeInOut;
    return out + `</g>`;
  }
}

