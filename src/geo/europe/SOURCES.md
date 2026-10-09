# Fonds de carte embarqués — sources et construction

Construits par `scripts/build-geo.mjs` (mapshaper) — sauf le fond Monde : `scripts/build-geo-world.mjs` (hors ligne, depuis le pack `datanime-maps`) ; téléchargements mis en cache dans `./geo-raw/` (ignoré par git).
Paramètres de la dernière construction : `build-info.json`. Synthèse des licences : `studio/docs/licence-cartes.md`.

| Fichier | Contenu | Entités | Source | Licence |
| --- | --- | --- | --- | --- |
| `europe/countries.topo.json` (objet `countries`) | pays d'Europe et de contexte (Afrique du Nord, Proche-Orient), propriétés `id` (ISO alpha-2), `name`, `nameFr`, `continent` | 93 | Natural Earth 1:50m admin-0, pack « Monde » Datanime (Crimée → Ukraine) | domaine public |
| `world/countries.topo.json` (objet `countries`) | monde entier sauf Antarctique (fond « Monde (pays) »), mêmes propriétés que l'Europe : `id` (ISO alpha-2, majuscules), `name`, `nameFr`, `continent` | 236 (dont 53 en Afrique) | Natural Earth 1:110m admin-0 v5.1.1, pack « Monde » Datanime (`world-countries-110m.topojson` : 62 petites entités reprises du 50m ; Crimée → Ukraine, Chypre du Nord → CY, Somaliland → SO) | domaine public |
| `frBe/regions.topo.json` (objet `regions`) | 13 régions FR + 3 régions BE, propriétés `id` (clé interne « FR1 »…, « BE1 »…), `name`, `cntr`, `code` (INSEE / NIS) | 16 | IGN ADMIN EXPRESS COG CARTO PE 2026 ; NGI-IGN AdminVector | Licence Ouverte 2.0 ; CC BY 4.0 |
| `frBeRegions.json` (GeoJSON) | 96 départements FR (métropole) + 10 provinces BE + Bruxelles-Capitale, propriétés `id`, `country`, `code`, `name`, `lat`, `lon` | 107 | idem | idem |
| `regionCentroids.json` | centroïdes de `frBeRegions.json` (géocodage par code postal) | 107 | calculé | idem |

## Traitements

| Étape | Pays | Régions / départements / provinces |
| --- | --- | --- |
| Filtre | sans Groenland ni Antarctique | métropole (codes INSEE 97x exclus) |
| Découpe | cadre de contexte lon −40…95, lat 22…80 ; îles lointaines effacées (Canaries, Madère, Açores, Jan Mayen) | — |
| Simplification | `-simplify weighted keep-shapes` 14 % | régions FR 4 %, régions BE 8 %, départements 1,2 %, provinces 2,5 % |
| Sortie | TopoJSON, quantification 20 000 | TopoJSON 20 000 / GeoJSON 0,001° |

Monde : pas de découpe ni de simplification supplémentaire (le 1:110m l'est déjà), Antarctique exclu, quantification 100 000 (~130 Ko) ;
1:110m plutôt que 1:50m (~0,9 Mo) pour le poids du bundle ; projection Equal Earth (`d3.geoEqualEarth`), barre d'échelle mesurée à l'équateur.

Anneaux dans le sens horaire (convention sphérique d3) ; le script vérifie qu'aucune entité ne dépasse un hémisphère
et la bibliothèque ré-oriente à la volée toute entité mal orientée.
