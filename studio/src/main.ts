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
import { download, recordWebm, slug, studioFile, svgToPngBlob, webmSupported, exportGif } from "./export";
import { themeFor, ensureFont } from "./theme";
import { guessUnit } from "./format";

const store = new Store();
const preview = new Preview(store);

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
  const r = parseSpec({ ...base, style: { ...keepStyle(store.state.spec), ...(base.style ?? {}) } });
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
  const r = parseSpec({ ...spec, type, encoding, axes, style: { ...spec.style, title, subtitle: "", source: "" }, mode: { ...spec.mode, fourD: { ...spec.mode.fourD, enabled: false } } });
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
};

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
  const file = studioFile(spec, { data, sampleId });
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

const header = h(
  "header",
  { class: "topbar" },
  h(
    "div",
    { class: "brand" },
    h("span", {
      class: "logo",
      html: `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#d62839"/><path d="M6 23 Q11 7 16 23" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M12 23 Q18.5 12 25 23" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.8" stroke-linecap="round"/><path d="M5 24.5 H27" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/></svg>`,
    }),
    h("h1", null, "Reporting ", h("em", null, "4D"), h("span", { class: "dot" }, " · "), h("span", { class: "studio" }, "Studio")),
    h("span", { class: "tagline" }, "Graphiques SVG animés · alteridea")
  ),
  h(
    "div",
    { class: "toolbar" },
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
const center = h("section", { class: "center" }, gallery.root, preview.root);
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
  gallery.update();
  dataPanel.update();
  settings.update();
  void preview.update(kinds);
});

preview.onModeChange = (m) => {
  webmBtn.classList.toggle("dim", m === "none");
};

/* ------------------------------------------------------------------ démarrage */

const params = new URLSearchParams(location.search);
if (params.has("reset")) store.clearSession();
void ensureFont(store.state.spec.style.font).finally(() => {
  if (!store.restore()) loadSample(params.get("sample") ?? SAMPLES[0]!.id);
  applyUi();
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
};
(window as unknown as { r4d: typeof api }).r4d = api;
