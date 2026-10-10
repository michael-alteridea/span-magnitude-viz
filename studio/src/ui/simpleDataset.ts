/**
 * Création simple d'un dataset : colonnes à cocher, un filtre de lignes, axes proposés.
 */
import type { Dataset } from "../data/table";
import type { FilterSpec } from "../spec";
import { h } from "./dom";

export interface SimpleAxes {
  x: string | null;
  y: string[];
  series: string | null;
}

export interface FormulaInput {
  as: string;
  op: "add" | "sub" | "mul" | "div" | "max" | "min";
  a: string;
  b: string;
  bKind: "col" | "sum" | "max" | "mean";
}

export interface SimpleResult {
  name: string;
  columns: string[];
  filters: FilterSpec[];
  axes: SimpleAxes;
  groupBy: string;
  aggs: { field: string; op: "sum" | "mean" | "count" }[];
  formulas: FormulaInput[];
}

const roleOf = (ds: Dataset): { x: string | null; y: string | null; series: string | null } => {
  const date = ds.columns.find((c) => c.type === "date");
  const nums = ds.columns.filter((c) => c.type === "number" && !c.idLike);
  const cats = ds.columns.filter((c) => c.type === "category" && c.cardinality >= 2 && c.cardinality <= 16);
  return { x: date?.name ?? cats[0]?.name ?? null, y: nums[0]?.name ?? null, series: cats.find((c) => c.name !== (date?.name ?? cats[0]?.name))?.name ?? null };
};

export function openSimpleDataset(ds: Dataset, onCreate: (r: SimpleResult) => void, onMore: () => void): void {
  const roles = roleOf(ds);
  const kept = new Set(ds.columns.filter((c) => !c.idLike).map((c) => c.name));
  let filterCol = "";
  const filterVals = new Set<string>();

  const root = h("div", { style: "position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center" });
  const box = h("div", { style: "background:#111;color:#f4f4f5;width:min(640px,94vw);max-height:88vh;overflow:auto;border-radius:12px;padding:20px;font:15px system-ui" });
  const propose = h("p", { style: "margin:8px 0 14px;color:#a1a1aa" });
  const cols = h("div", { style: "display:flex;flex-direction:column;gap:6px;margin-bottom:14px;max-height:240px;overflow:auto" });
  const colSearch = h("input", { type: "search", placeholder: "Chercher un champ…", style: "padding:8px 10px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#fff;width:100%;margin-bottom:8px" }) as HTMLInputElement;
  const boxes: { name: string; cb: HTMLInputElement; row: HTMLElement }[] = [];
  const filterHost = h("div", { style: "margin-bottom:14px" });

  const refresh = () => {
    const x = roles.x && kept.has(roles.x) ? roles.x : null;
    const y = roles.y && kept.has(roles.y) ? roles.y : null;
    const s = roles.series && kept.has(roles.series) ? roles.series : null;
    propose.textContent = `Je propose : axe = ${x ?? "aucun"}, mesure = ${y ?? "aucune"}${s ? `, couleur = ${s}` : ""}.`;
  };

  for (const c of ds.columns) {
    const tag = c.name === roles.x ? "axe" : c.name === roles.y ? "mesure" : c.name === roles.series ? "couleur" : "";
    const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
    cb.checked = kept.has(c.name);
    cb.addEventListener("change", () => {
      if (cb.checked) kept.add(c.name);
      else kept.delete(c.name);
      refresh();
    });
    const row = h("label", { style: "display:flex;gap:8px;align-items:center" }, cb, c.name, h("span", { style: "color:#71717a;font-size:13px" }, `${c.type}${tag ? " · " + tag : ""}`));
    boxes.push({ name: c.name, cb, row });
    cols.append(row);
  }

  const sel = h("select", { style: "padding:8px;border-radius:8px;background:#18181b;color:#fff;border:1px solid #3f3f46" }, h("option", { value: "" }, "Aucun filtre")) as HTMLSelectElement;
  for (const c of ds.columns.filter((c) => c.type === "category" || c.type === "date")) sel.append(h("option", { value: c.name }, c.name));
  const vals = h("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-top:8px" });
  sel.addEventListener("change", () => {
    filterCol = sel.value;
    filterVals.clear();
    vals.replaceChildren();
    if (!filterCol) return;
    const uniq = [...new Set(ds.rows.map((r) => String(r[filterCol] ?? "")).filter(Boolean))].slice(0, 24);
    for (const v of uniq) {
      const b = h("button", { type: "button", style: "padding:4px 8px;border-radius:999px;border:1px solid #3f3f46;background:#18181b;color:#fff;cursor:pointer" }, v) as HTMLButtonElement;
      b.addEventListener("click", () => {
        if (filterVals.has(v)) filterVals.delete(v);
        else filterVals.add(v);
        b.style.background = filterVals.has(v) ? "#0E6E8C" : "#18181b";
      });
      vals.append(b);
    }
  });
  filterHost.append(h("div", null, "Lignes gardées : ", sel), vals);

  const groupSel = h("select", { style: "padding:8px;border-radius:8px;background:#18181b;color:#fff;border:1px solid #3f3f46" }, h("option", { value: "" }, "Pas de regroupement")) as HTMLSelectElement;
  for (const c of ds.columns.filter((c) => c.type === "category" || c.type === "date")) groupSel.append(h("option", { value: c.name }, c.name));
  const aggHost = h("div", { style: "display:flex;flex-direction:column;gap:4px;margin-top:8px;max-height:220px;overflow:auto" });
  const aggOps = new Map<string, "sum" | "mean" | "">();
  const aggRows: { name: string; cb: HTMLInputElement; sel: HTMLSelectElement }[] = [];
  for (const c of ds.columns.filter((c) => c.type === "number" && !c.idLike)) {
    aggOps.set(c.name, c.name === roles.y ? "sum" : "");
    const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
    const s = h("select", { style: "padding:6px;border-radius:8px;background:#18181b;color:#fff;border:1px solid #3f3f46;min-width:110px" }, h("option", { value: "" }, "ignorer"), h("option", { value: "sum" }, "somme"), h("option", { value: "mean" }, "moyenne")) as HTMLSelectElement;
    s.value = aggOps.get(c.name)!;
    s.addEventListener("change", () => aggOps.set(c.name, s.value as "sum" | "mean" | ""));
    aggRows.push({ name: c.name, cb, sel: s });
    aggHost.append(h("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 0" }, h("label", { style: "display:flex;gap:8px;align-items:center" }, cb, c.name), s));
  }
  const bulk = h("select", { style: "padding:6px;border-radius:8px;background:#18181b;color:#fff;border:1px solid #3f3f46" }, h("option", { value: "mean" }, "moyenne"), h("option", { value: "sum" }, "somme"), h("option", { value: "" }, "ignorer")) as HTMLSelectElement;
  const applyBulk = () => {
    const op = bulk.value as "sum" | "mean" | "";
    for (const r of aggRows) if (r.cb.checked) { r.sel.value = op; aggOps.set(r.name, op); }
  };
  const countCb = h("input", { type: "checkbox" }) as HTMLInputElement;
  const groupBox = h("div", { style: "margin-bottom:14px" }, h("h3", { style: "font-size:14px;margin:0 0 8px" }, "Regrouper"), groupSel, h("label", { style: "display:flex;gap:8px;align-items:center;margin-top:8px" }, countCb, "Compter les lignes"), h("div", { style: "display:flex;gap:8px;align-items:center;margin-top:8px" }, h("span", { style: "color:#a1a1aa" }, "Cochez, puis :"), bulk, h("button", { type: "button", style: "padding:6px 10px;border-radius:8px;border:1px solid #3f3f46;background:transparent;color:#fff;cursor:pointer", onclick: applyBulk }, "Appliquer aux cochés")), aggHost);
  const nums = ds.columns.filter((c) => c.type === "number" && !c.idLike).map((c) => c.name);
  const formulas: FormulaInput[] = [];
  const fList = h("div", { style: "display:flex;flex-direction:column;gap:4px;margin:8px 0" });
  const fName = h("input", { placeholder: "Nom de la colonne", style: "flex:1;padding:6px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#fff" }) as HTMLInputElement;
  const fA = h("select", { style: "padding:6px;border-radius:8px;background:#18181b;color:#fff;border:1px solid #3f3f46" }, ...nums.map((n) => h("option", { value: n }, n))) as HTMLSelectElement;
  const fOp = h("select", { style: "padding:6px;border-radius:8px;background:#18181b;color:#fff;border:1px solid #3f3f46" },
    h("option", { value: "div" }, "÷"), h("option", { value: "mul" }, "×"), h("option", { value: "add" }, "+"), h("option", { value: "sub" }, "−"), h("option", { value: "max" }, "max"), h("option", { value: "min" }, "min")
  ) as HTMLSelectElement;
  const fRight = h("select", { style: "flex:1;padding:6px;border-radius:8px;background:#18181b;color:#fff;border:1px solid #3f3f46" }) as HTMLSelectElement;
  const fillRight = () => {
    fRight.replaceChildren(
      ...nums.map((n) => h("option", { value: `col:${n}` }, n)),
      ...nums.map((n) => h("option", { value: `sum:${n}` }, `total de ${n}`)),
      ...nums.map((n) => h("option", { value: `max:${n}` }, `max de ${n}`)),
      ...nums.map((n) => h("option", { value: `mean:${n}` }, `moyenne de ${n}`))
    );
  };
  fillRight();
  const paintF = () => {
    fList.replaceChildren(...formulas.map((f, i) => h("div", { style: "display:flex;gap:8px;align-items:center;color:#d4d4d8" },
      h("span", { style: "flex:1" }, `${f.as} = ${f.a} ${{ add: "+", sub: "−", mul: "×", div: "÷", max: "max", min: "min" }[f.op]} ${f.bKind === "col" ? f.b : f.bKind === "sum" ? "total de " + f.b : f.bKind === "max" ? "max de " + f.b : "moyenne de " + f.b}`),
      h("button", { type: "button", style: "border:0;background:transparent;color:#a1a1aa;cursor:pointer", onclick: () => { formulas.splice(i, 1); paintF(); } }, "×")
    )));
  };
  const addF = () => {
    const as = fName.value.trim();
    const raw = fRight.value;
    if (!as || !fA.value || !raw) return;
    const [bKind, b] = raw.split(":") as [FormulaInput["bKind"], string];
    formulas.push({ as, op: fOp.value as FormulaInput["op"], a: fA.value, b, bKind });
    fName.value = "";
    paintF();
  };
  const formulaBox = h("div", { style: "margin-bottom:14px" },
    h("h3", { style: "font-size:14px;margin:0 0 8px" }, "Colonnes calculées"),
    h("div", { style: "display:flex;gap:6px;align-items:center" }, fName, fA, fOp, fRight, h("button", { type: "button", style: "padding:6px 10px;border-radius:8px;border:1px solid #3f3f46;background:transparent;color:#fff;cursor:pointer", onclick: addF }, "Ajouter")),
    fList
  );
  const name = h("input", { value: ds.name, style: "width:100%;padding:10px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#fff" }) as HTMLInputElement;
  refresh();

  const setAll = (on: boolean) => {
    for (const b of boxes) if (b.row.style.display !== "none") { b.cb.checked = on; if (on) kept.add(b.name); else kept.delete(b.name); }
    refresh();
  };
  colSearch.addEventListener("input", () => {
    const q = colSearch.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (const b of boxes) b.row.style.display = !q || b.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q) ? "" : "none";
  });
  box.append(
    h("h2", { style: "margin:0 0 4px;font-size:20px" }, "Créer un dataset"),
    h("p", { style: "margin:0;color:#a1a1aa" }, `${ds.rows.length} lignes · cochez les colonnes, filtrez si besoin.`),
    propose,
    h("h3", { style: "font-size:14px;margin:0 0 8px" }, "Colonnes"),
    colSearch,
    h("div", { style: "display:flex;gap:8px;margin-bottom:8px" },
      h("button", { type: "button", style: "padding:6px 10px;border-radius:8px;border:1px solid #3f3f46;background:transparent;color:#fff;cursor:pointer", onclick: () => setAll(true) }, "Tout sélectionner"),
      h("button", { type: "button", style: "padding:6px 10px;border-radius:8px;border:1px solid #3f3f46;background:transparent;color:#fff;cursor:pointer", onclick: () => setAll(false) }, "Ne rien sélectionner")
    ),
    cols,
    h("h3", { style: "font-size:14px;margin:0 0 8px" }, "Filtre"),
    filterHost,
    groupBox,
    formulaBox,
    name,
    h("div", { style: "display:flex;gap:8px;margin-top:14px;justify-content:flex-end" },
      h("button", { type: "button", style: "padding:10px 14px;border:0;background:transparent;color:#a1a1aa;cursor:pointer", onclick: () => root.remove() }, "Annuler"),
      h("button", { type: "button", style: "padding:10px 14px;border:1px solid #3f3f46;background:transparent;color:#fff;border-radius:8px;cursor:pointer", onclick: () => { root.remove(); onMore(); } }, "Plus de filtres"),
      h("button", { type: "button", style: "padding:10px 14px;border:0;background:#0E6E8C;color:#fff;border-radius:8px;cursor:pointer", onclick: () => {
        const filters: FilterSpec[] = filterCol && filterVals.size ? [{ field: filterCol, op: "in", values: [...filterVals], value: null, label: "" }] : [];
        root.remove();
        const groupBy = groupSel.value;
        const aggs = [...aggOps.entries()].filter(([, op]) => op).map(([field, op]) => ({ field, op: op as "sum" | "mean" | "count" }));
        if (groupBy && countCb.checked) aggs.unshift({ field: "Nombre de lignes", op: "count" });
        onCreate({ name: name.value.trim() || ds.name, columns: [...kept], filters, axes: { x: groupBy || (roles.x && kept.has(roles.x) ? roles.x : null), y: aggs.length ? aggs.map((a) => a.field) : roles.y && kept.has(roles.y) ? [roles.y] : [], series: groupBy ? null : roles.series && kept.has(roles.series) ? roles.series : null }, groupBy, aggs, formulas });
      } }, "Créer le dataset")
    )
  );
  root.append(box);
  document.body.append(root);
}
