/**
 * Collapsible field-analysis / pre-wiring panel (FR UI).
 * Shared by demo/main.ts and demo/standalone.ts.
 */
import {
  analyzeColumns,
  columnsFromRows,
  resolveInitialMapping,
  validateMapping,
  rememberMapping,
  loadRememberedMapping,
  computeSpanPreview,
  spanPreviewFormulaFr,
  formatSpanLengthFr,
  FIELD_ROLE_LABELS_FR,
  type ColumnAnalysis,
  type ColumnMapping,
  type FieldRole,
  type Suitability,
} from "span-magnitude-viz";

export interface FieldAnalysisPanelOptions {
  /** Host element — contents replaced when showing the panel. */
  host: HTMLElement;
  /** Called when the user confirms a valid mapping. */
  onApply: (mapping: ColumnMapping, unit: "date" | "number") => void;
  /** Optional unit select (demo); if absent, unit defaults to "date". */
  unitSelect?: HTMLSelectElement | null;
  /** Start expanded (default true after upload). */
  initiallyOpen?: boolean;
}

export interface FieldAnalysisPanelHandle {
  /** Render / refresh for newly imported rows. */
  show(rows: Record<string, unknown>[]): void;
  hide(): void;
  destroy(): void;
  getMapping(): ColumnMapping | null;
  isValid(): boolean;
}

const ROLE_SHORT_FR: Record<FieldRole, string> = {
  spanStart: "début",
  spanEnd: "fin",
  duration: "durée",
  magnitude: "magn.",
  color: "couleur",
  facet: "facette",
  label: "libellé",
  id: "id",
  lat: "lat",
  lon: "lon",
  postal: "CP",
};

const TYPE_LABEL_FR: Record<string, string> = {
  date: "date",
  number: "nombre",
  string: "texte",
  boolean: "booléen",
};

const SUIT_CLASS: Record<Suitability, string> = {
  good: "smv-suit-good",
  ok: "smv-suit-ok",
  bad: "smv-suit-bad",
};

const SUIT_DOT: Record<Suitability, string> = {
  good: "●",
  ok: "●",
  bad: "●",
};

const PANEL_STYLES = `
.smv-fap { border: 1px solid #2a2622; border-radius: 8px; background: #141210; margin-bottom: 12px; overflow: hidden; }
.smv-fap-toggle {
  display: flex; align-items: center; gap: 8px; width: 100%;
  appearance: none; border: 0; background: #1c1917; color: #e7e5e4;
  padding: 10px 14px; font: inherit; font-size: 13px; font-weight: 500;
  cursor: pointer; text-align: left;
}
.smv-fap-toggle:hover { color: #d62839; }
.smv-fap-chevron { display: inline-block; transition: transform .15s ease; color: #a8a29e; }
.smv-fap-chevron.open { transform: rotate(90deg); }
.smv-fap-body { display: none; padding: 12px 14px 14px; }
.smv-fap-body.open { display: block; }
.smv-fap-table-wrap { overflow-x: auto; margin-bottom: 12px; }
.smv-fap-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.smv-fap-table th, .smv-fap-table td {
  border-bottom: 1px solid #2a2622; padding: 6px 8px; text-align: left; vertical-align: top;
}
.smv-fap-table th { color: #a8a29e; font-weight: 500; white-space: nowrap; }
.smv-fap-table td { color: #e7e5e4; }
.smv-fap-col { font-family: ui-monospace, "IBM Plex Mono", monospace; font-weight: 500; }
.smv-fap-samples { color: #a8a29e; max-width: 220px; }
.smv-fap-roles { display: flex; flex-wrap: wrap; gap: 4px 8px; }
.smv-fap-role {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; color: #a8a29e; white-space: nowrap;
}
.smv-suit-good { color: #4ade80; }
.smv-suit-ok { color: #fbbf24; }
.smv-suit-bad { color: #f87171; }
.smv-fap-map {
  display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: end;
  padding-top: 4px; border-top: 1px solid #2a2622;
}
.smv-fap-map label {
  display: flex; flex-direction: column; gap: 4px;
  font-size: 11px; color: #a8a29e;
}
.smv-fap-map select {
  font: inherit; font-size: 12px; min-width: 120px;
  background: #1c1917; color: #e7e5e4; border: 1px solid #3f3a36;
  border-radius: 6px; padding: 6px 8px;
}
.smv-fap-map select.smv-invalid { border-color: #f87171; }
.smv-fap-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.smv-fap-apply {
  appearance: none; border: 1px solid #3f3a36; background: #1f1416;
  color: #e7e5e4; border-radius: 6px; padding: 8px 14px; font: inherit;
  font-size: 13px; cursor: pointer;
}
.smv-fap-apply:hover:not(:disabled) { border-color: #d62839; color: #d62839; }
.smv-fap-apply:disabled { opacity: 0.45; cursor: not-allowed; }
.smv-fap-issues { color: #fca5a5; font-size: 12px; margin: 0; min-height: 1.2em; flex: 1; }
.smv-fap-meta { font-size: 11px; color: #78716c; margin: 0 0 8px; }
.smv-fap-span-preview {
  display: none; margin-top: 10px; padding: 8px 10px;
  border: 1px solid #2a2622; border-radius: 6px; background: #1a1714;
  font-size: 12px; color: #e7e5e4;
}
.smv-fap-span-preview.visible { display: block; }
.smv-fap-span-preview .smv-fap-span-formula {
  font-family: ui-monospace, "IBM Plex Mono", monospace;
  font-weight: 500; color: #d62839; margin-bottom: 4px;
}
.smv-fap-span-preview .smv-fap-span-stats { color: #a8a29e; }
.smv-fap-span-preview .smv-fap-span-stats strong { color: #e7e5e4; font-weight: 500; }
.smv-fap-span-preview .smv-fap-span-empty { color: #78716c; font-style: italic; }
`;

let stylesInjected = false;
function ensureStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.id = "smv-fap-styles";
  el.textContent = PANEL_STYLES;
  document.head.appendChild(el);
  stylesInjected = true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readSelects(root: HTMLElement): ColumnMapping {
  const val = (id: string) =>
    (root.querySelector(`#${id}`) as HTMLSelectElement | null)?.value || "";
  const emptyToNull = (s: string) => (s ? s : null);
  return {
    start: val("smv-map-start"),
    end: emptyToNull(val("smv-map-end")),
    duration: emptyToNull(val("smv-map-duration")),
    magnitude: val("smv-map-mag"),
    colorField: emptyToNull(val("smv-map-color")),
    group: emptyToNull(val("smv-map-facet")),
    label: emptyToNull(val("smv-map-label")),
    id: emptyToNull(val("smv-map-id")),
    lat: emptyToNull(val("smv-map-lat")),
    lon: emptyToNull(val("smv-map-lon")),
    postal: emptyToNull(val("smv-map-postal")),
  };
}

function roleSuitFor(
  a: ColumnAnalysis | undefined,
  role: FieldRole,
  startIsDate: boolean
): Suitability | undefined {
  if (!a) return undefined;
  if (role === "spanEnd" && startIsDate) {
    const base = a.roles.find((r) => r.role === role);
    if (a.type === "date" || a.dateRate >= 0.6) return "good";
    return "bad";
  }
  return a.roles.find((r) => r.role === role)?.suitability;
}

function fillSelect(
  sel: HTMLSelectElement,
  columns: string[],
  selected: string | null | undefined,
  allowEmpty: boolean,
  analyses: ColumnAnalysis[],
  role: FieldRole,
  opts?: { startIsDate?: boolean; disableBad?: boolean }
): void {
  const startIsDate = Boolean(opts?.startIsDate);
  const disableBad = opts?.disableBad !== false;
  sel.innerHTML = "";
  if (allowEmpty) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "—";
    sel.appendChild(opt);
  }
  const byName = new Map(analyses.map((a) => [a.name, a]));
  for (const c of columns) {
    const opt = document.createElement("option");
    opt.value = c;
    const a = byName.get(c);
    const suit = roleSuitFor(a, role, startIsDate);
    const mark =
      suit === "good" ? " ●" : suit === "ok" ? " ◐" : suit === "bad" ? " ○" : "";
    opt.textContent = c + mark;
    if (suit === "bad") {
      opt.dataset.suit = "bad";
      if (disableBad) opt.disabled = true;
    }
    sel.appendChild(opt);
  }
  if (selected && columns.includes(selected)) {
    const a = byName.get(selected);
    const suit = roleSuitFor(a, role, startIsDate);
    if (suit === "bad" && disableBad && allowEmpty) {
      sel.value = "";
    } else if (suit === "bad" && disableBad && !allowEmpty) {
      // pick first non-bad
      const firstOk = columns.find((c) => roleSuitFor(byName.get(c), role, startIsDate) !== "bad");
      sel.value = firstOk ?? selected;
    } else {
      sel.value = selected;
    }
  } else if (allowEmpty) sel.value = "";
  else {
    const firstOk = columns.find((c) => roleSuitFor(byName.get(c), role, startIsDate) !== "bad");
    sel.value = firstOk ?? columns[0] ?? "";
  }
}

export function createFieldAnalysisPanel(
  options: FieldAnalysisPanelOptions
): FieldAnalysisPanelHandle {
  ensureStyles();
  const { host, onApply, unitSelect } = options;
  let open = options.initiallyOpen !== false;
  let rows: Record<string, unknown>[] | null = null;
  let analyses: ColumnAnalysis[] = [];
  let columns: string[] = [];
  let root: HTMLElement | null = null;
  let unitListenerAttached = false;

  const currentUnit = (): "date" | "number" =>
    unitSelect?.value === "number" ? "number" : "date";

  const updateSpanPreview = (): void => {
    if (!root || !rows) return;
    const box = root.querySelector(".smv-fap-span-preview") as HTMLElement | null;
    if (!box) return;
    const mapping = readSelects(root);
    const unit = currentUnit();
    const stats = computeSpanPreview(rows, mapping, unit);
    if (!stats) {
      box.classList.remove("visible");
      box.innerHTML = "";
      return;
    }
    box.classList.add("visible");
    const formula = spanPreviewFormulaFr(stats.mode);
    if (stats.count === 0) {
      box.innerHTML = `
        <div class="smv-fap-span-formula">${escapeHtml(formula)}</div>
        <div class="smv-fap-span-empty">Aucune durée calculable sur l’échantillon — vérifiez début / fin (ou durée).</div>
      `;
      return;
    }
    const med =
      stats.median == null ? "—" : formatSpanLengthFr(stats.median, unit);
    const avg =
      stats.mean == null ? "—" : formatSpanLengthFr(stats.mean, unit);
    const sampleNote =
      stats.sampled < rows.length
        ? ` (échantillon ${stats.sampled}/${rows.length})`
        : "";
    box.innerHTML = `
      <div class="smv-fap-span-formula">${escapeHtml(formula)}</div>
      <div class="smv-fap-span-stats">
        Span calculé · <strong>${stats.count}</strong> marques${escapeHtml(sampleNote)}
        · médiane <strong>${escapeHtml(med)}</strong>
        · moyenne <strong>${escapeHtml(avg)}</strong>
      </div>
    `;
  };

  const refreshValidation = (): boolean => {
    if (!root || !rows) return false;
    const mapping = readSelects(root);
    mapping.meta = columns.filter(
      (c) =>
        c !== mapping.start &&
        c !== mapping.end &&
        c !== mapping.duration &&
        c !== mapping.magnitude
    );
    const result = validateMapping(mapping, columns, analyses);
    const btn = root.querySelector(".smv-fap-apply") as HTMLButtonElement | null;
    const issues = root.querySelector(".smv-fap-issues");
    if (btn) btn.disabled = !result.valid;
    if (issues) {
      const parts = [...result.issues, ...result.warnings.filter((w) => /peu adaptée/.test(w))];
      issues.textContent = parts.join(" ");
    }
    // highlight required selects
    for (const [id, role] of [
      ["smv-map-start", "spanStart"],
      ["smv-map-end", "spanEnd"],
      ["smv-map-duration", "duration"],
      ["smv-map-mag", "magnitude"],
    ] as const) {
      const sel = root.querySelector(`#${id}`) as HTMLSelectElement | null;
      if (!sel) continue;
      const col = sel.value;
      const a = analyses.find((x) => x.name === col);
      const suit = a?.roles.find((r) => r.role === role)?.suitability;
      sel.classList.toggle("smv-invalid", Boolean(col) && suit === "bad");
    }
    updateSpanPreview();
    return result.valid;
  };

  const render = (): void => {
    if (!rows) {
      host.style.display = "none";
      host.innerHTML = "";
      root = null;
      return;
    }
    host.style.display = "block";
    const mapping = resolveInitialMapping(columns, analyses);
    if (unitSelect) {
      const remembered = loadRememberedMapping(columns);
      if (remembered?.unit === "date" || remembered?.unit === "number") {
        unitSelect.value = remembered.unit;
      }
    }

    const rowsHtml = analyses
      .map((a) => {
        const rolesHtml = a.roles
          .filter((r) => r.suitability !== "bad")
          .map((r) => {
            const cls = SUIT_CLASS[r.suitability];
            return `<span class="smv-fap-role ${cls}" title="${escapeHtml(r.reason)}">${SUIT_DOT[r.suitability]} ${ROLE_SHORT_FR[r.role]}</span>`;
          })
          .join("") || `<span class="smv-fap-role smv-suit-bad" title="Aucun rôle adapté">● —</span>`;
        return `<tr>
          <td class="smv-fap-col">${escapeHtml(a.name)}</td>
          <td>${TYPE_LABEL_FR[a.type] ?? a.type}</td>
          <td>${a.cardinality}</td>
          <td class="smv-fap-samples">${escapeHtml(a.sampleValues.join(", "))}</td>
          <td><div class="smv-fap-roles">${rolesHtml}</div></td>
        </tr>`;
      })
      .join("");

    host.innerHTML = `
      <div class="smv-fap">
        <button type="button" class="smv-fap-toggle" aria-expanded="${open}">
          <span class="smv-fap-chevron ${open ? "open" : ""}">▸</span>
          Analyser les champs
          <span style="color:#78716c;font-weight:400;margin-left:4px">(${analyses.length} colonnes · ${rows.length} lignes)</span>
        </button>
        <div class="smv-fap-body ${open ? "open" : ""}">
          <p class="smv-fap-meta">Rôles adaptés uniquement (● verte / ambre). Les combos impossibles sont désactivées dans les listes (ex. fin ≠ compte si début = date).</p>
          <div class="smv-fap-table-wrap">
            <table class="smv-fap-table">
              <thead>
                <tr>
                  <th>Colonne</th>
                  <th>Type</th>
                  <th>Card.</th>
                  <th>Échantillons</th>
                  <th>Rôles possibles</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          <div class="smv-fap-map">
            <label>Début (span) <select id="smv-map-start"></select></label>
            <label>Fin (span) <select id="smv-map-end"></select></label>
            <label>Durée <select id="smv-map-duration"></select></label>
            <label>Magnitude <select id="smv-map-mag"></select></label>
            <label>Couleur <select id="smv-map-color"></select></label>
            <label>Facettes / groupe <select id="smv-map-facet"></select></label>
            <label>Libellé <select id="smv-map-label"></select></label>
            <label>Identifiant <select id="smv-map-id"></select></label>
            <label>Latitude <select id="smv-map-lat"></select></label>
            <label>Longitude <select id="smv-map-lon"></select></label>
            <label>Code postal <select id="smv-map-postal"></select></label>
          </div>
          <div class="smv-fap-span-preview" aria-live="polite"></div>
          <div class="smv-fap-actions">
            <button type="button" class="smv-fap-apply" disabled>Voir la visualisation</button>
            <p class="smv-fap-issues"></p>
          </div>
        </div>
      </div>
    `;
    root = host.firstElementChild as HTMLElement;

    const startSel = root.querySelector("#smv-map-start") as HTMLSelectElement;
    const endSel = root.querySelector("#smv-map-end") as HTMLSelectElement;
    const durSel = root.querySelector("#smv-map-duration") as HTMLSelectElement;
    const magSel = root.querySelector("#smv-map-mag") as HTMLSelectElement;
    const colorSel = root.querySelector("#smv-map-color") as HTMLSelectElement;
    const facetSel = root.querySelector("#smv-map-facet") as HTMLSelectElement;
    const labelSel = root.querySelector("#smv-map-label") as HTMLSelectElement;
    const idSel = root.querySelector("#smv-map-id") as HTMLSelectElement;
    const latSel = root.querySelector("#smv-map-lat") as HTMLSelectElement;
    const lonSel = root.querySelector("#smv-map-lon") as HTMLSelectElement;
    const postalSel = root.querySelector("#smv-map-postal") as HTMLSelectElement;

    const startIsDateNow = () => {
      const a = analyses.find((x) => x.name === startSel.value);
      return Boolean(a && (a.type === "date" || a.dateRate >= 0.6));
    };

    const refillCore = (keepSelection: boolean) => {
      const startDate = startIsDateNow();
      const cur = keepSelection ? readSelects(root!) : mapping;
      fillSelect(startSel, columns, cur.start, false, analyses, "spanStart");
      fillSelect(endSel, columns, cur.end, true, analyses, "spanEnd", {
        startIsDate: startDate,
        disableBad: true,
      });
      fillSelect(durSel, columns, cur.duration, true, analyses, "duration", {
        disableBad: true,
      });
      fillSelect(magSel, columns, cur.magnitude, false, analyses, "magnitude", {
        disableBad: true,
      });
    };

    fillSelect(startSel, columns, mapping.start, false, analyses, "spanStart");
    refillCore(false);
    fillSelect(
      colorSel,
      columns,
      mapping.colorField ?? mapping.group,
      true,
      analyses,
      "color",
      { disableBad: false }
    );
    fillSelect(facetSel, columns, mapping.group, true, analyses, "facet", {
      disableBad: false,
    });
    fillSelect(labelSel, columns, mapping.label, true, analyses, "label", {
      disableBad: false,
    });
    fillSelect(idSel, columns, mapping.id, true, analyses, "id", {
      disableBad: false,
    });
    fillSelect(latSel, columns, mapping.lat, true, analyses, "lat", {
      disableBad: false,
    });
    fillSelect(lonSel, columns, mapping.lon, true, analyses, "lon", {
      disableBad: false,
    });
    fillSelect(postalSel, columns, mapping.postal, true, analyses, "postal", {
      disableBad: false,
    });

    root.querySelector(".smv-fap-toggle")?.addEventListener("click", () => {
      open = !open;
      const body = root!.querySelector(".smv-fap-body");
      const chev = root!.querySelector(".smv-fap-chevron");
      const btn = root!.querySelector(".smv-fap-toggle");
      body?.classList.toggle("open", open);
      chev?.classList.toggle("open", open);
      btn?.setAttribute("aria-expanded", String(open));
    });

    const onChange = (ev?: Event) => {
      const t = ev?.target as HTMLSelectElement | undefined;
      // Mutual exclusivity: end XOR duration (prefer the one just changed)
      if (t === endSel && endSel.value) {
        durSel.value = "";
      } else if (t === durSel && durSel.value) {
        endSel.value = "";
      }
      if (t === startSel) {
        // Re-evaluate end options against new start type; drop impossible Fin
        const prevEnd = endSel.value;
        refillCore(true);
        const prevOpt = [...endSel.options].find((o) => o.value === prevEnd);
        if (prevEnd && prevOpt?.disabled) {
          // same-day point event fallback when start is date and no other date end
          const startA = analyses.find((x) => x.name === startSel.value);
          if (startA && (startA.type === "date" || startA.dateRate >= 0.6)) {
            endSel.value = startSel.value;
            durSel.value = "";
          }
        }
      }
      refreshValidation();
    };
    for (const sel of [
      startSel,
      endSel,
      durSel,
      magSel,
      colorSel,
      facetSel,
      labelSel,
      idSel,
      latSel,
      lonSel,
      postalSel,
    ]) {
      sel.addEventListener("change", onChange);
    }


    root.querySelector(".smv-fap-apply")?.addEventListener("click", () => {
      if (!refreshValidation() || !root || !rows) return;
      const m = readSelects(root);
      m.meta = columns.filter(
        (c) =>
          c !== m.start &&
          c !== m.end &&
          c !== m.duration &&
          c !== m.magnitude &&
          c !== m.lat &&
          c !== m.lon &&
          c !== m.postal
      );
      const unit =
        unitSelect?.value === "number"
          ? ("number" as const)
          : ("date" as const);
      rememberMapping(columns, m, unit);
      onApply(m, unit);
    });

    if (unitSelect && !unitListenerAttached) {
      unitSelect.addEventListener("change", () => {
        refreshValidation();
      });
      unitListenerAttached = true;
    }

    refreshValidation();
  };

  return {
    show(nextRows: Record<string, unknown>[]) {
      rows = nextRows;
      columns = columnsFromRows(nextRows);
      analyses = analyzeColumns(nextRows);
      open = true;
      render();
    },
    hide() {
      rows = null;
      analyses = [];
      columns = [];
      host.style.display = "none";
      host.innerHTML = "";
      root = null;
    },
    destroy() {
      this.hide();
    },
    getMapping() {
      if (!root || !rows) return null;
      const m = readSelects(root);
      m.meta = columns;
      return m;
    },
    isValid() {
      return refreshValidation();
    },
  };
}

/** Role label helper for external FR copy. */
export function roleLabelFr(role: FieldRole): string {
  return FIELD_ROLE_LABELS_FR[role];
}
