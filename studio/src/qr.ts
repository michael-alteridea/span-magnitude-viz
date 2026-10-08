/**
 * QR code en SVG pur (matrice → chemin), via qrcode-generator (MIT, embarqué dans le bundle, aucun réseau).
 */
import qrcode from "qrcode-generator";

export interface QrMatrix {
  size: number;
  version: number;
  /** Modules foncés, ligne par ligne. */
  rows: boolean[][];
}

const ALNUM = /^[0-9A-Z $%*+\-./:]*$/;
const qrCache = new Map<string, QrMatrix>();

/**
 * Matrice QR (correction d'erreur M, version minimale) : partie avant « # » en octets,
 * fragment en alphanumérique s'il s'y prête (QR plus petit).
 */
export function qrMatrix(text: string): QrMatrix {
  const hit = qrCache.get(text);
  if (hit) return hit;
  const qr = qrcode(0, "M");
  const at = text.indexOf("#");
  const frag = at >= 0 ? text.slice(at + 1) : "";
  if (at >= 0 && frag && ALNUM.test(frag)) {
    qr.addData(text.slice(0, at + 1), "Byte");
    qr.addData(frag, "Alphanumeric");
  } else qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  const rows = Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => qr.isDark(r, c)));
  const m: QrMatrix = { size, version: (size - 17) / 4, rows };
  if (qrCache.size > 50) qrCache.clear();
  qrCache.set(text, m);
  return m;
}

/** Chemin SVG des modules foncés, en unités de module (une passe par suite horizontale). */
export function qrPath(m: QrMatrix): string {
  let d = "";
  m.rows.forEach((row, y) => {
    let x = 0;
    while (x < m.size) {
      if (!row[x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < m.size && row[e]) e++;
      d += `M${x} ${y}h${e - x}v1h${x - e}z`;
      x = e;
    }
  });
  return d;
}
