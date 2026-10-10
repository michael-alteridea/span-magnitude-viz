# Datanime — variantes « A majuscule » en jaune (10 oct. 2026)

Base : mot-symbole du studio (`studio/src/assets/brand/wordmark.ts`, Inter Bold 112 px). « Dat » et « nime » sont
les chemins exacts du studio (mêmes couleurs, mêmes formes) ; seule la lettre du milieu change, en jaune.

| Code | Description |
|---|---|
| V0 | Référence actuelle : « a » orange simple |
| A1 | « DatAnime » : A capital normal en jaune |
| A2 | A capital réduit à la hauteur d’x de « nime » (Inter ExtraBold pour la graisse) |
| B1 | ▶ plein = A tourné d’un quart de tour horaire ; barre du A = fente verticale (deux pièces) |
| B2 | Vrai A d’Inter Bold tourné de 90° horaire (pointe à droite) |
| B3 | ▶ arrondi évidé : œil du A = trou triangulaire près de la pointe (fût 0,15 × hauteur) |

Deux jaunes : **jaune or** (plus profond, tient sur blanc) et **jaune vif** (plus lumineux, pour fond sombre).

Fichiers (`variantes/`) : `<code>-<light|dark>-<jaune-or|jaune-vif>.svg` (avec fond), `…-transparent.svg`,
`…-800.png`, `<code>-favicon-<jaune>.svg` + `-32.png` / `-256.png` (lettre jaune sur carré pétrole foncé arrondi).
Planche : `planche.html` → `planche.png` (Chrome headless, 2×).

Regénérer : `python3 -m venv .venv && .venv/bin/pip install fonttools uharfbuzz cairosvg pillow`,
puis `.venv/bin/python build.py && .venv/bin/python planche.py && node render.js`
(polices Inter statiques : `/workspace/tell4d-logo/src/Inter-700.ttf`, `Inter-800.ttf`).
