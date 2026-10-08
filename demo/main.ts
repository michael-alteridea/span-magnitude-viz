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
import projects from "./data/projects.json";
import contracts from "./data/contracts.json";
import projects500 from "./data/projects-500.json";
import frBeMap from "./data/fr-be-map.json";
import { createFieldAnalysisPanel } from "./fieldAnalysisPanel";

const host = document.getElementById("chart-host")!;
const datasetSel = document.getElementById("dataset") as HTMLSelectElement;
const geometrySel = document.getElementById("geometry") as HTMLSelectElement;
const viewModeSel = document.getElementById("viewMode") as HTMLSelectElement;
const persistenceSel = document.getElementById("persistence") as HTMLSelectElement;
const mapRegionSel = document.getElementById("mapRegion") as HTMLSelectElement | null;
const mapLevelSel = document.getElementById("mapLevel") as HTMLSelectElement | null;
const mapFitSel = document.getElementById("mapFit") as HTMLSelectElement | null;
const cohortSel = document.getElementById("cohort") as HTMLSelectElement;
const colorBySel = document.getElementById("colorBy") as HTMLSelectElement;
const colorSchemeSel = document.getElementById("colorScheme") as HTMLSelectElement;
const cascadeSel = document.getElementById("cascadeSpeed") as HTMLSelectElement;
const mirrorChk = document.getElementById("mirror") as HTMLInputElement;
const descEl = document.getElementById("desc")!;
const statsEl = document.getElementById("stats")!;
const errorsEl = document.getElementById("errors")!;
const editor = document.getElementById("json-editor") as HTMLTextAreaElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const importUnitSel = document.getElementById("import-unit") as HTMLSelectElement;
const fieldHost = document.getElementById("field-analysis-host")!;

const datasets: Record<string, unknown> = {
  projects,
  contracts,
  "projects-500": projects500,
  "fr-be-map": frBeMap,
};

let chart: VizHandle | null = null;
let currentRaw: unknown = projects;
let ready = false;
let importedRows: Record<string, unknown>[] | null = null;
let pendingColorField: string | null = null;

const fieldPanel = createFieldAnalysisPanel({
  host: fieldHost,
  unitSelect: importUnitSel,
  onApply: (mapping, unit) => applyImportedMapping(mapping, unit),
});


function parseGeometry(v: string): GeometryMode {
  if (v === "bar" || v === "point" || v === "lane") return v;
  return "arc";
}

function parsePersistence(v: string): PersistenceMode {
  if (v === "ephemeral" || v === "finale") return v;
  return "keep";
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

function parseViewMode(v: string): ViewMode {
  return v === "map" ? "map" : "chart";
}

function populateColorBy(raw: unknown): void {
  const parsed = tryParseDocument(raw);
  const prev = colorBySel.value;
  colorBySel.innerHTML = "";
  const axes = parsed.ok
    ? discoverColorByAxes(parsed.data.marks)
    : [
        { key: "group", label: "Group", kind: "categorical" as const },
        { key: "cohort", label: "Cohort", kind: "categorical" as const },
        { key: "magnitude", label: "Magnitude (cold→hot)", kind: "continuous" as const },
        { key: "span", label: "Span (cold→hot)", kind: "continuous" as const },
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

function populateCohorts(raw: unknown): void {
  const parsed = tryParseDocument(raw);
  const prev = cohortSel.value;
  cohortSel.innerHTML = `<option value="">Toutes</option>`;
  if (!parsed.ok) return;
  for (const c of parsed.data.cohorts) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    cohortSel.appendChild(opt);
  }
  if (prev && parsed.data.cohorts.includes(prev)) {
    cohortSel.value = prev;
  }
}

function mountFromRaw(raw: unknown): void {
  errorsEl.textContent = "";
  const parsed = tryParseDocument(raw);
  if (!parsed.ok) {
    errorsEl.textContent = "Validation échouée:\n" + parsed.error.issues.join("\n");
    statsEl.textContent = "";
    descEl.textContent = "Document invalide — corrigez le JSON.";
    chart?.destroy();
    chart = null;
    return;
  }

  const doc = parsed.data;
  descEl.textContent =
    (doc.description || doc.title || "Sans description") +
    (doc.title ? ` — « ${doc.title} »` : "");
  statsEl.textContent = `${doc.marks.length} marques · cohortes: ${doc.cohorts.join(", ")} · groupes: ${doc.groups.join(", ")}`;

  chart?.destroy();
  const width = Math.min(1052, host.clientWidth || 960);
  const geometry = parseGeometry(geometrySel.value);
  const persistence = parsePersistence(persistenceSel.value);
  const cascadeSpeed = (cascadeSel.value || "normal") as "slow" | "normal" | "fast";

  const viewMode = parseViewMode(viewModeSel?.value || "chart");
  chart = createSpanMagnitudeViz(host, doc, {
    geometry,
    persistence,
    viewMode,
    mapRegion: parseMapRegion(mapRegionSel?.value),
    mapLevel: parseMapLevel(mapLevelSel?.value),
    mapFit: parseMapFit(mapFitSel?.value),
    mapChoropleth: true,
    mapHeatmap: true,
    width,
    height: 540,
    animate: true,
    autoplay: true,
    theme: "dark",
    slowFirst: 2,
    slowOpen: cascadeSpeed === "slow" ? 0.36 : cascadeSpeed === "fast" ? 0.18 : 0.28,
    cascadeSpeed,
    entrance: true,
    morphDurationMs: 550,
    durationMs: Math.min(18000, 5000 + doc.marks.length * 100),
    cohortFilter: cohortSel.value || null,
    mirrorSplit: mirrorChk.checked,
    mirrorCohort: cohortSel.value || doc.cohorts[0] || null,
    tickers: true,
    colorBy: colorBySel.value || "group",
    colorScheme: colorSchemeSel.value || "altairady",
  });
}

function loadDataset(key: string): void {
  const raw = datasets[key];
  if (raw == null) {
    errorsEl.textContent = `Jeu de données inconnu: ${key}`;
    return;
  }
  datasetSel.value = key;
  currentRaw = raw;
  importedRows = null;
  fieldPanel.hide();
  editor.value = JSON.stringify(currentRaw, null, 2);
  populateCohorts(currentRaw);
  populateColorBy(currentRaw);
  cohortSel.value = "";
  mirrorChk.checked = false;
  if (key === "fr-be-map" && viewModeSel) {
    viewModeSel.value = "map";
    geometrySel.value = "point";
    persistenceSel.value = "finale";
  }
  mountFromRaw(currentRaw);
}

function onDatasetChange(): void {
  if (!ready) return;
  loadDataset(datasetSel.value);
}

function onGeometryChange(): void {
  if (!ready) return;
  if (chart) {
    chart.setGeometry(parseGeometry(geometrySel.value));
  } else {
    mountFromRaw(currentRaw);
  }
}

function onPersistenceChange(): void {
  if (!ready) return;
  if (chart) {
    chart.setPersistence(parsePersistence(persistenceSel.value));
  } else {
    mountFromRaw(currentRaw);
  }
}

function onColorByChange(): void {
  if (!ready) return;
  chart?.setColorBy(colorBySel.value || "group");
}

function onColorSchemeChange(): void {
  if (!ready) return;
  chart?.setColorScheme(colorSchemeSel.value || "altairady");
}

function onCascadeChange(): void {
  if (!ready) return;
  mountFromRaw(currentRaw);
}

function onCohortChange(): void {
  if (!ready) return;
  chart?.setFilter({
    cohort: cohortSel.value || null,
    mirrorSplit: mirrorChk.checked,
    mirrorCohort: cohortSel.value || null,
  });
  if (!cohortSel.value && !mirrorChk.checked) {
    mountFromRaw(currentRaw);
  }
}

function onMirrorChange(): void {
  if (!ready) return;
  const cohorts = tryParseDocument(currentRaw);
  const mirrorCohort =
    cohortSel.value || (cohorts.ok ? cohorts.data.cohorts[0] : null);
  if (mirrorChk.checked) {
    chart?.setFilter({
      cohort: null,
      mirrorSplit: true,
      mirrorCohort,
    });
  } else {
    chart?.setFilter({
      cohort: cohortSel.value || null,
      mirrorSplit: false,
      mirrorCohort: null,
    });
  }
}

function applyImportedMapping(mapping: ColumnMapping, unit: "date" | "number"): void {
  if (!importedRows?.length) {
    errorsEl.textContent =
      "Aucun tableau importé — chargez un CSV / Excel / JSON d’abord.";
    return;
  }
  const cols = columnsFromRows(importedRows);
  const analyses = analyzeColumns(importedRows);
  const validation = validateMapping(mapping, cols, analyses);
  if (!validation.valid) {
    chart?.destroy();
    chart = null;
    host.innerHTML = "";
    errorsEl.textContent =
      "Mapping invalide — visualisation non mise à jour.\n" +
      validation.issues.join("\n");
    statsEl.textContent = "";
    descEl.textContent = "Mapping invalide — corrigez les rôles.";
    return;
  }
  pendingColorField = mapping.colorField ?? null;
  const doc = rowsToDocument(importedRows, {
    unit,
    mapping,
    title: "Fichier importé",
  });
  const marks = (doc as { marks?: unknown[] }).marks;
  if (!Array.isArray(marks) || marks.length === 0) {
    chart?.destroy();
    chart = null;
    host.innerHTML = "";
    errorsEl.textContent =
      "Aucune marque produite avec ce mapping — vérifiez début / fin (ou durée) / magnitude.";
    statsEl.textContent = "";
    return;
  }
  currentRaw = doc;
  editor.value = JSON.stringify(doc, null, 2);
  populateCohorts(currentRaw);
  populateColorBy(currentRaw);
  if (pendingColorField) {
    const key = pendingColorField;
    const want =
      key === mapping.group ? "group" : `meta.${key}`;
    if ([...colorBySel.options].some((o) => o.value === want)) {
      colorBySel.value = want;
    } else if (key === mapping.group) {
      colorBySel.value = "group";
    }
    pendingColorField = null;
  }
  mountFromRaw(currentRaw);
}

function showImportPanel(rows: Record<string, unknown>[]): void {
  importedRows = rows;
  fieldPanel.show(rows);
  errorsEl.textContent =
    "Analyse des champs prête — choisissez le mapping puis « Voir la visualisation ».";
}

async function onFileSelected(file: File): Promise<void> {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".json")) {
      const text = await file.text();
      const raw = JSON.parse(text);
      if (Array.isArray(raw)) {
        showImportPanel(raw as Record<string, unknown>[]);
      } else {
        currentRaw = raw;
        importedRows = null;
        fieldPanel.hide();
        editor.value = JSON.stringify(raw, null, 2);
        populateCohorts(currentRaw);
        populateColorBy(currentRaw);
        mountFromRaw(currentRaw);
      }
      return;
    }
    if (name.endsWith(".csv")) {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) throw new Error("CSV vide ou sans en-tête");
      showImportPanel(rows);
      return;
    }
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      if (!sheet) throw new Error("Classeur Excel sans feuille");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });
      if (!rows.length) throw new Error("Feuille Excel vide");
      showImportPanel(rows);
      return;
    }
    throw new Error("Format non supporté (JSON, CSV, XLSX)");
  } catch (e) {
    errorsEl.textContent =
      "Import échoué: " + (e instanceof Error ? e.message : String(e));
  }
}

datasetSel.addEventListener("change", onDatasetChange);
datasetSel.addEventListener("input", onDatasetChange);
geometrySel.addEventListener("change", onGeometryChange);
geometrySel.addEventListener("input", onGeometryChange);
viewModeSel?.addEventListener("change", () => {
  if (!ready) return;
  if (chart) chart.setViewMode(parseViewMode(viewModeSel.value));
  else mountFromRaw(currentRaw);
});
function onMapControlChange(): void {
  syncMapControls();
  if (!ready) return;
  chart?.setMap({
    region: parseMapRegion(mapRegionSel?.value),
    level: parseMapLevel(mapLevelSel?.value),
    fit: parseMapFit(mapFitSel?.value),
  });
}
mapRegionSel?.addEventListener("change", onMapControlChange);
mapLevelSel?.addEventListener("change", onMapControlChange);
mapFitSel?.addEventListener("change", onMapControlChange);
syncMapControls();
persistenceSel.addEventListener("change", onPersistenceChange);
persistenceSel.addEventListener("input", onPersistenceChange);
cohortSel.addEventListener("change", onCohortChange);
cohortSel.addEventListener("input", onCohortChange);
mirrorChk.addEventListener("change", onMirrorChange);
colorBySel.addEventListener("change", onColorByChange);
colorSchemeSel.addEventListener("change", onColorSchemeChange);
cascadeSel.addEventListener("change", onCascadeChange);
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void onFileSelected(f);
});

document.getElementById("play")!.addEventListener("click", () => chart?.play());
document.getElementById("pause")!.addEventListener("click", () => chart?.pause());
document.getElementById("reset")!.addEventListener("click", () => chart?.reset());

document.getElementById("apply-json")!.addEventListener("click", () => {
  try {
    currentRaw = JSON.parse(editor.value);
    populateCohorts(currentRaw);
    populateColorBy(currentRaw);
    mountFromRaw(currentRaw);
  } catch (e) {
    errorsEl.textContent =
      "JSON syntaxe invalide: " + (e instanceof Error ? e.message : String(e));
  }
});

document.getElementById("load-invalid")!.addEventListener("click", () => {
  const bad = {
    version: 1,
    unit: "date",
    marks: [
      {
        id: "dup",
        span: { start: "2021-01-01", end: "2020-01-01" },
        magnitude: -5,
      },
      {
        id: "dup",
        span: { start: 42, end: 99 },
        magnitude: 10,
      },
    ],
  };
  editor.value = JSON.stringify(bad, null, 2);
  currentRaw = bad;
  mountFromRaw(bad);
});

loadDataset(datasetSel.value || "projects");
ready = true;

window.addEventListener("resize", () => {
  if (chart && currentRaw) {
    const t = chart.getState().progress;
    mountFromRaw(currentRaw);
    chart?.setProgress(t >= 1 ? 1 : t);
    if (t < 1) chart?.pause();
  }
});
