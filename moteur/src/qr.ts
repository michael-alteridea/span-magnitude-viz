/** QR code en chemin SVG (qrcode-generator, MIT, embarqué). */
import qrcode from "qrcode-generator";

export function qrSvgPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  let d = "";
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!qr.isDark(y, x)) {
        x++;
        continue;
      }
      let e = x;
      while (e < size && qr.isDark(y, e)) e++;
      d += `M${x} ${y}h${e - x}v1h${x - e}z`;
      x = e;
    }
  }
  return { size, d };
}
