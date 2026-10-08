/**
 * Tell4D · Studio (moteur Reporting 4D) — point d'entrée.
 * Trois zones : Données | Aperçu | Réglages. Tout le rendu est en SVG (D3).
 */
import "./styles.css";
import { Store } from "./state";
import { chartSize, isSpecial, parseSpec, studioFileSchema, type ChartSpec, type ChartType } from "./spec";
import { buildDataset, serializableRaw, type Dataset } from "./data/table";
import { readFile, parseText, type ImportResult } from "./data/files";
import { SAMPLES, sampleById } from "./data/samples";
import { autoEncode } from "./data/suggest";
import { Preview } from "./ui/preview";
import { SettingsPanel } from "./ui/settings";
import { DataPanel } from "./ui/dataPanel";
import { Gallery } from "./ui/gallery";
import { toast } from "./ui/toast";
import { h, svgIcon, ICONS } from "./ui/dom";
import { download, recordWebm, slug, studioFile, svgToPngBlob, webmSupported, exportGif, svgToJpegDataUrl, embedFontsInto, blobToDataUrl } from "./export";
import { themeFor, ensureFont } from "./theme";
import { tell4dIconMarkup } from "./brand";
import { guessUnit } from "./format";
import { SAMPLE_TODAY } from "./data/samples";
import { Explorer } from "./ui/explorer";
import { StoryStrip } from "./ui/storyStrip";
import type { Insight, StoryContext } from "./story/insights";
import { narrate, narrativeKey, applyNarrative, type Narrative } from "./story/narrate";
import { MAX_SNAPSHOTS, newSnapshotId, parseStory, roleForKind, type Snapshot } from "./story/snapshots";
import type { SlideImage } from "./story/pptx";
import { composeSvg } from "./export";
import { prepareCache, renderChart, valueMaxOf } from "./charts/render";
import { NORME_WORDING_F, SCENARIO_CODES, SCENARIO_HELP, SCENARIO_NAMES, normeAdvice, scaleGroups, scaleKey, type ScaleInfo } from "./norme";
import { valueFormatter } from "./format";
import { MappingWindow, type MappingApply, type MappingSource } from "./ui/mapping";
import { readWorkbookData, sheetMatrix, toWorkbookIn, type Matrix, type WorkbookData } from "./data/workbook";
import { detectStructure } from "./data/structure";
import { detectDelimiter, parseDelimitedMatrix } from "span-magnitude-viz/fileImport";
import { cryptoAvailable, hashFileBytes, hashPastedText, hashRows, makeProvenance, type Provenance, type ProvenanceKind } from "./provenance";

const store = new Store();
const preview = new Preview(store);

/* ------------------------------------------------------------------ récit calculé */

/** « Aujourd'hui » : date figée des exemples (8 oct. 2026), sinon la date réelle (minuit UTC). */
function storyContext(): StoryContext {
  const { ds, sampleId } = store.state;
  const d = new Date();
  const today = sampleId ? Date.parse(`${SAMPLE_TODAY}T00:00:00Z`) : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return { today, entity: ds?.name };
}

let narrCache: { key: string; n: Narrative | null } = { key: "", n: null };
function currentNarrative(): Narrative | null {
  const { spec, ds, dsVersion } = store.state;
  const sc = storyContext();
  const key = narrativeKey(spec, dsVersion, sc);
  if (key !== narrCache.key) narrCache = { key, n: narrate(spec, ds, sc) };
  return narrCache.n;
}
/** Mode norme : bascule douce (types déconseillés → barres, orientation temps / structure), avant le récit. */
let lastNotice = { text: "", at: 0 };
function applyNormeAdvice(spec: ChartSpec, ds: Dataset | null): ChartSpec {
  let out = spec;
  for (let k = 0; k < 2; k++) {
    const adv = out.norme.enabled ? normeAdvice(out, ds) : null;
    if (!adv || adv.soft || (!adv.patch.type && !adv.patch.style)) break;
    out = { ...out, type: adv.patch.type ?? out.type, style: { ...out.style, ...(adv.patch.style ?? {}) } };
    const now = Date.now();
    if (adv.notice !== lastNotice.text || now - lastNotice.at > 3000) {
      lastNotice = { text: adv.notice, at: now };
      setTimeout(() => toast(adv.notice, "info", 4200), 0);
    }
  }
  return out;
}
store.beforeNotify = (state) => {
  const adjusted = applyNormeAdvice(state.spec, state.ds);
  const changed = adjusted !== state.spec;
  if (changed) state.spec = adjusted;
  return applyNarrative(state.spec, currentNarrative()) ?? (changed ? adjusted : null);
};

/** Spec « neuf » côté récit : textes recalculés (drapeaux de saisie remis à zéro). */
function freshStory(spec: { story?: unknown } & Record<string, unknown>) {
  const st = (spec.story ?? {}) as Record<string, unknown>;
  return { ...spec, story: { ...st, auto: true, edited: { title: false, subtitle: false, comments: false } } };
}

/* ------------------------------------------------------------------ actions */

function keepStyle(spec: ChartSpec) {
  const s = spec.style;
  return { background: s.background, backgroundCustom: s.backgroundCustom, palette: s.palette, paletteCustom: s.paletteCustom, font: s.font, size: s.size, accentBar: s.accentBar, brandMark: s.brandMark, authQr: s.authQr };
}

/* ------------------------------------------------------------------ provenance (empreinte des données) */

let cryptoWarned = false;
/** Empreinte SHA-256 (WebCrypto) ; null si indisponible (page servie hors contexte sécurisé). */
async function safeHash(fn: () => Promise<string>): Promise<string | null> {
  if (!cryptoAvailable()) {
    if (!cryptoWarned) console.warn("Empreinte des données indisponible : WebCrypto exige https, localhost ou file://.");
    cryptoWarned = true;
    return null;
  }
  try {
    return await fn();
  } catch (e) {
    console.warn("Empreinte des données impossible", e);
    return null;
  }
}

const sampleHashes = new Map<string, Promise<string | null>>();
/** Exemples intégrés : empreinte du JSON canonique des lignes, données datées au 8 oct. 2026. */
function sampleProvenance(id: string): Promise<Provenance | null> {
  const sample = sampleById(id);
  if (!sample) return Promise.resolve(null);
  if (!sampleHashes.has(id)) sampleHashes.set(id, safeHash(() => hashRows(sample.rows())));
  const now = new Date();
  return sampleHashes.get(id)!.then((hash) => {
    const ds = store.state.ds;
    return hash && ds ? makeProvenance({ hash, kind: "sample", fileName: sample.name, rows: ds.rows.length, cols: ds.columns.length, asOf: SAMPLE_TODAY, now }) : null;
  });
}

/** Applique une provenance calculée en différé au jeu de données courant (si inchangé entre-temps). */
function attachProvenance(p: Promise<Provenance | null>): void {
  const seq = store.state.dataSeq;
  void p.then((pr) => pr && store.setProvenance(pr, seq));
}

interface ImportOrigin {
  hash: string | null;
  kind: ProvenanceKind;
  fileName: string;
}

function loadSample(id: string): void {
  const sample = sampleById(id);
  if (!sample) return;
  const ds = buildDataset(sample.name, sample.rows());
  const base = sample.spec;
  // Mode norme conservé d'un exemple à l'autre (sauf exemple qui l'impose) ; entité / mesure propres à l'exemple
  const cur = store.state.spec.norme;
  const bn = (base.norme ?? {}) as Partial<ChartSpec["norme"]>;
  const norme = { enabled: bn.enabled ?? cur.enabled, autoSwitch: bn.autoSwitch ?? cur.autoSwitch, entity: bn.entity ?? "", measure: bn.measure ?? "" };
  const r = parseSpec(freshStory({ ...base, norme, style: { ...keepStyle(store.state.spec), ...(base.style ?? {}) } }));
  if (r.ok) store.setSpec(r.spec);
  store.setDataset(ds, { sampleId: sample.id, note: sample.description });
  attachProvenance(sampleProvenance(sample.id));
  toast(`Exemple chargé : ${sample.name}`, "ok", 2200);
}

async function applyImport(res: ImportResult, origin?: ImportOrigin): Promise<void> {
  const ds = buildDataset(res.name, res.rows);
  if (!ds.columns.length || !ds.rows.length) throw new Error("Aucune ligne exploitable.");
  let spec = store.state.spec;
  let type: ChartType = spec.type;
  const hasDate = ds.columns.some((c) => c.type === "date");
  const hasNum = ds.columns.some((c) => c.type === "number");
  if (isSpecial(type) && !(hasDate && hasNum)) type = "bar";
  let encoding = autoEncode({ ...spec, type }, ds, type, true);
  if (isSpecial(type)) {
    const mod = await import("./charts/special");
    encoding = { ...encoding, ...mod.suggestSpecialEncoding(ds) };
  }
  const title = res.name && res.name !== "Collage" ? res.name : "Nouveau graphique";
  const axes = { x: { grid: false }, y: { unit: guessUnit(encoding.y[0]) }, y2: { grid: false } };
  const r = parseSpec({ ...spec, type, encoding: { ...encoding, scenarios: {} }, axes, transform: {}, story: {}, norme: { ...spec.norme, entity: "", measure: "" }, style: { ...spec.style, title, subtitle: "", source: "" }, mode: { ...spec.mode, fourD: { ...spec.mode.fourD, enabled: false } } });
  if (r.ok) store.setSpec(r.spec);
  const provenance = origin?.hash ? makeProvenance({ hash: origin.hash, kind: origin.kind, fileName: origin.fileName, rows: ds.rows.length, cols: ds.columns.length, sheet: res.sheet ?? null }) : null;
  store.setDataset(ds, { note: res.note ?? null, sheets: res.sheets ?? null, sheet: res.sheet ?? null, provenance });
  const types = ds.columns.map((c) => c.type);
  toast(`${ds.rows.length} lignes importées · ${types.filter((t) => t === "number").length} mesure(s), ${types.filter((t) => t === "date").length} date(s)`, "ok");
}

/* ------------------------------------------------------------------ import intelligent (fenêtre « Mise en forme ») */

/** Tableau « simple » : un seul bloc, en-tête en ligne 1, en colonnes, sans sections ni ligne de temps. */
function isPlainMatrix(m: Matrix): boolean {
  const s = detectStructure(m);
  const t = s.tables[s.main];
  return s.tables.length <= 1 && (!t || (t.layout === "long" && t.headerRow === 0 && !t.sections.length && t.timeSource !== "row" && !t.notes.length));
}
/** Classeur à mettre en forme : plusieurs onglets non vides, formules sans résultat, ou feuille « humaine ». */
function needsMapping(wb: WorkbookData): boolean {
  const filled = wb.sheets.filter((s) => s.model.cells.size > 0);
  if (filled.length > 1 || wb.missingCached > 0) return true;
  return !!filled[0] && !isPlainMatrix(sheetMatrix(filled[0]));
}

let lastMapping: { src: MappingSource; origin: ImportOrigin } | null = null;
let pendingOrigin: ImportOrigin | null = null;

function openMapping(src: MappingSource, origin: ImportOrigin): Promise<void> {
  lastMapping = { src, origin };
  pendingOrigin = origin;
  return mappingWindow.open(src);
}

function applyMapping(a: MappingApply): void {
  const ds = buildDataset(a.name, a.rows);
  if (!ds.columns.length || !ds.rows.length) {
    toast("Aucune ligne exploitable.", "error");
    return;
  }
  // Titre saisi dans la fenêtre : protégé du titre calculé par le récit (sous-titre et commentaires restent calculés)
  const fresh = freshStory({ ...a.spec, provenance: null } as unknown as Record<string, unknown>);
  if (a.spec.style.title.trim()) (fresh.story as { edited: { title: boolean } }).edited.title = true;
  const errs = store.setSpec(fresh);
  if (errs.length) toast(errs.join(" ; "), "error");
  const origin = pendingOrigin ?? lastMapping?.origin ?? null;
  const provenance = origin?.hash ? makeProvenance({ hash: origin.hash, kind: origin.kind, fileName: origin.fileName, rows: ds.rows.length, cols: ds.columns.length, sheet: a.sheet }) : null;
  store.setDataset(ds, { note: a.note, sheets: null, sheet: a.sheet, provenance });
  toast(`Mise en forme appliquée : ${ds.rows.length} lignes · ${a.pivot.y.length + (a.pivot.y2 ? 1 : 0)} série(s)`, "ok");
}

/** Texte collé : empreinte du texte normalisé (fins de ligne LF, blancs de fin retirés). */
async function importPasted(text: string): Promise<void> {
  const hashP = safeHash(() => hashPastedText(text));
  const matrix = parseDelimitedMatrix(text, detectDelimiter(text));
  if (matrix.length >= 3 && !isPlainMatrix(matrix)) {
    await openMapping({ kind: "paste", name: "Collage", fileName: "", matrix }, { hash: await hashP, kind: "paste", fileName: "" });
    return;
  }
  const res = parseText(text, "Collage");
  await applyImport(res, { hash: await hashP, kind: "paste", fileName: "" });
}

const WORKBOOK_EXT = /\.(xlsx|xlsm|xls|ods)$/i;
const TEXT_EXT = /\.(csv|tsv|txt)$/i;

/** Fichier déposé / choisi : empreinte des octets bruts du fichier. */
async function importFromFile(file: File, sheet?: string): Promise<void> {
  const buf = await file.arrayBuffer();
  const hashP = safeHash(async () => hashFileBytes(buf));
  const base = file.name.replace(/\.[^.]+$/, "");
  if (!sheet && WORKBOOK_EXT.test(file.name)) {
    const wb = await readWorkbookData(buf);
    if (needsMapping(wb)) {
      await openMapping({ kind: "file", name: base, fileName: file.name, workbook: wb }, { hash: await hashP, kind: "file", fileName: file.name });
      return;
    }
  } else if (TEXT_EXT.test(file.name)) {
    const text = await file.text();
    const matrix = parseDelimitedMatrix(text, detectDelimiter(text));
    if (matrix.length >= 3 && !isPlainMatrix(matrix)) {
      await openMapping({ kind: "file", name: base, fileName: file.name, matrix }, { hash: await hashP, kind: "file", fileName: file.name });
      return;
    }
  }
  const [res, hash] = await Promise.all([readFile(file, sheet), hashP]);
  await applyImport(res, { hash, kind: "file", fileName: file.name });
}

/** « Mise en forme… » : rouvre le dernier fichier, sinon le tableau courant. */
function reopenMapping(): void {
  if (lastMapping) {
    void openMapping(lastMapping.src, lastMapping.origin);
    return;
  }
  const { ds, provenance } = store.state;
  if (!ds || !ds.rows.length) {
    toast("Chargez d'abord un fichier ou collez un tableau.", "info");
    return;
  }
  const cols = ds.columns.map((c) => c.name);
  const matrix: Matrix = [cols, ...ds.raw.map((r) => cols.map((c) => {
    const v = r[c];
    return v == null ? null : typeof v === "number" || typeof v === "boolean" || v instanceof Date ? v : String(v);
  }))];
  void openMapping({ kind: "paste", name: ds.name, fileName: provenance?.fileName ?? "", matrix }, { hash: provenance?.hash ?? null, kind: provenance?.kind ?? "paste", fileName: provenance?.fileName ?? "" });
}

const mappingWindow = new MappingWindow(
  () => store.state.spec,
  (wb, onProgress) => import("./data/formula/recalc").then((m) => m.recalcInBrowser(toWorkbookIn(wb), wb.formulas, onProgress)),
  (a) => applyMapping(a)
);

const actions = {
  loadSample,
  importText(text: string) {
    void importPasted(text).catch((e) => toast(String(e instanceof Error ? e.message : e), "error"));
  },
  importFile(file: File) {
    store.lastFile = file;
    importFromFile(file).catch((e) => toast("Import impossible : " + (e instanceof Error ? e.message : String(e)), "error", 6000));
  },
  changeSheet(name: string) {
    const f = store.lastFile;
    if (!f) return;
    importFromFile(f, name).catch((e) => toast(e instanceof Error ? e.message : String(e), "error"));
  },
  explore() {
    explorer.open();
  },
  reshape() {
    reopenMapping();
  },
};

/** Ouvre une piste de l'Explorer dans l'éditeur (style courant conservé). */
function openInsight(ins: Insight): void {
  const cur = store.state.spec;
  const errs = store.setSpec(
    freshStory({
      ...ins.spec,
      norme: cur.norme,
      style: { ...ins.spec.style, ...keepStyle(cur), title: ins.analysis.title, subtitle: "", source: cur.style.source },
    } as unknown as Record<string, unknown>)
  );
  if (errs.length) toast(errs.join(" ; "), "error");
  else toast(`Piste ouverte : ${ins.analysis.title}`, "ok", 2600);
}

/* ------------------------------------------------------------------ histoire */

async function takeSnapshot(): Promise<Snapshot | null> {
  const { spec, ds, sampleId, story } = store.state;
  if (!ds) {
    toast("Chargez des données avant de prendre un snapshot.", "info");
    return null;
  }
  if (story.snapshots.length >= MAX_SNAPSHOTS) {
    toast(`Histoire limitée à ${MAX_SNAPSHOTS} snapshots.`, "info");
    return null;
  }
  const { width, height } = chartSize(spec);
  const th = themeFor(spec);
  const n = currentNarrative();
  const full = await preview.currentSvg();
  const [thumb, svg] = await Promise.all([svgToJpegDataUrl(full, width, height, 320, th.bg).catch(() => null), preview.bareSvg().catch(() => null)]);
  const kind = spec.story.kind ?? n?.kind ?? null;
  const snap: Snapshot = {
    id: newSnapshotId(),
    name: spec.style.title || `Snapshot ${story.snapshots.length + 1}`,
    createdAt: new Date().toISOString(),
    spec: structuredClone(spec),
    svg,
    thumb,
    width,
    height,
    title: spec.style.title,
    subtitle: spec.style.subtitle,
    comments: spec.story.comments.filter((c) => c.trim()),
    source: spec.style.source,
    kind,
    role: n?.role ?? roleForKind(kind),
    sampleId,
    dataName: ds.name,
    generatedAt: new Date().toISOString(),
  };
  store.setStory({ ...store.state.story, snapshots: [...store.state.story.snapshots, snap] });
  store.setUi({ openSections: { ...store.state.ui.openSections, histoire: true } });
  toast(`Snapshot ajouté à l'histoire (${store.state.story.snapshots.length})`, "ok", 1800);
  return snap;
}

function openSnapshot(s: Snapshot): void {
  const sample = s.sampleId ? sampleById(s.sampleId) : undefined;
  if (sample && store.state.sampleId !== sample.id) {
    store.setDataset(buildDataset(sample.name, sample.rows()), { sampleId: sample.id, note: sample.description });
    attachProvenance(sampleProvenance(sample.id));
  } else if (!sample && store.state.ds?.name !== s.dataName) {
    toast(`Ce snapshot a été pris sur « ${s.dataName} » : rechargez ces données pour le retrouver à l'identique.`, "info", 5000);
  }
  const errs = store.setSpec(s.spec);
  if (errs.length) toast(errs.join(" ; "), "error");
}

/* ---- échelles communes (IBCS) : graphiques de même mesure dans l'histoire */

const sampleDs = new Map<string, Dataset>();
/** Données d'un snapshot : l'exemple d'origine, sinon les données courantes si elles portent le même nom. */
function datasetFor(s: Snapshot): Dataset | null {
  if (s.sampleId) {
    const sm = sampleById(s.sampleId);
    if (sm) {
      if (!sampleDs.has(sm.id)) sampleDs.set(sm.id, buildDataset(sm.name, sm.rows()));
      return sampleDs.get(sm.id)!;
    }
  }
  const ds = store.state.ds;
  return ds && ds.name === s.dataName ? ds : null;
}

function snapshotSpec(s: Snapshot): ChartSpec | null {
  const r = parseSpec(s.spec);
  return r.ok ? r.spec : null;
}

let scaleCache: { key: string; map: Map<string, ScaleInfo> } = { key: "", map: new Map() };
/** Groupes d'échelle de l'histoire (2+ graphiques de même mesure, même unité). */
function storyScales(): Map<string, ScaleInfo> {
  const snaps = store.state.story.snapshots;
  const key = JSON.stringify([snaps.map((s) => s.id), store.state.dsVersion, store.state.ds?.name]);
  if (key === scaleCache.key) return scaleCache.map;
  const items = snaps.map((s) => {
    const spec = snapshotSpec(s);
    const ds = spec ? datasetFor(s) : null;
    let max: number | null = null;
    try {
      max = spec && ds ? valueMaxOf(spec, ds) : null;
    } catch {
      max = null;
    }
    return { id: s.id, key: spec ? scaleKey(spec) : null, max };
  });
  scaleCache = { key, map: scaleGroups(items) };
  return scaleCache.map;
}

/** Indicateur d'échelle d'un snapshot (diapositive) : échelle commune, ou différente en mode norme. */
function scaleNoteFor(spec: ChartSpec, info: ScaleInfo | undefined, same: boolean): string | null {
  if (!info) return null;
  const fmt = valueFormatter(spec.axes.y);
  if (same) return `Même échelle pour les ${info.size} graphiques de cette mesure (max. ${fmt(info.max)})`;
  if (spec.norme.enabled && info.differs) return `Échelle propre (max. ${fmt(info.own)}) — différente des ${info.size - 1} autre(s) graphique(s) de même mesure`;
  return null;
}

/** Rendu à neuf (SVG nu, polices embarquées) avec échelle commune / indicateur. */
async function renderScaled(spec: ChartSpec, ds: Dataset, sharedMax: number | null, scaleNote: string | null): Promise<string> {
  const tmp = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  const cache = prepareCache(spec, ds, null, -1);
  const res = renderChart(tmp, spec, ds, cache, { build: 1, timePos: null }, { bare: true, sharedMax, scaleNote });
  return composeSvg({ svg: tmp, spec, plot: res.plot, specialHost: null, embedFonts: true });
}

/** Image PNG 2× d'un snapshot : SVG conservé (polices ré-embarquées), sinon rendu à neuf, sinon la vignette. */
async function snapshotImage(s: Snapshot): Promise<SlideImage | null> {
  const spec = s.spec as ChartSpec;
  try {
    const parsed = snapshotSpec(s);
    const info = storyScales().get(s.id);
    const same = !!store.state.story.sameScale && !!info;
    const note = parsed ? scaleNoteFor(parsed, info, same) : null;
    const ds = parsed && (same || note) ? datasetFor(s) : null;
    if (parsed && ds && (same || note)) {
      const svg = await renderScaled(parsed, ds, same ? info!.max : null, note);
      const blob = await svgToPngBlob(svg, s.width, s.height, 2);
      return { data: await blobToDataUrl(blob), width: s.width, height: s.height };
    }
  } catch (e) {
    console.warn("Échelle commune : rendu impossible", e);
  }
  try {
    if (s.svg) {
      const svg = await embedFontsInto(s.svg, spec.style.font);
      const blob = await svgToPngBlob(svg, s.width, s.height, 2);
      return { data: await blobToDataUrl(blob), width: s.width, height: s.height };
    }
  } catch {
    /* repli */
  }
  return s.thumb ? { data: s.thumb, width: s.width, height: s.height } : null;
}

async function buildStoryPptx(outputType: "blob" | "base64" = "blob") {
  const story = store.state.story;
  const images = new Map<string, SlideImage | null>();
  for (const s of story.snapshots) images.set(s.id, await snapshotImage(s));
  const { buildPptx } = await import("./story/pptx");
  return buildPptx(story, { images, outputType });
}

async function exportPptx(btn: HTMLButtonElement): Promise<void> {
  if (!store.state.story.snapshots.length) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "PowerPoint…";
  try {
    const blob = (await buildStoryPptx("blob")) as Blob;
    download(blob, `${slug(store.state.story.title || "histoire")}.pptx`);
    toast(`PowerPoint exporté (${store.state.story.snapshots.length + 2} diapositives)`, "ok");
  } catch (e) {
    toast("Export PowerPoint impossible : " + (e instanceof Error ? e.message : String(e)), "error", 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function pickType(t: ChartType): Promise<void> {
  const { spec, ds } = store.state;
  let encoding = autoEncode(spec, ds, t, false);
  if (isSpecial(t) && ds) {
    const mod = await import("./charts/special");
    const sug = mod.suggestSpecialEncoding(ds);
    const cur = spec.encoding;
    const valid = (f: string | null | undefined, kinds: string[]) => !!f && ds.columns.some((c) => c.name === f && kinds.includes(c.type));
    encoding = {
      ...encoding,
      x: valid(cur.x, ["date", "number"]) ? cur.x : sug.x ?? null,
      end: valid(cur.end, ["date", "number"]) ? cur.end : sug.end ?? null,
      y: cur.y[0] && valid(cur.y[0], ["number"]) ? [cur.y[0]] : sug.y ?? [],
      series: cur.series ?? sug.series ?? null,
      label: cur.label ?? sug.label ?? null,
      postal: cur.postal ?? sug.postal ?? null,
      lat: cur.lat ?? sug.lat ?? null,
      lon: cur.lon ?? sug.lon ?? null,
    };
  }
  const errs = store.setSpec({ ...spec, type: t, encoding });
  if (errs.length) toast(errs.join(" ; "), "error");
}

/* ------------------------------------------------------------------ exports */

function baseName(): string {
  return slug(store.state.spec.style.title || "graphique-tell4d");
}

async function exportSvg(): Promise<void> {
  const svg = await preview.currentSvg();
  download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${baseName()}.svg`);
  toast("SVG exporté (polices intégrées)", "ok");
}

async function exportPng(): Promise<void> {
  const scale = store.state.ui.pngScale;
  const { width, height } = chartSize(store.state.spec);
  const svg = await preview.currentSvg();
  const blob = await svgToPngBlob(svg, width, height, scale);
  download(blob, `${baseName()}@${scale}x.png`);
  toast(`PNG ${width * scale} × ${height * scale} exporté`, "ok");
}

async function exportWebm(btn: HTMLButtonElement): Promise<void> {
  if (preview.playMode === "none") {
    toast("Passez en mode « Dynamique » (animation d'entrée ou 4D) pour exporter une vidéo.", "info", 5000);
    return;
  }
  const { width, height } = chartSize(store.state.spec);
  const label = btn.textContent;
  btn.disabled = true;
  preview.setRecording(true);
  try {
    const blob = await recordWebm((p) => preview.svgAt(p), {
      width,
      height,
      durationMs: preview.exportDuration(),
      bg: themeFor(store.state.spec).bg,
      onProgress: (p) => (btn.textContent = `Vidéo… ${Math.round(p * 100)} %`),
    });
    download(blob, `${baseName()}.webm`);
    toast("Vidéo WebM exportée", "ok");
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error", 6000);
  } finally {
    preview.setRecording(false);
    btn.disabled = false;
    btn.textContent = label;
    preview.restart(false);
    preview.seek(1);
  }
}

function saveConfig(): void {
  const { spec, ds, sampleId, ui } = store.state;
  const data = ui.includeData && ds && !sampleId ? { name: ds.name, rows: serializableRaw(ds.raw), typeOverrides: ds.typeOverrides } : null;
  const file = studioFile(spec, { data, sampleId, story: store.state.story.snapshots.length ? store.state.story : undefined });
  download(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }), `${baseName()}.r4d.json`);
  toast(data ? "Configuration + données enregistrées" : "Configuration enregistrée", "ok");
}

async function loadConfig(file: File): Promise<void> {
  try {
    const raw = JSON.parse(await file.text());
    // Accepte aussi un spec « nu »
    const wrapped = raw && raw.kind === "reporting-4d-studio" ? raw : { kind: "reporting-4d-studio", version: 1, spec: raw };
    const f = studioFileSchema.parse(wrapped);
    const r = parseSpec(f.spec);
    if (!r.ok) throw new Error(r.issues.slice(0, 4).join(" ; "));
    let ds: Dataset | null = store.state.ds;
    let sampleId: string | null = store.state.sampleId;
    // Provenance : celle du fichier d'origine enregistrée dans la configuration, sinon empreinte des lignes jointes
    const savedProv = r.spec.provenance;
    let rowsForHash: unknown[] | null = null;
    if (f.data?.rows?.length) {
      ds = buildDataset(f.data.name, f.data.rows, f.data.typeOverrides ?? {});
      sampleId = null;
      if (!savedProv || savedProv.kind === "sample") rowsForHash = f.data.rows;
    } else if (f.sampleId && sampleById(f.sampleId)) {
      const s = sampleById(f.sampleId)!;
      ds = buildDataset(s.name, s.rows());
      sampleId = s.id;
    }
    store.setSpec(r.spec);
    if (ds !== store.state.ds) {
      store.setDataset(ds, { sampleId, note: "Chargé depuis " + file.name, provenance: sampleId || rowsForHash ? null : savedProv });
      if (sampleId) attachProvenance(sampleProvenance(sampleId));
      else if (rowsForHash && ds) {
        const rows = rowsForHash;
        const n = ds.rows.length;
        const c = ds.columns.length;
        attachProvenance(safeHash(() => hashRows(rows)).then((hash) => (hash ? makeProvenance({ hash, kind: "config", fileName: file.name, rows: n, cols: c }) : null)));
      }
    }
    if (f.story && Array.isArray(f.story.snapshots) && f.story.snapshots.length) store.setStory(parseStory(f.story));
    toast("Configuration chargée", "ok");
  } catch (e) {
    toast("Configuration invalide : " + (e instanceof Error ? e.message : String(e)), "error", 7000);
  }
}

/* ------------------------------------------------------------------ layout */

const cfgInput = h("input", { type: "file", accept: ".json,application/json", class: "hidden", "data-testid": "config-input" });
cfgInput.addEventListener("change", () => {
  const f = cfgInput.files?.[0];
  if (f) void loadConfig(f);
  cfgInput.value = "";
});

const pngScale = h(
  "select",
  { class: "mini-select", title: "Résolution PNG", "data-testid": "png-scale" },
  ...[1, 2, 3].map((v) => h("option", { value: String(v), selected: store.state.ui.pngScale === v }, `${v}×`))
);
pngScale.addEventListener("change", () => store.setUi({ pngScale: Number(pngScale.value) as 1 | 2 | 3 }));

const webmBtn: HTMLButtonElement = h("button", { class: "btn", "data-testid": "export-webm", title: webmSupported() ? "Vidéo WebM de l'animation (côté navigateur)" : "MediaRecorder indisponible dans ce navigateur", onclick: () => void exportWebm(webmBtn) }, "Vidéo WebM");
const includeData = h("input", { type: "checkbox", checked: store.state.ui.includeData, "data-testid": "include-data" });
includeData.addEventListener("change", () => store.setUi({ includeData: includeData.checked }));

const exploreTopBtn = h("button", { class: "btn btn-explore-top", "data-testid": "explore-open", title: "Pistes de graphiques calculées sur vos données", onclick: () => explorer.toggle() }, h("span", { html: svgIcon(ICONS.explore, 16) }), "Explorer mes données");
const snapTopBtn = h("button", { class: "btn", "data-testid": "snapshot-top", title: "Ajouter le graphique courant à l'histoire", onclick: () => void takeSnapshot() }, "📸 Snapshot");

/* ---- mode norme : badge, légende de notation */
const normeBadge = h("span", { class: "norme-badge", hidden: true, "data-testid": "norme-badge", title: `Mode norme actif — notation ${NORME_WORDING_F}` }, "Norme");
const normeLegend = buildNormeLegend();
const normeInfoBtn = h("button", { class: "btn btn-small norme-info", hidden: true, type: "button", "aria-expanded": "false", "aria-controls": "norme-legend", "data-testid": "norme-info", title: "Légende de la notation (scénarios, écarts)", onclick: () => toggleLegend() }, "ℹ Notation");

function toggleLegend(force?: boolean): void {
  const open = force ?? normeLegend.hidden;
  normeLegend.hidden = !open;
  normeInfoBtn.setAttribute("aria-expanded", open ? "true" : "false");
}
document.addEventListener("keydown", (e) => e.key === "Escape" && !normeLegend.hidden && toggleLegend(false));
document.addEventListener("pointerdown", (e) => {
  const t = e.target as Node | null;
  if (!normeLegend.hidden && t && !normeLegend.contains(t) && !normeInfoBtn.contains(t)) toggleLegend(false);
});

function buildNormeLegend(): HTMLElement {
  const NS = "http://www.w3.org/2000/svg";
  const sw = (code: string) => {
    const shapes: Record<string, string> = {
      AC: `<rect x="1" y="1" width="26" height="14" fill="#e4e4e7"/>`,
      PY: `<rect x="1" y="1" width="26" height="14" fill="#6b6b73"/>`,
      PL: `<rect x="1.5" y="1.5" width="25" height="13" fill="none" stroke="#e4e4e7" stroke-width="1.6" stroke-dasharray="4 2.5"/>`,
      FC: `<defs><pattern id="nl-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#e4e4e7" stroke-width="2"/></pattern></defs><rect x="1.5" y="1.5" width="25" height="13" fill="url(#nl-hatch)" stroke="#e4e4e7" stroke-width="1.2"/>`,
      POS: `<rect x="1" y="3" width="26" height="10" fill="#2e9e4f"/>`,
      NEG: `<rect x="1" y="3" width="26" height="10" fill="#d62839"/>`,
      PIN: `<line x1="2" y1="8" x2="20" y2="8" stroke="#2e9e4f" stroke-width="2"/><circle cx="21" cy="8" r="4.5" fill="#2e9e4f"/>`,
    };
    return h("span", { class: "nl-swatch", html: `<svg xmlns="${NS}" width="28" height="16" viewBox="0 0 28 16" aria-hidden="true">${shapes[code]}</svg>` });
  };
  const item = (code: string, label: string, help: string) => h("li", { "data-code": code }, sw(code), h("span", null, h("strong", null, label), " — ", help));
  return h(
    "div",
    { class: "norme-legend", id: "norme-legend", hidden: true, role: "dialog", "aria-label": "Notation des scénarios et des écarts", "data-testid": "norme-legend" },
    h("header", null, h("strong", null, "Notation des scénarios"), h("button", { type: "button", class: "icon-btn", title: "Fermer", onclick: () => toggleLegend(false) }, "×")),
    h("ul", null, ...SCENARIO_CODES.map((c) => item(c, `${SCENARIO_NAMES[c]} (${c})`, SCENARIO_HELP[c]))),
    h("strong", { class: "nl-sub" }, "Écarts"),
    h(
      "ul",
      null,
      item("POS", "Écart favorable", "barre verte : ΔPL (vs Budget), ΔPY (vs N-1), en valeur absolue."),
      item("NEG", "Écart défavorable", "barre rouge ; « Hausse = défavorable » inverse le sens (coûts, délais)."),
      item("PIN", "Écart relatif", "épingle (aiguille + point) en % de la référence.")
    ),
    h("p", { class: "muted small" }, "Rouge et vert sont réservés aux écarts ; les données restent en gris, le pétrole signale l'interface. Unité dans le sous-titre, mêmes décimales partout, échelles communes pour une même mesure."),
    h("p", { class: "muted small nl-legal" }, `Notation ${NORME_WORDING_F}. IBCS® est une marque déposée.`)
  );
}

const header = h(
  "header",
  { class: "topbar" },
  h(
    "div",
    { class: "brand" },
    h("span", {
      class: "logo",
      html: tell4dIconMarkup("t4d-hdr", 30),
    }),
    h("h1", null, "Tell", h("em", null, "4D"), h("span", { class: "dot" }, " · "), h("span", { class: "studio" }, "Studio")),
    h("span", { class: "tagline" }, "Graphiques SVG animés · alteridea"),
    normeBadge,
    normeInfoBtn
  ),
  h(
    "div",
    { class: "toolbar" },
    h("div", { class: "tool-group" }, h("span", { class: "group-label" }, "Récit"), exploreTopBtn, snapTopBtn),
    h("div", { class: "tool-group" }, h("span", { class: "group-label" }, "Exporter"),
      h("button", { class: "btn btn-accent", "data-testid": "export-svg", onclick: () => void exportSvg().catch((e) => toast(String(e), "error")) }, h("span", { html: svgIcon(ICONS.download, 16) }), "SVG"),
      h("span", { class: "split" }, h("button", { class: "btn", "data-testid": "export-png", onclick: () => void exportPng().catch((e) => toast(String(e), "error")) }, "PNG"), pngScale),
      webmBtn,
      h("button", { class: "btn", disabled: true, title: "Export GIF animé : prévu en V2", "data-testid": "export-gif", onclick: () => void exportGif().catch((e) => toast(e.message, "info")) }, "GIF ", h("small", null, "V2"))
    ),
    h("div", { class: "tool-group" }, h("span", { class: "group-label" }, "Configuration"),
      h("button", { class: "btn", "data-testid": "save-config", onclick: saveConfig, title: "Enregistrer le spec JSON (validé Zod)" }, "Enregistrer"),
      h("label", { class: "check mini", title: "Inclure les données importées dans le fichier JSON" }, includeData, h("span", null, "+ données")),
      h("button", { class: "btn", "data-testid": "load-config", onclick: () => cfgInput.click() }, "Ouvrir…"),
      cfgInput,
      h("button", { class: "btn btn-ghost", title: "Effacer la session et repartir de l'exemple", onclick: () => { store.clearSession(); loadSample(SAMPLES[0]!.id); } }, "Réinitialiser")
    )
  )
);

const gallery = new Gallery(store, (t) => void pickType(t));
const dataPanel = new DataPanel(store, actions);
const settings = new SettingsPanel(store);
const explorer = new Explorer(store, storyContext, openInsight);
const storyStrip = new StoryStrip(store, { snapshot: () => void takeSnapshot(), open: openSnapshot, exportPptx: (b) => void exportPptx(b), scales: () => storyScales() });
preview.onEditText = (field, value) => {
  if (field === "title") store.set("style.title", value);
  else if (field === "subtitle") store.set("style.subtitle", value);
  else if (field.startsWith("comment:")) {
    const i = Number(field.split(":")[1]);
    const c = [...store.state.spec.story.comments];
    c[i] = value;
    store.set("story.comments", c.map((x) => (x ?? "").trim()).filter(Boolean));
  }
};
const center = h("section", { class: "center" }, gallery.root, h("div", { class: "center-stack" }, preview.root), storyStrip.root);
const leftRail = h("button", { class: "rail rail-left", title: "Afficher les données", onclick: () => store.setUi({ leftCollapsed: false }) }, h("span", { html: svgIcon(ICONS.table, 18) }), h("span", { class: "rail-label" }, "Données"));
const rightRail = h("button", { class: "rail rail-right", title: "Afficher les réglages", onclick: () => store.setUi({ rightCollapsed: false }) }, h("span", { html: svgIcon(ICONS.sliders, 18) }), h("span", { class: "rail-label" }, "Réglages"));
// L'Explorer recouvre l'aperçu et les réglages (vignettes plus grandes, 4 colonnes sur grand écran)
const workspace = h("main", { class: "workspace" }, leftRail, dataPanel.root, center, settings.root, rightRail, explorer.root);
const app = h("div", { class: "app" }, header, workspace, normeLegend, mappingWindow.root);
document.getElementById("app")!.replaceChildren(app);

function applyUi() {
  const { leftCollapsed, rightCollapsed } = store.state.ui;
  const norme = store.state.spec.norme.enabled;
  normeBadge.hidden = !norme;
  normeInfoBtn.hidden = !norme;
  if (!norme && !normeLegend.hidden) toggleLegend(false);
  app.classList.toggle("norme-on", norme);
  workspace.classList.toggle("left-collapsed", leftCollapsed);
  workspace.classList.toggle("right-collapsed", rightCollapsed);
}

store.subscribe((kinds) => {
  applyUi();
  storyStrip.update();
  if (kinds.size === 1 && kinds.has("story")) return;
  gallery.update();
  dataPanel.update();
  settings.update();
  if (kinds.has("data") && explorer.isOpen) explorer.open();
  void preview.update(kinds);
});

preview.onModeChange = (m) => {
  webmBtn.classList.toggle("dim", m === "none");
};

/* ------------------------------------------------------------------ démarrage */

const params = new URLSearchParams(location.search);
if (params.has("reset")) store.clearSession();
store.restoreStory();
void ensureFont(store.state.spec.style.font).finally(() => {
  if (!store.restore()) loadSample(params.get("sample") ?? SAMPLES[0]!.id);
  else if (store.state.sampleId) attachProvenance(sampleProvenance(store.state.sampleId));
  applyUi();
  storyStrip.update();
});

/** API de débogage / tests (console : r4d.getSpec()). */
const api = {
  store,
  preview,
  getSpec: () => store.state.spec,
  setSpec: (patch: Record<string, unknown>) => store.setSpec({ ...store.state.spec, ...patch }),
  set: (path: string, v: unknown) => store.set(path, v),
  pickType: (t: ChartType) => pickType(t),
  loadSample,
  importText: (t: string) => importPasted(t),
  provenance: () => store.state.provenance,
  currentSvg: () => preview.currentSvg(),
  seek: (p: number) => preview.seek(p),
  explore: () => explorer.open(),
  mapping: () => mappingWindow,
  reshape: () => reopenMapping(),
  closeExplorer: () => explorer.close(),
  narrative: () => currentNarrative(),
  regenerate: () => store.regenerate(),
  snapshot: () => takeSnapshot(),
  story: () => store.state.story,
  moveSnapshot: (from: number, to: number) => storyStrip.move(from, to),
  pptxBase64: async () => (await buildStoryPptx("base64")) as string,
  storyScales: () => Object.fromEntries(storyScales()),
  setSameScale: (on: boolean) => store.setStory({ ...store.state.story, sameScale: on }),
  pngDataUrl: async (scale = 1) => {
    const { width, height } = chartSize(store.state.spec);
    return blobToDataUrl(await svgToPngBlob(await preview.currentSvg(), width, height, scale));
  },
};
(window as unknown as { r4d: typeof api }).r4d = api;
