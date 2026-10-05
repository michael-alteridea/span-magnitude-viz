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
    geometry: "arc",       // "arc" | "bar"
    width: 960,
    height: 540,
    animate: true,
    autoplay: true,
    theme: "dark",
    tickers: true,
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
| `geometry` | `"arc"` | Arcs Bézier ou barres |
| `animate` / `autoplay` | `true` | Cascade de révélation |
| `slowFirst` | `2` | Premières marques lentes + labels |
| `durationMs` | adaptatif | Durée totale de l’animation |
| `tickers` | `true` | Compteur + somme des magnitudes |
| `theme` | `"dark"` | `"dark"` \| `"light"` |
| `cohortFilter` | `null` | Filtrer une cohorte |
| `mirrorSplit` | `false` | Cohorte A au-dessus de l’axe, reste en dessous |
| `mirrorCohort` | — | Cohorte placée au-dessus en mode miroir |

---

## Géométries

- **`arc`** (défaut) — courbes de Bézier sur une baseline ; épaisseur ∝ magnitude ; léger jitter vertical pour étaler les arcs.
- **`bar`** — barres horizontales `x0→x1`, hauteur ∝ magnitude.

Le mode `lane` (packing) est réservé à une version ultérieure.

---

## Démo

La démo Vite (`npm run demo`) propose :

1. **Projets** (~64 marques) — budget × durée  
2. **Contrats / subventions** (~48 marques) — ACV × terme  

Contrôles : bascule arc/barre, filtre cohorte, miroir A↑/reste↓, lecture/pause/rejeu, éditeur JSON + bouton « Tester JSON invalide ».

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

## Inspiration & licence

Design inspiration: Periscopic’s public *U.S. Gun Deaths* visualization (individual-mark temporal storytelling). This library does **not** reuse Periscopic assets, branding, copy, or the flame/ash / “stolen years” metaphor.

MIT © span-magnitude-viz contributors
