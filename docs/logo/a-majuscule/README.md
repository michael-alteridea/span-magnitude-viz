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

## Variantes C (B rejetées) — A droit, œil en ▶

A capital normal en jaune (comme A1) ; seul l'œil du A devient un ▶ évidé. Script : `build_c.py` (shapely).
Planche : `planche-c.html` → `planche-c.png` (lignes A1 + C1..C3) — `.venv/bin/python planche.py A1,C1,C2,C3 planche-c.html "…"` puis `node render.js planche-c.html planche-c.png`.

| Code | Description | ▶ (haut. à 112 px / favicon 32 px) |
|---|---|---|
| C1 | œil remplacé par un ▶ de taille voisine, barre conservée | 13,7 px / 3,4 px |
| C2 | ▶ plus grand, mord sur la barre, jambages un peu affinés | 25,2 px / 6,2 px |
| C3 | barre supprimée, ▶ franc au milieu du A sur un pont plein | 29,5 px / 7,2 px |

## C15 — ▶ intermédiaire (≈ 19 px à 112 px), barre conservée

Entre C1 (13,7 px) et C2 (25,2 px) : ▶ de 19,0 px dans le mot-symbole, 4,7 px dans le favicon 32 px (visible).
Barre intacte (le bas du ▶ reste au-dessus), jambages légèrement mordus. Géométrie : `c15.py` (le ▶ est le même
triangle arrondi que l'œil du A de départ de l'animation, tourné de 90°). Gros plan : `zoom-c15.png` (C1, C15, C2).

## Animation (`anim/`)

Storyboard : « DatA » apparaît (0–0,7 s) → « Anime » arrive à droite (0,65–1,35 s) : on lit « DatA Anime » → les
deux A glissent et fusionnent (1,55–2,30 s) en jaunissant PENDANT le glissement (balayage net d’une copie jaune, 1,55–2,02 s, depuis le côté tourné vers l’autre A : aucune couleur intermédiaire terne) → l'œil du A pivote de 90° horaire
et devient le ▶ C15 (2,40–3,30 s). Durée 3,4 s puis tenue. Courbes : ease-out à l'entrée, in-out (cubique) ensuite.
- `logo-anim.svg` (clair, jaune or, fond transparent) · `logo-anim-dark.svg` (sombre, jaune vif) — CSS pur, sans script,
  respecte `prefers-reduced-motion` (affiche directement C15). État final = C15 au pixel près.
- `apercu.html` (les deux, bouton Rejouer) · `logo-anim-1080x1080-clair.mp4` · `logo-anim-1920x1080-sombre.mp4`
  (5 s à 30 i/s, dont 1,6 s de tenue) · `logo-anim-800.gif` (800×300, clair, 25 i/s, en boucle).
- Regénérer : `.venv/bin/python anim.py`, puis `node anim/capture.js <svg> <L> <H> <fond> <largeur_logo> <dossier> 30 5`
  et ffmpeg (voir l'historique du commit).

## Variante capitales « DATAnime » (C15caps)

Statique : `variantes/C15caps-<light|dark>-<jaune-or|jaune-vif>.svg` (+ `-transparent.svg`, `-800.png`, favicon = C15).
« DAT » en Inter Bold capitales (encre de « Dat »), crénage HarfBuzz (le A se glisse sous le bras du T), « nime » studio.
Animation : `anim_caps.py` → `anim/logo-anim-caps.svg`, `logo-anim-caps-dark.svg`, `apercu-caps.html`,
`logo-anim-caps-1080x1080-clair.mp4`, `logo-anim-caps-1920x1080-sombre.mp4`, `logo-anim-caps-800.gif` (même minutage, 3,4 s + tenue).

## Variante « accents » (DatÀnimé / DATÀnimé)

Après le pivot du ▶, paraphe jaune : grave sur le A (À, tracé 3,35–3,70 s) puis aigu sur le e (é, 3,50–3,85 s), miroir
exact l'un de l'autre (même longueur 30 px à 112 px, même angle 36°, effilés « swoosh »). Durée 4,0 s puis tenue.
- Statiques : `variantes/C15accents-<light|dark>-<jaune-or|jaune-vif>.svg` et `variantes/C15accents-caps-…` (+ `-transparent.svg`, `-800.png`).
- Animations : `anim/logo-anim-accents(.svg|-dark.svg|-1080x1080-clair.mp4|-1920x1080-sombre.mp4|-800.gif)` et
  `anim/logo-anim-caps-accents(…)` — MP4/GIF de 5,6 s (dont 1,6 s de tenue). Scripts : `accents.py`, `anim_accents.py`, `anim/render.sh`.

## Variante « minuscules » (Data + anime → DatAnime)

« Data » puis « anime » (deux a minuscules) → les deux a glissent l'un vers l'autre en jaunissant (balayage net,
1,55–2,02 s), se superposent (« Datanime » avec a jaune) → métamorphose a → A (2,22–2,62 s : le a grandit et s'efface,
le A grandit de 0,8 à 1 et apparaît, même axe et même ligne de base ; jaune sur jaune, aucun ton terne ; « Dat » et
« nime » passent de l'approche du a à celle du A) → pivot de l'œil en ▶ (2,72–3,62 s) → [accents 3,67–4,17 s].
Durées : 3,75 s (sans accents) / 4,3 s (avec), puis tenue ; MP4/GIF 5,3 s / 5,9 s. Script : `anim_min.py`.
Fichiers : `anim/logo-anim-minuscules(…)` et `anim/logo-anim-minuscules-accents(…)` (.svg, -dark.svg, -1080x1080-clair.mp4,
-1920x1080-sombre.mp4, -800.gif). Image finale = C15 / C15accents au pixel près.

## Réglages finaux, capitales (sans accents, sombre) — `anim_caps_final.py`

« DATA » → « Anime » → les deux A fusionnent en gardant leurs couleurs (le A d'« Anime » passe sous celui de « DATA »)
→ le A fusionné jaunit APRÈS la fusion (blanc → jaune vif, 2,38–2,78 s) → pivot de l'œil en ▶ (2,88–3,78 s). 3,85 s puis tenue.
Fichiers : `anim/logo-anim-caps-final-dark.svg` (+ `logo-anim-caps-final.svg` clair), `anim/logo-anim-caps-final-1920x1080-sombre.mp4` (5,4 s),
`anim/logo-anim-caps-final-800-sombre.gif` (800×300, fond sombre).

## Réglages finaux, minuscules (sans accents, sombre) — `anim_min_final.py`

« Data » + « anime » → les deux a glissent sans changer de couleur (le a d'« anime » passe sous celui de « Data »)
→ métamorphose a → A en blanc (2,40–2,80 s) → le A jaunit (blanc → jaune vif, 2,90–3,30 s) → pivot en ▶ (3,35–4,15 s). 4,2 s puis tenue.
Fichiers : `anim/logo-anim-minuscules-final-dark.svg`, `anim/logo-anim-minuscules-final-1920x1080-sombre.mp4` (5,8 s), `anim/logo-anim-minuscules-final-800-sombre.gif`.
