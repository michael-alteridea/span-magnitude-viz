# span-magnitude-viz

> Bibliothèque TypeScript pour raconter des histoires **span × magnitude** : chaque marque encode un intervalle sur un axe continu et une mesure quantitative, avec révélation animée et totaux cumulés.

Inspired by the *individual-mark temporal storytelling* grammar popularized by Periscopic’s public U.S. Gun Deaths piece — **without** copying branding, copy, palette, domain, or proprietary assets. Domain-agnostic: projects, contracts, grants, careers, subscriptions, hospitalizations, …

---

## Installation

```bash
npm install span-magnitude-viz
# peer-friendly: d3 and zod are bundled as dependencies
```

Démo locale :

```bash
cd span-magnitude-viz
npm install
npm run demo          # → http://localhost:5173
# ou
npm run dev
npm run build         # compile la lib (ESM + CJS + .d.ts)
```

---

## Format de données (contrat §4)

Document JSON minimal :

```json
{
  "version": 1,
  "unit": "date",
  "title": "Mon portfolio",
  "magnitudeLabel": "Budget (USD)",
  "spanLabel": "Calendrier",
  "countLabel": "Projets",
  "marks": [
    {
      "id": "p1",
      "label": "Mobile App v1",
      "span": { "start": "2020-01-15", "end": "2020-09-30" },
      "magnitude": 250000,
      "cohort": "2020",
      "group": "Product",
      "meta": { "owner": "Ada" }
    }
  ]
}
```

| Champ | Requis | Description |
|-------|--------|-------------|
| `version` | oui | Doit être `1` |
| `unit` | oui | `"date"` (ISO) ou `"number"` |
| `marks` | oui | Au moins 1 marque |
| `marks[].id` | oui | Unique |
| `marks[].span.start` / `end` | oui | Même type que `unit` ; `end ≥ start` |
| `marks[].magnitude` | oui | Nombre fini `≥ 0` |
| `revealAt` | non | Instant de révélation (défaut = `span.start`) |
| `cohort` / `group` / `label` / `meta` | non | Filtre, couleur, tooltip |

Schéma JSON Schema : [`schema/v1.json`](./schema/v1.json)  
Exemples : [`examples/minimal-date.json`](./examples/minimal-date.json), [`examples/minimal-number.json`](./examples/minimal-number.json)

---

## API

### `createSpanMagnitudeViz(container, document, options?)`

```ts
import { createSpanMagnitudeViz, parseDocument } from "span-magnitude-viz";

const doc = parseDocument(await fetch("/data/projects.json").then((r) => r.json()));

const chart = createSpanMagnitudeViz(
  document.getElementById("app")!,
  doc,
  {
    geometry: "arc",       // "arc" | "bar" | "point"
    persistence: "keep",  // "keep" | "ephemeral" | "finale"
    width: 960,
    height: 540,
    animate: true,
    autoplay: true,
    theme: "dark",
    tickers: true,
    colorScheme: "altairady", // Alteridea crimson (default)
    colorBy: "group",         // or "cohort" | "magnitude" | "span" | "meta.<key>"
    cascadeSpeed: "normal",   // "slow" | "normal" | "fast"
    morphDurationMs: 550,     // arc ↔ bar crossfade
    cohortFilter: null,
    mirrorSplit: false,
    mirrorCohort: "2021",
    onHover: (mark) => console.log(mark?.label),
  }
);

chart.play();
chart.pause();
chart.reset();
chart.setGeometry("bar");
chart.setGeometry("point");
chart.setPersistence("finale");
chart.setFilter({ cohort: "2021" });
chart.setFilter({ mirrorSplit: true, mirrorCohort: "2021" });
chart.setProgress(0.5);
chart.destroy();
```

Alias : `mount(...)` (même signature).

### `parseDocument(json)` / `tryParseDocument(json)`

Valide le contrat §4 (Zod) et normalise les dates en ms UTC.  
En cas d’échec, `parseDocument` lève `ParseError` avec `issues: string[]` ; `tryParseDocument` renvoie `{ ok: false, error }`.

```ts
import { tryParseDocument } from "span-magnitude-viz";

const result = tryParseDocument(raw);
if (!result.ok) {
  console.error(result.error.issues);
} else {
  createSpanMagnitudeViz(el, result.data);
}
```

### Options principales

| Option | Défaut | Rôle |
|--------|--------|------|
| `geometry` | `"arc"` | `arc` / `bar` / `point`; **map** view (`viewMode: "map"`, `mapRegion` FR+BE / Europe, `mapLevel`) for SVG dots + finale choropleth (lane → bar) |
| `persistence` | `"keep"` | `keep` (rester), `ephemeral` (fondu), `finale` (nuage en fin) |
| `pointStyle` | `"radius"` | `radius` (taille ∝ magnitude) ou `stroke` (rayon fixe + trait ∝ magnitude) |
| `animate` / `autoplay` | `true` | Cascade de révélation |
| `slowFirst` | `2` | Premières marques lentes + labels |
| `durationMs` | adaptatif | Durée totale de l’animation |
| `tickers` | `true` | Compteur + somme des magnitudes |
| `theme` | `"dark"` | `"dark"` \| `"light"` |
| `cohortFilter` | `null` | Filtrer une cohorte |
| `mirrorSplit` | `false` | Cohorte A au-dessus de l’axe, reste en dessous |
| `mirrorCohort` | — | Cohorte placée au-dessus en mode miroir |
| `facetBy` | auto | Axe de déclinaison du bandeau (`"year"` \| `"cohort"` \| `"group"` \| `"meta.*"`) |
| `facetSummary` / `yearSummary` | `true` | Bandeau synthèse (moyennes + mini-arcs) ; `yearSummary` reste un alias |
| `colorScheme` | `"altairady"` | `"altairady"` / Alteridea crimsons, `"warm"`, `"observable10"`, `"coldhot"`, `"muted"` |
| `colorBy` | `"group"` | `"group"` \| `"cohort"` \| `"magnitude"` \| `"span"` \| `"meta.<key>"` — continuous → cold→hot |
| `slowOpen` / `cascadeSpeed` | `0.28` / `"normal"` | Film reveal rhythm |
| `morphDurationMs` | `550` | Crossfade arc ↔ bar ↔ point on `setGeometry` |
| `entrance` | `true` | Subtle scale/opacity entrance (respects prefers-reduced-motion) |

---


## Synthèse par axe / Facet summary

Sous le graphique, un bandeau **`smv-facet-summary`** (activé par défaut ; `facetSummary: false` ou `yearSummary: false` pour le couper) liste **une ligne par valeur** de l’axe choisi :

- moyennes numériques de **span** (`spanLabel`) et de **magnitude** (`magnitudeLabel`) ;
- **trois mini-arcs** (Q1, médiane, Q3) : largeur ∝ span, épaisseur ∝ magnitude — même encodage que le viz principal.

**Décliner par / Break down by** — menu dans le bandeau (et option `facetBy`) :

| Axe | Rôle |
|-----|------|
| `year` | Années civiles chevauchées (`unit: "date"`) ou bucket entier (`unit: "number"`) — logique historique de `yearSummary` |
| `cohort` | Champ `cohort` de chaque marque |
| `group` | Champ `group` |
| `meta.<key>` | Champs `meta` découverts automatiquement quand les valeurs sont des primitifs homogènes (`string` / `number` / `boolean`) |

Défaut : `year` si `unit === "date"`, sinon `cohort` ou `group` s’ils sont utiles. Les jeux de démo (projets, contrats, stress 500) exposent déjà `group` et des `meta` (`status`, `owner`, `vendor`, `renewal`, …) pour exercer le sélecteur.

Below the chart, a **facet summary strip** (on by default; set `facetSummary`/`yearSummary: false` to hide) shows one row per value of the chosen axis, with span/magnitude averages and quartile mini-arcs. Use the in-strip **Break down by** dropdown or `options.facetBy`. Built-ins: `year`, `cohort`, `group`; plus discovered `meta.*` keys with consistent primitive values.

---

## Géométries

- **`arc`** (défaut) — courbes de Bézier sur une baseline ; épaisseur ∝ magnitude ; léger jitter vertical pour étaler les arcs.
- **`bar`** — barres horizontales `x0→x1`, hauteur ∝ magnitude.
- **`point`** — points au milieu du span, rayon (ou trait) ∝ magnitude ; labels au hover / révélation lente. Ordre de révélation film inchangé.

Le mode `lane` (packing) est réservé à une version ultérieure.

### Persistance (film)

- **`keep`** (défaut) — les marques restent après révélation.
- **`ephemeral`** — fondu après la fenêtre de révélation de chaque marque.
- **`finale`** — comme ephemeral pendant le film, puis toutes les marques réapparaissent en nuage à la fin (~92 % du timeline).

### Carte (`viewMode: "map"`)

| Option | Valeurs | Défaut | Rôle |
|---|---|---|---|
| `mapRegion` | `"fr-be"` / `"europe"` | `"fr-be"` | Fond FR (départements) + BE (provinces), ou Europe |
| `mapLevel` | `"country"` / `"nuts1"` / `"nuts2"` / `"nuts3"` | `"nuts2"` | Europe : maille du fond + choroplèthe |
| `mapFit` | `"region"` / `"data"` | `"region"` | Europe entière, ou zoom sur les régions contenant des points |

- Points : `meta.lat` + `meta.lon` partout ; codes postaux **FR/BE** seulement (lookup hors-ligne existant). En Europe, chaque point est rattaché à sa région par point-in-polygon (`d3.geoContains`), avec repli sur la couche pays (Royaume-Uni, Ukraine… hors NUTS 2024) puis sur la région la plus proche (< 60 km).
- Projection Europe : `geoAzimuthalEqualArea` centrée 10°E 52°N. Changement à chaud : `viz.setMap({ region, level, fit })`.
- Données : Natural Earth 1:50m (domaine public) + Eurostat GISCO NUTS 2024 1:10M — **© EuroGeographics pour les limites administratives** (mention affichée sous la carte ; usage **non commercial** sans licence EuroGeographics). Détails : `src/geo/europe/SOURCES.md`. Régénérer : `npm run build:geo`.
- Cartons SVG statiques (Europe pays / NUTS 2, France régions / départements, Belgique régions / provinces) : `docs/maps/*.svg`, aperçus `docs/maps/previews/*.png` — `npm run build:maps`.

---

## Démo

La démo Vite (`npm run demo`) propose :

1. **Projets** (~64 marques) — budget × durée  
2. **Contrats / subventions** (~48 marques) — ACV × terme  

Contrôles : bascule arc/barre/point (morph), persistance keep/ephemeral/finale, **colorBy** / palette Alteridea, cascade film, filtre cohorte, miroir, lecture/pause/rejeu, **chargement JSON/CSV/XLSX** + mapping colonnes, éditeur JSON.
Le bandeau de synthèse propose **Décliner par / Break down by** (année, cohorte, groupe, meta.*).

---

## Structure du dépôt

```
span-magnitude-viz/
├── DESIGN.md
├── README.md
├── schema/v1.json
├── src/
│   ├── index.ts          # createSpanMagnitudeViz, exports
│   ├── types.ts
│   ├── parse.ts          # validation Zod
│   ├── layout.ts         # échelles + chemins arc/barre
│   ├── animate.ts        # timeline + rAF
│   ├── tickers.ts
│   ├── facetSummary.ts   # facet / breakdown averages + quartile mini-arcs
│   ├── yearSummary.ts    # compatibility re-exports
│   └── render/svg.ts     # renderer SVG
├── demo/
│   ├── index.html
│   ├── main.ts
│   └── data/{projects,contracts}.json
└── examples/
    ├── minimal-date.json
    └── minimal-number.json
```

---


## Alteridea palette

Default mark colors use the **Alteridea brand crimson** from [alteridea.com](https://alteridea.com) (`--red: #d62839`, hover `#e9374a`, soft `rgba(214,40,57,.14)`). Continuous `colorBy` fields use a **cold→hot** gradient (blue → green → yellow → red ending at `#d62839`). UI accents (tickers, tooltips, facet strip) match the brand on a near-black dark theme (`#0b0b0c`).

`setColorBy` / `setColorScheme` update colors without remounting. Geometry swaps morph via opacity crossfade (~550ms).

## Import fichier (démo / standalone)

La démo et `standalone.html` acceptent **JSON**, **CSV** et **Excel (.xlsx)** (SheetJS). Après chargement tabulaire, mappez les colonnes : start / end (ou duration) / magnitude / color / group. Helpers exportés : `parseCsv`, `guessMapping`, `rowsToDocument`.

Rebuild offline : `npm run build:standalone` → `demo/standalone-offline.html`.

## Inspiration & licence

Design inspiration: Periscopic’s public *U.S. Gun Deaths* visualization (individual-mark temporal storytelling). This library does **not** reuse Periscopic assets, branding, copy, or the flame/ash / “stolen years” metaphor.

MIT © span-magnitude-viz contributors
