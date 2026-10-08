/** SVG (chaîne) → PNG (data URL), dans le navigateur. */
export interface PngOptions {
  /** Facteur de résolution (2 par défaut). */
  scale?: number;
  /** Fond forcé (sinon celui du SVG). */
  background?: string;
}

export function svgSize(svg: string): { width: number; height: number } {
  const vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/.exec(svg);
  if (vb) return { width: +vb[1]!, height: +vb[2]! };
  const w = /width="([\d.]+)"/.exec(svg), h = /height="([\d.]+)"/.exec(svg);
  return { width: w ? +w[1]! : 640, height: h ? +h[1]! : 360 };
}

export function svgToPng(svg: string, opts: PngOptions = {}): Promise<string> {
  if (typeof document === "undefined" || typeof Image === "undefined") return Promise.reject(new Error("toPNG : navigateur requis"));
  const scale = Math.max(0.5, Math.min(6, opts.scale ?? 2));
  const { width, height } = svgSize(svg);
  const src = /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg) ? svg : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.round(width * scale);
      c.height = Math.round(height * scale);
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("toPNG : canvas indisponible"));
      if (opts.background) {
        ctx.fillStyle = opts.background;
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      try {
        resolve(c.toDataURL("image/png"));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => reject(new Error("toPNG : image SVG illisible (logo externe ? utilisez une data URL)"));
    img.src = url;
  });
}
