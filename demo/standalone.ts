import {
  createSpanMagnitudeViz,
  tryParseDocument,
  discoverColorByAxes,
  parseCsv,
  rowsToDocument,
  validateMapping,
  columnsFromRows,
  analyzeColumns,
  type VizHandle,
  type ColumnMapping,
  type GeometryMode,
  type PersistenceMode,
  type ViewMode,
  type MapRegion,
  type MapLevel,
} from "span-magnitude-viz";
import * as XLSX from "xlsx";
import sample from "./data/standalone-sample.json";
import projects500 from "./data/projects-500.json";
import frBeMap from "./data/fr-be-map.json";
import opportunities500 from "./data/opportunities-500.json";
import { createFieldAnalysisPanel } from "./fieldAnalysisPanel";

const datasets: Record<string, unknown> = {
  sample,
  "projects-500": projects500,
  "fr-be-map": frBeMap,
  "opportunities-500": opportunities500,
};

/** Optional deep-link: ?dataset=opportunities-500&view=map&region=europe&level=nuts2&fit=region&persistence=finale&t=1 */
const params = new URLSearchParams(location.search);

const hostEl = document.getElementById("chart-host");
if (!hostEl) throw new Error("#chart-host missing");
const host: HTMLElement = hostEl;

const datasetSel = document.getElementById("dataset") as HTMLSelectElement | null;
const geometrySel = document.getElementById("geometry") as HTMLSelectElement | null;
const viewModeSel = document.getElementById("viewMode") as HTMLSelectElement | null;
const persistenceSel = document.getElementById("persistence") as HTMLSelectElement | null;
const colorBySel = document.getElementById("colorBy") as HTMLSelectElement | null;
const colorSchemeSel = document.getElementById("colorScheme") as HTMLSelectElement | null;
const mapRegionSel = document.getElementById("mapRegion") as HTMLSelectElement | null;
const mapLevelSel = document.getElementById("mapLevel") as HTMLSelectElement | null;
const mapFitSel = document.getElementById("mapFit") as HTMLSelectElement | null;
const fileInput = document.getElementById("file-input") as HTMLInputElement | null;
const errorsEl = document.getElementById("errors");
const fieldHost = document.getElementById("field-analysis-host");

let viz: VizHandle | null = null;
let currentRaw: unknown = sample;
let importedRows: Record<string, unknown>[] | null = null;

const fieldPanel = fieldHost
  ? createFieldAnalysisPanel({
      host: fieldHost,
      onApply: (mapping, unit) => applyStandaloneMapping(mapping, unit),
    })
  : null;


function parseGeometry(v: string | undefined): GeometryMode {
  if (v === "bar" || v === "point" || v === "lane") return v;
  return "arc";
}

function parsePersistence(v: string | undefined): PersistenceMode {
  if (v === "ephemeral" || v === "finale") return v;
  return "keep";
}

function parseViewMode(v: string | undefined): ViewMode {
  return v === "map" ? "map" : "chart";
}

function parseMapRegion(v: string | undefined): MapRegion {
  return v === "europe" ? "europe" : "fr-be";
}

function parseMapLevel(v: string | undefined): MapLevel {
  return v === "country" || v === "nuts1" || v === "nuts3" ? v : "nuts2";
}

function parseMapFit(v: string | undefined): "region" | "data" {
  return v === "data" ? "data" : "region";
}

function syncMapControls(): void {
  const europe = mapRegionSel?.value === "europe";
  if (mapLevelSel) mapLevelSel.disabled = !europe;
  if (mapFitSel) mapFitSel.disabled = !europe;
}

function populateColorBy(raw: unknown): void {
  if (!colorBySel) return;
  const parsed = tryParseDocument(raw);
  const prev = colorBySel.value;
  colorBySel.innerHTML = "";
  const axes = parsed.ok
    ? discoverColorByAxes(parsed.data.marks)
    : [
        { key: "group", label: "group" },
        { key: "cohort", label: "cohort" },
        { key: "magnitude", label: "magnitude" },
        { key: "span", label: "span" },
      ];
  for (const a of axes) {
    const opt = document.createElement("option");
    opt.value = a.key;
    opt.textContent = a.label;
    colorBySel.appendChild(opt);
  }
  if (prev && [...colorBySel.options].some((o) => o.value === prev)) {
    colorBySel.value = prev;
  }
}

function clearViz(): void {
  viz?.destroy();
  viz = null;
  host.innerHTML = "";
}

function mount(raw: unknown = currentRaw) {
  currentRaw = raw;
  const parsed = tryParseDocument(raw);
  if (!parsed.ok) {
    // Replace demo completely — never leave old tickers / chart on failure
    clearViz();
    if (errorsEl)
      errorsEl.textContent =
        "Validation échouée:\n" + parsed.error.issues.join("\n");
    return;
  }
  if (errorsEl) errorsEl.textContent = "";
  populateColorBy(raw);
  clearViz();
  const key = datasetSel?.value || "sample";
  const viewMode = parseViewMode(viewModeSel?.value);
  viz = createSpanMagnitudeViz(host, parsed.data, {
    geometry: parseGeometry(geometrySel?.value),
    persistence: parsePersistence(persistenceSel?.value),
    viewMode,
    mapRegion: parseMapRegion(mapRegionSel?.value),
    mapLevel: parseMapLevel(mapLevelSel?.value),
    mapFit: parseMapFit(mapFitSel?.value),
    mapChoropleth: true,
    mapHeatmap: true,
    width: Math.min(960, host.clientWidth || 960),
    height: 480,
    animate: true,
    autoplay: true,
    theme: "dark",
    slowFirst: 2,
    entrance: true,
    morphDurationMs: 550,
    cascadeSpeed: "normal",
    durationMs:
      key === "projects-500" && raw === projects500
        ? 16000
        : key === "fr-be-map"
          ? 11000
          : key === "opportunities-500"
            ? 16000
            : 9000,
    tickers: true,
    colorBy: colorBySel?.value || "group",
    colorScheme: colorSchemeSel?.value || "altairady",
  });
}

function loadDataset(key: string) {
  const raw = datasets[key] ?? sample;
  importedRows = null;
  fieldPanel?.hide();
  if (key === "fr-be-map" || key === "opportunities-500") {
    if (viewModeSel) viewModeSel.value = "map";
    if (geometrySel) geometrySel.value = "point";
    if (persistenceSel) persistenceSel.value = "finale";
  }
  mount(raw);
}

function showMapping(rows: Record<string, unknown>[]): void {
  importedRows = rows;
  fieldPanel?.show(rows);
  if (errorsEl) {
    errorsEl.textContent =
      "Analyse des champs prête — choisissez le mapping puis « Voir la visualisation ».";
  }
}

function applyStandaloneMapping(
  mapping: ColumnMapping,
  unit: "date" | "number"
): void {
  if (!importedRows?.length) {
    if (errorsEl)
      errorsEl.textContent =
        "Aucun tableau importé — chargez un CSV / Excel / JSON d’abord.";
    return;
  }
  const cols = columnsFromRows(importedRows);
  const analyses = analyzeColumns(importedRows);
  const validation = validateMapping(mapping, cols, analyses);
  if (!validation.valid) {
    clearViz();
    if (errorsEl)
      errorsEl.textContent =
        "Mapping invalide — visualisation non mise à jour.\n" +
        validation.issues.join("\n");
    return;
  }
  const colorField = mapping.colorField || "";
  const doc = rowsToDocument(importedRows, {
    unit,
    mapping,
    title: "Fichier importé",
  });
  const marks = (doc as { marks?: unknown[] }).marks;
  if (!Array.isArray(marks) || marks.length === 0) {
    clearViz();
    if (errorsEl)
      errorsEl.textContent =
        "Aucune marque produite avec ce mapping — vérifiez début / fin (ou durée) / magnitude.";
    return;
  }
  // Fully replace demo document + tickers
  mount(doc);
  if (colorField && colorBySel) {
    const want =
      colorField === mapping.group ? "group" : `meta.${colorField}`;
    if ([...colorBySel.options].some((o) => o.value === want)) {
      colorBySel.value = want;
      viz?.setColorBy(want);
    }
  }
}

async function onFile(file: File): Promise<void> {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".json")) {
      const raw = JSON.parse(await file.text());
      if (Array.isArray(raw)) {
        showMapping(raw);
      } else {
        fieldPanel?.hide();
        importedRows = null;
        mount(raw);
      }
      return;
    }
    if (name.endsWith(".csv")) {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error("CSV vide");
      showMapping(rows);
      return;
    }
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const wb = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: true,
      });
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      if (!sheet) throw new Error("Aucune feuille");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });
      if (!rows.length) throw new Error("Feuille vide");
      showMapping(rows);
      return;
    }
    throw new Error("Format non supporté (JSON / CSV / XLSX)");
  } catch (e) {
    if (errorsEl)
      errorsEl.textContent =
        "Import échoué: " + (e instanceof Error ? e.message : String(e));
  }
}

datasetSel?.addEventListener("change", () => loadDataset(datasetSel.value));
geometrySel?.addEventListener("change", () => {
  viz?.setGeometry(parseGeometry(geometrySel.value));
});
viewModeSel?.addEventListener("change", () => {
  viz?.setViewMode(parseViewMode(viewModeSel.value));
});
function onMapControlChange(): void {
  syncMapControls();
  viz?.setMap({
    region: parseMapRegion(mapRegionSel?.value),
    level: parseMapLevel(mapLevelSel?.value),
    fit: parseMapFit(mapFitSel?.value),
  });
}
mapRegionSel?.addEventListener("change", onMapControlChange);
mapLevelSel?.addEventListener("change", onMapControlChange);
mapFitSel?.addEventListener("change", onMapControlChange);
persistenceSel?.addEventListener("change", () => {
  viz?.setPersistence(parsePersistence(persistenceSel.value));
});
colorBySel?.addEventListener("change", () => {
  viz?.setColorBy(colorBySel.value || "group");
});
colorSchemeSel?.addEventListener("change", () => {
  viz?.setColorScheme(colorSchemeSel.value || "altairady");
});
fileInput?.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void onFile(f);
});
document.getElementById("replay")?.addEventListener("click", () => {
  viz?.reset();
  viz?.play();
});

function applyParams(): void {
  const set = (sel: HTMLSelectElement | null, key: string) => {
    const v = params.get(key);
    if (sel && v && [...sel.options].some((o) => o.value === v)) sel.value = v;
  };
  set(datasetSel, "dataset");
  set(mapRegionSel, "region");
  set(mapLevelSel, "level");
  set(mapFitSel, "fit");
}

applyParams();
syncMapControls();
loadDataset(datasetSel?.value || "sample");
{
  // Deep-link overrides applied after dataset presets
  const handle = viz as VizHandle | null;
  const v = params.get("view");
  if (v && viewModeSel && v !== viewModeSel.value) {
    viewModeSel.value = v;
    handle?.setViewMode(parseViewMode(v));
  }
  const p = params.get("persistence");
  if (p && persistenceSel && p !== persistenceSel.value) {
    persistenceSel.value = p;
    handle?.setPersistence(parsePersistence(p));
  }
  const t = params.get("t");
  if (t != null && Number.isFinite(Number(t))) handle?.setProgress(Number(t));
}
