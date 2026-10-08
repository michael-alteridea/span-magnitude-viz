/** Mesure et coupure de texte (canvas 2D) pour une mise en page SVG précise. */

let ctx: CanvasRenderingContext2D | null = null;

export function measure(text: string, sizePx: number, family: string, weight = 400): number {
  if (!ctx) {
    try {
      const c = document.createElement("canvas");
      ctx = typeof c.getContext === "function" ? c.getContext("2d") : null;
    } catch {
      ctx = null;
    }
  }
  if (!ctx) return text.length * sizePx * 0.55;
  ctx.font = `${weight} ${sizePx}px ${family}`;
  return ctx.measureText(text).width;
}

/** Coupe un texte en lignes de largeur max ; tronque avec « … » au-delà de maxLines. */
export function wrap(text: string, maxWidth: number, sizePx: number, family: string, weight = 400, maxLines = 2): string[] {
  // Espaces insécables (« 3,6 M€ », « 12 % ») conservées : pas de coupure entre un nombre et son unité
  const words = text.split(/[ \t\r\n]+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (measure(cand, sizePx, family, weight) <= maxWidth || !cur) cur = cand;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(lines.slice(maxLines - 1).join(" "), maxWidth, sizePx, family, weight);
    return kept;
  }
  return lines.map((l) => (measure(l, sizePx, family, weight) > maxWidth ? ellipsize(l, maxWidth, sizePx, family, weight) : l));
}

export function ellipsize(text: string, maxWidth: number, sizePx: number, family: string, weight = 400): string {
  if (measure(text, sizePx, family, weight) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid) + "…", sizePx, family, weight) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, Math.max(1, lo)).trimEnd() + "…";
}
