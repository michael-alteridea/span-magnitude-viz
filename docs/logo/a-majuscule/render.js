// node render.js → planche.png (Chrome headless, 2×)
const path = require("path");
const puppeteer = require("/workspace/mockups/menu-haut/node_modules/puppeteer-core");
(async () => {
  const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1500, height: 300, deviceScaleFactor: 2 });
  await p.goto("file://" + path.join(__dirname, process.argv[2] || "planche.html"), { waitUntil: "networkidle0" });
  await p.screenshot({ path: path.join(__dirname, (process.argv[3] || "planche.png")), fullPage: true });
  await b.close();
})();
