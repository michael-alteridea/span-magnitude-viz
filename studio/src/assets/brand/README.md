# Tell4D — logo « Bulle à contour, barres colorées » (variante « Contour moyen »)

© Alteridea — tous droits réservés. Ces fichiers constituent l'identité de **Tell4D** (moteur Reporting 4D) ;
ils ne sont pas couverts par la licence MIT du code et ne doivent pas être réutilisés hors des produits Alteridea.

Carré bleu pétrole aux coins arrondis ; grande bulle blanche presque pleine page, cernée d'un contour pétrole ;
quatre barres croissantes rouge → orange → lime → cyan avec leur traîne ; frise temporelle ; « 4D » agrandi.
Tous les textes (« 4D », « Tell4D ») sont vectorisés (chemins) : rendu identique sans aucune police installée.

| Fichier | Usage |
|---|---|
| `tell4d-h1-icon.svg` | Icône 512×512 (source unique : en-tête, cartouche SVG inline, favicon) |
| `tell4d-h1-lockup.svg` | Logo + nom, fonds clairs |
| `tell4d-h1-lockup-dark.svg` | Logo + nom, fonds sombres |
| `tell4d-h1-icon-{512,64,32,24}.png` | Rendus PNG |
| `icon-png.ts` | Le PNG 64 px en data URL : logo 2× de l'export PowerPoint |

Palette : fond bleu pétrole (pétrole, pétrole clair, pétrole profond) ; barres rouge corail, orange, lime, cyan.
Généré par `build_contour.py` → `make(36, 92)` (cairosvg), choisi le 8 oct. 2026 (les noms de fichiers `h1` sont
conservés pour ne pas changer les imports). `studio/public/favicon.svg` (= l'icône) et `studio/public/apple-touch-icon.png`
(180 px, fond plein cadre sans coins arrondis, iOS les ajoute) en dérivent.
