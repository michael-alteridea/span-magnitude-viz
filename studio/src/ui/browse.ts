/**
 * Aperçu complet : toutes les lignes, tri, recherche, suppression d'une ligne ou d'une colonne.
 */
import type { Dataset } from "../data/table";
import { formatCell } from "../format";
import { h } from "./dom";

const PAGE = 100;

export interface BrowseActions {
  current(): Dataset | null;
  deleteRow(index: number): void;
  deleteColumn(name: string): void;
}

export function openBrowse(actions: BrowseActions): void {
  let sort: { col: string; dir: 1 | -1 } | null = null;
  let q = "";
  let page = 0;

  const root = h("div", { style: "position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center" });
  const box = h("div", { style: "background:#111;color:#f4f4f5;width:min(1100px,96vw);height:min(80vh,800px);display:flex;flex-direction:column;border-radius:12px;padding:16px;font:14px system-ui" });
  const info = h("span", { style: "color:#a1a1aa" });
  const search = h("input", { type: "search", placeholder: "Chercher dans les lignes…", style: "padding:8px 10px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#fff;width:260px" }) as HTMLInputElement;
  const table = h("div", { style: "flex:1;overflow:auto;margin-top:12px" });
  const pager = h("div", { style: "display:flex;gap:8px;align-items:center;margin-top:10px" });

  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const draw = () => {
    const ds = actions.current();
    if (!ds) { root.remove(); return; }
    const words = norm(q).split(/\s+/).filter(Boolean);
    let list = ds.rows.map((r, i) => ({ r, i }));
    if (words.length) list = list.filter(({ r }) => words.every((w) => norm(ds.columns.map((c) => formatCell(r[c.name], c.type)).join(" ")).includes(w)));
    if (sort && ds.columns.some((c) => c.name === sort!.col)) {
      list.sort((a, b) => {
        const va = a.r[sort!.col], vb = b.r[sort!.col];
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va ?? "").localeCompare(String(vb ?? ""), "fr");
        return cmp * sort!.dir;
      });
    }
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    page = Math.min(page, pages - 1);
    const slice = list.slice(page * PAGE, page * PAGE + PAGE);
    info.textContent = `${list.length.toLocaleString("fr-FR")} lignes sur ${ds.rows.length.toLocaleString("fr-FR")} · ${ds.columns.length} colonnes`;
    const head = h("tr", null,
      h("th", { style: "position:sticky;top:0;background:#18181b;width:28px" }),
      ...ds.columns.map((c) => {
        const mark = sort?.col === c.name ? (sort.dir === 1 ? " ↑" : " ↓") : "";
        return h("th", { style: "position:sticky;top:0;background:#18181b;text-align:left;padding:6px 8px;white-space:nowrap" },
          h("span", { style: "cursor:pointer", onclick: () => { sort = { col: c.name, dir: sort?.col === c.name && sort.dir === 1 ? -1 : 1 }; draw(); } }, c.name + mark),
          h("button", { type: "button", title: `Retirer la colonne ${c.name}`, style: "margin-left:6px;border:0;background:transparent;color:#a1a1aa;cursor:pointer", onclick: () => { if (confirm(`Retirer la colonne « ${c.name} » ?`)) { actions.deleteColumn(c.name); draw(); } } }, "×")
        );
      })
    );
    const body = slice.map(({ r, i }) => h("tr", null,
      h("td", null, h("button", { type: "button", title: "Retirer cette ligne", style: "border:0;background:transparent;color:#a1a1aa;cursor:pointer", onclick: () => { actions.deleteRow(i); draw(); } }, "×")),
      ...ds.columns.map((c) => h("td", { style: "padding:4px 8px;border-top:1px solid #27272a;white-space:nowrap" }, formatCell(r[c.name], c.type)))
    ));
    table.replaceChildren(h("table", { style: "border-collapse:collapse;width:100%" }, h("thead", null, head), h("tbody", null, ...body)));
    pager.replaceChildren(
      h("button", { type: "button", disabled: page === 0, style: "padding:6px 10px", onclick: () => { page--; draw(); } }, "Précédent"),
      h("span", null, `${page + 1} / ${pages}`),
      h("button", { type: "button", disabled: page >= pages - 1, style: "padding:6px 10px", onclick: () => { page++; draw(); } }, "Suivant")
    );
  };
  search.addEventListener("input", () => { q = search.value; page = 0; draw(); });
  box.append(
    h("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:12px" }, h("div", null, h("strong", null, "Aperçu"), " ", info), h("div", { style: "display:flex;gap:8px" }, search, h("button", { type: "button", style: "padding:8px 12px;border:0;background:transparent;color:#a1a1aa;cursor:pointer", onclick: () => root.remove() }, "Fermer"))),
    h("p", { style: "margin:8px 0 0;color:#71717a;font-size:13px" }, "× sur une ligne la retire. × à côté d'un titre retire la colonne."),
    table,
    pager
  );
  root.append(box);
  document.body.append(root);
  draw();
}
