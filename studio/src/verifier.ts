/**
 * Page « Vérifier l'empreinte » (verifier.html) : lit le fragment du lien du QR, présente la provenance
 * du graphique, puis recalcule l'empreinte SHA-256 d'un fichier déposé ou d'un texte collé, avec les mêmes
 * règles que le Studio (`provenance.ts`). Tout reste dans le navigateur : rien n'est envoyé.
 */
import "./verifier.css";
import { tell4dIconMarkup, PLATFORM_URL, PRODUCT_LABEL, wordmarkMarkup } from "./brand";
import { canonicalJson, cryptoAvailable, frDateYmd, normalizePastedText, parseVerifyFragment, sha256Hex, shortFingerprint, type VerifyInfo } from "./provenance";
import { SAMPLES } from "./data/samples";

type Rule = "bytes" | "text" | "rows";
const RULE_LABEL: Record<Rule, string> = {
  bytes: "octets du fichier",
  text: "texte normalisé",
  rows: "lignes JSON (forme canonique)",
};

interface Candidate {
  rule: Rule;
  hash: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

const nf = (n: number) => n.toLocaleString("fr-FR");
const plural = (n: number, one: string, many: string) => `${nf(n)} ${n > 1 ? many : one}`;

/** Lignes d'un JSON (tableau, { data|rows|records: [...] }, ou configuration Datanime avec données). */
function jsonRows(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.data && typeof o.data === "object" && Array.isArray((o.data as Record<string, unknown>).rows)) return (o.data as { rows: unknown[] }).rows;
    for (const k of ["rows", "data", "records", "items", "values"]) if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return null;
}

async function textCandidates(text: string): Promise<Candidate[]> {
  const out: Candidate[] = [{ rule: "text", hash: await sha256Hex(normalizePastedText(text)) }];
  const t = text.replace(/^\uFEFF/, "").trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const rows = jsonRows(JSON.parse(t));
      if (rows) out.push({ rule: "rows", hash: await sha256Hex(canonicalJson(rows)) });
    } catch {
      /* pas du JSON */
    }
  }
  return out;
}

/** Empreintes candidates d'un fichier : octets bruts, puis (fichier texte) texte normalisé et lignes JSON. */
async function fileCandidates(buf: ArrayBuffer): Promise<Candidate[]> {
  const out: Candidate[] = [{ rule: "bytes", hash: await sha256Hex(buf) }];
  if (buf.byteLength <= 50_000_000) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      if (!/\u0000/.test(text)) out.push(...(await textCandidates(text)));
    } catch {
      /* fichier binaire (Excel…) : octets seulement */
    }
  }
  return out;
}

/* ------------------------------------------------------------------ interface */

const info: VerifyInfo | null = parseVerifyFragment(location.hash);
const hadFragment = location.hash.replace(/^#/, "").trim().length > 0;
const root = document.getElementById("verifier")!;

const header = el(
  "header",
  { class: "v-top" },
  el("a", { class: "v-brand", href: "./", title: `${PRODUCT_LABEL} · Studio` }, el("span", { class: "v-logo", html: tell4dIconMarkup("t4d-v", 30) }), el("span", { class: "v-name", html: wordmarkMarkup("dark", 15) })),
  el("span", { class: "v-sep" }, "·"),
  el("h1", {}, "Vérifier l'empreinte des données")
);

function summaryCard(): HTMLElement {
  if (!info) {
    return el(
      "section",
      { class: "v-card v-summary v-summary-missing", "data-testid": "v-summary" },
      el("h2", {}, hadFragment ? "Lien de vérification incomplet ou illisible" : "Aucun graphique à vérifier"),
      el("p", {}, hadFragment ? "Ce lien a peut-être été tronqué. Scannez de nouveau le QR du cartouche Datanime, ou ouvrez le lien complet." : "Scannez le QR du cartouche d'un graphique Datanime pour afficher sa provenance ici."),
      el("p", { class: "v-muted" }, "Vous pouvez quand même calculer l'empreinte d'un fichier ci-dessous et la comparer à celle du cartouche (« Empreinte … »).")
    );
  }
  const dims = `${plural(info.n, "ligne", "lignes")}, ${plural(info.c, "colonne", "colonnes")}`;
  const gen = frDateYmd(info.g);
  const imp = frDateYmd(info.i);
  const origin =
    info.kind === "sample"
      ? `à partir des données d'exemple du Studio au ${imp} (${dims})`
      : info.kind === "paste"
        ? `à partir de données collées le ${imp} (${dims})`
        : `à partir de données importées le ${imp} (${dims})`;
  return el(
    "section",
    { class: "v-card v-summary", "data-testid": "v-summary" },
    el("p", { class: "v-kicker" }, "Empreinte déclarée par le QR"),
    el("p", { class: "v-lead" }, `Selon ce QR, ce graphique a été généré par ${PRODUCT_LABEL} le ${gen} ${origin}, empreinte ${shortFingerprint(info.h)}.`),
    el("p", { class: "v-declared", "data-testid": "v-declared" }, "Il s'agit d'une empreinte déclarée, pas d'une signature : elle ne garantit ni que le graphique est fidèle aux données, ni qu'il provient de Datanime. Elle permet seulement de vérifier qu'un fichier a la même empreinte que celle inscrite dans le QR."),
    el("dl", { class: "v-facts" }, el("dt", {}, "Empreinte des données"), el("dd", { class: "v-mono", "data-testid": "v-hash" }, `${info.h.slice(0, 4)}·${info.h.slice(4, 8)} ${info.h.slice(8).replace(/(.{8})/g, "$1 ").trim()}`), el("dt", {}, "Calcul"), el("dd", {}, "SHA-256, 128 premiers bits"))
  );
}

const result = el("section", { class: "v-result", "aria-live": "polite", "data-testid": "v-result", hidden: "" });

function showResult(kind: "ok" | "ko" | "neutral" | "error", title: string, detail: string, extra?: string): void {
  result.hidden = false;
  result.className = `v-result v-${kind}`;
  result.dataset.state = kind;
  result.replaceChildren(el("p", { class: "v-result-title" }, title), el("p", { class: "v-result-detail" }, detail));
  if (extra) result.append(el("p", { class: "v-result-extra v-mono" }, extra));
}

function judge(cands: Candidate[], what: string): void {
  if (!info) {
    const c = cands[0]!;
    showResult("neutral", `Empreinte ${shortFingerprint(c.hash)}`, `Empreinte de ${what} (${RULE_LABEL[c.rule]}). Comparez-la à celle du cartouche du graphique.`, c.hash.slice(0, 32));
    return;
  }
  const hit = cands.find((c) => c.hash.slice(0, 32) === info.h);
  if (hit) showResult("ok", "✓ Les données correspondent", `L'empreinte de ${what} (${RULE_LABEL[hit.rule]}) est identique à celle déclarée dans le QR\u00a0: ${shortFingerprint(hit.hash)}.`);
  else showResult("ko", "✗ Les données ne correspondent pas à ce graphique", `L'empreinte de ${what} (${shortFingerprint(cands[0]!.hash)}) diffère de celle déclarée dans le QR (${shortFingerprint(info.h)}). Un seul caractère modifié suffit à changer l'empreinte.`);
}

async function verifyFile(file: File): Promise<void> {
  if (!cryptoAvailable()) return showResult("error", "Vérification indisponible", "Votre navigateur ne permet pas le calcul d'empreinte sur cette page (connexion non sécurisée).");
  showResult("neutral", "Calcul de l'empreinte…", file.name);
  try {
    judge(await fileCandidates(await file.arrayBuffer()), `« ${file.name} »`);
  } catch (e) {
    showResult("error", "Lecture du fichier impossible", e instanceof Error ? e.message : String(e));
  }
}

async function verifyText(text: string): Promise<void> {
  if (!text.trim()) return showResult("error", "Texte vide", "Collez le tableau d'origine (copié depuis Excel, Sheets ou un fichier CSV).");
  if (!cryptoAvailable()) return showResult("error", "Vérification indisponible", "Votre navigateur ne permet pas le calcul d'empreinte sur cette page (connexion non sécurisée).");
  judge(await textCandidates(text), "texte collé");
}

/** Exemples intégrés : l'empreinte se recalcule directement (aucun fichier à fournir). */
async function checkSamples(): Promise<void> {
  if (!info || info.kind !== "sample" || !cryptoAvailable()) return;
  for (const s of SAMPLES) {
    const h = await sha256Hex(canonicalJson(s.rows()));
    if (h.slice(0, 32) === info.h) {
      showResult("ok", "✓ Les données correspondent", `Exemple intégré au Studio : « ${s.name} » (données d'exemple, empreinte ${shortFingerprint(h)}).`);
      return;
    }
  }
  showResult("ko", "✗ Les données ne correspondent pas à ce graphique", "Aucun exemple intégré à cette version du Studio n'a cette empreinte.");
}

const fileInput = el("input", { type: "file", class: "v-hidden", "data-testid": "v-file", accept: ".csv,.tsv,.txt,.json,.xlsx,.xls,.xlsm,.ods,*/*" });
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void verifyFile(f);
  fileInput.value = "";
});
const drop = el(
  "section",
  { class: "v-card v-drop", tabindex: "0", role: "button", "aria-label": "Déposez le fichier d'origine pour vérifier", "data-testid": "v-drop" },
  el("span", { class: "v-drop-icon", html: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>' }),
  el("p", { class: "v-drop-title" }, "Déposez le fichier d'origine pour vérifier"),
  el("p", { class: "v-muted" }, "CSV, TSV, JSON, Excel… Le fichier reste sur votre appareil : rien n'est envoyé."),
  el("span", { class: "v-btn" }, "Choisir un fichier"),
  fileInput
);
drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
for (const ev of ["dragenter", "dragover"]) document.addEventListener(ev, (e) => {
  e.preventDefault();
  drop.classList.add("v-over");
});
for (const ev of ["dragleave", "drop"]) document.addEventListener(ev, () => drop.classList.remove("v-over"));
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) void verifyFile(f);
});

const ta = el("textarea", { rows: "6", placeholder: "Collez ici le tableau d'origine (tel que collé dans le Studio)…", "data-testid": "v-paste", spellcheck: "false" });
const pasteBtn = el("button", { type: "button", class: "v-btn", "data-testid": "v-paste-check" }, "Vérifier le texte collé");
pasteBtn.addEventListener("click", () => void verifyText(ta.value));
const paste = el("details", { class: "v-card v-paste" }, el("summary", {}, "…ou collez le tableau d'origine (texte)"), ta, pasteBtn);

const note = el("p", { class: "v-note", "data-testid": "v-note" }, "La vérification compare l'empreinte du fichier ; elle ne dit rien de l'exactitude des données. Empreinte déclarée, pas une signature. Un registre en ligne viendra renforcer cette vérification.");
const footer = el("footer", { class: "v-foot" }, el("a", { href: "./" }, `${PRODUCT_LABEL} · Studio`), " · ", el("span", {}, "Vérification 100 % dans votre navigateur"), " · ", el("a", { href: PLATFORM_URL, rel: "noopener" }, PLATFORM_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")));

root.replaceChildren(el("div", { class: "v-wrap" }, header, el("main", { class: "v-main" }, summaryCard(), drop, paste, result, note), footer));
if (info?.kind === "paste") paste.open = true;
void checkSamples();
window.addEventListener("hashchange", () => location.reload());

/** Accès pour les tests e2e. */
(window as unknown as { t4dVerifier: unknown }).t4dVerifier = { info, verifyText, fileCandidates };
