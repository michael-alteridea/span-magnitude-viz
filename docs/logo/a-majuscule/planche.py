"""Génère planche.html (une ligne par code, colonnes clair/sombre × jaune or / jaune vif + favicon 32 px réel)."""
import json, os, html, sys
CODES = sys.argv[1].split(",") if len(sys.argv) > 1 else None
NAME = sys.argv[2] if len(sys.argv) > 2 else "planche.html"
TITLE = sys.argv[3] if len(sys.argv) > 3 else "variantes « A majuscule » en jaune"
HERE = os.path.dirname(os.path.abspath(__file__))
m = json.load(open(os.path.join(HERE, "variantes.json")))
Y = [("jaune-or", "jaune or"), ("jaune-vif", "jaune vif")]
rows = []
for code, v in m["variantes"].items():
    if CODES and code not in CODES: continue
    cells = []
    for th, thl in (("light", "clair"), ("dark", "sombre")):
        for yk, yl in Y:
            f = f"variantes/{code}-{th}.svg" if code == "V0" else f"variantes/{code}-{th}-{yk}.svg"
            cells.append(f'<td class="wm {th}"><img src="{f}" alt="{code} {thl} {yl}"><img class="small" src="{f}" alt=""></td>')
    for yk, yl in Y:
        f = f"variantes/{code}-favicon.svg" if code == "V0" else f"variantes/{code}-favicon-{yk}.svg"
        cells.append(f'<td class="fav"><img src="{f}" width="32" height="32" alt="favicon {code} {yl}"></td>')
    rows.append(f'<tr><th><b>{code}</b><p>{html.escape(v["description"])}</p></th>{"".join(cells)}</tr>')
head = "".join(f"<th>{t} · {yl}</th>" for t in ("Fond clair", "Fond sombre") for _, yl in Y) + "".join(f"<th>Favicon 32 px · {yl}</th>" for _, yl in Y)
page = f"""<!doctype html><html lang="fr"><meta charset="utf-8"><title>Datanime — {TITLE}</title>
<style>
body{{font:14px/1.4 Inter,system-ui,sans-serif;margin:28px;color:#16232A;background:#F3F5F6}}
h1{{font-size:22px;margin:0 0 4px}} .sub{{margin:0 0 18px;color:#4a5a62}}
table{{border-collapse:separate;border-spacing:6px}}
thead th{{font-size:12px;font-weight:600;color:#4a5a62;text-align:left;padding:0 4px}}
tbody th{{width:230px;text-align:left;vertical-align:top;background:#fff;border-radius:10px;padding:10px 12px;font-weight:400}}
tbody th b{{font-size:20px}} tbody th p{{margin:4px 0 0;font-size:12.5px}}
td{{border-radius:10px;padding:14px 16px;vertical-align:middle}}
td.light{{background:#FFFFFF}} td.dark{{background:#0B1A20}}
td.wm img{{display:block;height:46px}} td.wm img.small{{height:16px;margin-top:10px}}
td.fav{{background:#fff;text-align:center;width:90px}} td.fav img{{display:inline-block}}
</style>
<h1>Datanime — {TITLE}</h1>
<p class="sub">Inter Bold, « Dat » et « nime » identiques au mot-symbole du studio ; seule la lettre jaune change. Deux jaunes : jaune or (plus profond, tient sur blanc) et jaune vif (plus lumineux). Sous chaque logo : rappel en petit (16 px de haut). Favicons à leur taille réelle de 32 px.</p>
<table><thead><tr><th>Code</th>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table></html>"""
open(os.path.join(HERE, NAME), "w").write(page)
print("ok")
