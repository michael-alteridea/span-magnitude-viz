import { describe, expect, it } from "vitest";
import { isAppleMobile, parseDatanimeText, projectFileAccept, PROJECT_FILE_ACCEPT_DESKTOP } from "../src/project/fileImport";

const IPHONE = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 };
const IPADOS = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 };
const MAC = { ...IPADOS, maxTouchPoints: 0 };
const WIN = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0 Safari/537.36", platform: "Win32", maxTouchPoints: 0 };
const PROJ = JSON.stringify({ kind: "datanime-project", version: 1, project: { name: "Pétrole et mazout" } });

describe("filtre du sélecteur de projet", () => {
  it("iPhone et iPadOS : aucun filtre (extension .datanime inconnue d'iOS → fichier grisé)", () => {
    expect(isAppleMobile(IPHONE)).toBe(true);
    expect(isAppleMobile(IPADOS)).toBe(true);
    expect(projectFileAccept(IPHONE)).toBeNull();
    expect(projectFileAccept(IPADOS)).toBeNull();
  });
  it("ordinateur : filtre .datanime / .json conservé (+ .txt)", () => {
    expect(isAppleMobile(MAC)).toBe(false);
    expect(isAppleMobile(WIN)).toBe(false);
    expect(projectFileAccept(WIN)).toBe(PROJECT_FILE_ACCEPT_DESKTOP);
    expect(PROJECT_FILE_ACCEPT_DESKTOP).toContain(".datanime");
    expect(PROJECT_FILE_ACCEPT_DESKTOP).toContain(".json");
  });
});

describe("validation du contenu après sélection", () => {
  it("projet Datanime, quel que soit le nom (.datanime, .datanime.txt, .json), BOM toléré", () => {
    for (const n of ["petrole-mazout.datanime", "petrole-mazout.datanime.txt", "petrole-mazout.json", "sans-extension"]) {
      expect(parseDatanimeText(PROJ, n, true).project).toBe(true);
    }
    expect(parseDatanimeText("\uFEFF" + PROJ, "x.datanime", true).project).toBe(true);
  });
  it("JSON qui n'est pas un projet : rendu tel quel, ou refusé si un projet est exigé", () => {
    expect(parseDatanimeText('{"kind":"reporting-4d-studio"}', "a.r4d.json")).toEqual({ project: false, raw: { kind: "reporting-4d-studio" } });
    expect(() => parseDatanimeText('[{"a":1}]', "donnees.json", true)).toThrow(/« donnees\.json » n'est pas un fichier Datanime/);
  });
  it("fichier non JSON, vide ou tronqué : erreur claire en français", () => {
    expect(() => parseDatanimeText("%PDF-1.7 …", "photo.pdf")).toThrow(/n'est pas un fichier Datanime \(contenu non JSON\)/);
    expect(() => parseDatanimeText("  ", "vide.datanime")).toThrow(/fichier vide/);
    expect(() => parseDatanimeText('{"kind":"datanime-project",', "coupe.datanime")).toThrow(/JSON illisible/);
  });
});
