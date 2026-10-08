/**
 * Cartouche Tell4D (coin bas droit de chaque graphique) : petit bloc rectangulaire avec
 * logo + « Tell4D » (lien vers la plateforme), date de génération, date d'import des données,
 * source, empreinte courte et QR d'empreinte des données (lien vers la page de vérification).
 * 100 % SVG : identique dans l'aperçu, les exports SVG / PNG / WebM, les snapshots et les diapositives.
 */
import type { ChartSpec } from "../spec";
import type { Theme } from "../theme";
import type { G, PlotRect } from "./context";
import { ellipsize, measure } from "./text";
import { LOGO_COLORS, PLATFORM_URL, PRODUCT_LABEL, appendTell4dIcon, type Appendable } from "../brand";
import { generatedOn } from "../story/fr";
import { provenanceLines, shortFingerprint, verifyInfoFor, verifyUrl, type Provenance } from "../provenance";
import { qrMatrix, qrPath, type QrMatrix } from "../qr";

/** Identifiants uniques des dégradés de l'icône (plusieurs graphiques par page). */
let iconSeq = 0;

/** Marge claire autour du QR (en modules). */
export const QR_QUIET = 3;

export interface CartoucheLayout {
  w: number;
  h: number;
  s: number;
  font: string;
  date: string;
  data: [string, string] | null;
  source: string | null;
  fingerprint: string | null;
  qr: { url: string; m: QrMatrix; size: number } | null;
  textW: number;
}

const K = { pad: 8, gap: 10, brandRow: 18, lineH: 13.5, fs: 9.5, fsBrand: 12.5, logo: 14, qrMin: 72, sourceMax: 125 };

/** Mesure le cartouche (sans dessiner). */
export function layoutCartouche(spec: ChartSpec, s: number, font: string, now: Date): CartoucheLayout {
  const p = spec.provenance as Provenance | null;
  const date = generatedOn(now);
  const data = p ? provenanceLines(p) : null;
  const src = spec.style.source.trim();
  const source = src ? (/^source/i.test(src) ? src : `Source : ${src}`) : null;
  const fingerprint = p ? `Empreinte ${shortFingerprint(p.hash)}` : null;
  const fs = K.fs * s;
  const m = (t: string, w = 400) => measure(t, fs, font, w);
  let textW = Math.max(K.logo * s + 5 * s + measure(PRODUCT_LABEL, K.fsBrand * s, font, 700), m(date), ...(data ? data.map((l) => m(l)) : []), fingerprint ? m(fingerprint) : 0);
  if (source) textW = Math.max(textW, Math.min(m(source), K.sourceMax * s));
  const nLines = 1 + (data ? 2 : 0) + (source ? 1 : 0) + (fingerprint ? 1 : 0);
  const textH = K.brandRow * s + nLines * K.lineH * s;
  let qr: CartoucheLayout["qr"] = null;
  if (p && spec.style.authQr) {
    const url = verifyUrl(verifyInfoFor(p, now));
    qr = { url, m: qrMatrix(url), size: Math.max(K.qrMin * s, textH) };
  }
  const innerH = Math.max(textH, qr?.size ?? 0);
  const w = K.pad * s * 2 + textW + (qr ? K.gap * s + qr.size : 0);
  const h = K.pad * s * 2 + innerH;
  return { w, h, s, font, date, data, source, fingerprint, qr, textW };
}

/** Dessine le cartouche en (x0, y0) ; renvoie le rectangle occupé. */
export function drawCartouche(root: G, theme: Theme, lay: CartoucheLayout, x0: number, y0: number): PlotRect {
  const { s, font, w, h } = lay;
  const pad = K.pad * s;
  const fs = K.fs * s;
  const lh = K.lineH * s;
  const g = root.append("g").attr("class", "r4d-cartouche").attr("data-r4d", "cartouche");
  g.append("rect").attr("class", "r4d-cartouche-box").attr("x", x0).attr("y", y0).attr("width", w).attr("height", h).attr("rx", 5 * s).attr("fill", theme.bg).attr("stroke", theme.grid).attr("stroke-width", 1 * s);
  const innerH = h - pad * 2;
  const nLines = 1 + (lay.data ? 2 : 0) + (lay.source ? 1 : 0) + (lay.fingerprint ? 1 : 0);
  const textH = K.brandRow * s + nLines * lh;
  const tx = x0 + pad;
  let y = y0 + pad + (innerH - textH) / 2;

  // Logo + nom du produit : lien vers la plateforme
  const a = g.append("a").attr("class", "r4d-cartouche-link").attr("href", PLATFORM_URL).attr("target", "_blank").attr("rel", "noopener");
  a.append("title").text(`${PRODUCT_LABEL} — ${PLATFORM_URL}`);
  const logo = K.logo * s;
  const by = y + K.brandRow * s / 2 - 1 * s;
  appendTell4dIcon(a as unknown as Appendable, `t4d-i${++iconSeq}`)
    .attr("class", "r4d-logo")
    .attr("x", tx)
    .attr("y", by - logo / 2)
    .attr("width", logo)
    .attr("height", logo)
    .attr("aria-hidden", "true");
  a.append("text").attr("class", "r4d-brand").attr("x", tx + logo + 5 * s).attr("y", by).attr("dy", "0.35em").attr("font-size", K.fsBrand * s).attr("font-weight", 700).attr("fill", theme.muted).text(PRODUCT_LABEL);
  y += K.brandRow * s;

  const line = (cls: string, text: string, fill: string) => {
    const t = g.append("text").attr("class", cls).attr("x", tx).attr("y", y + lh / 2).attr("dy", "0.35em").attr("font-size", fs).attr("fill", fill).text(ellipsize(text, lay.textW + 0.5, fs, font));
    y += lh;
    return t;
  };
  line("r4d-cartouche-date", lay.date, theme.muted);
  if (lay.data) {
    line("r4d-cartouche-data", lay.data[0], theme.faint);
    line("r4d-cartouche-data", lay.data[1], theme.faint);
  }
  if (lay.source) line("r4d-source", lay.source, theme.faint);
  if (lay.fingerprint) {
    const t = g.append("text").attr("class", "r4d-fingerprint").attr("x", tx).attr("y", y + lh / 2).attr("dy", "0.35em").attr("font-size", fs).attr("fill", theme.faint);
    const [label, value] = [lay.fingerprint.slice(0, lay.fingerprint.indexOf(" ")), lay.fingerprint.slice(lay.fingerprint.indexOf(" ") + 1)];
    t.append("tspan").text(`${label} `);
    t.append("tspan").attr("class", "r4d-fingerprint-value").attr("fill", theme.dark ? LOGO_COLORS.light : LOGO_COLORS.petrol).attr("font-weight", 700).text(value);
    y += lh;
  }

  // QR d'empreinte des données : modules foncés sur plaque blanche (marge claire de QR_QUIET modules), lien vers la vérification
  if (lay.qr) {
    const { m, size, url } = lay.qr;
    const qx = x0 + w - pad - size;
    const qy = y0 + pad + (innerH - size) / 2;
    const qa = g.append("a").attr("class", "r4d-qr-link").attr("href", url).attr("target", "_blank").attr("rel", "noopener").attr("aria-label", "Vérifier l'empreinte");
    qa.append("title").text("Vérifier l'empreinte des données");
    qa.append("rect").attr("class", "r4d-qr-plate").attr("x", qx).attr("y", qy).attr("width", size).attr("height", size).attr("rx", 2 * s).attr("fill", "#ffffff").attr("stroke", theme.dark ? "none" : theme.grid).attr("stroke-width", 0.75 * s);
    const n = m.size + QR_QUIET * 2;
    const q = qa
      .append("svg")
      .attr("class", "r4d-qr")
      .attr("x", qx)
      .attr("y", qy)
      .attr("width", size)
      .attr("height", size)
      .attr("viewBox", `${-QR_QUIET} ${-QR_QUIET} ${n} ${n}`)
      .attr("shape-rendering", "crispEdges")
      .attr("data-url", url)
      .attr("data-version", m.version)
      .attr("data-modules", m.size);
    q.append("path").attr("d", qrPath(m)).attr("fill", "#111111");
  }
  return { x: x0, y: y0, w, h };
}
