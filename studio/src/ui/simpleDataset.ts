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

export interface SimpleResult {
  name: string;
  columns: string[];
  filters: FilterSpec[];
  axes: SimpleAxes;
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
  const cols = h("div", { style: "display:flex;flex-direction:column;gap:6px;margin-bottom:14px" });
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
    cols.append(h("label", { style: "display:flex;gap:8px;align-items:center" }, cb, c.name, h("span", { style: "color:#71717a;font-size:13px" }, `${c.type}${tag ? " · " + tag : ""}`)));
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

  const name = h("input", { value: ds.name, style: "width:100%;padding:10px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#fff" }) as HTMLInputElement;
  refresh();

  box.append(
    h("h2", { style: "margin:0 0 4px;font-size:20px" }, "Créer un dataset"),
    h("p", { style: "margin:0;color:#a1a1aa" }, `${ds.rows.length} lignes · cochez les colonnes, filtrez si besoin.`),
    propose,
    h("h3", { style: "font-size:14px;margin:0 0 8px" }, "Colonnes"),
    cols,
    h("h3", { style: "font-size:14px;margin:0 0 8px" }, "Filtre"),
    filterHost,
    name,
    h("div", { style: "display:flex;gap:8px;margin-top:14px;justify-content:flex-end" },
      h("button", { type: "button", style: "padding:10px 14px;border:0;background:transparent;color:#a1a1aa;cursor:pointer", onclick: () => root.remove() }, "Annuler"),
      h("button", { type: "button", style: "padding:10px 14px;border:1px solid #3f3f46;background:transparent;color:#fff;border-radius:8px;cursor:pointer", onclick: () => { root.remove(); onMore(); } }, "Plus de filtres"),
      h("button", { type: "button", style: "padding:10px 14px;border:0;background:#0E6E8C;color:#fff;border-radius:8px;cursor:pointer", onclick: () => {
        const filters: FilterSpec[] = filterCol && filterVals.size ? [{ field: filterCol, op: "in", values: [...filterVals], value: null, label: "" }] : [];
        root.remove();
        onCreate({ name: name.value.trim() || ds.name, columns: [...kept], filters, axes: { x: roles.x && kept.has(roles.x) ? roles.x : null, y: roles.y && kept.has(roles.y) ? [roles.y] : [], series: roles.series && kept.has(roles.series) ? roles.series : null } });
      } }, "Créer le dataset")
    )
  );
  root.append(box);
  document.body.append(root);
}
