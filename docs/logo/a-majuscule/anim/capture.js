// node capture.js <svg> <W> <H> <fond> <largeur_logo_px> <dossier_images> [fps=30] [durée_s=4.6] [t_unique_s]
// Capture image par image : toutes les animations CSS sont mises en pause et positionnées à t (déterministe).
const fs = require("fs"), path = require("path");
const puppeteer = require("/workspace/mockups/menu-haut/node_modules/puppeteer-core");
const [svgFile, W, H, bg, logoW, outDir, fps = 30, dur = 4.6, single] = process.argv.slice(2);
(async () => {
  const svg = fs.readFileSync(svgFile, "utf8");
  const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: +W, height: +H, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;background:${bg};display:flex;align-items:center;justify-content:center">
    <div style="width:${logoW}px">${svg.replace("<svg ", '<svg style="width:100%;height:auto;display:block" ')}</div></body></html>`);
  fs.mkdirSync(outDir, { recursive: true });
  const seek = (t) => p.evaluate((ms) => { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; }); }, t * 1000);
  const n = single !== undefined ? 1 : Math.round(dur * fps);
  for (let i = 0; i < n; i++) {
    const t = single !== undefined ? +single : i / fps;
    await seek(t);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await p.screenshot({ path: path.join(outDir, single !== undefined ? `t${t}.png` : `f${String(i).padStart(4, "0")}.png`) });
  }
  console.log("animations:", await p.evaluate(() => document.getAnimations().length), "images:", n);
  await b.close();
})();
