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

## Mot-symbole (8 oct. 2026)

« Dat » neutre + « a » orange plein + « nime » pétrole, sans ▶, à toutes les tailles (fichiers de marque p0) :
`datanime-wordmark-light.svg` / `datanime-wordmark-dark.svg` (texte seul, chemins vectorisés), `wordmark.ts`
(chemins, couleurs, PNG 96 px pour PowerPoint) ; lockups `datanime-lockup*.svg` = icône + mot-symbole.
Utilisé dans l'en-tête du Studio, l'espace Revues, la page de vérification, le compte rendu, le cartouche
(aperçu, exports, film, mode lecture, images publiées) et les PowerPoint. Nom accessible : « Datanime ».
L'icône carrée et le favicon ne changent pas.

## Logo C15 « DatAnime » (10 oct. 2026) — remplace le mot-symbole et l'icône ci-dessus

Choisi par Michaël le 10 oct. 2026 : Inter Bold, « Dat » encre / blanc, **A capitale droite jaune dont l'œil est un ▶**
(pointe vers la droite), « nime » pétrole. **Jaune or `#E3A600` sur fonds clairs, jaune vif `#FFD000` sur fonds sombres.**
Sources : `docs/logo/a-majuscule/variantes/C15-*` (branche `wip/logo-a-majuscule`).

- `wordmark.ts`, `datanime-wordmark-{light,dark}.svg` : mot-symbole C15 (chemins vectorisés, œil évidé `fill-rule="evenodd"`),
  même échelle verticale que l'ancien (viewBox `205 37.5 491.5 86`), PNG 96 px pour PowerPoint.
- `tell4d-h1-icon.svg` (+ PNG 512/64/32/24, `icon-png.ts`), `public/favicon.svg`, `public/apple-touch-icon.png` (180 px, plein cadre) :
  icône carrée C15 (A jaune vif à œil ▶ sur pétrole profond `#08465A`). Noms de fichiers conservés (imports inchangés).
- `datanime-lockup*.svg` : icône C15 + mot-symbole C15.
- `logo-anim-{light,dark}.svg` : animation CSS seule (4,2 s, `prefers-reduced-motion` → image finale fixe), via
  `logoAnimMarkup()` (classes, keyframes et masques préfixés). Jouée en introduction du Film et du mode lecture (toucher
  pour passer) et sur la carte de fin du Reel (figée image par image : `seek` = instant t, rendu déterministe).
