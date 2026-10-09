# Licence des fonds de carte (Datanime Studio)

*Mise à jour du 8 oct. 2026 : toutes les couches embarquées proviennent de sources ouvertes réutilisables, y compris
dans un produit commercial. Aucune couche sous licence restrictive n'est plus livrée.*

## 1. Couches embarquées

| Couche (Studio) | Fichier | Source | Licence | Mention |
| --- | --- | --- | --- | --- |
| Europe — **pays** (carte Europe, pays voisins de la carte des régions) | `src/geo/europe/countries.topo.json` | Natural Earth 1:50m *Admin 0 – Countries* (pack « Monde » Datanime : Crimée rattachée à l'Ukraine) | Domaine public | « Natural Earth » (facultative) |
| Monde — **pays** (fond « Monde (pays) », 236 entités, Antarctique exclu) | `src/geo/world/countries.topo.json` | Natural Earth 1:110m *Admin 0 – Countries* v5.1.1 (pack « Monde » Datanime : Crimée rattachée à l'Ukraine) | Domaine public | « Natural Earth » (facultative) |
| Burundi — **provinces** (fond « Burundi (provinces) », 18 provinces d'**avant la réforme de 2025**, dont 10 mises en avant) | `src/geo/burundi/provinces.topo.json` | geoBoundaries gbOpen BDI ADM1 (`BDI-ADM1-87207978`, source « geoBoundaries, Wikimedia », année représentée 2014 selon les métadonnées mais Rumonge — créée en 2015 — incluse ; build geoBoundaries du 12 déc. 2023) | CC0 1.0 (domaine public) | « geoBoundaries » (facultative, affichée) |
| **France départements** (96, métropole) | `src/geo/frBeRegions.json` | IGN — ADMIN EXPRESS COG CARTO PE, édition 2026 | Licence Ouverte Etalab 2.0 | « IGN — ADMIN EXPRESS » |
| **Belgique provinces** (10 + Bruxelles-Capitale) | `src/geo/frBeRegions.json` | NGI-IGN — AdminVector (Territorial Divisions), géométries AGDP / Statbel | CC BY 4.0 | « NGI-IGN » + lien de licence |
| **Régions France (13) · Belgique (3)** (« Répartir dans l'espace ») | `src/geo/frBe/regions.topo.json` | IGN ADMIN EXPRESS (régions) ; NGI-IGN AdminVector (régions) | Licence Ouverte · CC BY 4.0 | idem |
| Centroïdes (géocodage par code postal) | `src/geo/regionCentroids.json` | calculés sur les deux couches ci-dessus | idem | idem |

Les identifiants internes (« FR-75 », « BE-BE21 », « FR1 », « BE3 ») sont des clés de jointure historiques, conservées
pour ne pas casser les configurations ni le géocodage ; les codes officiels (INSEE, NIS) sont dans la propriété `code`.

Les anciennes mailles « nuts1 / nuts2 / nuts3 » d'une configuration enregistrée sont acceptées et affichées en maille
**pays** ; le Studio ne propose plus de maille infranationale à l'échelle de l'Europe.

## 2. Ce qui est affiché

- **Cartouche** de toute carte (aperçu, exports SVG / PNG / vidéo / PowerPoint, film, mode lecture, images publiées) :
  - carte « France · Belgique » et carte des régions : « Fond : IGN, NGI-Statbel, Natural Earth » puis
    « Licence Ouverte · CC BY 4.0 · domaine public » ;
  - carte Europe et carte Monde : « Fond : Natural Earth (domaine public) » ;
  - carte Burundi : « Fond : geoBoundaries (CC0 1.0) » puis « Provinces d'avant la réforme de 2025 ».
  Voir `mapSourceLines()` dans `studio/src/charts/cartouche.ts`.
- **Sous la carte** (bibliothèque, `.smv-map-attribution`) : `FRBE_ATTRIBUTION_FR`, `EUROPE_ATTRIBUTION_FR`
  (`src/geo/europe.ts`), `WORLD_ATTRIBUTION_FR` (`src/geo/world.ts`) ou `BURUNDI_ATTRIBUTION_FR` (`src/geo/burundi.ts`).
- Toute carte garde sa **barre d'échelle en km** (carte Monde : mesurée le long de l'équateur, mention « à l'équateur »).

## 3. Sources et liens

| Source | Licence | Lien |
| --- | --- | --- |
| IGN ADMIN EXPRESS COG CARTO PE (FlatGeobuf WGS84, 2026-01-01) | Licence Ouverte Etalab 2.0 : réutilisation libre, y compris commerciale, avec mention de la source | https://geoservices.ign.fr/adminexpress — https://www.etalab.gouv.fr/licence-ouverte-open-licence/ |
| NGI-IGN AdminVector (Shapefile EPSG:4326) | CC BY 4.0 : réutilisation libre, y compris commerciale, avec attribution « NGI-IGN » | https://publish.geo.be/geonetwork/srv/api/records/fb1e2993-2020-428c-9188-eb5f75e284b9 — https://creativecommons.org/licenses/by/4.0/deed.fr |
| Natural Earth 1:50m et 1:110m Admin 0 | Domaine public | https://www.naturalearthdata.com/about/terms-of-use/ |
| geoBoundaries gbOpen BDI ADM1 (GeoJSON, commit `9469f09`) | CC0 1.0 Universal (licence déclarée par l'API : « CC0 1.0 Universal (CC0 1.0) Public Domain Dedication ») : réutilisation libre, y compris commerciale, sans attribution obligatoire (mention conservée par bonne pratique) | https://www.geoboundaries.org/api/current/gbOpen/BDI/ADM1/ — https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/BDI/ADM1/geoBoundaries-BDI-ADM1.geojson — https://creativecommons.org/publicdomain/zero/1.0/deed.fr |

**Burundi : millésime du découpage.** La loi organique n° 1/05 du 16 mars 2023, appliquée à l'issue des élections de
2025, a ramené les provinces de 18 à 5 (Bujumbura, Buhumuza, Burunga, Butanyerera, Gitega). Le fond embarqué représente
les **18 anciennes provinces** (celles des noms demandés : Gitega, Buja rural, Bururi, Kirundo, Karusi, Bubanza, Rumonge,
Makamba, Ngozi, Buja). Natural Earth 10m admin-1 v5.1.1 a été écarté : il ne compte que 17 provinces (pas de Rumonge).

## 4. Régénérer

`npm run build:geo` (`scripts/build-geo.mjs`, mapshaper) télécharge les sources dans `geo-raw/` (ignoré par git), lit le
pack Natural Earth (`--maps <dossier>`, par défaut `/workspace/datanime-maps`), simplifie et écrit les fichiers
ci-dessus ; paramètres dans `src/geo/europe/build-info.json` et `src/geo/europe/SOURCES.md`.
Burundi : `npm run build:geo:burundi` (`scripts/build-geo-burundi.mjs`) lit les fichiers bruts déjà téléchargés dans
`/workspace/datanime-maps/burundi/raw` (`--raw <dossier>`, hors git) ; paramètres dans `src/geo/burundi/build-info.json`.
Carte autonome de documentation : `node scripts/render-carte-burundi.mjs` → `studio/docs/shots/carte-burundi.svg` / `.png`.
