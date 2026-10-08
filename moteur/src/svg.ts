/** Petits outils de construction SVG en chaîne (aucun DOM requis : toSVG fonctionne côté serveur). */
export const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type AttrVal = string | number | boolean | null | undefined;

export function tag(name: string, attrs: Record<string, AttrVal>, inner?: string): string {
  let a = "";
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    a += v === true ? ` ${k}` : ` ${k}="${esc(typeof v === "number" ? r2(v) : v)}"`;
  }
  return inner == null ? `<${name}${a}/>` : `<${name}${a}>${inner}</${name}>`;
}

/** Arrondi à 2 décimales (SVG compact et stable). */
export const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Empreinte courte et déterministe (identifiants de clipPath stables d'un rendu à l'autre). */
export function hashId(prefix: string, ...parts: unknown[]): string {
  const s = JSON.stringify(parts);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

/** Largeur approximative d'un texte (sans DOM). */
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    if (/[\s\u202f\u00a0]/.test(ch)) w += 0.28;
    else if (/[il.,;:'|!]/.test(ch)) w += 0.27;
    else if (/[mwMW@%]/.test(ch)) w += 0.86;
    else if (/[A-Z0-9€]/.test(ch)) w += 0.64;
    else w += 0.54;
  }
  return w * size * (bold ? 1.06 : 1);
}

/** Tronque un texte avec « … » pour tenir dans une largeur. */
export function fit(s: string, size: number, max: number, bold = false): string {
  if (textWidth(s, size, bold) <= max) return s;
  let out = s;
  while (out.length > 1 && textWidth(out + "…", size, bold) > max) out = out.slice(0, -1);
  return out.trimEnd() + "…";
}

/** Découpe un texte en lignes (au mot) pour une largeur donnée. */
export function wrap(s: string, size: number, max: number, maxLines = 2, bold = false): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size, bold) <= max || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(lines.slice(maxLines - 1).join(" "), size, max, bold);
    return kept;
  }
  return lines.map((l) => fit(l, size, max, bold));
}
