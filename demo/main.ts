import {
  createSpanMagnitudeViz,
  tryParseDocument,
  type VizHandle,
} from "span-magnitude-viz";
import projects from "./data/projects.json";
import contracts from "./data/contracts.json";

const host = document.getElementById("chart-host")!;
const datasetSel = document.getElementById("dataset") as HTMLSelectElement;
const geometrySel = document.getElementById("geometry") as HTMLSelectElement;
const cohortSel = document.getElementById("cohort") as HTMLSelectElement;
const mirrorChk = document.getElementById("mirror") as HTMLInputElement;
const descEl = document.getElementById("desc")!;
const statsEl = document.getElementById("stats")!;
const errorsEl = document.getElementById("errors")!;
const editor = document.getElementById("json-editor") as HTMLTextAreaElement;

const datasets: Record<string, unknown> = {
  projects,
  contracts,
};

let chart: VizHandle | null = null;
let currentRaw: unknown = projects;
let ready = false;

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
  // Keep selection if it still exists in the new dataset
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
  const geometry = (geometrySel.value === "bar" ? "bar" : "arc") as "arc" | "bar";

  chart = createSpanMagnitudeViz(host, doc, {
    geometry,
    width,
    height: 540,
    animate: true,
    autoplay: true,
    theme: "dark",
    slowFirst: 2,
    durationMs: Math.min(18000, 5000 + doc.marks.length * 100),
    cohortFilter: cohortSel.value || null,
    mirrorSplit: mirrorChk.checked,
    mirrorCohort: cohortSel.value || doc.cohorts[0] || null,
    tickers: true,
  });
}

function loadDataset(key: string): void {
  const raw = datasets[key];
  if (raw == null) {
    errorsEl.textContent = `Jeu de données inconnu: ${key}`;
    return;
  }
  // Keep the <select> in sync so a pre-init user change cannot leave
  // value="contracts" while we mount projects (which would swallow the
  // next change-to-contracts because the value would already match).
  datasetSel.value = key;
  currentRaw = raw;
  editor.value = JSON.stringify(currentRaw, null, 2);
  populateCohorts(currentRaw);
  cohortSel.value = "";
  mirrorChk.checked = false;
  mountFromRaw(currentRaw);
}

function onDatasetChange(): void {
  if (!ready) return;
  loadDataset(datasetSel.value);
}

function onGeometryChange(): void {
  if (!ready) return;
  // Remount so bar/arc swap always rebuilds marks + restarts animation.
  // setGeometry alone also works; remount keeps duration/filter options fresh.
  if (chart) {
    chart.setGeometry(geometrySel.value === "bar" ? "bar" : "arc");
  } else {
    mountFromRaw(currentRaw);
  }
}

function onCohortChange(): void {
  if (!ready) return;
  chart?.setFilter({
    cohort: cohortSel.value || null,
    mirrorSplit: mirrorChk.checked,
    mirrorCohort: cohortSel.value || null,
  });
  // Remount when clearing filter so all marks return with animation
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
    // Mirror needs all marks visible, not filtered to one cohort
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

datasetSel.addEventListener("change", onDatasetChange);
datasetSel.addEventListener("input", onDatasetChange);
geometrySel.addEventListener("change", onGeometryChange);
geometrySel.addEventListener("input", onGeometryChange);
cohortSel.addEventListener("change", onCohortChange);
cohortSel.addEventListener("input", onCohortChange);
mirrorChk.addEventListener("change", onMirrorChange);

document.getElementById("play")!.addEventListener("click", () => chart?.play());
document.getElementById("pause")!.addEventListener("click", () => chart?.pause());
document.getElementById("reset")!.addEventListener("click", () => chart?.reset());

document.getElementById("apply-json")!.addEventListener("click", () => {
  try {
    currentRaw = JSON.parse(editor.value);
    populateCohorts(currentRaw);
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

// Initial mount, then enable controls (avoids pre-init select desync).
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
