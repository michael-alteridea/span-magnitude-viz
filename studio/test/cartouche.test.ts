/**
 * Cartouche Tell4D et QR d'empreinte des données : empreintes (règles de normalisation), lien de vérification
 * (construction / lecture), QR décodable, cartouche présent dans le SVG (lien, dates, source, empreinte, QR),
 * option « QR d'empreinte des données » qui ne masque que le QR.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import JSZip from "jszip";
import jsQR from "jsqr";
import { PLATFORM_URL } from "../src/brand";
import { parseSpec } from "../src/spec";
import { sampleById, SAMPLE_TODAY } from "../src/data/samples";
import { buildDataset } from "../src/data/table";
import {
  VERIFY_BASE,
  VERIFY_URL,
  canonicalJson,
  hashPastedText,
  hashRows,
  makeProvenance,
  normalizePastedText,
  parseVerifyFragment,
  sha256Hex,
  shortFingerprint,
  verifyCode,
  verifyInfoFor,
  verifyUrl,
  type Provenance,
} from "../src/provenance";
import { qrMatrix, qrPath, type QrMatrix } from "../src/qr";

const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const HASH = "3f9ac21e" + "0123456789abcdef".repeat(2) + "deadbeef" + "00112233" + "44556677";
let render: typeof import("../src/charts/render");
let QR_QUIET: number;

beforeAll(async () => {
  const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, { document, window });
  render = await import("../src/charts/render");
  QR_QUIET = (await import("../src/charts/cartouche")).QR_QUIET;
});

/** Matrice → image RGBA (modules foncés sur blanc, marge claire) pour jsQR. */
function rasterize(m: QrMatrix, px = 4, quiet = 4): { data: Uint8ClampedArray; size: number } {
  const size = (m.size + quiet * 2) * px;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  m.rows.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < px; dy++)
        for (let dx = 0; dx < px; dx++) {
          const i = (((y + quiet) * px + dy) * size + (x + quiet) * px + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 17;
        }
    })
  );
  return { data, size };
}

/** Chemin SVG « M x y h w v1 h-w z » → matrice (contrôle de ce qui est réellement dessiné). */
function matrixFromPath(d: string, size: number): QrMatrix {
  const rows = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let k = 0; k < w; k++) rows[y]![x + k] = true;
  }
  return { size, version: (size - 17) / 4, rows };
}

function decode(m: QrMatrix): string | null {
  const { data, size } = rasterize(m);
  return jsQR(data, size, size)?.data ?? null;
}

function draw(specInput: Record<string, unknown>, opts: Record<string, unknown> = {}, sampleId = "business-review") {
  const r = parseSpec(specInput);
  if (!r.ok) throw new Error(r.issues.join("; "));
  const s = sampleById(sampleId)!;
  const ds = buildDataset(s.name, s.rows());
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  const cache = render.prepareCache(r.spec, ds, null, 1);
  const res = render.renderChart(svg, r.spec, ds, cache, { build: 1, timePos: null }, { now: new Date(2026, 9, 8, 13, 19), ...opts });
  return { svg, res, html: svg.outerHTML };
}

const PROV: Provenance = makeProvenance({ hash: HASH, kind: "file", fileName: "ventes.csv", rows: 36, cols: 5, now: new Date(2026, 9, 8, 9, 30) });
const BAR = { type: "bar", encoding: { x: "Région", y: ["Réel (€)"] }, style: { source: "Source : CRM Salesforce, export du 8 octobre 2026 à 9 h, périmètre France et Belgique" }, provenance: PROV };

describe("empreintes des données", () => {
  it("SHA-256 (WebCrypto) : vecteur de référence", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("texte collé : CRLF → LF, espaces de fin de ligne et blancs finaux retirés, tabulations conservées", async () => {
    expect(normalizePastedText("\uFEFFMois;CA  \r\njanv.;12\u00a0\r\n\r\n  ")).toBe("Mois;CA\njanv.;12");
    expect(normalizePastedText("a\tb\t\nc\t\td")).toBe("a\tb\t\nc\t\td");
    expect(normalizePastedText("a\rb")).toBe("a\nb");
    expect(await hashPastedText("Mois;CA\r\njanv.;12 \r\n")).toBe(await hashPastedText("Mois;CA\njanv.;12"));
    expect(await hashPastedText("Mois;CA\njanv.;12")).not.toBe(await hashPastedText("Mois;CA\njanv.;13"));
  });
  it("lignes : JSON canonique (ordre des clés indifférent, dates ISO)", async () => {
    expect(canonicalJson([{ b: 1, a: "x" }])).toBe('[{"a":"x","b":1}]');
    expect(canonicalJson({ d: new Date(Date.UTC(2026, 9, 8)), n: NaN, u: undefined })).toBe('{"d":"2026-10-08T00:00:00.000Z","n":null}');
    expect(await hashRows([{ b: 1, a: "x" }])).toBe(await hashRows([{ a: "x", b: 1 }]));
    const rows = sampleById("ventes")!.rows();
    expect(await hashRows(rows)).toBe(await hashRows(sampleById("ventes")!.rows()));
    expect(await hashRows(JSON.parse(JSON.stringify(rows)))).toBe(await hashRows(rows));
  });
});

describe("lien de vérification", () => {
  it("base sur une seule constante, fragment compact en majuscules", () => {
    expect(VERIFY_BASE).toBe("https://alteridea-dashboard.web.app");
    expect(VERIFY_URL).toBe(`${VERIFY_BASE}/reporting/verifier.html`);
    const v = verifyInfoFor(PROV, new Date(2026, 9, 8, 13));
    expect(v).toEqual({ h: HASH.slice(0, 32), i: "20261008", g: "20261008", n: 36, c: 5, kind: "file" });
    expect(verifyCode(v)).toBe(`1.F.${HASH.slice(0, 32).toUpperCase()}.20261008.20261008.36.5`);
    expect(verifyUrl(v)).toBe(`${VERIFY_URL}#1.F.${HASH.slice(0, 32).toUpperCase()}.20261008.20261008.36.5`);
    expect(verifyUrl(v).length).toBeLessThan(130);
  });
  it("exemples : date des données ; texte collé : type P", () => {
    const s = makeProvenance({ hash: HASH, kind: "sample", rows: 300, cols: 12, asOf: SAMPLE_TODAY, now: new Date(2027, 0, 3) });
    expect(verifyInfoFor(s, new Date(2027, 0, 3)).i).toBe("20261008");
    expect(verifyCode(verifyInfoFor({ ...PROV, kind: "paste" }, new Date(2026, 9, 9)))).toMatch(/^1\.P\..+\.20261008\.20261009\.36\.5$/);
  });
  it("lecture : forme compacte, forme longue, liens incomplets ou illisibles → null", () => {
    const v = verifyInfoFor(PROV, new Date(2026, 9, 8));
    expect(parseVerifyFragment(verifyUrl(v))).toEqual(v);
    expect(parseVerifyFragment("#" + verifyCode(v))).toEqual(v);
    expect(parseVerifyFragment(`#h=${HASH.slice(0, 32)}&i=20261008&g=20261009&n=300&c=12`)).toEqual({ h: HASH.slice(0, 32), i: "20261008", g: "20261009", n: 300, c: 12, kind: null });
    expect(parseVerifyFragment(`#h=${HASH.slice(0, 32).toUpperCase()}&i=20261008&g=20261009&n=300&c=12&k=E`)?.kind).toBe("sample");
    for (const bad of ["", "#", "#1.F.ABC.20261008.20261008.36.5", `#1.F.${HASH.slice(0, 32)}.20261332.20261008.36.5`, `#1.F.${HASH.slice(0, 32)}.20260230.20261008.36.5`, `#1.F.${HASH.slice(0, 32)}.20261008.20261008.36`, `#1.F.${HASH.slice(0, 32)}.20261008.20261008.-1.5`, `#h=${HASH.slice(0, 31)}&i=20261008&g=20261008&n=1&c=1`, "#%E0%A4%A", "#bonjour"])
      expect(parseVerifyFragment(bad), bad).toBeNull();
  });
  it("empreinte courte « 3f9a·c21e »", () => {
    expect(shortFingerprint(HASH)).toBe("3f9a·c21e");
  });
});

describe("QR d'empreinte des données", () => {
  it("petit (version ≤ 6, correction M) et décodable vers l'URL de vérification", () => {
    for (const n of [5, 36, 300, 99999]) {
      const url = verifyUrl(verifyInfoFor({ ...PROV, rows: n, cols: 12 }, new Date(2026, 9, 8)));
      const m = qrMatrix(url);
      expect(m.version, url).toBeLessThanOrEqual(6);
      expect(m.size).toBeGreaterThanOrEqual(21);
      expect(decode(m)).toBe(url);
      // le chemin SVG redonne exactement la matrice
      expect(matrixFromPath(qrPath(m), m.size).rows).toEqual(m.rows);
    }
  });
  it("forme longue (non alphanumérique) : QR plus grand mais décodable", () => {
    const url = `${VERIFY_URL}#h=${HASH.slice(0, 32)}&i=20261008&g=20261008&n=300&c=12`;
    const m = qrMatrix(url);
    expect(decode(m)).toBe(url);
    expect(m.version).toBeGreaterThan(qrMatrix(verifyUrl(verifyInfoFor(PROV, new Date()))).version);
  });
});

describe("cartouche Tell4D", () => {
  it("bloc rectangulaire : logo + « Tell4D » en lien, généré le, données importées le, source tronquée, empreinte, QR", () => {
    const { svg, res, html } = draw(BAR);
    const c = svg.querySelector(".r4d-cartouche")!;
    expect(c).toBeTruthy();
    expect(c.querySelector("a.r4d-cartouche-link")?.getAttribute("href")).toBe(PLATFORM_URL);
    expect(c.querySelector("a.r4d-cartouche-link .r4d-logo")).toBeTruthy();
    expect(c.querySelector("a.r4d-cartouche-link .r4d-brand")?.textContent).toBe("Tell4D");
    expect(norm(c.querySelector(".r4d-cartouche-date")?.textContent ?? "")).toBe("Généré le 8 oct. 2026");
    expect([...c.querySelectorAll(".r4d-cartouche-data")].map((e) => norm(e.textContent ?? ""))).toEqual(["Données importées le", "8 oct. 2026"]);
    const src = norm(c.querySelector(".r4d-source")?.textContent ?? "");
    expect(src.startsWith("Source : CRM")).toBe(true);
    expect(src.endsWith("…")).toBe(true);
    expect(norm(c.querySelector(".r4d-fingerprint")?.textContent ?? "")).toBe("Empreinte 3f9a·c21e");
    const qr = c.querySelector("svg.r4d-qr")!;
    const url = verifyUrl(verifyInfoFor(PROV, new Date(2026, 9, 8)));
    expect(qr.getAttribute("data-url")).toBe(url);
    expect(c.querySelector("a.r4d-qr-link")?.getAttribute("href")).toBe(url);
    expect(c.querySelector("a.r4d-qr-link title")?.textContent).toMatch(/^Vérifier l'empreinte/);
    expect(qr.getAttribute("shape-rendering")).toBe("crispEdges");
    // marge claire (quiet zone) : viewBox plus grand que la matrice, plaque blanche dessous
    const n = Number(qr.getAttribute("data-modules"));
    expect(qr.getAttribute("viewBox")).toBe(`${-QR_QUIET} ${-QR_QUIET} ${n + 2 * QR_QUIET} ${n + 2 * QR_QUIET}`);
    expect(QR_QUIET).toBeGreaterThanOrEqual(2);
    expect(c.querySelector(".r4d-qr-plate")?.getAttribute("fill")).toBe("#ffffff");
    // le QR dessiné se décode vers l'URL de vérification
    expect(decode(matrixFromPath(qr.querySelector("path")!.getAttribute("d")!, n))).toBe(url);
    // ≥ 1,5 px par module dès le PNG 1× (1200 px) : donc aussi dans un PNG de 1600 px
    const side = Number(qr.getAttribute("width"));
    expect(side / (n + 2 * QR_QUIET)).toBeGreaterThanOrEqual(1.5);
    // forme : rectangle (≈ 2:1), discret (≤ 20 % de la largeur), dans le coin bas droit
    const r = res.cartouche!;
    expect(r.w / r.h).toBeGreaterThan(1.6);
    expect(r.w / r.h).toBeLessThan(2.7);
    expect(r.w).toBeLessThan(1200 * 0.2);
    expect(r.x + r.w).toBeCloseTo(1200 - 40, 0);
    expect(r.y + r.h).toBeGreaterThan(640);
    expect(html).not.toMatch(/certifi|authenticit|preuve/i);
  });
  it("ne chevauche pas la zone du graphique (sans commentaires : bande réservée ; avec : sous la colonne « À retenir »)", () => {
    const a = draw({ ...BAR, story: { showComments: false } }).res;
    expect(a.plot.y + a.plot.h).toBeLessThanOrEqual(a.cartouche!.y);
    const b = draw({ ...BAR, story: { comments: ["Un constat", "Un autre constat"] } });
    const cb = b.res.cartouche!;
    expect(b.res.plot.x + b.res.plot.w).toBeLessThanOrEqual(cb.x);
    for (const t of b.svg.querySelectorAll(".r4d-comment text")) expect(Number(t.getAttribute("y"))).toBeLessThan(cb.y);
    // portrait : bande pleine largeur
    const p = draw({ ...BAR, style: { ...BAR.style, size: { preset: "4:5" } } }).res;
    expect(p.plot.y + p.plot.h).toBeLessThanOrEqual(p.cartouche!.y);
  });
  it("exemples : « Données d'exemple au 8 oct. 2026 »", () => {
    const sp = makeProvenance({ hash: HASH, kind: "sample", rows: 300, cols: 12, asOf: SAMPLE_TODAY });
    const { svg } = draw({ ...BAR, provenance: sp });
    expect([...svg.querySelectorAll(".r4d-cartouche-data")].map((e) => norm(e.textContent ?? ""))).toEqual(["Données d'exemple", "au 8 oct. 2026"]);
    expect(svg.querySelector(".r4d-qr")?.getAttribute("data-url")).toContain("#1.E.");
  });
  it("option « QR d'empreinte des données » désactivée : QR masqué, cartouche conservé (offre gratuite)", () => {
    const { svg, res } = draw({ ...BAR, style: { ...BAR.style, authQr: false, brandMark: false } });
    expect(svg.querySelector(".r4d-cartouche")).toBeTruthy();
    expect(svg.querySelector(".r4d-qr")).toBeNull();
    expect(svg.querySelector(".r4d-cartouche-link")).toBeTruthy();
    expect(norm(svg.querySelector(".r4d-fingerprint")?.textContent ?? "")).toBe("Empreinte 3f9a·c21e");
    expect(res.cartouche!.w / res.cartouche!.h).toBeGreaterThan(1.1);
    // offre pro : seule à pouvoir retirer tout le cartouche
    expect(draw({ ...BAR, branding: "pro", style: { ...BAR.style, brandMark: false } }).svg.querySelector(".r4d-cartouche")).toBeNull();
  });
  it("sans provenance (aucune empreinte) : cartouche sans QR ni ligne « Données »", () => {
    const { svg } = draw({ ...BAR, provenance: null });
    expect(svg.querySelector(".r4d-cartouche-date")).toBeTruthy();
    expect(svg.querySelector(".r4d-qr")).toBeNull();
    expect(svg.querySelector(".r4d-cartouche-data")).toBeNull();
  });
  it("fond clair, fond perso, mode norme : cartouche présent et QR sur plaque blanche", () => {
    for (const style of [{ background: "light" }, { background: "custom", backgroundCustom: "#2a1f4d" }]) {
      const { svg } = draw({ ...BAR, style: { ...BAR.style, ...style } });
      expect(svg.querySelector(".r4d-qr-plate")?.getAttribute("fill")).toBe("#ffffff");
      expect(svg.querySelector(".r4d-qr path")?.getAttribute("fill")).toBe("#111111");
    }
    const { svg } = draw({ ...BAR, norme: { enabled: true } });
    expect(svg.querySelector(".r4d-cartouche .r4d-qr")).toBeTruthy();
    const reds = [...svg.querySelectorAll(".r4d-cartouche *")].filter((e) => ["#d62839", "#2e9e4f"].includes((e.getAttribute("fill") ?? "").toLowerCase()));
    expect(reds).toEqual([]);
  });
  it("PowerPoint : lien natif « Vérifier l'empreinte » par diapositive", async () => {
    const { buildPptx } = await import("../src/story/pptx");
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const spec = (parseSpec({ provenance: PROV }) as { spec: unknown }).spec;
    const snap = { id: "s1", name: "s1", createdAt: "2026-10-08T11:00:00.000Z", spec, svg: null, thumb: null, width: 1200, height: 675, title: "T", subtitle: "", comments: [], source: "", kind: null, role: "context" as const, sampleId: null, dataName: "Démo", generatedAt: "2026-10-08T11:00:00.000Z" };
    const buf = (await buildPptx({ title: "Revue", snapshots: [snap] }, { images: new Map([["s1", { data: png, width: 1200, height: 675 }]]), outputType: "nodebuffer", now: new Date(2026, 9, 8) })) as Uint8Array;
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("ppt/slides/slide3.xml")!.async("string");
    expect(norm(xml).replace(/&apos;/g, "'")).toContain("Vérifier l'empreinte des données · 3f9a·c21e");
    const rels = await zip.file("ppt/slides/_rels/slide3.xml.rels")!.async("string");
    expect(rels).toContain(`${VERIFY_URL}#1.F.${HASH.slice(0, 32).toUpperCase()}.20261008.20261008.36.5`);
    expect(xml + rels).not.toMatch(/certifi|authenticit|preuve/i);
  });
});
