/**
 * Datanime · Studio (moteur Reporting 4D) — point d'entrée.
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
import { download, recordWebm, slug, studioFile, svgToPngBlob, webmSupported, exportGif, svgToJpegDataUrl, embedFontsInto, blobToDataUrl, pngFit, stableSvgIds } from "./export";
import { themeFor, ensureFont } from "./theme";
import { PLATFORM_URL, tell4dIconMarkup } from "./brand";
import { ReviewSpace } from "./review/space";
import { LocalReviewStorage } from "./review/storage";
import { reportSlideComments } from "./review/model";
import { guessUnit } from "./format";
import { SAMPLE_TODAY } from "./data/samples";
import { Explorer } from "./ui/explorer";
import { StoryStrip } from "./ui/storyStrip";
import type { Insight, StoryContext } from "./story/insights";
import { narrate, narrativeKey, applyNarrative, type Narrative } from "./story/narrate";
import { MAX_SNAPSHOTS, newSnapshotId, parseStory, roleForKind, type Snapshot, type StoryState } from "./story/snapshots";
import type { SlideImage } from "./story/pptx";
import { composeSvg } from "./export";
import { prepareCache, renderChart, valueMaxOf } from "./charts/render";
import { NORME_WORDING_F, SCENARIO_CODES, SCENARIO_HELP, SCENARIO_NAMES, normeAdvice, scaleGroups, scaleKey, type ScaleInfo } from "./norme";
import { valueFormatter } from "./format";
import { MappingWindow, type MappingApply, type MappingSource } from "./ui/mapping";
import { readWorkbookData, sheetMatrix, toWorkbookIn, type Matrix, type WorkbookData } from "./data/workbook";
import { detectStructure } from "./data/structure";
import { detectDelimiter, parseDelimitedMatrix } from "span-magnitude-viz/fileImport";
import { DrillBar } from "./ui/drillBar";
import { StoryFilm } from "./ui/storyFilm";
import { LOCAL_STORY_ID, READING_PUBLIC_BASE, demoStoryDef, demoStoryOf, parseReadRoute, readHash, readUrl, readingStoryIdFor, type ReadRoute } from "./story/reading";
import { DEMO_FINANCE_ID, DEMO_ORG, DEMO_PIPELINE_ID, demoFinanceReview, demoPipelineReview, demoReadingStory } from "./review/demo";
import { demoNotesFor } from "./publish/demoNotes";
import { DATA_URL_MAX_CHARS, MANIFEST_MAX_BYTES, IMAGE_H, IMAGE_W, buildIndex, buildManifest, isPublished, isoLocal, isoOrNull, localStoryManifestId, manifestDownloadName, manifestSchema, manifestUrl, PUBLISHED_STORIES, type Manifest } from "./publish/manifest";
import { CadencerDialog, type CadencerTarget } from "./ui/cadencerDialog";
import { drillStepAdded, type NativeSlide } from "./story/morph";
import { ScenarioDialog } from "./ui/scenarioDialog";
import { drillInto, drillPathLabels, initDrill, rootGrain } from "./data/drill";
import type { DrillGrain } from "./spec";
import { columnOf } from "./data/table";
import { runScenario, scenarioSnapshotId, type RoleBinding, type Scenario } from "./story/scenarios";
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

interface SnapOpts {
  /** Identifiant stable (scénario) ; remplace un snapshot de même id. */
  id?: string;
  scenario?: string | null;
  step?: string | null;
  quiet?: boolean;
}

async function takeSnapshot(opts: SnapOpts = {}): Promise<Snapshot | null> {
  const { spec, ds, sampleId, story } = store.state;
  if (!ds) {
    toast("Chargez des données avant de prendre un snapshot.", "info");
    return null;
  }
  const guided = !opts.id ? guideMatch() : null;
  if (guided) opts = { ...opts, ...guided };
  const replace = opts.id ? story.snapshots.findIndex((x) => x.id === opts.id) : -1;
  if (replace < 0 && story.snapshots.length >= MAX_SNAPSHOTS) {
    toast(`Histoire limitée à ${MAX_SNAPSHOTS} snapshots.`, "info");
    return null;
  }
  const { width, height } = chartSize(spec);
  const th = themeFor(spec);
  const n = currentNarrative();
  const full = await preview.finalSvg();
  const [thumb, svg] = await Promise.all([svgToJpegDataUrl(full, width, height, 320, th.bg).catch(() => null), preview.bareSvg().catch(() => null)]);
  const kind = spec.story.kind ?? n?.kind ?? null;
  const snap: Snapshot = {
    id: opts.id ?? newSnapshotId(),
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
    path: spec.type === "drill" ? drillPathLabels(spec.drill) : [],
    scenario: opts.scenario ?? null,
    step: opts.step ?? null,
  };
  const list = [...store.state.story.snapshots];
  if (replace >= 0) list[replace] = snap;
  else list.push(snap);
  store.setStory({ ...store.state.story, snapshots: list });
  store.setUi({ openSections: { ...store.state.ui.openSections, histoire: true } });
  if (!opts.quiet) toast(replace >= 0 ? "Snapshot mis à jour dans l'histoire" : `Snapshot ajouté à l'histoire (${store.state.story.snapshots.length})`, "ok", 1800);
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
async function renderScaled(spec: ChartSpec, ds: Dataset, sharedMax: number | null, scaleNote: string | null, qrUrl: string | null = null, now?: Date, bare = true): Promise<string> {
  const tmp = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  const cache = prepareCache(spec, ds, null, -1);
  const res = renderChart(tmp, spec, ds, cache, { build: 1, timePos: null }, { bare, sharedMax, scaleNote, qrUrl, now });
  return composeSvg({ svg: tmp, spec, plot: res.plot, specialHost: null, embedFonts: true, ...(now ? { created: now } : {}) });
}

/** Spec de diapositive : titre, sous-titre et commentaires du snapshot. */
function slideSpec(s: Snapshot, parsed: ChartSpec): ChartSpec {
  return { ...parsed, style: { ...parsed.style, title: s.title, subtitle: s.subtitle }, story: { ...parsed.story, comments: s.comments } };
}

function snapNow(s: Snapshot): Date | undefined {
  const d = new Date(s.generatedAt || s.createdAt || "");
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/**
 * Image PNG 3× d'un snapshot : rendu à neuf depuis les données (échelle commune, QR du cartouche vers le mode
 * lecture), sinon SVG conservé (polices ré-embarquées), sinon la vignette.
 */
async function snapshotImage(s: Snapshot, scales: Map<string, ScaleInfo> = storyScales(), sameScale = !!store.state.story.sameScale, qrUrl: string | null = null): Promise<SlideImage | null> {
  const spec = s.spec as ChartSpec;
  const parsed = snapshotSpec(s);
  try {
    const info = scales.get(s.id);
    const same = sameScale && !!info;
    const note = parsed ? scaleNoteFor(parsed, info, same) : null;
    const ds = parsed && (same || note || qrUrl) ? datasetFor(s) : null;
    if (parsed && ds && (same || note || qrUrl)) {
      const svg = await renderScaled(slideSpec(s, parsed), ds, same ? info!.max : null, note, qrUrl, snapNow(s));
      const blob = await svgToPngBlob(svg, s.width, s.height, 3);
      return { data: await blobToDataUrl(blob), width: s.width, height: s.height };
    }
  } catch (e) {
    console.warn("Échelle commune : rendu impossible", e);
  }
  try {
    if (s.svg) {
      const svg = await embedFontsInto(s.svg, spec.style.font);
      const blob = await svgToPngBlob(svg, s.width, s.height, 3);
      return { data: await blobToDataUrl(blob), width: s.width, height: s.height };
    }
    // snapshot sans rendu conservé (revues de démonstration) : rendu à neuf depuis les données d'origine
    const ds = parsed ? datasetFor(s) : null;
    if (parsed && ds) {
      const fixed = { ...parsed, style: { ...parsed.style, title: s.title, subtitle: s.subtitle }, story: { ...parsed.story, comments: s.comments } };
      const svg = await renderScaled(fixed, ds, null, null);
      const blob = await svgToPngBlob(svg, s.width, s.height, 3);
      return { data: await blobToDataUrl(blob), width: s.width, height: s.height };
    }
  } catch {
    /* repli */
  }
  return s.thumb ? { data: s.thumb, width: s.width, height: s.height } : null;
}

/** Groupes d'échelle d'une liste de snapshots quelconque (revues). */
function scalesOf(snaps: Snapshot[]): Map<string, ScaleInfo> {
  return scaleGroups(
    snaps.map((s) => {
      const spec = snapshotSpec(s);
      const ds = spec ? datasetFor(s) : null;
      let max: number | null = null;
      try {
        max = spec && ds ? valueMaxOf(spec, ds) : null;
      } catch {
        max = null;
      }
      return { id: s.id, key: spec ? scaleKey(spec) : null, max };
    })
  );
}

/* ---- mode lecture : liens profonds #/lire/<histoire>/<snapshot> */

/** Base des liens : adresse courante (http) ; fichier hors ligne : adresse publique. */
function linkBase(): string {
  return /^https?:$/.test(location.protocol) ? location.href.split("#")[0]!.split("?")[0]! : READING_PUBLIC_BASE;
}

/** Lien de lecture d'un snapshot : démo intégrée → adresse publique (tout appareil) ; sinon histoire / revue locale. */
function snapReadUrl(s: Snapshot, storyId: string): string {
  const id = readingStoryIdFor(s, storyId);
  return readUrl(demoStoryDef(id) ? READING_PUBLIC_BASE : linkBase(), id, s.id);
}

export interface PptxBuildOptions {
  /** Transitions Morph (formes natives nommées « !! », repli fondu). */
  morph?: boolean;
  /** Séquence de construction (amorce → complet) en mode Morph. */
  build?: boolean;
  /** Histoire de lecture des liens (revue, histoire courante). */
  storyId?: string;
}

async function buildStoryPptx(outputType: "blob" | "base64" = "blob", story: StoryState = store.state.story, o: PptxBuildOptions = {}) {
  const own = story === store.state.story;
  const scales = own ? storyScales() : scalesOf(story.snapshots);
  const storyId = o.storyId ?? LOCAL_STORY_ID;
  const images = new Map<string, SlideImage | null>();
  const links = new Map<string, string>();
  const native = new Map<string, NativeSlide[]>();
  const snaps = story.snapshots;
  for (const s of snaps) links.set(s.id, snapReadUrl(s, storyId));
  if (o.morph) {
    const { nativeStages } = await import("./story/morphRender");
    for (let i = 0; i < snaps.length; i++) {
      const s = snaps[i]!;
      const parsed = snapshotSpec(s);
      const ds = parsed ? datasetFor(s) : null;
      if (!parsed || !ds) continue;
      const info = scales.get(s.id);
      const same = !!story.sameScale && !!info;
      const next = snaps[i + 1];
      const prev = snaps[i - 1];
      const outStep = next ? drillStepAdded(s.spec, next.spec) : null;
      const inZoom = prev && native.has(prev.id) && drillStepAdded(prev.spec, s.spec) ? i - 1 : null;
      try {
        native.set(
          s.id,
          await nativeStages({ spec: slideSpec(s, parsed), ds, now: snapNow(s) ?? new Date(), sharedMax: same ? info!.max : null, scaleNote: scaleNoteFor(parsed, info, same), qrUrl: links.get(s.id) ?? null, build: o.build ?? true, zoomOut: outStep ? { step: outStep, index: i } : null, zoomInIndex: inZoom })
        );
      } catch (e) {
        console.warn("Morph : rendu natif impossible", e);
      }
    }
  }
  for (const s of snaps) if (!native.has(s.id)) images.set(s.id, await snapshotImage(s, scales, !!story.sameScale, links.get(s.id) ?? null));
  const { buildPptx } = await import("./story/pptx");
  return buildPptx(story, { images, outputType, links, native, morph: !!o.morph });
}

/* ---- Pont Cadencer : « manifeste de revue » (publié à la construction, ou téléchargé pour une histoire locale) */

interface PublicationSource {
  id: string;
  readId: string;
  titre: string;
  persona: string;
  entreprise: string;
  date_reunion: string | null;
  genere_le: string;
  snapshots: Snapshot[];
  notes: Record<string, string>;
}

/** Date de génération la plus récente des snapshots (manifeste publié : déterministe). */
function latestGenerated(snaps: Snapshot[], fallback: string): string {
  const ts = snaps.map((s) => isoOrNull(s.generatedAt) ?? isoOrNull(s.createdAt)).filter((x): x is string => !!x);
  ts.sort((a, b) => Date.parse(a) - Date.parse(b));
  return ts[ts.length - 1] ?? fallback;
}

/**
 * Contenu d'un manifeste : démo intégrée (recalculée), revue Norvia (version de démonstration d'origine quand
 * elle est publiée), revue locale ou histoire courante du Studio.
 */
async function publicationSource(storyId: string, publie: boolean): Promise<PublicationSource | null> {
  const now = isoLocal(new Date());
  const d = demoStoryDef(storyId);
  if (d) {
    const st = await demoReadingStory(storyId);
    if (!st) return null;
    return { id: storyId, readId: storyId, titre: st.title, persona: d.scenario.label.replace(/^Scénario\s+/u, ""), entreprise: DEMO_ORG, date_reunion: null, genere_le: publie ? d.generatedAt : now, snapshots: st.snapshots, notes: demoNotesFor(storyId, st.snapshots.map((s) => s.id)) };
  }
  if (storyId === LOCAL_STORY_ID) {
    const st = store.state.story;
    if (!st.snapshots.length) return null;
    return { id: await localStoryManifestId(st.snapshots.map((s) => s.id)), readId: LOCAL_STORY_ID, titre: st.title.trim() || "Histoire", persona: "", entreprise: "", date_reunion: null, genere_le: now, snapshots: st.snapshots, notes: {} };
  }
  await reviewSpace.ensureDemo();
  let r = reviewStorage.get(storyId);
  if (publie && storyId === DEMO_PIPELINE_ID) r = await demoPipelineReview();
  else if (publie && storyId === DEMO_FINANCE_ID) r = await demoFinanceReview();
  if (!r || !r.snapshots.length) return null;
  return {
    id: r.id,
    readId: r.id,
    titre: r.title,
    persona: r.persona.audience || r.persona.label,
    entreprise: r.org.split(" · ")[0]?.trim() ?? "",
    date_reunion: isoOrNull(r.meetingAt),
    genere_le: publie ? latestGenerated(r.snapshots, isoOrNull(r.createdAt) ?? now) : now,
    snapshots: r.snapshots,
    notes: r.notes,
  };
}

/** Image publiée d'un snapshot : PNG 1600 × 900 complet (titre, commentaires, cartouche avec QR vers le lien de lecture) et SVG autonome. */
async function publicationImage(s: Snapshot, scales: Map<string, ScaleInfo>, qrUrl: string): Promise<{ png: string; svg: string | null }> {
  const parsed = snapshotSpec(s);
  const ds = parsed ? datasetFor(s) : null;
  let svg: string | null = null;
  if (parsed && ds) {
    try {
      // image complète (titre d'action, sous-titre, graphique, « À retenir », cartouche) : lisible seule à l'écran
      svg = await renderScaled(slideSpec(s, parsed), ds, null, scaleNoteFor(parsed, scales.get(s.id), false), qrUrl, snapNow(s), false);
    } catch (e) {
      console.warn("Manifeste : rendu impossible", e);
    }
  }
  if (!svg && s.svg) svg = await embedFontsInto(s.svg, (s.spec as ChartSpec).style.font);
  const src = svg ?? s.thumb;
  if (!src) throw new Error(`snapshot sans rendu : ${s.title}`);
  const bg = parsed ? themeFor(parsed).bg : "#ffffff";
  return { png: await blobToDataUrl(await pngFit(src, s.width, s.height, IMAGE_W, IMAGE_H, bg)), svg: svg ? stableSvgIds(svg) : null };
}

export interface Publication {
  manifest: Manifest;
  images: { id: string; png: string; svg: string | null }[];
}

/**
 * Manifeste d'une histoire. « publie » : adresses absolues (constante PLATFORM_URL) pour `studio-dist/publie/` ;
 * « integre » : images PNG intégrées (data:), liens de lecture de cet appareil.
 */
async function publication(storyId: string, mode: "publie" | "integre"): Promise<Publication | null> {
  const publie = mode === "publie";
  const src = await publicationSource(storyId, publie);
  if (!src) return null;
  const readBase = publie ? PLATFORM_URL : linkBase();
  const scales = scalesOf(src.snapshots);
  const images: Publication["images"] = [];
  for (const s of src.snapshots) images.push({ id: s.id, ...(await publicationImage(s, scales, readUrl(readBase, src.readId, s.id))) });
  const manifest = await buildManifest(
    { ...src, snapshots: src.snapshots.map((s, i) => ({ snap: s, note: src.notes[s.id] ?? null, png: images[i]!.png, svg: publie && !!images[i]!.svg })) },
    { images: mode, base: PLATFORM_URL, readBase }
  );
  return { manifest, images };
}

/**
 * Image intégrée sous la limite du contrat : PNG 1600 × 900 si possible, sinon réduit par paliers (1280, 1024, 800,
 * 640 px de large) puis, en dernier recours, quantifié (palette réduite) jusqu'à tenir dans `maxChars`.
 */
async function fitPngDataUrl(dataUrl: string, maxChars: number, bg: string): Promise<{ png: string; w: number }> {
  if (dataUrl.length <= maxChars) return { png: dataUrl, w: IMAGE_W };
  for (const w of [1280, 1024, 800, 640]) {
    const h = Math.round((w * IMAGE_H) / IMAGE_W);
    const png = await blobToDataUrl(await pngFit(dataUrl, IMAGE_W, IMAGE_H, w, h, bg));
    if (png.length <= maxChars) return { png, w };
    if (w === 640) {
      const q = await blobToDataUrl(await quantizePng(png, w, h, 32));
      return { png: q, w };
    }
  }
  return { png: dataUrl, w: IMAGE_W };
}

/** Réduction de palette (postérisation à `levels` niveaux par canal) : PNG nettement plus léger, texte lisible. */
async function quantizePng(dataUrl: string, w: number, h: number, levels: number): Promise<Blob> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) d.data[i + k] = Math.round(Math.round(d.data[i + k]! / step) * step);
  g.putImageData(d, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Échec de la quantification PNG"))), "image/png"));
}

/**
 * Manifeste téléchargé dans les limites du contrat : chaque image ≤ 800 000 caractères et fichier ≤ 12 Mo ;
 * le budget par image est partagé entre les snapshots. Renvoie le JSON et les éventuels avertissements.
 */
async function fitManifestForDownload(m: Manifest, bg = "#ffffff"): Promise<{ json: string; reduced: number; over: boolean }> {
  const n = m.snapshots.length;
  const overhead = JSON.stringify({ ...m, snapshots: m.snapshots.map((s) => ({ ...s, image_png: "" })) }, null, 2).length + 4096;
  const budget = Math.max(50_000, Math.min(DATA_URL_MAX_CHARS, Math.floor((MANIFEST_MAX_BYTES - overhead) / Math.max(1, n))));
  let reduced = 0;
  const snapshots = [];
  for (const s of m.snapshots) {
    const r = await fitPngDataUrl(s.image_png, budget, bg);
    if (r.png !== s.image_png) reduced++;
    snapshots.push({ ...s, image_png: r.png });
  }
  const out = { ...m, snapshots };
  const json = JSON.stringify(out, null, 2);
  const over = new Blob([json]).size > MANIFEST_MAX_BYTES || snapshots.some((s) => s.image_png.length > DATA_URL_MAX_CHARS);
  return { json, reduced, over };
}

async function downloadManifest(storyId: string): Promise<void> {
  try {
    const p = await publication(storyId, "integre");
    if (!p) return void toast("Rien à envoyer : l'histoire est vide", "info");
    const fit = await fitManifestForDownload(p.manifest);
    download(new Blob([fit.json], { type: "application/json" }), manifestDownloadName(p.manifest.id));
    if (fit.over) toast(`Manifeste téléchargé, mais au-delà des limites de Cadencer (12 Mo, 800 000 caractères par image) : retirez des snapshots avant l'envoi.`, "error", 8000);
    else if (fit.reduced) toast(`Manifeste téléchargé (${p.manifest.snapshots.length} snapshots ; ${fit.reduced} image${fit.reduced > 1 ? "s" : ""} réduite${fit.reduced > 1 ? "s" : ""} pour rester sous 12 Mo)`, "ok", 5000);
    else toast(`Manifeste téléchargé (${p.manifest.snapshots.length} snapshots, images intégrées)`, "ok", 4000);
  } catch (e) {
    toast("Manifeste impossible : " + (e instanceof Error ? e.message : String(e)), "error", 6000);
  }
}

/** Démo publiée correspondant exactement à l'histoire courante (mêmes snapshots, même ordre), sinon null. */
async function storyPublishedId(snaps: Snapshot[]): Promise<{ id: string | null; demo: string | null }> {
  const d = demoStoryOf(snaps);
  if (!d) return { id: null, demo: null };
  const demo = await demoReadingStory(d);
  const same = !!demo && demo.snapshots.length === snaps.length && demo.snapshots.every((s, i) => s.id === snaps[i]!.id);
  return { id: same ? d : null, demo: d };
}

async function openCadencer(storyId: string): Promise<void> {
  let t: CadencerTarget;
  if (storyId === LOCAL_STORY_ID) {
    const st = store.state.story;
    const pub = await storyPublishedId(st.snapshots);
    t = {
      storyId: pub.id ?? LOCAL_STORY_ID,
      title: st.title.trim() || "Histoire",
      count: st.snapshots.length,
      manifestUrl: pub.id ? manifestUrl(pub.id) : null,
      readUrl: pub.id ? readUrl(READING_PUBLIC_BASE, pub.id) : readUrl(linkBase(), LOCAL_STORY_ID),
      note: pub.id
        ? "Histoire identique à la démonstration publiée : Cadencer importe la version en ligne."
        : pub.demo
          ? `Ces snapshots viennent de la démonstration publiée, dont le manifeste complet est disponible : ${manifestUrl(pub.demo)}`
          : null,
    };
  } else {
    await reviewSpace.ensureDemo();
    const r = reviewStorage.get(storyId);
    const published = isPublished(storyId);
    t = {
      storyId,
      title: r?.title ?? storyId,
      count: r?.snapshots.length ?? 0,
      manifestUrl: published ? manifestUrl(storyId) : null,
      readUrl: published ? readUrl(READING_PUBLIC_BASE, storyId) : readUrl(linkBase(), storyId),
      note: published ? "Version publiée : la revue de démonstration d'origine (les modifications faites sur cet appareil ne sont pas publiées)." : null,
    };
  }
  cadencer.open(t);
}

async function exportPptx(btn: HTMLButtonElement): Promise<void> {
  if (!store.state.story.snapshots.length) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "PowerPoint…";
  try {
    const morph = storyStrip.morph;
    const blob = (await buildStoryPptx("blob", store.state.story, { morph, build: morph, storyId: demoStoryOf(store.state.story.snapshots) ?? LOCAL_STORY_ID })) as Blob;
    download(blob, `${slug(store.state.story.title || "histoire")}${morph ? "-morph" : ""}.pptx`);
    toast(morph ? "PowerPoint exporté avec transitions Morph (à ouvrir dans PowerPoint 2019 / Microsoft 365)" : `PowerPoint exporté (${store.state.story.snapshots.length + 2} diapositives)`, "ok", morph ? 5000 : 3000);
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
  const drill = t === "drill" && ds ? initDrill(ds, spec.drill) : spec.drill;
  const errs = store.setSpec({ ...spec, type: t, encoding, drill });
  if (errs.length) toast(errs.join(" ; "), "error");
}

/* ------------------------------------------------------------------ exploration guidée & scénarios */

function drillRoot(): DrillGrain {
  const { spec, ds } = store.state;
  return ds && columnOf(ds, spec.drill.date) ? rootGrain(ds, spec.drill.date!) : spec.drill.grain;
}

/** Clic sur une barre / région / ligne : zoom (période) ou focus (catégorie). */
function onDrillClick(el: Element): void {
  const { spec } = store.state;
  if (spec.type !== "drill") return;
  const kind = el.getAttribute("data-drill-kind");
  const d = spec.drill;
  if (kind === "period") {
    const start = Number(el.getAttribute("data-drill-key"));
    const grain = el.getAttribute("data-drill-grain") as DrillGrain;
    if (!Number.isFinite(start)) return;
    store.set("drill", drillInto(d, { kind: "period", start, grain }, drillRoot()));
  } else if (kind === "cat") {
    const field = el.getAttribute("data-drill-field") ?? "";
    const value = el.getAttribute("data-drill-value") ?? "";
    if (!field || !value || /^Autres \(/.test(value)) return;
    if (d.path.some((p) => p.kind === "cat" && p.field === field && p.value === value)) return;
    store.set("drill", drillInto(d, { kind: "cat", field, value }, drillRoot()));
  }
}

/** Scénario en cours (guidage pas à pas, identifiants stables des snapshots). */
let guide: { sc: Scenario; binding: RoleBinding; frames: ReturnType<typeof runScenario>["frames"]; dataKey: string } | null = null;

function dataKey(): string {
  const { provenance, ds, sampleId } = store.state;
  return provenance?.hash ?? `${sampleId ?? ""}:${ds?.name ?? ""}:${ds?.rows.length ?? 0}`;
}

/** Étape du scénario qui correspond à la vue courante (snapshot pris à la main pendant le pas à pas). */
function guideMatch(): SnapOpts | null {
  const { spec } = store.state;
  if (!guide || spec.type !== "drill") return null;
  const cur = JSON.stringify({ ...spec.drill });
  const f = guide.frames.find((x) => JSON.stringify({ ...x.drill }) === cur);
  return f ? { id: scenarioSnapshotId(guide.sc, f.step, guide.dataKey), scenario: guide.sc.id, step: f.step.id } : null;
}

function guideText(): string | null {
  if (!guide || store.state.spec.type !== "drill") return null;
  const cur = JSON.stringify(store.state.spec.drill);
  const k = guide.frames.findIndex((x) => JSON.stringify(x.drill) === cur);
  const n = guide.frames.length;
  const taken = new Set(store.state.story.snapshots.map((s) => s.step).filter(Boolean));
  if (k < 0) return `${guide.sc.label} · hors parcours — « Suggestion » ou le fil d'Ariane pour y revenir`;
  const next = guide.frames[k + 1];
  return `${guide.sc.label} · étape ${k + 1}/${n} : ${guide.frames[k]!.step.name}${taken.has(guide.frames[k]!.step.id) ? " ✓" : " — 📸 Snapshot"}${next ? ` · ensuite : ${next.step.name}` : " · puis ▶ Film"}`;
}

/** Pas à pas : étape suivante (bouton de piste de la barre d'exploration). */
function guideNext(): { label: string; drill: ChartSpec["drill"] } | null {
  if (!guide || store.state.spec.type !== "drill") return null;
  const cur = JSON.stringify(store.state.spec.drill);
  const k = guide.frames.findIndex((x) => JSON.stringify(x.drill) === cur);
  const next = k >= 0 ? guide.frames[k + 1] : null;
  return next ? { label: `Étape ${k + 2} : ${next.step.name}`, drill: next.drill } : null;
}

/** Spec d'une étape de scénario (textes recalculés, style courant conservé). */
function scenarioSpec(drill: ChartSpec["drill"]): ChartSpec {
  const cur = store.state.spec;
  return { ...cur, type: "drill", drill, story: { ...cur.story, auto: true, kind: null, edited: { title: false, subtitle: false, comments: false } } };
}

let lastUpdate: Promise<void> = Promise.resolve();

async function settle(): Promise<void> {
  await lastUpdate;
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

async function startScenario(sc: Scenario, binding: RoleBinding, auto: boolean): Promise<void> {
  const ds = store.state.ds;
  if (!ds) return;
  const run = runScenario(sc, ds, binding);
  if (!run.frames.length) {
    toast("Scénario impossible sur ces données : vérifiez les colonnes associées aux rôles.", "error", 6000);
    return;
  }
  // empreinte des données de l'exemple (sinon le dataKey tombe sur le repli sampleId:name:n et les ids changent)
  if (store.state.sampleId && !store.state.provenance) await sampleProvenance(store.state.sampleId).then((pr) => pr && store.setProvenance(pr, store.state.dataSeq));
  guide = { sc, binding, frames: run.frames, dataKey: dataKey() };
  drillBar.closePivot();
  store.setStory({ title: sc.storyTitle, snapshots: [], sameScale: false });
  if (run.stoppedAt) toast(`Étape « ${run.stoppedAt.name} » sans objet sur ces données : scénario arrêté à ${run.frames.length} étape(s).`, "info", 6000);
  if (!auto) {
    store.setSpec(scenarioSpec(run.frames[0]!.drill));
    toast(`${sc.label} : cliquez les barres et les régions, ou suivez « Suggestion ». 📸 à chaque étape, puis ▶ Film.`, "ok", 6500);
    return;
  }
  for (const f of run.frames) {
    store.setSpec(scenarioSpec(f.drill));
    await settle();
    await takeSnapshot({ id: scenarioSnapshotId(sc, f.step, guide.dataKey), scenario: sc.id, step: f.step.id, quiet: true });
  }
  toast(`${sc.label} : ${run.frames.length} snapshots créés — lecture du film`, "ok", 3000);
  film.open(store.state.story.snapshots, 0);
}

/* ------------------------------------------------------------------ exports */

function baseName(): string {
  return slug(store.state.spec.style.title || "graphique-datanime");
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

const exploreTopBtn = h("button", { class: "btn btn-explore-top", "data-testid": "explore-open", title: "Pistes de graphiques calculées sur vos données", onclick: () => explorer.toggle() }, h("span", { html: svgIcon(ICONS.explore, 16) }), h("span", { class: "btn-lbl" }, "Explorer mes données"));
const scenarioTopBtn = h("button", { class: "btn btn-scenario", "data-testid": "scenario-open", title: "Scénarios de réunion (Directeur commercial…) : exploration guidée, snapshots, film et PowerPoint", onclick: () => scenarioDialog.open() }, h("span", { html: svgIcon(ICONS.clapper, 16) }), h("span", { class: "btn-lbl" }, "Scénarios"));
const reviewsCount = h("span", { class: "btn-count", "data-testid": "reviews-count" });
const reviewsTopBtn = h("button", { class: "btn", "data-testid": "reviews-open", title: "Revues partagées : liens et QR par snapshot, page participant, réunion et compte rendu", onclick: () => reviewSpace.go({ page: "list", id: null }) }, h("span", { class: "rv-ic", html: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20 C3 16 6 14 9 14 S15 16 15.5 20"/><path d="M16 4.5 A3.5 3.5 0 0 1 16 11.5 M18 14.5 C20 15.3 21.3 17.3 21.5 20"/></svg>` }), h("span", { class: "btn-lbl" }, "Revues"), reviewsCount);
const snapTopBtn = h("button", { class: "btn", "data-testid": "snapshot-top", title: "Ajouter le graphique courant à l'histoire", onclick: () => void takeSnapshot() }, "📸", h("span", { class: "btn-lbl" }, " Snapshot"));

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
    h("h1", null, "Data", h("em", null, "nime"), h("span", { class: "dot" }, " · "), h("span", { class: "studio" }, "Studio")),
    h("span", { class: "tagline" }, "Graphiques SVG animés · alteridea"),
    normeBadge,
    normeInfoBtn
  ),
  h(
    "div",
    { class: "toolbar" },
    h("div", { class: "tool-group" }, h("span", { class: "group-label" }, "Récit"), exploreTopBtn, scenarioTopBtn, snapTopBtn, reviewsTopBtn),
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
const storyStrip = new StoryStrip(store, { snapshot: () => void takeSnapshot(), open: openSnapshot, exportPptx: (b) => void exportPptx(b), scales: () => storyScales(), film: () => film.open(store.state.story.snapshots, 0), read: () => startReading(demoStoryOf(store.state.story.snapshots) ?? LOCAL_STORY_ID, null), cadencer: () => void openCadencer(LOCAL_STORY_ID) });
const cadencer = new CadencerDialog({ download: (id) => downloadManifest(id), copy: (text, label) => void copyText(text, label) });
const film = new StoryFilm((s) => datasetFor(s));

async function copyText(url: string, done = "Lien de la diapositive copié"): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast(done, "ok");
  } catch {
    toast(`Lien : ${url}`, "info", 9000);
  }
}

let readerStory: string | null = null;
let readerReturn = "";
let readSeq = 0;
let closingFromRoute = false;
const reader = new StoryFilm((s) => datasetFor(s), {
  reading: true,
  onSlide: (s) => {
    if (!readerStory) return;
    const hash = readHash(readerStory, s.id);
    if (location.hash !== hash) history.replaceState(null, "", hash);
  },
  onClose: () => {
    readerStory = null;
    if (closingFromRoute) return;
    const back = readerReturn;
    readerReturn = "";
    history.replaceState(null, "", location.pathname + location.search + back);
    void reviewSpace.handleHash(back);
  },
  linkFor: (s) => (readerStory ? snapReadUrl(s, readerStory) : null),
  copy: (u) => void copyText(u),
});

/** Histoire d'un lien de lecture : démo intégrée (recalculée, tout appareil), histoire courante ou revue (cet appareil). */
async function resolveReading(storyId: string): Promise<{ title: string; snapshots: Snapshot[] } | null> {
  const demo = await demoReadingStory(storyId);
  if (demo) return demo;
  if (storyId === LOCAL_STORY_ID) {
    const st = store.state.story;
    return st.snapshots.length ? { title: st.title || "Histoire", snapshots: st.snapshots } : null;
  }
  await reviewSpace.ensureDemo();
  const r = reviewStorage.get(storyId);
  return r ? { title: r.title, snapshots: r.snapshots } : null;
}

async function openReading(rt: ReadRoute): Promise<void> {
  const seq = ++readSeq;
  const story = await resolveReading(rt.storyId);
  if (seq !== readSeq) return;
  if (!story) {
    readerStory = null;
    reader.showMessage(
      "Histoire introuvable sur cet appareil",
      "Ce lien de lecture désigne une histoire ou une revue enregistrée dans le navigateur d'un autre appareil : pour l'instant, les histoires restent sur l'appareil qui les a créées. Les démonstrations intégrées (Directeur commercial, Directeur financier) s'ouvrent partout.",
      [
        { label: "Lire la démo « Directeur commercial »", href: readHash("demo-dircom") },
        { label: "Lire la démo « Directeur financier »", href: readHash("demo-daf") },
        { label: "Ouvrir le Studio", onclick: () => reader.close() },
      ]
    );
    return;
  }
  let k = rt.snapId ? story.snapshots.findIndex((s) => s.id === rt.snapId) : 0;
  if (k < 0) {
    k = 0;
    toast("Diapositive introuvable dans cette histoire : lecture depuis le début", "info", 4500);
  }
  const same = reader.isOpen && readerStory === rt.storyId;
  readerStory = rt.storyId;
  if (same) {
    if (reader.index !== k) reader.goTo(k);
  } else reader.open(story.snapshots, k, story.title);
}

/** Ouvre le mode lecture depuis le Studio ou une revue (retour à la page d'origine à la fermeture). */
function startReading(storyId: string, snapId: string | null): void {
  if (!parseReadRoute(location.hash)) readerReturn = location.hash;
  const hash = readHash(storyId, snapId);
  if (location.hash === hash) void openReading({ storyId, snapId });
  else location.hash = hash;
}

/** Routeur du fragment : mode lecture (#/lire/…), sinon espace Revues. */
async function route(hash: string): Promise<void> {
  const rt = parseReadRoute(hash);
  if (rt) return openReading(rt);
  if (reader.isOpen) {
    closingFromRoute = true;
    reader.close();
    closingFromRoute = false;
  }
  return reviewSpace.handleHash(hash);
}
const drillBar = new DrillBar(store, { snapshot: () => void takeSnapshot(), guide: () => guideText(), guideNext: () => guideNext() });
preview.onDrill = (el) => onDrillClick(el);
const scenarioDialog = new ScenarioDialog(store, { loadSample: (id) => loadSample(id), start: (sc, b, auto) => void startScenario(sc, b, auto) });
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
const center = h("section", { class: "center" }, gallery.root, h("div", { class: "center-stack" }, drillBar.root, preview.root), storyStrip.root);
const leftRail = h("button", { class: "rail rail-left", title: "Afficher les données", onclick: () => store.setUi({ leftCollapsed: false }) }, h("span", { html: svgIcon(ICONS.table, 18) }), h("span", { class: "rail-label" }, "Données"));
const rightRail = h("button", { class: "rail rail-right", title: "Afficher les réglages", onclick: () => store.setUi({ rightCollapsed: false }) }, h("span", { html: svgIcon(ICONS.sliders, 18) }), h("span", { class: "rail-label" }, "Réglages"));
// L'Explorer recouvre l'aperçu et les réglages (vignettes plus grandes, 4 colonnes sur grand écran)
const workspace = h("main", { class: "workspace" }, leftRail, dataPanel.root, center, settings.root, rightRail, explorer.root);
/* ---- espace « Revues » (partage local pour l'instant ; stockage derrière une interface) */
const reviewStorage = new LocalReviewStorage();
const reviewSpace: ReviewSpace = new ReviewSpace(
  {
    storage: reviewStorage,
    datasetFor: (s) => datasetFor(s),
    toast: (m, k, ms) => toast(m, k ?? "info", ms),
    pptx: async (title, snaps): Promise<Blob> => (await buildStoryPptx("blob", { title, snapshots: snaps, sameScale: false }, { storyId: reviewSpace.currentId() ?? LOCAL_STORY_ID })) as Blob,
    film: (snaps, k) => film.open(snaps, k),
    read: (id, snapId) => startReading(id, snapId),
    cadencer: (id) => void openCadencer(id),
    currentStory: () => store.state.story,
    baseUrl: () => location.href.split("#")[0]!.split("?")[0]!,
    openInStudio: (s) => (reviewSpace.close(), openSnapshot(s)),
  },
  tell4dIconMarkup("t4d-rv", 34)
);
const updateReviewsCount = () => {
  const n = reviewStorage.list().length;
  reviewsCount.textContent = n ? String(n) : "";
};
reviewStorage.subscribe(updateReviewsCount);
const app = h("div", { class: "app" }, header, workspace, normeLegend, mappingWindow.root, scenarioDialog.root, film.root, reviewSpace.root, reader.root, cadencer.root);
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
  drillBar.update();
  if (kinds.size === 1 && kinds.has("story")) return;
  gallery.update();
  dataPanel.update();
  settings.update();
  if (kinds.has("data") && explorer.isOpen) explorer.open();
  lastUpdate = preview.update(kinds);
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

// routes de l'espace Revues (#/revues…, #/r/…) : liens et QR de partage
// et mode lecture (#/lire/<histoire>/<snapshot>), ouvert directement depuis un lien ou un QR
window.addEventListener("hashchange", () => void route(location.hash));
if (parseReadRoute(location.hash)) void route(location.hash);
void reviewSpace.ensureDemo().then(() => {
  updateReviewsCount();
  if (location.hash.startsWith("#/") && !parseReadRoute(location.hash)) void reviewSpace.handleHash(location.hash);
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
  scenario: (id: string, auto = true) => scenarioDialog.run(id, auto),
  openSnapshot: (s: Snapshot) => openSnapshot(s),
  film: () => film,
  settle: () => settle(),
  drill: () => store.state.spec.drill,
  story: () => store.state.story,
  moveSnapshot: (from: number, to: number) => storyStrip.move(from, to),
  pptxBase64: async (o: PptxBuildOptions = {}) => (await buildStoryPptx("base64", store.state.story, { storyId: demoStoryOf(store.state.story.snapshots) ?? LOCAL_STORY_ID, ...o })) as string,
  reader: () => reader,
  read: (storyId: string, snapId: string | null = null) => startReading(storyId, snapId),
  readUrl: (s: Snapshot, storyId = LOCAL_STORY_ID) => snapReadUrl(s, storyId),
  reviews: () => reviewSpace,
  reviewStorage: () => reviewStorage,
  reviewPptxBase64: async (id: string) => {
    const r = reviewStorage.get(id);
    if (!r) return null;
    return (await buildStoryPptx("base64", { title: r.title, snapshots: r.snapshots.map((s) => ({ ...s, comments: reportSlideComments(r, s) })), sameScale: false }, { storyId: r.id })) as string;
  },
  storyScales: () => Object.fromEntries(storyScales()),
  setSameScale: (on: boolean) => store.setStory({ ...store.state.story, sameScale: on }),
  /** Manifeste de revue (Pont Cadencer) : « publie » pour la construction, « integre » pour le téléchargement. */
  publication: (storyId: string, mode: "publie" | "integre" = "publie") => publication(storyId, mode),
  publishedStories: () => [...PUBLISHED_STORIES],
  publicationIndex: (manifests: Manifest[], genere_le: string) => buildIndex(manifests, genere_le),
  /** Image intégrée ramenée sous `maxChars` caractères (réduction par paliers, puis palette réduite). */
  fitPng: (dataUrl: string, maxChars: number) => fitPngDataUrl(dataUrl, maxChars, "#ffffff"),
  validateManifest: (m: unknown) => {
    const r = manifestSchema.safeParse(m);
    return r.success ? null : r.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`);
  },
  cadencer: (storyId: string = LOCAL_STORY_ID) => openCadencer(storyId),
  cadencerDialog: () => cadencer,
  pngDataUrl: async (scale = 1) => {
    const { width, height } = chartSize(store.state.spec);
    return blobToDataUrl(await svgToPngBlob(await preview.currentSvg(), width, height, scale));
  },
};
(window as unknown as { r4d: typeof api }).r4d = api;
