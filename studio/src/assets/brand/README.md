# Datanime — logo « Bulle à contour, barres colorées » (variante « Contour moyen »)

© Alteridea — tous droits réservés. Ces fichiers constituent l'identité de **Datanime** (moteur Reporting 4D) ;
ils ne sont pas couverts par la licence MIT du code et ne doivent pas être réutilisés hors des produits Alteridea.

Carré bleu pétrole aux coins arrondis ; grande bulle blanche presque pleine page, cernée d'un contour pétrole ;
quatre barres croissantes rouge → orange → lime → cyan avec leur traîne ; frise temporelle ; « DA » agrandi (anciennement « 4D »).
Tous les textes (« DA », « Datanime ») sont vectorisés (chemins) : rendu identique sans aucune police installée.

| Fichier | Usage |
|---|---|
| `tell4d-h1-icon.svg` | Icône 512×512 (source unique : en-tête, cartouche SVG inline, favicon) |
| `datanime-lockup.svg` | Logo + nom « Datanime », fonds clairs |
| `datanime-lockup-dark.svg` | Logo + nom « Datanime », fonds sombres |
| `tell4d-h1-icon-{512,64,32,24}.png` | Rendus PNG |
| `icon-png.ts` | Le PNG 64 px en data URL : logo 2× de l'export PowerPoint |

Palette : fond bleu pétrole (pétrole, pétrole clair, pétrole profond) ; barres rouge corail, orange, lime, cyan.
Généré par `build_contour.py` → `make(36, 92)` (cairosvg), choisi le 8 oct. 2026 (les noms de fichiers `h1` sont
conservés pour ne pas changer les imports). `studio/public/favicon.svg` (= l'icône) et `studio/public/apple-touch-icon.png`
(180 px, fond plein cadre sans coins arrondis, iOS les ajoute) en dérivent.

Renommage du 8 oct. 2026 : Tell4D devient **Datanime**. Icône, PNG, favicon, apple-touch-icon, `icon-png.ts` et lockups
sont produits par `build_datanime.py` (même icône, « DA » à la place de « 4D », même position, taille et graisse ;
nom « Data » + « nime » vectorisé en Inter 700). Les fichiers techniques `tell4d-h1-icon*` gardent leur nom.
