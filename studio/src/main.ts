/**
 * Reporting 4D · Studio — point d'entrée.
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
import { guessUnit } from "./format";
import { SAMPLE_TODAY } from "./data/samples";
import { Explorer } from "./ui/explorer";
import { StoryStrip } from "./ui/storyStrip";
import type { Insight, StoryContext } from "./story/insights";
import { narrate, narrativeKey, applyNarrative, type Narrative } from "./story/narrate";
import { MAX_SNAPSHOTS, newSnapshotId, parseStory, roleForKind, type Snapshot } from "./story/snapshots";
import type { SlideImage } from "./story/pptx";

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
store.beforeNotify = (state) => applyNarrative(state.spec, currentNarrative());

/** Spec « neuf » côté récit : textes recalculés (drapeaux de saisie remis à zéro). */
function freshStory(spec: { story?: unknown } & Record<string, unknown>) {
  const st = (spec.story ?? {}) as Record<string, unknown>;
  return { ...spec, story: { ...st, auto: true, edited: { title: false, subtitle: false, comments: false } } };
}

/* ------------------------------------------------------------------ actions */

function keepStyle(spec: ChartSpec) {
  const s = spec.style;
  return { background: s.background, backgroundCustom: s.backgroundCustom, palette: s.palette, paletteCustom: s.paletteCustom, font: s.font, size: s.size, accentBar: s.accentBar, brandMark: s.brandMark };
}

function loadSample(id: string): void {
  const sample = sampleById(id);
  if (!sample) return;
  const ds = buildDataset(sample.name, sample.rows());
  const base = sample.spec;
  const r = parseSpec(freshStory({ ...base, style: { ...keepStyle(store.state.spec), ...(base.style ?? {}) } }));
  if (r.ok) store.setSpec(r.spec);
  store.setDataset(ds, { sampleId: sample.id, note: sample.description });
  toast(`Exemple chargé : ${sample.name}`, "ok", 2200);
}

async function applyImport(res: ImportResult): Promise<void> {
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
  const r = parseSpec({ ...spec, type, encoding, axes, transform: {}, story: {}, style: { ...spec.style, title, subtitle: "", source: "" }, mode: { ...spec.mode, fourD: { ...spec.mode.fourD, enabled: false } } });
  if (r.ok) store.setSpec(r.spec);
  store.setDataset(ds, { note: res.note ?? null, sheets: res.sheets ?? null, sheet: res.sheet ?? null });
  const types = ds.columns.map((c) => c.type);
  toast(`${ds.rows.length} lignes importées · ${types.filter((t) => t === "number").length} mesure(s), ${types.filter((t) => t === "date").length} date(s)`, "ok");
}

const actions = {
  loadSample,
  importText(text: string) {
    try {
      void applyImport(parseText(text, "Collage")).catch((e) => toast(String(e instanceof Error ? e.message : e), "error"));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  },
  importFile(file: File) {
    store.lastFile = file;
    readFile(file)
      .then(applyImport)
      .catch((e) => toast("Import impossible : " + (e instanceof Error ? e.message : String(e)), "error", 6000));
  },
  changeSheet(name: string) {
    const f = store.lastFile;
    if (!f) return;
    readFile(f, name)
      .then(applyImport)
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"));
  },
  explore() {
    explorer.open();
  },
};

/** Ouvre une piste de l'Explorer dans l'éditeur (style courant conservé). */
function openInsight(ins: Insight): void {
  const cur = store.state.spec;
  const errs = store.setSpec(
    freshStory({
      ...ins.spec,
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
  } else if (!sample && store.state.ds?.name !== s.dataName) {
    toast(`Ce snapshot a été pris sur « ${s.dataName} » : rechargez ces données pour le retrouver à l'identique.`, "info", 5000);
  }
  const errs = store.setSpec(s.spec);
  if (errs.length) toast(errs.join(" ; "), "error");
}

/** Image PNG 2× d'un snapshot : SVG conservé (polices ré-embarquées), sinon rendu à neuf, sinon la vignette. */
async function snapshotImage(s: Snapshot): Promise<SlideImage | null> {
  const spec = s.spec as ChartSpec;
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
  return slug(store.state.spec.style.title || "graphique-reporting-4d");
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
    if (f.data?.rows?.length) {
      ds = buildDataset(f.data.name, f.data.rows, f.data.typeOverrides ?? {});
      sampleId = null;
    } else if (f.sampleId && sampleById(f.sampleId)) {
      const s = sampleById(f.sampleId)!;
      ds = buildDataset(s.name, s.rows());
      sampleId = s.id;
    }
    store.setSpec(r.spec);
    if (ds !== store.state.ds) store.setDataset(ds, { sampleId, note: "Chargé depuis " + file.name });
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

const header = h(
  "header",
  { class: "topbar" },
  h(
    "div",
    { class: "brand" },
    h("span", {
      class: "logo",
      html: `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><defs><linearGradient id="r4d-logo-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3FA7C4"/><stop offset=".55" stop-color="#0E6E8C"/><stop offset="1" stop-color="#08465A"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#r4d-logo-g)"/><path d="M6 23 Q11 7 16 23" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M12 23 Q18.5 12 25 23" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.8" stroke-linecap="round"/><path d="M5 24.5 H27" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/></svg>`,
    }),
    h("h1", null, "Reporting ", h("em", null, "4D"), h("span", { class: "dot" }, " · "), h("span", { class: "studio" }, "Studio")),
    h("span", { class: "tagline" }, "Graphiques SVG animés · alteridea")
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
const storyStrip = new StoryStrip(store, { snapshot: () => void takeSnapshot(), open: openSnapshot, exportPptx: (b) => void exportPptx(b) });
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
const center = h("section", { class: "center" }, gallery.root, h("div", { class: "center-stack" }, preview.root, explorer.root), storyStrip.root);
const leftRail = h("button", { class: "rail rail-left", title: "Afficher les données", onclick: () => store.setUi({ leftCollapsed: false }) }, h("span", { html: svgIcon(ICONS.table, 18) }), h("span", { class: "rail-label" }, "Données"));
const rightRail = h("button", { class: "rail rail-right", title: "Afficher les réglages", onclick: () => store.setUi({ rightCollapsed: false }) }, h("span", { html: svgIcon(ICONS.sliders, 18) }), h("span", { class: "rail-label" }, "Réglages"));
const workspace = h("main", { class: "workspace" }, leftRail, dataPanel.root, center, settings.root, rightRail);
const app = h("div", { class: "app" }, header, workspace);
document.getElementById("app")!.replaceChildren(app);

function applyUi() {
  const { leftCollapsed, rightCollapsed } = store.state.ui;
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
  importText: (t: string) => applyImport(parseText(t, "Collage")),
  currentSvg: () => preview.currentSvg(),
  seek: (p: number) => preview.seek(p),
  explore: () => explorer.open(),
  closeExplorer: () => explorer.close(),
  narrative: () => currentNarrative(),
  regenerate: () => store.regenerate(),
  snapshot: () => takeSnapshot(),
  story: () => store.state.story,
  moveSnapshot: (from: number, to: number) => storyStrip.move(from, to),
  pptxBase64: async () => (await buildStoryPptx("base64")) as string,
  pngDataUrl: async (scale = 1) => {
    const { width, height } = chartSize(store.state.spec);
    return blobToDataUrl(await svgToPngBlob(await preview.currentSvg(), width, height, scale));
  },
};
(window as unknown as { r4d: typeof api }).r4d = api;
