# Licence des fonds de carte (Tell4D Studio)

*Note du 8 oct. 2026 — état des lieux et options pour un usage commercial. Les données de carte ne sont **pas** modifiées par cette note.*

## 1. Couches actuelles, source et licence

| Couche (Studio) | Fichier | Source | Licence | Usage commercial |
| --- | --- | --- | --- | --- |
| Europe — **Pays** (maille « Pays », fond de contexte) | `src/geo/europe/countries.topo.json` | Natural Earth 1:50m *Admin 0 – Countries* | Domaine public | ✅ Oui, sans condition |
| Europe — **NUTS 1, 2, 3** | `src/geo/europe/nuts{1,2,3}.topo.json` | Eurostat GISCO, NUTS 2024 1:10M | Conditions GISCO : usage **non commercial**, mention « © EuroGeographics pour les limites administratives » | ❌ Non sans licence EuroGeographics |
| **France départements** + **Belgique provinces / Bruxelles** (fond « France · Belgique », mini-cartes) | `src/geo/frBeRegions.json` | Origine non documentée dans le dépôt ; les noms belges (« Prov. Antwerpen », « Région de Bruxelles-Capitale/ Brussels Hoofdstedelijk Gewest ») sont ceux de **GISCO NUTS 2** → à traiter comme GISCO | Idem GISCO (par prudence) | ❌ À considérer comme non commercial |
| Cartons SVG statiques France régions / départements, Belgique régions / provinces, Europe NUTS 2 (`docs/maps/`) | `docs/maps/*.svg` | GISCO NUTS 2024 1:1M (+ Natural Earth) | Idem GISCO | ❌ Non |
| Codes postaux → centroïdes (FR/BE) | `src/geo/postalLookup.ts`, `regionCentroids.json` | Centroïdes dérivés des polygones ci-dessus | Suit la couche d'origine | ⚠️ Idem |

Le Studio n'a pas de couche « NUTS 0 » distincte : la maille « Pays » utilise Natural Earth.

**Conditions GISCO** (page « Administrative units » / « NUTS ») : droit non exclusif et non transférable,
*« the data will not be used for commercial purposes »*, mention obligatoire dans la légende de la carte ;
*« If you intend to use the data commercially, please contact EuroGeographics »*.
- https://ec.europa.eu/eurostat/web/gisco/geodata/administrative-units
- https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/territorial-units-statistics
- Détail technique du dépôt : `src/geo/europe/SOURCES.md`

**Ce qui est affiché aujourd'hui** : la bibliothèque écrit « © EuroGeographics pour les limites administratives
(Eurostat GISCO NUTS 2024) · Natural Earth » sous la carte Europe ; depuis le 8 oct. 2026, le **cartouche Tell4D**
de toute carte ajoute « Fond : © EuroGeographics, Natural Earth » et « Limites GISCO : usage non commercial »
(ou « Fond : Natural Earth (domaine public) » pour la maille Europe « Pays »), voir `mapSourceLines()` dans
`studio/src/charts/cartouche.ts`.

## 2. Sources ouvertes compatibles avec un usage commercial

| Source | Couvre | Licence | Lien |
| --- | --- | --- | --- |
| **Natural Earth** 1:10m *Admin 1 – States, Provinces* | départements français, provinces belges (régions FR / BE par fusion) ; pays du monde | Domaine public | https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/ — https://www.naturalearthdata.com/about/terms-of-use/ |
| **IGN ADMIN EXPRESS** (COG CARTO) | régions, départements, communes FR (métropole + DROM) | Licence Ouverte Etalab 2.0 : réutilisation commerciale libre, mention « IGN — ADMIN EXPRESS, date de mise à jour » | https://geoservices.ign.fr/adminexpress — https://www.data.gouv.fr/datasets/admin-express-admin-express-cog-admin-express-cog-carto-admin-express-cog-carto-pe-admin-express-cog-carto-plus-pe |
| Etalab « Contours administratifs » (fichiers 1000 m / 100 m prêts à l'emploi, utilisés par geo.api.gouv.fr) | régions, départements, communes FR | **ODbL** (intègre OpenStreetMap) : commercial permis, mais attribution et partage à l'identique de la *base* dérivée | https://www.data.gouv.fr/datasets/contours-administratifs — https://geo.api.gouv.fr/decoupage-administratif |
| **NGI / IGN Belgique — AdminVector** (Territorial Divisions) | régions, provinces (+ objet fictif Bruxelles-Capitale), arrondissements, communes BE | CC BY 4.0 : commercial permis, créditer « NGI-IGN » + lien licence | https://publish.geo.be/geonetwork/srv/api/records/fb1e2993-2020-428c-9188-eb5f75e284b9 — https://ngi.be/fr/politique-douverture-et-de-reutilisation-des-donnees-geographiques-de-lign/ |
| Statbel — secteurs statistiques | BE (maille infra-communale ; régions / provinces par fusion) | CC BY 4.0 | https://statbel.fgov.be/fr/open-data/secteurs-statistiques-2026 |
| **EuroGeographics EuroGlobalMap / EuroRegionalMap** (Open Maps for Europe) | unités administratives de toute l'Europe (1:1M / 1:250k) | EuroGeographics Open Data Licence : commercial permis avec attribution « © EuroGeographics 2026 » | https://www.mapsforeurope.org/licence |

À noter : EuroGlobalMap / EuroRegionalMap décrivent des **unités administratives**, pas exactement la nomenclature
**NUTS** (les NUTS 2 / 3 coïncident souvent avec des régions / provinces / départements mais pas partout) ; une table de
correspondance serait nécessaire.

## 3. Options

**(a) Licence commerciale EuroGeographics.** Les limites GISCO dérivent d'EuroBoundaryMap ; EuroGeographics publie
une grille tarifaire EuroBoundaryMap (couverture européenne : 6 600 € « small », 19 800 € « medium »,
39 600 € « large », 59 400 € « unlimited » ; couverture régionale : 3 300 € à 29 700 €). Le cas d'une diffusion
de NUTS généralisés GISCO dans un SaaS n'est pas tarifé publiquement : à demander.
Contact : contact@eurogeographics.org / oliwia.marszalek@eurogeographics.org (Membership and Data Officer),
+32 2 888 71 93 — https://eurogeographics.org/activities/licensing/

**(b) Remplacer les couches FR / BE par des sources ouvertes** : départements / régions FR depuis IGN ADMIN EXPRESS
COG CARTO (Licence Ouverte) ou Natural Earth admin-1 (domaine public), provinces / régions BE depuis NGI AdminVector
(CC BY 4.0) ; pour l'Europe, EuroGlobalMap (licence ouverte EuroGeographics, commerciale) ou Natural Earth admin-1.
Mêmes identifiants (codes INSEE, codes NUTS / NIS) à conserver pour ne rien casser côté géocodage postal ; mentions
à afficher : « IGN — ADMIN EXPRESS », « NGI-IGN, CC BY 4.0 », « © EuroGeographics 2026 ».

**(c) Garder NUTS seulement dans l'offre gratuite / non commerciale** : l'offre gratuite garde les fonds GISCO
(avec la mention) ; les offres payantes basculent sur les couches de (b), ou masquent les mailles NUTS 1–3.

**Recommandation** : (b) pour France · Belgique dès maintenant (sources officielles, gratuites, commerciales,
même précision ou meilleure), (c) pour les mailles NUTS Europe tant que l'option EuroGlobalMap n'est pas
validée ; (a) seulement si un client exige la nomenclature NUTS exacte sur toute l'Europe.

*Cette note n'est pas un avis juridique ; vérifier les conditions en vigueur au moment de la mise en production.*
