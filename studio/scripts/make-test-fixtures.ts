/**
 * Génère les fixtures de test de l'import intelligent, entièrement FICTIVES (société « Exemple SA », produits
 * « Produit A » et « Produit B » ; aucun chiffre réel) :
 *   npx vite-node --config vitest.config.ts studio/scripts/make-test-fixtures.ts
 * - plan-mini.xlsx : onglets « Lisez-moi », « Hypothèses », « Plan 60m — Exemple » (plan mensuel janv. 2027 – déc. 2031 :
 *   calendrier, 24 commerciaux × en poste / ancienneté / productivité, clients, MRR, charges, résultat, trésorerie,
 *   totaux annuels 2027…2031, bloc « RÉSUMÉ DU SCÉNARIO »), « Synthèse » (tableau annuel, deux variantes) et « Sources ».
 *   Toutes les formules sont écrites SANS valeur en cache (comme un classeur généré par script) ;
 * - plan-mini.expected.json : valeurs recalculées par LibreOffice (vérité terrain, `soffice --headless`) ;
 * - plan-commercial.tsv : collage de l'équipe commerciale (M1…M26, format français « 25,0% »).
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as XLSX from "xlsx";

const OUT = resolve(import.meta.dirname ?? ".", "../test/fixtures");
const HYP = "Hypothèses";
const PLAN = "Plan 60m — Exemple";
const SYN = "Synthèse";
const H = (row: number) => `'${HYP}'!$D$${row}`;
const L = (c: number) => XLSX.utils.encode_col(c);
const MONTH_COL = (m: number) => 2 + m; // M1 = colonne D (index 3) ; Ouverture = C (index 2)
const YEAR_COL = (y: number) => 63 + y - 1; // 2027 = BL … 2031 = BP

type Cell = XLSX.CellObject;
const sheets: Record<string, XLSX.WorkSheet> = {};
const put = (ws: XLSX.WorkSheet, a: string, v: number | string | null, z?: string) => {
  if (typeof v === "string" && v.startsWith("=")) ws[a] = { t: "n", f: v.slice(1), ...(z ? { z } : {}) } as Cell;
  else if (typeof v === "number") ws[a] = { t: "n", v, ...(z ? { z } : {}) } as Cell;
  else if (typeof v === "string") ws[a] = { t: "s", v } as Cell;
};
const EUR = '#,##0 "€"';
const PCT = "0.0%";

/* ------------------------------------------------------------------ Hypothèses (valeurs inventées) */
const hyp = (sheets[HYP] = {} as XLSX.WorkSheet);
const P: Record<string, number> = {};
let hr = 1;
put(hyp, "A1", "Hypothèses — Exemple SA (données fictives)");
hr = 3;
put(hyp, "A3", "Paramètre");
put(hyp, "B3", "Unité");
put(hyp, "D3", "Valeur");
hr = 4;
const section = (t: string) => {
  hr++;
  put(hyp, `A${hr}`, t);
  hr++;
};
const param = (key: string, label: string, unit: string, v: number | string, z = "0.00") => {
  P[key] = hr;
  put(hyp, `A${hr}`, label);
  put(hyp, `B${hr}`, unit);
  put(hyp, `D${hr}`, v, z);
  hr++;
};
section("1. Prix et clients");
param("prixA", "Prix mensuel par licence — Produit A", "€", 45, EUR);
param("prixB", "Prix mensuel par licence — Produit B", "€", 120, EUR);
param("remise", "Remise volume au-delà de 10 licences", "%", 0.1, PCT);
param("licA", "Licences moyennes par client — Produit A", "nb", 6, "0");
param("licB", "Licences moyennes par client — Produit B", "nb", 12, "0");
param("prixEffA", "Prix mensuel par client — Produit A", "€", `=$D$${P.licA}*IF($D$${P.licA}>10,$D$${P.prixA}*(1-$D$${P.remise}),$D$${P.prixA})`, EUR);
param("prixEffB", "Prix mensuel par client — Produit B", "€", `=$D$${P.licB}*IF($D$${P.licB}>10,$D$${P.prixB}*(1-$D$${P.remise}),$D$${P.prixB})`, EUR);
param("index", "Indexation annuelle des prix", "%", 0.03, PCT);
param("churnA", "Attrition mensuelle des clients — Produit A", "%", 0.015, PCT);
param("churnB", "Attrition mensuelle des clients — Produit B", "%", 0.01, PCT);
param("mes", "Frais de mise en service par nouveau client", "€", 600, EUR);
section("2. Équipe commerciale");
param("ramp", "Montée en compétence d'un commercial", "mois", 4, "0");
param("signA", "Signatures Produit A par commercial productif et par mois", "nb", 1.6, "0.0");
param("signB", "Signatures Produit B par commercial productif et par mois", "nb", 0.5, "0.0");
param("rotation", "Rotation annuelle des commerciaux", "%", 0.12, PCT);
param("vacance", "Vacance après un départ", "mois", 2, "0");
param("attr", "Facteur de capacité après attrition", "coef.", `=MAX(0,1-$D$${P.rotation}*($D$${P.vacance}+$D$${P.ramp}/2)/12)`, "0.000");
param("coutCom", "Coût mensuel chargé d'un commercial", "€", 5200, EUR);
param("commission", "Commission sur le chiffre d'affaires", "%", 0.06, PCT);
const HIRES = [4, 7, 10, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 46, 49, 52, 55, 58];
HIRES.forEach((m, i) => param(`hire${i + 1}`, `Mois d'embauche — commercial n°${i + 1}`, "mois", m, "0"));
section("3. Pipeline et partenaires");
param("leadCost", "Coût d'acquisition d'un lead", "€", 45, EUR);
param("leadGrowth", "Croissance annuelle des leads", "%", 0.15, PCT);
param("rdv", "Taux de rendez-vous qualifiés", "%", 0.18, PCT);
param("oppCap", "Opportunités suivies par commercial productif", "nb", 12, "0");
param("partOn", "Canal partenaires activé (1/0)", "0/1", 1, "0");
param("partStart", "Démarrage du canal partenaires", "mois", 6, "0");
param("partRamp", "Montée en charge du canal partenaires", "mois", 3, "0");
param("partRate", "Signatures Produit A par mois via partenaires (régime)", "nb", 2.5, "0.0");
section("4. Support et charges");
param("cps", "Clients par ETP support", "nb", 120, "0");
param("supStart", "Premier mois d'embauche support", "mois", 3, "0");
param("supMax", "ETP support maximum", "ETP", 6, "0");
param("coutSup", "Coût mensuel chargé d'un ETP support", "€", 3800, EUR);
param("hebMin", "Hébergement minimum", "€", 400, EUR);
param("hebClient", "Hébergement par client", "€", 2.5, EUR);
param("mktBase", "Marketing fixe", "€", 3000, EUR);
param("mktRate", "Marketing variable (part du CA)", "%", 0.04, PCT);
param("fg", "Frais généraux", "€", 6500, EUR);
param("inflation", "Inflation annuelle des frais généraux", "%", 0.025, PCT);
param("amort", "Amortissements", "€", 900, EUR);
param("impot", "Taux d'impôt (simplifié)", "%", 0.25, PCT);
param("delai", "Part du CA encaissée le mois suivant", "%", 0.3, PCT);
param("apport", "Trésorerie d'ouverture", "€", 150000, EUR);
param("prudence", "Coefficient de la variante prudente", "coef.", 0.85, "0.00");
hyp["!ref"] = `A1:D${hr}`;

/* ------------------------------------------------------------------ Plan mensuel */
const ws = (sheets[PLAN] = {} as XLSX.WorkSheet);
put(ws, "A1", "Exemple SA — plan mensuel 60 mois (janv. 2027 – déc. 2031), EUR HT — données fictives");
put(ws, "A2", "Toutes les cellules sont des formules liées à la colonne D de l'onglet Hypothèses. Colonne C = ouverture (avant le mois 1). Résumé (besoin de financement, point bas) en bas de la feuille.");
put(ws, "A3", "Lecture : embauches support calculées sur le mois précédent (pas de références circulaires).");
put(ws, "A5", "Poste");
put(ws, "B5", "Unité");
put(ws, "C5", "Ouverture");
for (let m = 1; m <= 60; m++) put(ws, `${L(MONTH_COL(m))}5`, `M${m}`);
for (let y = 1; y <= 5; y++) put(ws, `${L(YEAR_COL(y))}5`, 2026 + y);
put(ws, "A7", "Calendrier");
put(ws, "A8", "Mois");
for (let m = 1; m <= 60; m++) put(ws, `${L(MONTH_COL(m))}8`, `=DATE(2027,${m},1)`, "mmm yyyy");

type Annual = "last" | "avg" | "sum" | ((y: number, first: string, last: string) => string) | null;
let row = 9;
const rowsOf: Record<string, number> = {};
const line = (key: string, label: string, unit: string, f: (m: number, c: string, p: string) => string, opts: { opening?: number | string; z?: string; annual?: Annual } = {}) => {
  const r = row++;
  rowsOf[key] = r;
  put(ws, `A${r}`, label);
  put(ws, `B${r}`, unit);
  if (opts.opening !== undefined) put(ws, `C${r}`, opts.opening, opts.z);
  for (let m = 1; m <= 60; m++) put(ws, `${L(MONTH_COL(m))}${r}`, "=" + f(m, L(MONTH_COL(m)), L(MONTH_COL(m) - 1)), opts.z);
  const an = opts.annual === undefined ? "last" : opts.annual;
  if (an)
    for (let y = 1; y <= 5; y++) {
      const first = L(MONTH_COL((y - 1) * 12 + 1));
      const last = L(MONTH_COL(y * 12));
      const f2 = an === "last" ? `${last}${r}` : an === "avg" ? `AVERAGE(${first}${r}:${last}${r})` : an === "sum" ? `SUM(${first}${r}:${last}${r})` : an(y, first, last);
      put(ws, `${L(YEAR_COL(y))}${r}`, "=" + f2, opts.z);
    }
  return r;
};
const sectionRow = (t: string) => {
  put(ws, `A${row}`, t);
  row++;
};
const R = (key: string) => rowsOf[key]!;

sectionRow("1. Équipe commerciale");
for (let k = 1; k <= 24; k++) {
  const en = row;
  line(`en${k}`, `Commercial salarié n°${k} en poste (1/0)`, "0/1", (m) => `IF(${m}>=${H(P[`hire${k}`]!)},1,0)`, { opening: 0, z: "0" });
  line(`anc${k}`, `Commercial salarié n°${k} — ancienneté`, "mois", (_m, c, p) => `IF(${c}${en}=1,${p}${en + 1}+1,0)`, { opening: 0, z: "0" });
  line(`prod${k}`, `Commercial salarié n°${k} — productivité (ramp)`, "%", (_m, c) => `IF(${c}${en}=1,MIN(1,${c}${en + 1}/${H(P.ramp!)}),0)`, { opening: 0, z: PCT, annual: "avg" });
}
const enRows = Array.from({ length: 24 }, (_, i) => R(`en${i + 1}`));
const prodRows = Array.from({ length: 24 }, (_, i) => R(`prod${i + 1}`));
line("enPoste", "Commerciaux salariés en poste", "pers.", (_m, c) => enRows.map((r) => `${c}${r}`).join("+"), { opening: 0, z: "#,##0.0" });
line("capacite", "Capacité commerciale salariés (ETP productifs, après attrition)", "ETP", (_m, c) => `(${prodRows.map((r) => `${c}${r}`).join("+")})*${H(P.attr!)}`, { z: "0.00", annual: "avg" });
line("recrues", "Commerciaux recrutés dans le mois", "pers.", (_m, c, p) => `${c}${R("enPoste")}-${p}${R("enPoste")}`, { z: "0", annual: "sum" });
row++;
sectionRow("2. Pipeline, clients et revenus");
line("leads", "Leads marketing", "nb", (m) => `${H(P.mktBase!)}/${H(P.leadCost!)}*(1+${H(P.leadGrowth!)})^INT((${m}-1)/12)`, { z: "#,##0", annual: "sum" });
line("rdv", "Rendez-vous qualifiés", "nb", (_m, c) => `${c}${R("leads")}*${H(P.rdv!)}`, { z: "#,##0.0", annual: "sum" });
line("opp", "Opportunités suivies", "nb", (_m, c) => `MIN(${c}${R("rdv")},${c}${R("capacite")}*${H(P.oppCap!)})`, { z: "#,##0.0", annual: "sum" });
line("part", "Canal partenaires — montée en charge", "%", (m) => `IF(AND(${H(P.partOn!)}=1,${m}>=${H(P.partStart!)}),MIN(1,(${m}-${H(P.partStart!)}+1)/${H(P.partRamp!)}),0)`, { z: PCT, annual: "avg" });
line("newA", "Nouveaux clients Produit A", "clients", (_m, c) => `${c}${R("capacite")}*${H(P.signA!)}+${c}${R("part")}*${H(P.partRate!)}`, { z: "#,##0.0", annual: "sum" });
line("newB", "Nouveaux clients Produit B", "clients", (_m, c) => `${c}${R("capacite")}*${H(P.signB!)}`, { z: "#,##0.0", annual: "sum" });
line("transfo", "Taux de transformation des opportunités", "%", (_m, c) => `IF(${c}${R("opp")}=0,0,(${c}${R("newA")}+${c}${R("newB")})/${c}${R("opp")})`, { z: PCT, annual: "avg" });
const cliA = row;
line("cliA", "Clients actifs Produit A", "clients", (_m, c, p) => `${p}${cliA}*(1-${H(P.churnA!)})+${c}${R("newA")}`, { opening: 0, z: "#,##0.0" });
const cliB = row;
line("cliB", "Clients actifs Produit B", "clients", (_m, c, p) => `${p}${cliB}*(1-${H(P.churnB!)})+${c}${R("newB")}`, { opening: 0, z: "#,##0.0" });
line("cli", "Clients actifs (total)", "clients", (_m, c) => `${c}${cliA}+${c}${cliB}`, { z: "#,##0.0" });
line("pA", "Prix mensuel par client Produit A", "€", (m) => `${H(P.prixEffA!)}*(1+${H(P.index!)})^INT((${m}-1)/12)`, { z: EUR });
line("pB", "Prix mensuel par client Produit B", "€", (m) => `${H(P.prixEffB!)}*(1+${H(P.index!)})^INT((${m}-1)/12)`, { z: EUR });
line("mrrA", "MRR Produit A", "€", (_m, c) => `${c}${cliA}*${c}${R("pA")}`, { z: EUR });
line("mrrB", "MRR Produit B", "€", (_m, c) => `${c}${cliB}*${c}${R("pB")}`, { z: EUR });
line("mrr", "MRR total", "€", (_m, c) => `${c}${R("mrrA")}+${c}${R("mrrB")}`, { z: EUR });
line("arpa", "Revenu mensuel moyen par client", "€", (_m, c) => `IF(${c}${R("cli")}=0,0,${c}${R("mrr")}/${c}${R("cli")})`, { z: EUR, annual: "avg" });
line("mes", "Mises en service", "€", (_m, c) => `(${c}${R("newA")}+${c}${R("newB")})*${H(P.mes!)}`, { z: EUR, annual: "sum" });
const ca = line("ca", "Chiffre d'affaires HT", "€", (_m, c) => `${c}${R("mrr")}+${c}${R("mes")}`, { opening: 0, z: EUR, annual: "sum" });
row++;
sectionRow("3. Charges");
line("salCom", "Salaires commerciaux", "€", (_m, c) => `${c}${R("enPoste")}*${H(P.coutCom!)}`, { z: EUR, annual: "sum" });
line("comm", "Commissions", "€", (_m, c) => `${c}${ca}*${H(P.commission!)}`, { z: EUR, annual: "sum" });
const sup = row;
line("sup", "Équipe support", "ETP", (m, _c, p) => `MAX(${p}${sup},IF(AND(${m}>=${H(P.supStart!)},${p}${cliA}+${p}${cliB}>=${H(P.cps!)}),MIN(${H(P.supMax!)},INT((${p}${cliA}+${p}${cliB})/${H(P.cps!)})),0))`, { opening: 0, z: "#,##0.0" });
line("salSup", "Salaires support", "€", (_m, c) => `${c}${sup}*${H(P.coutSup!)}`, { z: EUR, annual: "sum" });
line("heb", "Hébergement", "€", (_m, c) => `MAX(${H(P.hebMin!)},${c}${R("cli")}*${H(P.hebClient!)})`, { z: EUR, annual: "sum" });
line("mkt", "Marketing", "€", (_m, c) => `${H(P.mktBase!)}+${c}${ca}*${H(P.mktRate!)}`, { z: EUR, annual: "sum" });
line("fg", "Frais généraux", "€", (m) => `${H(P.fg!)}*(1+${H(P.inflation!)})^INT((${m}-1)/12)`, { z: EUR, annual: "sum" });
line("charges", "Total charges", "€", (_m, c) => ["salCom", "comm", "salSup", "heb", "mkt", "fg"].map((k) => `${c}${R(k)}`).join("+"), { z: EUR, annual: "sum" });
row++;
sectionRow("4. Résultat et trésorerie");
line("ebitda", "EBITDA", "€", (_m, c) => `${c}${ca}-${c}${R("charges")}`, { z: EUR, annual: "sum" });
line("marge", "Marge EBITDA", "%", (_m, c) => `IF(${c}${ca}=0,0,${c}${R("ebitda")}/${c}${ca})`, { z: PCT, annual: (y) => `IF(${L(YEAR_COL(y))}${ca}=0,0,${L(YEAR_COL(y))}${R("ebitda")}/${L(YEAR_COL(y))}${ca})` });
line("amort", "Amortissements", "€", () => H(P.amort!), { z: EUR, annual: "sum" });
line("impot", "Impôt (simplifié)", "€", (_m, c) => `MAX(0,${c}${R("ebitda")}-${c}${R("amort")})*${H(P.impot!)}`, { z: EUR, annual: "sum" });
line("rn", "Résultat net", "€", (_m, c) => `${c}${R("ebitda")}-${c}${R("amort")}-${c}${R("impot")}`, { z: EUR, annual: "sum" });
line("enc", "Encaissements clients", "€", (_m, c, p) => `${c}${ca}*(1-${H(P.delai!)})+${p}${ca}*${H(P.delai!)}`, { z: EUR, annual: "sum" });
line("dec", "Décaissements", "€", (_m, c) => `${c}${R("charges")}+${c}${R("impot")}`, { z: EUR, annual: "sum" });
const treso = row;
line("treso", "Trésorerie fin de mois", "€", (_m, c, p) => `${p}${treso}+${c}${R("enc")}-${c}${R("dec")}`, { opening: `=${H(P.apport!)}`, z: EUR });
const eff = line("eff", "Effectif total (y.c. fondateur)", "pers.", (_m, c) => `${c}${R("enPoste")}+${c}${sup}+1`, { z: "#,##0.0" });
row++;
const D = L(MONTH_COL(1));
const BK = L(MONTH_COL(60));
const trRange = `${D}${treso}:${BK}${treso}`;
put(ws, `A${row++}`, "RÉSUMÉ DU SCÉNARIO");
const summary: [string, string, string][] = [
  ["Besoin de financement", `=MAX(0,-MIN(${trRange}))`, EUR],
  ["Trésorerie minimale", `=MIN(${trRange})`, EUR],
  ["Mois du point bas", `=INDEX(${D}8:${BK}8,MATCH(MIN(${trRange}),${trRange},0))`, "mmm yyyy"],
  ["Commerciaux en fin de plan", `=${BK}${R("enPoste")}`, "0"],
  ["Clients actifs en fin de plan", `=ROUND(${BK}${R("cli")},0)`, "#,##0"],
  ["Résultat net cumulé sur 60 mois", `=SUM(${D}${R("rn")}:${BK}${R("rn")})`, EUR],
];
for (const [label, f, z] of summary) {
  put(ws, `A${row}`, label);
  put(ws, `C${row}`, f, z);
  row++;
}
ws["!ref"] = `A1:${L(YEAR_COL(5))}${row - 1}`;

/* ------------------------------------------------------------------ Synthèse (deux variantes) */
const sy = (sheets[SYN] = {} as XLSX.WorkSheet);
put(sy, "A1", "Synthèse — Exemple SA (Produit A + Produit B), plan 60 mois, EUR HT — données fictives");
put(sy, "A2", "Colonnes B–F : scénario central ; colonnes G–K : variante prudente (coefficient de l'onglet Hypothèses). Projections fictives, pas des données constatées.");
put(sy, "A4", "1. Tableau annuel 2027 à 2031");
put(sy, "A5", "Indicateur");
for (let y = 1; y <= 5; y++) {
  put(sy, `${L(y)}5`, `Central — ${2026 + y}`);
  put(sy, `${L(5 + y)}5`, `Prudent — ${2026 + y}`);
}
const synRows: [string, number, string, boolean][] = [
  ["Chiffre d'affaires HT", ca, EUR, false],
  ["EBITDA", R("ebitda"), EUR, false],
  ["Résultat net", R("rn"), EUR, false],
  ["Effectif fin d'année (y.c. fondateur)", eff, "#,##0.0", true],
  ["dont commerciaux salariés", R("enPoste"), "#,##0.0", true],
];
synRows.forEach(([label, src, z, round], i) => {
  const r = 6 + i;
  put(sy, `A${r}`, label);
  for (let y = 1; y <= 5; y++) {
    put(sy, `${L(y)}${r}`, `='${PLAN}'!$${L(YEAR_COL(y))}$${src}`, z);
    put(sy, `${L(5 + y)}${r}`, round ? `=ROUND(${L(y)}${r}*${H(P.prudence!)},0)` : `=${L(y)}${r}*${H(P.prudence!)}`, z);
  }
});
sy["!ref"] = "A1:K10";

/* ------------------------------------------------------------------ Lisez-moi / Sources */
const readme = (sheets["Lisez-moi"] = {} as XLSX.WorkSheet);
[
  "Lisez-moi",
  "",
  "Classeur FICTIF de démonstration pour les tests automatisés de Reporting 4D Studio (import intelligent) : société « Exemple SA », produits « Produit A » et « Produit B ».",
  "Aucune donnée réelle : toutes les hypothèses de l'onglet Hypothèses sont inventées ; les autres onglets ne contiennent que des formules.",
  "Onglets : Hypothèses (paramètres), Plan 60m — Exemple (plan mensuel janv. 2027 – déc. 2031), Synthèse (tableau annuel, deux variantes), Sources.",
].forEach((t, i) => t && put(readme, `A${i + 1}`, t));
readme["!ref"] = "A1:A5";
const sources = (sheets["Sources"] = {} as XLSX.WorkSheet);
[
  "Sources",
  "",
  "Hypothèses inventées pour les tests ; ordres de grandeur arbitraires, sans lien avec une entreprise existante.",
  "Recalcul de référence : LibreOffice (soffice --headless), voir studio/scripts/make-test-fixtures.ts.",
].forEach((t, i) => t && put(sources, `A${i + 1}`, t));
sources["!ref"] = "A1:A4";

/* ------------------------------------------------------------------ écriture + recalcul LibreOffice */
const wb = XLSX.utils.book_new();
for (const n of ["Lisez-moi", HYP, PLAN, SYN, "Sources"]) XLSX.utils.book_append_sheet(wb, sheets[n]!, n);
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
writeFileSync(resolve(OUT, "plan-mini.xlsx"), buf);

const tmp = mkdtempSync(join(tmpdir(), "r4d-fx-"));
writeFileSync(join(tmp, "plan-mini.xlsx"), buf);
const lo = spawnSync("soffice", ["--headless", "--norestore", `-env:UserInstallation=file://${tmp}/profile`, "--convert-to", "xlsx", "--outdir", join(tmp, "recalc"), join(tmp, "plan-mini.xlsx")], { encoding: "utf8" });
if (lo.status !== 0) throw new Error(`LibreOffice : ${lo.stderr || lo.stdout}`);
const ref = XLSX.read(readFileSync(join(tmp, "recalc", "plan-mini.xlsx")), { type: "buffer" });
const expected: Record<string, Record<string, number | string>> = {};
let nf = 0;
for (const n of wb.SheetNames) {
  expected[n] = {};
  for (const [a, c] of Object.entries(wb.Sheets[n]!)) {
    if (a[0] === "!" || !(c as Cell).f) continue;
    nf++;
    const e = ref.Sheets[n]?.[a] as Cell | undefined;
    if (!e || (e.t !== "n" && e.t !== "s")) throw new Error(`${n}!${a} : pas de valeur LibreOffice`);
    expected[n]![a] = e.v as number | string;
  }
}
writeFileSync(resolve(OUT, "plan-mini.expected.json"), JSON.stringify(expected));

/* ------------------------------------------------------------------ collage TSV (équipe commerciale, M1…M26) */
const rs = ref.Sheets[PLAN]!;
const MOIS = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
const NCOL = 26;
const fr = (v: number, z: string) => (z === PCT ? `${(v * 100).toFixed(1).replace(".", ",")}%` : String(Math.round(v * 1000) / 1000).replace(".", ","));
const tsv: string[][] = [["Poste", "Unité", "Ouverture", ...Array.from({ length: NCOL }, (_, i) => `M${i + 1}`)], Array(NCOL + 3).fill(""), ["Calendrier", ...Array(NCOL + 2).fill("")]];
tsv.push(["Mois", "", "", ...Array.from({ length: NCOL }, (_, i) => `${MOIS[i % 12]} ${2027 + Math.floor(i / 12)}`)]);
tsv.push(["1. Équipe commerciale", ...Array(NCOL + 2).fill("")]);
for (let r = R("en1"); r <= R("prod24"); r++) {
  const z = (ws[`D${r}`] as Cell).z ?? "0";
  const v = (c: number) => Number((rs[`${L(c)}${r}`] as Cell | undefined)?.v ?? 0);
  tsv.push([String(ws[`A${r}`]!.v), String(ws[`B${r}`]!.v), fr(v(2), z), ...Array.from({ length: NCOL }, (_, i) => fr(v(MONTH_COL(i + 1)), z))]);
}
writeFileSync(resolve(OUT, "plan-commercial.tsv"), tsv.map((r) => r.join("\t")).join("\n") + "\n");
console.log(`plan-mini.xlsx : ${(buf.length / 1024).toFixed(0)} Ko, ${nf} formules ; plan-commercial.tsv : ${tsv.length} lignes`);
