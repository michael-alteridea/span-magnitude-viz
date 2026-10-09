/**
 * Datanime · Studio (moteur Reporting 4D) — point d'entrée.
 * Trois zones : Données | Aperçu | Réglages. Tout le rendu est en SVG (D3).
 */
import { armDrillZoom, setZoomEnabled, setZoomSlowdown } from "./ui/drillZoom";
import "./styles.css";
import { Store } from "./state";
import { chartSize, isSpecial, parseSpec, studioFileSchema, type ChartSpec, type ChartType } from "./spec";
import { buildDataset, type Dataset } from "./data/table";
import { readFile, parseText, type ImportResult } from "./data/files";
import { DataWindow, tabFromParam } from "./ui/dataWindow";
import { recentId, rowsToTsv, type RecentEntry } from "./data/recents";
import { SAMPLES, sampleById, sampleLicence } from "./data/samples";
import { autoEncode } from "./data/suggest";
import { SelectionPanel } from "./ui/selectionPanel";
import { Preview } from "./ui/preview";
import { SettingsPanel } from "./ui/settings";
import { chartTarget } from "./ui/panelMap";
import { makeMenu, menuHead, menuItem, menuSep } from "./ui/menu";
import { DataPanel } from "./ui/dataPanel";
import { Gallery } from "./ui/gallery";
import { toast } from "./ui/toast";
import { h, svgIcon, ICONS } from "./ui/dom";
import { download, recordWebm, recordGif, slug, svgToPngBlob, webmSupported, svgToJpegDataUrl, embedFontsInto, blobToDataUrl, pngFit, stableSvgIds } from "./export";
import { themeFor, ensureFont } from "./theme";
import { PLATFORM_URL, tell4dIconMarkup, wordmarkMarkup } from "./brand";
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
import { DATA_URL_MAX_CHARS, MANIFEST_MAX_BYTES, IMAGE_H, IMAGE_W, buildIndex, buildManifest, fingerprintSpec, isPublished, isoLocal, isoOrNull, localStoryManifestId, manifestDownloadName, manifestSchema, manifestUrl, PUBLISHED_STORIES, type Manifest } from "./publish/manifest";
import { CadencerDialog, type CadencerTarget } from "./ui/cadencerDialog";
import { ReelDialog } from "./ui/reelDialog";
import type { ReelItem } from "./reel/charts";
import { REEL_EXAMPLE_TITLE, reelExampleSnapshots } from "./reel/example";
import { licenceFromSource } from "./data/licence";
import { drillStepAdded, type NativeSlide } from "./story/morph";
import { ScenarioDialog } from "./ui/scenarioDialog";
import { drillInto, drillPathLabels, initDrill, rootGrain } from "./data/drill";
import type { DrillGrain } from "./spec";
import { columnOf } from "./data/table";
import { runScenario, scenarioSnapshotId, snapshotIndexOf, type RoleBinding, type Scenario } from "./story/scenarios";
import { cryptoAvailable, hashFileBytes, hashPastedText, hashRows, makeProvenance, type Provenance, type ProvenanceKind } from "./provenance";
import { focusInfo } from "./ui/focusUi";
import { sameExceptFocus } from "./charts/focus";
import { ProjectController } from "./project/controller";
import { openProjectRepo, storageUsage, type ProjectRepo } from "./project/repo";
import { CURRENT_PROJECT_KEY, parseProjectFile, projectFileName, toProjectFile, type Project, type ProjectSource } from "./project/project";
import { ProjectsDialog } from "./ui/projectsDialog";
import { confirmDialog } from "./ui/confirm";
import { DatasetEditor, type DatasetDraft } from "./ui/datasetEditor";
import { datasetChangeDialog } from "./ui/datasetDialog";
import { createDataset, describeRecipe, findDataset, nextDatasetId, sameRecipe, sceneRef, scenesLabel, scenesUsing, toRef, uniqueDatasetName, updateDataset, chipGroups, chipText } from "./data/datasets";
import { applyRecipe } from "./data/transform";
import { REVIEWS_KEY } from "./review/storage";
import type { DatasetRef } from "./spec";

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
  rememberDataset({ kind: sample.publicData ? "public" : "sample", sampleId: sample.id });
  toast(`Exemple chargé : ${sample.name}`, "ok", 2200);
}

let dataWindowReady = false;
/** « Données › Récents » : mémorise le jeu courant (localement, jamais envoyé). */
function rememberDataset(o: { kind: RecentEntry["kind"]; sampleId?: string; fileName?: string; hash?: string | null }): void {
  const ds = store.state.ds;
  if (!ds || !dataWindowReady) return;
  const cols = ds.columns.map((c) => c.name);
  const tsv = o.sampleId ? null : rowsToTsv(cols, ds.raw as Record<string, unknown>[]);
  dataWindow.remember({
    id: recentId(o.kind, o.sampleId ?? ds.name, o.fileName ?? ""),
    kind: o.kind,
    name: ds.name,
    ...(o.fileName ? { fileName: o.fileName } : {}),
    ...(o.sampleId ? { sampleId: o.sampleId } : {}),
    at: new Date().toISOString(),
    rows: ds.rows.length,
    cols: cols.length,
    ...(tsv ? { tsv } : {}),
    ...(o.hash ? { hash: o.hash } : {}),
  });
}

/** Rouvre un jeu récent : exemple rechargé, sinon tableau gardé localement (même chemin qu'un import). */
function reopenRecent(e: RecentEntry): void {
  if (e.sampleId) {
    if (sampleById(e.sampleId)) loadSample(e.sampleId);
    else toast("Cet exemple n'existe plus.", "error");
    return;
  }
  if (!e.tsv) {
    toast("Réimportez le fichier : il était trop volumineux pour être gardé dans ce navigateur.", "info", 4200);
    return;
  }
  const kind = e.kind === "file" ? "file" : "paste";
  void applyImport(parseText(e.tsv, e.name), { hash: e.hash ?? null, kind, fileName: e.fileName ?? "" }).catch((err) => toast(String(err instanceof Error ? err.message : err), "error"));
}

/**
 * Modification d'une cellule (Données › Aperçu › Modifier) : tout jeu de données, exemples compris. Un exemple modifié
 * devient « vos données » (nom « … (modifié) », session enregistrée, snapshots sur les données modifiées) ; l'empreinte
 * suit le contenu (JSON canonique des lignes) ; source et licence restent dans le cartouche (texte du graphique).
 */
function editCell(row: number, column: string, text: string): void {
  const ds = store.state.ds;
  if (!ds || !ds.raw[row] || !ds.columns.some((c) => c.name === column)) return;
  const raw = ds.raw.map((r, i) => (i === row ? { ...r, [column]: text } : r));
  const fromSample = !!store.state.sampleId;
  const name = fromSample && !/ \(modifié\)$/.test(ds.name) ? `${ds.name} (modifié)` : ds.name;
  const nds = buildDataset(name, raw, ds.typeOverrides);
  const note = fromSample ? "Exemple modifié : vos changements sont enregistrés dans cette session ; source et licence restent dans le cartouche (précisez-y que les données ont été modifiées)." : store.state.importNote;
  const { sheets, sheet } = store.state;
  store.setDataset(nds, { note, sheets, sheet, provenance: null });
  if (store.state.spec.style.source && fromSample && !/données modifiées/i.test(store.state.spec.style.source)) store.set("style.source", `${store.state.spec.style.source} · données modifiées`);
  attachProvenance(safeHash(() => hashRows(raw)).then((hash) => (hash ? makeProvenance({ hash, kind: "config", fileName: name, rows: nds.rows.length, cols: nds.columns.length }) : null)));
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
  rememberDataset({ kind: origin?.kind === "file" ? "file" : "paste", fileName: origin?.fileName || undefined, hash: origin?.hash ?? null });
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
  rememberDataset({ kind: origin?.kind === "file" ? "file" : "paste", fileName: origin?.fileName || undefined, hash: null });
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
  editCell,
  reelSample(id: string) {
    void openReel(`public:${id}`);
  },
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
  scenarios() {
    scenarioDialog.open();
  },
  editDataset(id: string | null) {
    openDatasetEditor(id);
  },
  openData() {
    dataWindow.open();
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
      // les pistes sont calculées sur le dataset du graphique : le graphique ouvert le garde
      dataset: cur.dataset,
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
  /** Insertion à cet index (copie « Dupliquer et mettre en avant ») au lieu d'ajouter en fin. */
  insertAt?: number;
  name?: string;
  role?: Snapshot["role"];
}

async function takeSnapshot(opts: SnapOpts = {}): Promise<Snapshot | null> {
  const { spec, ds, sampleId, story } = store.state;
  if (!ds) {
    toast("Chargez des données avant d'ajouter une scène.", "info");
    return null;
  }
  const guided = !opts.id && opts.insertAt == null ? guideMatch() : null;
  if (guided) opts = { ...opts, ...guided };
  const replace = opts.id ? story.snapshots.findIndex((x) => x.id === opts.id) : -1;
  if (replace < 0 && story.snapshots.length >= MAX_SNAPSHOTS) {
    toast(`Séquence limitée à ${MAX_SNAPSHOTS} scènes.`, "info");
    return null;
  }
  const snap = await captureSnapshot(opts);
  const list = [...store.state.story.snapshots];
  if (replace >= 0) list[replace] = snap;
  else if (opts.insertAt != null) list.splice(Math.max(0, Math.min(list.length, opts.insertAt)), 0, snap);
  else list.push(snap);
  store.setStory({ ...store.state.story, snapshots: list });
  store.setUi({ openSections: { ...store.state.ui.openSections, histoire: true } });
  if (!opts.quiet) toast(replace >= 0 ? "Scène mise à jour dans la séquence" : `Scène ajoutée à la séquence (${store.state.story.snapshots.length})`, "ok", 1800);
  return snap;
}

/** Snapshot du graphique courant (rendu, textes, spec), sans l'ajouter à l'histoire. Données chargées requises. */
async function captureSnapshot(opts: SnapOpts = {}): Promise<Snapshot> {
  const { spec, sampleId, story } = store.state;
  const ds = store.state.ds!;
  const { width, height } = chartSize(spec);
  const th = themeFor(spec);
  const n = currentNarrative();
  const full = await preview.finalSvg();
  const [thumb, svg] = await Promise.all([svgToJpegDataUrl(full, width, height, 320, th.bg).catch(() => null), preview.bareSvg().catch(() => null)]);
  const kind = spec.story.kind ?? n?.kind ?? null;
  const snap: Snapshot = {
    id: opts.id ?? newSnapshotId(),
    name: opts.name ?? (spec.style.title || `Scène ${story.snapshots.length + 1}`),
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
    role: opts.role ?? n?.role ?? roleForKind(kind),
    sampleId,
    dataName: ds.name,
    generatedAt: new Date().toISOString(),
    path: spec.type === "drill" ? drillPathLabels(spec.drill) : [],
    scenario: opts.scenario ?? null,
    step: opts.step ?? null,
  };
  return snap;
}

/* ---- « Modifier le graphique » d'une scène du Reel : éditeur complet, puis retour au Reel */

let reelEdit: { item: ReelItem; sceneNo: number; before: { spec: ChartSpec; ds: Dataset | null; sampleId: string | null; note: string | null; provenance: Provenance | null; sheets: string[] | null; sheet: string | null } } | null = null;
const reelEditLabel = h("span", { class: "reel-edit-label", "data-testid": "reel-edit-label" });
const reelEditBar = h(
  "div",
  { class: "reel-edit-bar", role: "region", "aria-label": "Modification d'une scène du Reel", hidden: true, "data-testid": "reel-edit-bar" },
  h("span", { class: "reel-edit-ico", html: svgIcon(ICONS.reel, 16) }),
  reelEditLabel,
  h("span", { class: "reel-edit-hint" }, "Type, couleurs, mise en avant, réglages : tout l'éditeur est disponible."),
  h("button", { class: "btn", type: "button", "data-testid": "reel-edit-cancel", onclick: () => void cancelReelEdit() }, "Annuler"),
  h("button", { class: "btn btn-accent", type: "button", "data-testid": "reel-edit-validate", onclick: () => void validateReelEdit() }, h("span", { html: svgIcon(ICONS.check, 15) }), "Valider")
);

function editReelScene(item: ReelItem, sceneNo: number): void {
  const st = store.state;
  reelEdit = { item, sceneNo, before: { spec: structuredClone(st.spec), ds: st.ds, sampleId: st.sampleId, note: st.importNote, provenance: st.provenance, sheets: st.sheets, sheet: st.sheet } };
  reelDialog.suspend();
  const s = item.snap;
  const sample = s.sampleId ? sampleById(s.sampleId) : undefined;
  // données du snapshot (exemple, ou données du Reel) chargées dans l'éditeur si ce ne sont pas les données courantes
  if (!sample && item.ds && st.ds !== item.ds && st.ds?.name !== s.dataName) store.setDataset(item.ds, { note: `Données de la scène « ${s.title || s.name} »` });
  openSnapshot(s);
  reelEditLabel.textContent = `Modification de la scène ${sceneNo} du Reel`;
  reelEditBar.hidden = false;
  document.body.classList.add("reel-editing");
  settings.reveal({ section: "graphique", paths: [] });
}

function endReelEdit(): void {
  reelEdit = null;
  reelEditBar.hidden = true;
  document.body.classList.remove("reel-editing");
}

/** Valider : le snapshot est remplacé sur place (même id, même position), puis la fenêtre du Reel revient. */
async function validateReelEdit(): Promise<void> {
  const e = reelEdit;
  if (!e || !store.state.ds) return;
  stopFocusPick();
  await settle();
  const s = e.item.snap;
  const opts: SnapOpts = { id: s.id, name: s.name, role: s.role, scenario: s.scenario ?? null, step: s.step ?? null, quiet: true };
  const inStory = store.state.story.snapshots.some((x) => x.id === s.id);
  const snap = inStory ? await takeSnapshot(opts) : await captureSnapshot(opts);
  if (!snap) return;
  if (s.path?.length && !snap.path?.length) snap.path = s.path;
  endReelEdit();
  await reelDialog.resume({ snap, ds: store.state.ds });
  toast(`Scène ${e.sceneNo} mise à jour${inStory ? " (et dans la séquence)" : ""}`, "ok", 2200);
}

/** Annuler : l'éditeur retrouve son état d'avant, le Reel revient inchangé. */
async function cancelReelEdit(): Promise<void> {
  const e = reelEdit;
  if (!e) return;
  stopFocusPick();
  const b = e.before;
  if (store.state.ds !== b.ds) store.setDataset(b.ds, { sampleId: b.sampleId, note: b.note, provenance: b.provenance, sheets: b.sheets, sheet: b.sheet });
  store.setSpec(b.spec);
  endReelEdit();
  await reelDialog.resume(null);
}

function openSnapshot(s: Snapshot): void {
  const sample = s.sampleId ? sampleById(s.sampleId) : undefined;
  if (sample && store.state.sampleId !== sample.id) {
    store.setDataset(buildDataset(sample.name, sample.rows()), { sampleId: sample.id, note: sample.description });
    attachProvenance(sampleProvenance(sample.id));
  } else if (!sample && store.state.ds?.name !== s.dataName) {
    toast(`Cette scène a été prise sur « ${s.dataName} » : rechargez ces données pour le retrouver à l'identique.`, "info", 5000);
  }
  const errs = store.setSpec(s.spec);
  if (errs.length) toast(errs.join(" ; "), "error");
}

/* ---- mise en avant (étape L) : choix au toucher et « Dupliquer et mettre en avant » */

let focusPicking = false;
/** Copie mise en avant en cours d'édition : ses réglages de mise en avant suivent l'éditeur. */
let focusCopy: { id: string; base: unknown } | null = null;
let focusSyncTimer = 0;

function startFocusPick(): void {
  if (!focusInfo(store.state.spec, store.state.ds).kind) {
    toast("Ce graphique n'a pas d'élément à mettre en avant.", "info");
    return;
  }
  focusPicking = true;
  preview.setFocusPicking(true, stopFocusPick);
}

function stopFocusPick(): void {
  focusPicking = false;
  preview.setFocusPicking(false);
}

/** Toucher d'une marque : en mode choix (ou mise en avant déjà active hors exploration), elle devient la marque mise en avant. */
function onFocusTap(key: string): boolean {
  const spec = store.state.spec;
  if (!key) return false;
  // hors du mode « Choisir sur le graphique », un toucher sur une marque sert la sélection par touchers successifs
  // (la mise en avant se déplace depuis le panneau contextuel de l'élément : « Mettre en avant »)
  if (!focusPicking) return false;
  stopFocusPick();
  if (spec.style.focus.key !== key) store.set("style.focus.key", key);
  settings.reveal({ section: "recit", paths: ["style.focus.key"], group: "focus" });
  window.setTimeout(() => {
    const note = document.querySelector<HTMLInputElement>('[data-path="style.focus.note"]');
    if (note && !matchMedia("(pointer: coarse)").matches) note.focus({ preventScroll: true });
  }, 60);
  return true;
}

/** Duplique le snapshot juste après lui-même, mise en avant active, et ouvre le choix de l'élément. */
async function duplicateAndFocus(s: Snapshot): Promise<void> {
  const i = store.state.story.snapshots.findIndex((x) => x.id === s.id);
  if (i < 0) return;
  openSnapshot(s);
  await settle();
  const fi = focusInfo(store.state.spec, store.state.ds);
  if (!fi.kind) {
    toast("Ce type de graphique n'a pas de mise en avant (barres d'une seule série, secteurs, arcs, points, courbes ou carte).", "info", 4200);
    return;
  }
  if (!store.state.spec.style.focus.key) store.set("style.focus.key", "@max");
  await settle();
  const copy = await takeSnapshot({ insertAt: i + 1, name: `${s.name} · mise en avant`, role: s.role, quiet: true });
  if (!copy) return;
  focusCopy = { id: copy.id, base: s.spec };
  startFocusPick();
  toast("Copie ajoutée juste après : touchez l'élément à mettre en avant, puis écrivez le commentaire.", "ok", 3200);
}

/** Les retouches de mise en avant (élément, titre, texte) sont reportées sur la copie tant que le graphique reste le même. */
function syncFocusCopy(): void {
  if (!focusCopy) return;
  const spec = store.state.spec;
  if (!sameExceptFocus(focusCopy.base, spec) || !store.state.story.snapshots.some((x) => x.id === focusCopy!.id)) {
    focusCopy = null;
    return;
  }
  const cur = store.state.story.snapshots.find((x) => x.id === focusCopy!.id)!;
  const cs = cur.spec as typeof spec;
  if (JSON.stringify(cs.style.focus) === JSON.stringify(spec.style.focus) && cs.style.title === spec.style.title && cs.style.subtitle === spec.style.subtitle && JSON.stringify(cs.story) === JSON.stringify(spec.story)) return;
  window.clearTimeout(focusSyncTimer);
  const id = focusCopy.id;
  focusSyncTimer = window.setTimeout(() => {
    void settle().then(() => {
      if (focusCopy?.id === id) void takeSnapshot({ id, name: cur.name, role: cur.role, scenario: cur.scenario, step: cur.step, quiet: true });
    });
  }, 450);
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
    if (!p) return void toast("Rien à envoyer : la séquence est vide", "info");
    const fit = await fitManifestForDownload(p.manifest);
    download(new Blob([fit.json], { type: "application/json" }), manifestDownloadName(p.manifest.id));
    if (fit.over) toast(`Manifeste téléchargé, mais au-delà des limites de Cadencer (12 Mo, 800 000 caractères par image) : retirez des scènes avant l'envoi.`, "error", 8000);
    else if (fit.reduced) toast(`Manifeste téléchargé (${p.manifest.snapshots.length} scènes ; ${fit.reduced} image${fit.reduced > 1 ? "s" : ""} réduite${fit.reduced > 1 ? "s" : ""} pour rester sous 12 Mo)`, "ok", 5000);
    else toast(`Manifeste téléchargé (${p.manifest.snapshots.length} scènes, images intégrées)`, "ok", 4000);
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

/** « Créer un Reel » : histoire courante, revue, ou exemple public (Eurostat) quand l'histoire est vide. */
async function openReel(storyId: string = LOCAL_STORY_ID): Promise<void> {
  let title: string;
  let snaps: Snapshot[];
  const pub = storyId.startsWith("public:") ? sampleById(storyId.slice(7)) : undefined;
  if (pub?.publicData?.reel) {
    // Données publiques : exemple chargé dans l'éditeur (modifiable), Reel sur l'histoire suggérée
    if (store.state.sampleId !== pub.id) loadSample(pub.id);
    const r = await pub.publicData.reel();
    title = r.title;
    snaps = r.snapshots;
  } else if (storyId === "exemple" || (storyId === LOCAL_STORY_ID && !store.state.story.snapshots.length)) {
    title = REEL_EXAMPLE_TITLE;
    snaps = reelExampleSnapshots();
  } else if (storyId === LOCAL_STORY_ID) {
    title = store.state.story.title.trim() || "Histoire";
    snaps = store.state.story.snapshots;
  } else {
    await reviewSpace.ensureDemo();
    const r = reviewStorage.get(storyId);
    title = r?.title ?? storyId;
    snaps = r?.snapshots ?? [];
  }
  if (!snaps.length) {
    toast("Aucune scène à raconter : ajoutez des scènes à la séquence (📸).", "info");
    return;
  }
  // Licence : celle de l'exemple, sinon celle écrite dans la source (données publiques modifiées : « … · Licence : … »)
  const lic = [...new Set(snaps.map((s) => sampleLicence(s.sampleId) || licenceFromSource(s.source)).filter(Boolean))];
  if (reelEdit) endReelEdit();
  await reelDialog.open({ title, items: snaps.map((snap) => ({ snap, ds: datasetFor(snap) })), licence: lic.length === 1 ? lic[0]! : "", editChart: editReelScene });
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
        ? "Séquence identique à la démonstration publiée : Cadencer importe la version en ligne."
        : pub.demo
          ? `Ces scènes viennent de la démonstration publiée, dont le manifeste complet est disponible : ${manifestUrl(pub.demo)}`
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

/** Texte de progression posé sur un bouton (libellé seul si le bouton en a un, icône conservée). */
function busyText(btn: HTMLButtonElement, text: string): void {
  const l = btn.querySelector<HTMLElement>("[data-busy], .btn-lbl, .mi-l");
  if (l) l.textContent = text;
  else btn.textContent = text;
}

async function exportPptx(btn: HTMLButtonElement): Promise<void> {
  if (!store.state.story.snapshots.length) return;
  const label = btn.innerHTML;
  btn.disabled = true;
  busyText(btn, "PowerPoint…");
  try {
    const morph = storyStrip.morph;
    const blob = (await buildStoryPptx("blob", store.state.story, { morph, build: morph, storyId: demoStoryOf(store.state.story.snapshots) ?? LOCAL_STORY_ID })) as Blob;
    download(blob, `${slug(store.state.story.title || "histoire")}${morph ? "-morph" : ""}.pptx`);
    toast(morph ? "PowerPoint exporté avec transitions Morph (à ouvrir dans PowerPoint 2019 / Microsoft 365)" : `PowerPoint exporté (${store.state.story.snapshots.length + 2} diapositives)`, "ok", morph ? 5000 : 3000);
  } catch (e) {
    toast("Export PowerPoint impossible : " + (e instanceof Error ? e.message : String(e)), "error", 6000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
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
    armDrillZoom();
    store.set("drill", drillInto(d, { kind: "period", start, grain }, drillRoot()));
  } else if (kind === "cat") {
    const field = el.getAttribute("data-drill-field") ?? "";
    const value = el.getAttribute("data-drill-value") ?? "";
    if (!field || !value || /^Autres \(/.test(value)) return;
    if (d.path.some((p) => p.kind === "cat" && p.field === field && p.value === value)) return;
    armDrillZoom();
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
  return f ? { id: scenarioSnapshotId(guide.sc, f.step), scenario: guide.sc.id, step: f.step.id } : null;
}

function guideText(): string | null {
  if (!guide || store.state.spec.type !== "drill") return null;
  const cur = JSON.stringify(store.state.spec.drill);
  const k = guide.frames.findIndex((x) => JSON.stringify(x.drill) === cur);
  const n = guide.frames.length;
  const taken = new Set(store.state.story.snapshots.map((s) => s.step).filter(Boolean));
  if (k < 0) return `${guide.sc.label} · hors parcours — « Suggestion » ou le fil d'Ariane pour y revenir`;
  const next = guide.frames[k + 1];
  return `${guide.sc.label} · étape ${k + 1}/${n} : ${guide.frames[k]!.step.name}${taken.has(guide.frames[k]!.step.id) ? " ✓" : " — 📸 Ajouter la scène"}${next ? ` · ensuite : ${next.step.name}` : " · puis ▶ Film"}`;
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
    await takeSnapshot({ id: scenarioSnapshotId(sc, f.step), scenario: sc.id, step: f.step.id, quiet: true });
  }
  toast(`${sc.label} : ${run.frames.length} scènes créées — lecture du film`, "ok", 3000);
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
  const label = btn.innerHTML;
  btn.disabled = true;
  preview.setRecording(true);
  try {
    const blob = await recordWebm((p) => preview.svgAt(p), {
      width,
      height,
      durationMs: preview.exportDuration(),
      bg: themeFor(store.state.spec).bg,
      onProgress: (p) => busyText(btn, `Vidéo… ${Math.round(p * 100)} %`),
    });
    download(blob, `${baseName()}.webm`);
    toast("Vidéo WebM exportée", "ok");
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error", 6000);
  } finally {
    preview.setRecording(false);
    btn.disabled = false;
    btn.innerHTML = label;
    preview.restart(false);
    preview.seek(1);
  }
}

/** GIF animé : mêmes images que la vidéo (boucle d'images commune), encodées dans le navigateur. */
async function exportGifAnim(btn: HTMLButtonElement): Promise<void> {
  if (preview.playMode === "none") {
    toast("Passez en mode « Dynamique » (animation d'entrée ou 4D) pour exporter un GIF animé.", "info", 5000);
    return;
  }
  const { width, height } = chartSize(store.state.spec);
  const label = btn.innerHTML;
  btn.disabled = true;
  preview.setRecording(true);
  try {
    const blob = await recordGif((p) => preview.svgAt(p), {
      width,
      height,
      durationMs: preview.exportDuration(),
      bg: themeFor(store.state.spec).bg,
      onProgress: (p) => busyText(btn, `GIF… ${Math.round(p * 100)} %`),
    });
    download(blob, `${baseName()}.gif`);
    toast(`GIF animé exporté (${(blob.size / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo)`, "ok");
  } catch (e) {
    toast("Export GIF impossible : " + (e instanceof Error ? e.message : String(e)), "error", 6000);
  } finally {
    preview.setRecording(false);
    btn.disabled = false;
    btn.innerHTML = label;
    preview.restart(false);
    preview.seek(1);
  }
}

/** « Ouvrir un fichier » : projet `.datanime`, ou ancienne configuration `.r4d.json` (spec nu accepté). */
async function openFile(file: File): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    toast(`Fichier illisible : ${file.name}`, "error", 6000);
    return;
  }
  let parsed: ReturnType<typeof parseProjectFile>;
  try {
    parsed = parseProjectFile(raw);
  } catch (e) {
    toast("Projet invalide : " + (e instanceof Error ? e.message : String(e)), "error", 7000);
    return;
  }
  if ("legacy" in parsed) return loadConfig(raw, file.name);
  if (projects.dirty && !(await confirmDialog({ title: `Ouvrir « ${parsed.project.name} »`, message: "Le projet ouvert a des modifications non enregistrées : elles seront perdues.", confirm: "Ouvrir sans enregistrer", danger: true, testid: "confirm-open" }))) return;
  try {
    const p = await projects.importProject(parsed.project);
    await projects.open(p);
    toast(`Projet « ${p.name} » importé et ouvert${parsed.withData ? "" : " (sans les données importées)"}`, "ok");
  } catch (e) {
    toast("Import impossible : " + (e instanceof Error ? e.message : String(e)), "error", 7000);
  }
}

async function loadConfig(raw: any, fileName: string): Promise<void> {
  try {
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
      store.setDataset(ds, { sampleId, note: "Chargé depuis " + fileName, provenance: sampleId || rowsForHash ? null : savedProv });
      if (sampleId) attachProvenance(sampleProvenance(sampleId));
      else if (rowsForHash && ds) {
        const rows = rowsForHash;
        const n = ds.rows.length;
        const c = ds.columns.length;
        attachProvenance(safeHash(() => hashRows(rows)).then((hash) => (hash ? makeProvenance({ hash, kind: "config", fileName, rows: n, cols: c }) : null)));
      }
    }
    if (f.story && Array.isArray(f.story.snapshots) && f.story.snapshots.length) store.setStory(parseStory(f.story));
    toast("Configuration chargée", "ok");
  } catch (e) {
    toast("Configuration invalide : " + (e instanceof Error ? e.message : String(e)), "error", 7000);
  }
}

/* ------------------------------------------------------------------ layout */

const cfgInput = h("input", { type: "file", accept: ".datanime,.json,application/json", class: "hidden", "data-testid": "config-input" });
cfgInput.addEventListener("change", () => {
  const f = cfgInput.files?.[0];
  if (f) void openFile(f);
  cfgInput.value = "";
});

const pngScale = h(
  "select",
  { title: "Résolution PNG", "aria-label": "Résolution PNG", "data-testid": "png-scale" },
  ...[1, 2, 3].map((v) => h("option", { value: String(v), selected: store.state.ui.pngScale === v }, `${v}×`))
);
pngScale.addEventListener("change", () => {
  store.setUi({ pngScale: Number(pngScale.value) as 1 | 2 | 3 });
  pngItem.querySelector(".mi-l")!.textContent = `Image PNG ${pngScale.value}×`;
});


/* ---- menus « Exporter » et « Fichier » (remplacent les 9 boutons d'export et de configuration) */
const ic = (k: keyof typeof ICONS, n = 16) => svgIcon(ICONS[k], n);
const exportBtn: HTMLButtonElement = h("button", { type: "button", class: "btn btn-accent btn-export menu-btn", title: "Exporter le graphique (SVG, PNG, vidéo) ou la séquence (PowerPoint)" }, h("span", { html: ic("export") }), h("span", { class: "btn-lbl", "data-busy": "" }, "Exporter"));
const pngItem = menuItem(ic("image"), `Image PNG ${store.state.ui.pngScale}×`, { testid: "export-png", hint: "Présentations, documents", onclick: () => void exportPng().catch((e) => toast(String(e), "error")) });
const webmBtn = menuItem(ic("film2"), "Vidéo WebM", { testid: "export-webm", hint: webmSupported() ? "Animation d'entrée ou 4D" : "MediaRecorder indisponible dans ce navigateur", onclick: () => void exportWebm(exportBtn) });
const pptxItem = menuItem(ic("story"), "PowerPoint de la séquence", { testid: "export-pptx", hint: "Une scène par diapositive", onclick: () => void exportPptx(exportBtn) });
const exportMenu = makeMenu(
  exportBtn,
  [
    menuHead("Télécharger le graphique"),
    menuItem(ic("download"), "Image SVG", { testid: "export-svg", hint: "Vectoriel, polices intégrées", onclick: () => void exportSvg().catch((e) => toast(String(e), "error")) }),
    pngItem,
    h("div", { class: "menu-row" }, h("span", null, "Résolution PNG"), pngScale),
    webmBtn,
    menuItem(ic("film"), "GIF animé", { testid: "export-gif", hint: "Animation d'entrée ou 4D, 12 images/s", onclick: () => void exportGifAnim(exportBtn) }),
    menuSep(),
    menuHead("Séquence"),
    pptxItem,
  ],
  { testid: "export-menu", label: "Exporter" }
);
exportBtn.addEventListener("click", () => {
  const n = store.state.story.snapshots.length;
  pptxItem.disabled = n === 0;
  pptxItem.querySelector("small")!.textContent = n ? `${n} scène${n > 1 ? "s" : ""} · une diapositive chacune` : "Ajoutez d'abord des scènes (📸)";
});
const fileBtn: HTMLButtonElement = h("button", { type: "button", class: "btn btn-ghost menu-btn", title: "Projets : mes projets, enregistrer, exporter, ouvrir un fichier, réinitialiser" }, h("span", { html: ic("folder") }), h("span", { class: "btn-lbl" }, "Projets"), h("span", { class: "menu-car", html: ic("chevronD", 12) }));
makeMenu(
  fileBtn,
  [
    menuItem(ic("folder"), "Mes projets…", { testid: "projects-open", hint: "Projets enregistrés sur cet appareil", onclick: () => void projectsDialog.open() }),
    menuItem(ic("save"), "Enregistrer", { testid: "save-project", hint: "Source, graphique et séquence, sur cet appareil", onclick: () => void saveProject() }),
    menuItem(ic("download"), "Exporter le projet", { testid: "export-project", hint: "Fichier .datanime (données incluses)", onclick: () => void exportCurrentProject() }),
    menuItem(ic("upload"), "Ouvrir un fichier…", { testid: "load-config", hint: "Projet .datanime ou ancienne configuration .r4d.json", onclick: () => cfgInput.click() }),
    menuSep(),
    menuHead("Réinitialiser"),
    menuItem(ic("history"), "Revenir au dernier enregistrement", { testid: "reset-revert", hint: "Annule les changements non enregistrés", onclick: () => void revertProject() }),
    menuItem(ic("story"), "Vider la séquence", { testid: "reset-clear", hint: "Garde la source et le graphique", onclick: () => void clearSequence() }),
    menuItem(ic("refresh"), "Tout réinitialiser", { testid: "reset-config", hint: "Source, graphique et séquence (projet vide)", danger: true, onclick: () => void resetAll() }),
  ],
  { testid: "file-menu", label: "Projets" }
);

// Fenêtre « Données » : entrée claire dans la barre du haut
const dataTopBtn = h("button", { type: "button", class: "btn btn-ghost btn-data-top", "data-testid": "data-open-top", title: "Importer un fichier, coller un tableau, rouvrir un jeu récent, choisir un exemple ou des données publiques", onclick: () => dataWindow.open() }, h("span", { html: svgIcon(ICONS.table, 15) }), h("span", { class: "btn-lbl" }, "Ouvrir des données"));
const reviewsCount = h("span", { class: "btn-count", "data-testid": "reviews-count" });
const reviewsTopBtn = h("button", { type: "button", class: "btn btn-ghost btn-reviews", "data-testid": "reviews-open", title: "Revues partagées : liens et QR par scène, page participant, réunion et compte rendu", onclick: () => reviewSpace.go({ page: "list", id: null }) }, h("span", { class: "rv-ic", html: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20 C3 16 6 14 9 14 S15 16 15.5 20"/><path d="M16 4.5 A3.5 3.5 0 0 1 16 11.5 M18 14.5 C20 15.3 21.3 17.3 21.5 20"/></svg>` }), h("span", { class: "btn-lbl" }, "Mes revues"), reviewsCount);

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
    h("h1", null, h("span", { class: "wm", html: wordmarkMarkup("dark", 14) }), h("span", { class: "dot" }, " · "), h("span", { class: "studio" }, "Studio")),
    normeBadge,
    normeInfoBtn
  ),
  h(
    "div",
    { class: "toolbar" },
    h("div", { class: "tool-group" }, dataTopBtn, reviewsTopBtn, fileBtn, cfgInput, exportBtn)
  )
);

/** Fenêtre « Données » : fichier, collage, récents, exemples, données publiques (une seule porte d'entrée). */
const dataWindow = new DataWindow({
  loadSample: (id) => actions.loadSample(id),
  importText: (t) => actions.importText(t),
  importFile: (f) => actions.importFile(f),
  reshape: () => reopenMapping(),
  reelSample: (id) => actions.reelSample(id),
  scenarios: () => scenarioDialog.open(),
  reopenRecent: (e) => reopenRecent(e),
});
dataWindowReady = true;

/* ---- Datasets dérivés (déploiement 2) : étape « Filtrer » de la fenêtre Données, catalogue, scènes */

const datasetEditor = new DatasetEditor(store, {
  save: (d, asNew) => saveDatasetDraft(d, asNew),
  useWithoutSaving: (d) => {
    // Filtre de vue du graphique courant (sur la source entière), sans créer de dataset
    const spec = store.state.spec;
    store.setSpec({ ...spec, dataset: null, transform: { ...spec.transform, filters: d.filters.slice(0, 10) } });
    dataWindow.close();
    toast(d.filters.length ? "Filtres appliqués à ce graphique seulement (Réglages › ① Graphique › Filtre de vue)" : "Le graphique utilise toute la source", "ok", 3200);
  },
  close: () => dataWindow.close(),
});
dataWindow.attachEditor(datasetEditor.root, () => !!store.state.ds, (id) => openDatasetEditor(id));

function openDatasetEditor(id: string | null): void {
  if (!store.state.ds) {
    dataWindow.open();
    return;
  }
  datasetEditor.start(id);
  dataWindow.showFilter();
}

/** Scènes déjà partagées dans une revue (identifiants), pour le dialogue « N scènes utilisent ce dataset ». */
function sharedSceneIds(): Set<string> {
  const out = new Set<string>();
  try {
    const raw = localStorage.getItem(REVIEWS_KEY);
    const reviews = raw ? ((JSON.parse(raw) as { reviews?: { demo?: boolean; snapshots?: { id?: string }[] }[] }).reviews ?? []) : [];
    for (const r of reviews) if (!r.demo) for (const sn of r.snapshots ?? []) if (sn.id) out.add(sn.id);
  } catch {
    /* stockage indisponible */
  }
  return out;
}

/** Ce qui change entre deux recettes (« + Distribution », « Année : 2025 → 2026 »). */
function recipeDelta(before: DatasetRef["filters"], after: DatasetRef["filters"]): string {
  const b = new Map(chipGroups(before).map((g) => [g.field, g]));
  const parts: string[] = [];
  for (const g of chipGroups(after)) {
    const o = b.get(g.field);
    if (!o) parts.push(`${g.field} : ${chipText(g)}`);
    else if (JSON.stringify(o.filters) !== JSON.stringify(g.filters)) {
      const added = g.filters[0]?.op === "in" && o.filters[0]?.op === "in" ? g.filters[0].values.filter((v) => !o.filters[0]!.values.includes(v)) : [];
      parts.push(added.length && added.length <= 3 && g.filters[0]!.values.length > o.filters[0]!.values.length ? `mêmes filtres + ${added.join(", ")}` : `${g.field} : ${chipText(g)}`);
    }
  }
  for (const f of b.keys()) if (!chipGroups(after).some((g) => g.field === f)) parts.push(`sans filtre ${f}`);
  return parts.join(" · ");
}

/**
 * « Mettre à jour les scènes » : chaque scène est rechargée avec la nouvelle recette, son récit recalculé (les textes
 * saisis à la main sont gardés : drapeaux story.edited) puis reprise à la même place, sous le même identifiant.
 */
async function updateScenesDataset(ids: string[], ref: DatasetRef): Promise<void> {
  const current = structuredClone(store.state.spec);
  for (const id of ids) {
    const s = store.state.story.snapshots.find((x) => x.id === id);
    if (!s) continue;
    const r = parseSpec({ ...(s.spec as object), dataset: ref });
    if (!r.ok) continue;
    store.setSpec(r.spec);
    await settle();
    await takeSnapshot({ id: s.id, name: s.name, role: s.role, scenario: s.scenario ?? null, step: s.step ?? null, quiet: true });
  }
  store.setSpec(current.dataset?.id === ref.id ? { ...current, dataset: ref } : current);
  await settle();
}

async function saveDatasetDraft(d: DatasetDraft, asNew: boolean): Promise<void> {
  const src = store.state.ds;
  if (!src) return;
  const list = store.state.datasets;
  const cur = d.editId && !asNew ? findDataset(list, src.name, d.editId) : undefined;
  if (!cur) {
    const name = uniqueDatasetName(list, src.name, d.name);
    const nd = createDataset(list, src.name, { name, filters: d.filters, columns: d.columns });
    store.setDatasets([...list, nd]);
    store.set("dataset", toRef(nd));
    dataWindow.close();
    toast(`Dataset ${nd.id} « ${nd.name} » enregistré : le graphique l'utilise (${applyRecipe(src, nd).rows.length.toLocaleString("fr-FR")} lignes).`, "ok", 3600);
    return;
  }
  const name = uniqueDatasetName(list, src.name, d.name, cur.id);
  const next = updateDataset(cur, { name, filters: d.filters, columns: d.columns });
  const replace = (x: typeof next) => store.state.datasets.map((y) => (y.id === x.id && y.source === x.source ? x : y));
  const snaps = store.state.story.snapshots;
  const users = scenesUsing(snaps, cur.id).filter((s) => sceneRef(s)!.version === cur.version || !sameRecipe(sceneRef(s)!, next));
  const recipeChanged = !sameRecipe(cur, next);
  const followChart = (ref: DatasetRef) => {
    if (store.state.spec.dataset?.id === ref.id) store.set("dataset", ref);
  };
  if (!recipeChanged || !users.length) {
    store.setDatasets(replace(next));
    followChart(toRef(next));
    dataWindow.close();
    toast(recipeChanged ? `Dataset ${next.id} mis à jour (v${next.version})` : `Dataset ${next.id} renommé « ${next.name} »`, "ok", 2600);
    return;
  }
  const rowsBefore = applyRecipe(src, cur).rows.length;
  const rowsAfter = applyRecipe(src, next).rows.length;
  const since = new Date(cur.updatedAt);
  const choice = await datasetChangeDialog({
    id: cur.id,
    name: cur.name,
    version: cur.version,
    before: cur.filters,
    after: next.filters,
    rowsBefore,
    rowsAfter,
    scenes: users.map((snap) => ({ snap, index: snaps.indexOf(snap) })),
    shared: sharedSceneIds(),
    nextId: nextDatasetId(list, src.name),
    delta: recipeDelta(cur.filters, next.filters),
    since: Number.isFinite(since.getTime()) ? `${since.toLocaleDateString("fr-FR")} ${since.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "",
  });
  if (!choice) return;
  dataWindow.close();
  if (choice === "new") {
    const nd = createDataset(list, src.name, { name: uniqueDatasetName(list, src.name, d.name === cur.name ? `${d.name} (variante)` : d.name), filters: next.filters, columns: next.columns });
    store.setDatasets([...list, nd]);
    store.set("dataset", toRef(nd));
    toast(`Nouveau dataset ${nd.id} « ${nd.name} » : ${cur.id} et ses scènes ne changent pas.`, "ok", 3600);
    return;
  }
  store.setDatasets(replace(next));
  if (choice === "freeze") {
    followChart(toRef(next));
    toast(`${scenesLabel(users.length)} ${users.length > 1 ? "restent figées" : "reste figée"} sur ${cur.id} v${cur.version} ; le dataset passe en v${next.version}.`, "ok", 3800);
    return;
  }
  toast(`Mise à jour de ${scenesLabel(users.length)}…`, "info", 1500);
  await updateScenesDataset(users.map((u) => u.id), toRef(next));
  toast(`${scenesLabel(users.length)} ${users.length > 1 ? "mises à jour" : "mise à jour"} avec ${next.id} v${next.version} (${describeRecipe(next) || "sans filtre"}).`, "ok", 3800);
}
const gallery = new Gallery(store, (t) => void pickType(t));
const dataPanel = new DataPanel(store, actions);
const settings = new SettingsPanel(store, {
  exportSvg: () => void exportSvg().catch((e) => toast(String(e), "error")),
  exportPng: () => void exportPng().catch((e) => toast(String(e), "error")),
  exportWebm: (b) => void exportWebm(b),
  exportGif: (b) => void exportGifAnim(b),
  exportPptx: (b) => void exportPptx(b),
  snapshots: () => store.state.story.snapshots.length,
  pickFocus: () => startFocusPick(),
  editDataset: (id) => openDatasetEditor(id),
});
// Sélection par touchers successifs : panneau contextuel en tête des réglages
const selPanel = new SelectionPanel(store, preview.selection, {
  showAll: () => preview.selection.set({ level: "page", ek: null, sk: null, name: "" }),
  pickType: (t) => void pickType(t),
});
settings.root.insertBefore(selPanel.root, settings.root.querySelector(".acc-search"));
const syncSelCtx = () => {
  const lvl = preview.selection.sel?.level ?? null;
  settings.root.classList.toggle("sel-ctx", !!lvl && lvl !== "page");
  settings.root.classList.toggle("sel-page", lvl === "page");
};
preview.selection.onChange((sel) => {
  syncSelCtx();
  if (sel && sel.level !== "page" && store.state.ui.rightCollapsed) store.setUi({ rightCollapsed: false });
});
const explorer = new Explorer(store, storyContext, openInsight);
const storyStrip: StoryStrip = new StoryStrip(store, {
  snapshot: () => void takeSnapshot(),
  open: openSnapshot,
  duplicateFocus: (s) => void duplicateAndFocus(s),
  exportPptx: (b) => void exportPptx(b),
  scales: () => storyScales(),
  film: () => film.open(store.state.story.snapshots, 0),
  read: () => startReading(demoStoryOf(store.state.story.snapshots) ?? LOCAL_STORY_ID, null),
  cadencer: () => void openCadencer(LOCAL_STORY_ID),
  reel: () => void openReel(LOCAL_STORY_ID),
  status: () => ({ name: projects.saved?.name ?? null, savedAt: projects.savedAt, dirty: projects.dirty, scenes: projects.sceneStates() }),
  save: () => void saveProject(),
  openProjects: () => void projectsDialog.open(),
  revert: () => void revertProject(),
  clearSequence: () => void clearSequence(),
  resetAll: () => void resetAll(),
  resetScene: (id) => {
    if (projects.resetScene(id)) toast("Scène réinitialisée (état du dernier enregistrement)", "ok", 2000);
  },
});
settings.setSequenceOptions(storyStrip.sequenceOptions);

/* ---- projets (sur cet appareil, IndexedDB) : Enregistrer, Mes projets, Réinitialiser, état « modifiée » */
const repoReady = openProjectRepo();
let repoPersistent = true;
void repoReady.then((r) => (repoPersistent = r.persistent));
const projectRepo: ProjectRepo = {
  get persistent() {
    return repoPersistent;
  },
  list: async () => (await repoReady).list(),
  get: async (id) => (await repoReady).get(id),
  put: async (p) => (await repoReady).put(p),
  delete: async (id) => (await repoReady).delete(id),
};

/** Charge la source d'un projet (exemple référencé ou lignes copiées), puis son graphique. */
async function applyProjectSource(src: ProjectSource | null, spec: unknown): Promise<void> {
  const sample = src?.sampleId ? sampleById(src.sampleId) : undefined;
  let ds: Dataset | null = null;
  let meta: Parameters<typeof store.setDataset>[1] = {};
  if (sample) {
    ds = buildDataset(sample.name, sample.rows(), src?.typeOverrides ?? {});
    meta = { sampleId: sample.id, note: sample.description };
  } else if (src?.rows?.length) {
    ds = buildDataset(src.name, src.rows, src.typeOverrides ?? {});
    meta = { note: src.note ?? `Projet : ${src.name}`, provenance: src.provenance };
  } else if (src) {
    toast(`Les données « ${src.name} » ne sont pas dans ce projet : les données courantes sont conservées.`, "info", 6000);
  }
  if (spec) {
    const errs = store.setSpec(spec);
    if (errs.length) toast("Graphique du projet : " + errs.slice(0, 3).join(" ; "), "error", 6000);
  }
  if (ds) {
    store.setDataset(ds, meta);
    if (sample) attachProvenance(sampleProvenance(sample.id));
  }
}

const projects: ProjectController = new ProjectController({
  store,
  repo: projectRepo,
  morph: () => storyStrip.morph,
  setMorph: (on) => storyStrip.setMorph(on),
  chartThumb: async () => {
    const { width, height } = chartSize(store.state.spec);
    return svgToJpegDataUrl(await preview.finalSvg(), width, height, 320, themeFor(store.state.spec).bg);
  },
  applySource: applyProjectSource,
  loadDefault: () => loadSample(SAMPLES[0]!.id),
  settle: () => settle(),
  onChange: () => storyStrip.update(),
});

const projectsDialog = new ProjectsDialog({
  list: () => projectRepo.list(),
  currentId: () => projects.saved?.id ?? null,
  dirty: () => projects.dirty,
  persistent: () => projectRepo.persistent,
  usage: () => storageUsage(),
  open: async (id) => {
    const p = await projectRepo.get(id);
    if (!p) return void toast("Projet introuvable sur cet appareil.", "error");
    await projects.open(p);
    toast(`Projet « ${p.name} » ouvert`, "ok", 2200);
  },
  duplicate: async (id) => {
    const c = await projects.duplicate(id);
    if (c) toast(`Copie créée : « ${c.name} »`, "ok", 2200);
  },
  rename: (id, name) => projects.rename(id, name),
  remove: async (id) => {
    await projects.remove(id);
    toast("Projet supprimé de cet appareil", "ok", 2200);
  },
  exportFile: async (id) => {
    const p = await projectRepo.get(id);
    if (p) downloadProject(p);
  },
  importFile: async (file) => {
    try {
      const parsed = parseProjectFile(JSON.parse(await file.text()));
      if ("legacy" in parsed) {
        toast("Ancienne configuration (.r4d.json) : ouvrez-la avec « Projets ▾ › Ouvrir un fichier… ».", "info", 6000);
        return;
      }
      const p = await projects.importProject(parsed.project);
      toast(`Projet « ${p.name} » importé`, "ok", 2200);
    } catch (e) {
      toast("Import impossible : " + (e instanceof Error ? e.message : String(e)), "error", 7000);
    }
  },
  newProject: async () => {
    projects.resetAll();
    toast("Nouveau projet : exemple par défaut, séquence vide", "ok", 2200);
  },
});

function downloadProject(p: Project): void {
  download(new Blob([JSON.stringify(toProjectFile(p, true))], { type: "application/json" }), projectFileName(p.name));
}

async function saveProject(): Promise<void> {
  try {
    const first = !projects.saved;
    const p = await projects.save();
    toast(first ? `Projet « ${p.name} » enregistré sur cet appareil` : `Enregistré sur cet appareil · ${projects.savedAt}`, "ok", 2200);
  } catch (e) {
    toast("Enregistrement impossible : " + (e instanceof Error ? e.message : String(e)), "error", 7000);
  }
}

async function exportCurrentProject(): Promise<void> {
  const p = await projects.snapshotProject({ id: projects.saved?.id, createdAt: projects.saved?.createdAt, name: projects.saved?.name ?? (store.state.story.title.trim() || "Mon projet") });
  downloadProject(p);
  toast("Projet exporté (.datanime)", "ok", 2200);
}

async function revertProject(): Promise<void> {
  if (!projects.saved) return void toast("Pas encore d'enregistrement : cliquez « Enregistrer ».", "info");
  if (!projects.dirty) return void toast("Aucun changement depuis le dernier enregistrement.", "info", 2200);
  if (!(await confirmDialog({ title: "Revenir au dernier enregistrement ?", message: `Les changements faits depuis ${projects.savedAt} seront annulés (source, graphique et séquence).`, confirm: "Revenir à l'enregistrement", danger: true, testid: "confirm-revert" }))) return;
  await projects.revert();
  toast(`Projet revenu à l'enregistrement de ${projects.savedAt}`, "ok", 2200);
}

async function clearSequence(): Promise<void> {
  const n = store.state.story.snapshots.length;
  if (!n) return void toast("La séquence est déjà vide.", "info", 2000);
  if (!(await confirmDialog({ title: "Vider la séquence ?", message: `Les ${n} scène(s) seront retirées. La source et le graphique sont gardés. « Revenir au dernier enregistrement » reste possible.`, confirm: "Vider la séquence", danger: true, testid: "confirm-clear" }))) return;
  projects.clearSequence();
  toast("Séquence vidée", "ok", 2000);
}

async function resetAll(): Promise<void> {
  if (!(await confirmDialog({ title: "Tout réinitialiser ?", message: "Source, graphique et séquence repartent de zéro (exemple par défaut). Les projets enregistrés restent dans « Mes projets ».", confirm: "Tout réinitialiser", danger: true, testid: "confirm-reset" }))) return;
  projects.resetAll();
  toast("Projet vide : exemple par défaut, séquence vide", "ok", 2200);
}

// Avertir avant de quitter la page s'il reste des modifications non enregistrées
window.addEventListener("beforeunload", (e) => {
  if (!projects.dirty) return;
  e.preventDefault();
  e.returnValue = "";
});
const reelDialog = new ReelDialog();
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
      "Séquence introuvable sur cet appareil",
      "Ce lien de lecture désigne une séquence ou une revue enregistrée dans le navigateur d'un autre appareil : pour l'instant, les séquences restent sur l'appareil qui les a créées. Les démonstrations intégrées (Directeur commercial, Directeur financier) s'ouvrent partout.",
      [
        { label: "Lire la démo « Directeur commercial »", href: readHash("demo-dircom") },
        { label: "Lire la démo « Directeur financier »", href: readHash("demo-daf") },
        { label: "Ouvrir le Studio", onclick: () => reader.close() },
      ]
    );
    return;
  }
  const k = rt.snapId ? snapshotIndexOf(story.snapshots, rt.snapId) : 0;
  if (k < 0) {
    // Identifiant inconnu (ni stable, ni ancien identifiant à suffixe) : le dire, proposer la diapositive 1
    readerStory = null;
    const first = story.snapshots[0]!;
    reader.showMessage(
      "Cette scène n'existe plus ou a été renommée",
      `Le lien désigne « ${rt.snapId} », introuvable dans « ${story.title} ». Il a peut-être été retiré ou renommé depuis l'envoi du lien.`,
      [
        { label: "Ouvrir la diapositive 1", href: readHash(rt.storyId, first.id) },
        { label: "Ouvrir le Studio", onclick: () => reader.close() },
      ]
    );
    return;
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
preview.onFocusPick = (key) => onFocusTap(key);
// Toucher / cliquer un élément du graphique : ouvre la section du panneau et met le réglage en avant
preview.onPick = (el) => {
  const t = chartTarget(el, store.state.spec.type, store.state.spec.norme.enabled);
  if (t) settings.reveal(t);
};
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
    reel: (id) => void openReel(id),
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
const app = h("div", { class: "app" }, header, workspace, normeLegend, dataWindow.root, mappingWindow.root, scenarioDialog.root, film.root, reviewSpace.root, reader.root, cadencer.root, reelDialog.root, reelEditBar);
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
  syncFocusCopy();
  if (focusPicking && !focusInfo(store.state.spec, store.state.ds).kind) stopFocusPick();
  gallery.update();
  dataPanel.update();
  dataWindow.update(store.state.sampleId);
  settings.update();
  if (kinds.has("data") && explorer.isOpen) explorer.open();
  if (kinds.has("data")) preview.selection.clear();
  lastUpdate = preview.update(kinds);
  void Promise.resolve(lastUpdate).then(() => {
    selPanel.update();
    syncSelCtx();
  });
});

preview.onModeChange = (m) => {
  webmBtn.classList.toggle("dim", m === "none");
  webmBtn.title = m === "none" ? "Passez en « Entrée animée » ou « 4D » (Réglages › Export) pour exporter une vidéo" : "";
};

/* ------------------------------------------------------------------ démarrage */

const params = new URLSearchParams(location.search);
if (params.has("reset")) {
  // ?reset : session neuve, détachée du projet ouvert (les projets enregistrés restent dans « Mes projets »)
  store.clearSession();
  try {
    localStorage.removeItem(CURRENT_PROJECT_KEY);
  } catch {
    /* stockage indisponible */
  }
}
store.restoreStory();
void ensureFont(store.state.spec.style.font).finally(() => {
  if (!store.restore()) loadSample(params.get("sample") ?? SAMPLES[0]!.id);
  else if (store.state.sampleId) attachProvenance(sampleProvenance(store.state.sampleId));
  applyUi();
  storyStrip.update();
  void settle().then(() => projects.init());
});

// routes de l'espace Revues (#/revues…, #/r/…) : liens et QR de partage
// et mode lecture (#/lire/<histoire>/<snapshot>), ouvert directement depuis un lien ou un QR
window.addEventListener("hashchange", () => void route(location.hash));
if (parseReadRoute(location.hash)) void route(location.hash);
void reviewSpace.ensureDemo().then(() => {
  updateReviewsCount();
  if (location.hash.startsWith("#/") && !parseReadRoute(location.hash)) void reviewSpace.handleHash(location.hash);
});
// lien direct vers l'exemple de Reel (?reel=exemple) : un visiteur crée un Reel en 1 clic
// lien direct vers la fenêtre Données (?donnees=publiques, ?donnees=ouvrir, fichier, coller, recents, exemples)
{
  const tab = tabFromParam(params.get("donnees"), dataWindow.recentEntries.length > 0);
  if (tab && !params.get("reel")) dataWindow.open(tab);
}
if (params.get("reel") === "exemple") void openReel("exemple");
else if (params.get("reel")?.startsWith("public:")) void openReel(params.get("reel")!);

/** API de débogage / tests (console : r4d.getSpec()). */
const api = {
  store,
  preview,
  getSpec: () => store.state.spec,
  setSpec: (patch: Record<string, unknown>) => store.setSpec({ ...store.state.spec, ...patch }),
  set: (path: string, v: unknown) => store.set(path, v),
  pickType: (t: ChartType) => pickType(t),
  selection: () => preview.selection,
  fingerprintSpec: (sp: unknown) => fingerprintSpec(sp),
  loadSample,
  importText: (t: string) => importPasted(t),
  provenance: () => store.state.provenance,
  currentSvg: () => preview.currentSvg(),
  seek: (p: number) => preview.seek(p),
  /** Transition « zoom dans la marque » : activation et ralenti (captures à mi-transition). */
  drillZoom: (on: boolean, slowdown = 1) => {
    setZoomEnabled(on);
    setZoomSlowdown(slowdown);
  },
  explore: () => explorer.open(),
  /** Fenêtre « Données » (onglets, récents). */
  dataWindow: () => dataWindow,
  /** Panneau de réglages : ouvrir une section, cibler un réglage, menus de la barre du haut. */
  panel: () => settings,
  exportMenu: () => exportMenu,
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
  /** Projets (sur cet appareil). */
  projects: () => projects,
  projectRepo: () => projectRepo,
  /** Datasets dérivés (déploiement 2) : catalogue, étape Filtrer de la fenêtre Données. */
  datasets: () => store.state.datasets,
  datasetEditor: () => datasetEditor,
  editDataset: (id: string | null) => openDatasetEditor(id),
  projectsDialog: () => projectsDialog,
  duplicateFocus: (i: number) => duplicateAndFocus(store.state.story.snapshots[i]!),
  focusPicking: () => focusPicking,
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
  /** « Créer un Reel » (histoire courante, id de revue, ou « exemple »). */
  reel: (storyId: string = LOCAL_STORY_ID) => openReel(storyId),
  reelDialog: () => reelDialog,
  reelEditing: () => (reelEdit ? { sceneNo: reelEdit.sceneNo, id: reelEdit.item.snap.id } : null),
  pngDataUrl: async (scale = 1) => {
    const { width, height } = chartSize(store.state.spec);
    return blobToDataUrl(await svgToPngBlob(await preview.currentSvg(), width, height, scale));
  },
};
(window as unknown as { r4d: typeof api }).r4d = api;
