# span-magnitude-viz — Design Document

**Status:** implemented — TypeScript library + Vite demo (`npm run build` / `npm run demo`)  
**Goal:** An open-source TypeScript library for *temporal magnitude storytelling*: each datum is one mark whose **width/span** encodes a duration (or any interval on a continuous axis) and whose **height/thickness** encodes a second quantitative measure. Animation reveals marks over a third optional temporal dimension (e.g. when each event “started”), with live cumulative totals.

Inspired by Periscopic’s *U.S. Gun Deaths* visual grammar (arcs of magnitude over time), **without** copying branding, copy, palette, domain, or proprietary assets. This library is **domain-agnostic**: projects, careers, subscriptions, grants, hospitalizations, product launches — anything with a span and a magnitude.

---

## 1. Research summary: Periscopic “U.S. Gun Deaths”

### 1.1 Visual grammar (public writeups)

Sources: WIRED, Alberto Cairo (Peachpit), Andy Kirk (visualisingdata), Communication Arts, Alternative Narratives Vis Archive, live site HTML comments.

| Element | Encoding / behavior |
|--------|----------------------|
| One mark per individual | Each arc = one person |
| Arc length (x) | Lived years + projected remaining (“stolen”) years on an age axis (0–100) |
| Color split on the same path | Warm orange/yellow = lived life (“flame”); gray = projected years after death (“ash”) |
| Death cue | Dot drops from the arc apex/breakpoint to the baseline |
| Intro animation | Slow annotated first arcs → then rapid cascade of thousands |
| Cumulative tickers | Running totals of people killed + stolen years |
| Filters | Demographics, gun type, region; selected vs complement can split above/below axis |
| Alternate view | Age-distribution / histogram toggle |
| Metaphor | Life as birth → apex → diminishment → death; extinguished flame |

Emotional storytelling comes from **multiplicity of individual marks** + **animation of accumulation**, not from aggregated bars alone.

### 1.2 Confirmed original tech stack

From HTML comments and markup on https://guns.periscopic.com/ (as of research date):

```
Visualization: EaselJS / CreateJS (HTML5 canvas)
Animation:     GreenSock GSAP (TweenMax + BezierPlugin)
Curves:        Cubic Bézier paths (de Casteljau)
Time:          Moment.js
Routing/state: History.js
UI:            jQuery (legacy), custom CSS
Render surfaces: three stacked <canvas> layers
  - #stage            main arcs
  - #distributionView alternate distribution view
  - #overstage        hover / overlay
```

**Not** D3/SVG in the original. Canvas + scene-graph (CreateJS) + GSAP was chosen for performance with ~10k animated strokes.

### 1.3 Related / inspired work (patterns to borrow, not copy)

| Project | Pattern |
|---------|---------|
| Pitch Interactive *Out of Sight, Out of Mind* (drones) | Same “one mark per event, cascade over time” storytelling; D3 for data + **canvas** for dense animated dots (CreativeJS) |
| Classic D3/Observable *arc diagrams* | Network links as SVG arcs — different problem (adjacency), but useful path math |
| Observable Plot `Plot.arrow` | Declarative bent links; good for static exploratory charts, weak for staged cascade storytelling |

### 1.4 Open-source recreation takeaways

- No well-known faithful open-source clone of Periscopic’s gun-deaths viz was found; only FBI data-munging repos and design criticism.
- Recreating the *grammar* (individual interval marks + magnitude + temporal reveal + cumulative totals) is the right OSS path — not cloning copy, branding, or domain.
- **Hybrid rendering** is the proven pattern: D3 (or custom TS) for scales/layout; **SVG** for ≤~2–3k marks; **canvas** (or canvas overlay) when mark count or animation density grows.

---

## 2. Product framing (generic)

### Name

**`span-magnitude-viz`** (working package name: `@span-magnitude/viz` or `span-magnitude-viz`)

### One-sentence pitch

> Encode any two measures as **span × magnitude** marks, optionally reveal them over a third time axis, and accumulate totals — a reusable storytelling chart, not a Gantt clone and not a domain-specific “projects” tool.

### Non-goals

- Not a full BI dashboard
- Not a Gantt with dependencies/resources
- Not a network arc diagram
- Does **not** ship Periscopic branding, gun-deaths copy, flame/ash metaphor, or stolen-years language

### Demo domains (same schema, different data files)

1. **Projects** — span = duration, magnitude = budget  
2. **Subscriptions / contracts** — span = term, magnitude = ACV  
3. **Research grants** — span = award period, magnitude = award amount  

---

## 3. Encoding mapping table

| Visual channel | Data field(s) | Role | Notes |
|----------------|---------------|------|-------|
| **Mark identity** | `id` | One mark per record | Required |
| **Span start (x0)** | `span.start` | Left endpoint of interval | Required; continuous scale |
| **Span end (x1)** | `span.end` | Right endpoint | Required; `end ≥ start` |
| **Span length** | derived `end − start` | Width of bar / chord of arc | Primary “how long” story |
| **Magnitude** | `magnitude` | Height, stroke thickness, or fill intensity | Required; ≥ 0 |
| **Reveal time** | `revealAt` (optional) | When the mark enters the animation | Defaults to `span.start` |
| **Cohort / facet** | `cohort` (optional) | Small-multiples or filter (e.g. start year) | String or number |
| **Group / color** | `group` (optional) | Categorical color | |
| **Label** | `label` (optional) | Tooltip / annotation title | |
| **Metadata** | `meta` (optional) | Arbitrary JSON for tooltips | Passthrough |
| **Cumulative count** | derived | Ticker: number of revealed marks | |
| **Cumulative magnitude** | derived | Ticker: sum of `magnitude` of revealed marks | Optional second ticker: sum of span lengths |

### Geometry modes (pluggable)

| Mode | Span → | Magnitude → | Best for |
|------|--------|-------------|----------|
| `arc` | Chord length on baseline; Bézier/elliptical bulge | Stroke width (and/or opacity) | Emotional “life/path” storytelling (Periscopic-like) |
| `bar` | Horizontal bar from x0→x1 | Bar height | Analytic clarity, YoY comparison |
| `point` | Dot at span midpoint (x); vertical jitter scatter | Radius or stroke ∝ magnitude | Dense event scatters; prep for geo map |
| `lane` | Bar in a packed lane (y = packed row) | Stroke/fill thickness or lane height | Dense portfolios without overlap |

**Default for v1 demo:** `arc` + optional `bar` / `point` toggle. Lane packing is v1.1.

**Persistence modes** (runtime option, not schema): `keep` (default) · `ephemeral` (fade after reveal) · `finale` (ephemeral during film, then all reappear as a scatter).

**Map view (`viewMode: "map"`):** France départements + Belgium provinces SVG basemap (IGN ADMIN EXPRESS, NGI-IGN AdminVector) (D3 `geoMercator`). Marks project from `meta.lat`/`meta.lon` or FR/BE `meta.postal` via offline lookup (city overrides → département/province centroids). Same film reveal schedule; optional Alteridea-red choropleth + soft heatmap at finale. Mapping UI columns: Latitude, Longitude, Code postal.

### Axis model

```
x-axis:  continuous domain over span units (dates or numbers)
y-axis:  (arc) shared baseline with vertical bulge; (bar) magnitude scale
         OR packed lanes (lane mode); (point) jittered scatter around baseline
color:   ordinal on `group`
```

Units are **not** hard-coded to years. The schema uses either ISO datetimes **or** numeric `start`/`end`; the library normalizes via a `unit` hint (`"date"` | `"number"`).

---

## 4. Minimal data schema (JSON) — primary deliverable

This is the contract that activates the visualization. Invalid/missing required fields → clear validation errors, no silent coercion of bad ranges.

### 4.1 Top-level document

```json
{
  "$schema": "https://span-magnitude.dev/schema/v1.json",
  "version": 1,
  "title": "Portfolio 2019–2024",
  "description": "Optional human-readable blurb for the demo chrome.",
  "unit": "date",
  "magnitudeLabel": "Budget (USD)",
  "spanLabel": "Duration",
  "countLabel": "Projects",
  "marks": [ ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `1` | yes | Schema version |
| `unit` | `"date"` \| `"number"` | yes | How `span.start` / `span.end` / `revealAt` are interpreted |
| `marks` | `Mark[]` | yes | Array of marks (min length 1 for a useful chart) |
| `title` | string | no | Chart title |
| `description` | string | no | Subtitle / context |
| `magnitudeLabel` | string | no | Legend / ticker label for magnitude (default `"Magnitude"`) |
| `spanLabel` | string | no | Axis label for span (default `"Span"`) |
| `countLabel` | string | no | Ticker label for count (default `"Items"`) |
| `defaults` | object | no | Default visual options (see §4.4) |

### 4.2 Mark object

```json
{
  "id": "proj-042",
  "label": "Northwind Redesign",
  "span": { "start": "2021-03-01", "end": "2022-11-15" },
  "magnitude": 420000,
  "revealAt": "2021-03-01",
  "cohort": "2021",
  "group": "Product",
  "meta": {
    "owner": "Ada Lovelace",
    "status": "shipped"
  }
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `id` | string | **yes** | Unique within `marks` |
| `span` | object | **yes** | `{ start, end }` |
| `span.start` | string (ISO 8601 date/datetime) **or** number | **yes** | Matches top-level `unit` |
| `span.end` | string or number | **yes** | Matches `unit`; must be `≥ start` |
| `magnitude` | number | **yes** | Finite, `≥ 0` |
| `label` | string | no | Display name |
| `revealAt` | string or number | no | Same type as `unit`; default = `span.start` |
| `cohort` | string or number | no | Facet/filter key (e.g. start year) |
| `group` | string | no | Color category |
| `meta` | object | no | Opaque; shown in tooltip as key/value |

### 4.3 `unit` rules

| `unit` | `start` / `end` / `revealAt` examples | Normalized internally to |
|--------|--------------------------------------|---------------------------|
| `"date"` | `"2021-03-01"`, `"2021-03-01T12:00:00Z"` | UTC ms since epoch |
| `"number"` | `0`, `3.5`, `100` | number as-is (caller defines meaning: years, days, index, …) |

Mixing types inside one file is a validation error.

### 4.4 Optional `defaults` (visual)

```json
{
  "defaults": {
    "geometry": "arc",
    "colorScheme": "observable10",
    "animate": true,
    "tickers": ["count", "magnitudeSum"]
  }
}
```

### 4.5 Tiny valid example (`unit: "number"`)

```json
{
  "version": 1,
  "unit": "number",
  "magnitudeLabel": "Impact score",
  "spanLabel": "Years",
  "countLabel": "Initiatives",
  "marks": [
    {
      "id": "a",
      "label": "Alpha",
      "span": { "start": 2019, "end": 2021.5 },
      "magnitude": 12,
      "cohort": 2019,
      "group": "R&D"
    },
    {
      "id": "b",
      "label": "Beta",
      "span": { "start": 2020, "end": 2024 },
      "magnitude": 40,
      "cohort": 2020,
      "group": "Ops"
    }
  ]
}
```

### 4.6 Tiny valid example (`unit: "date"`, project-shaped demo)

```json
{
  "version": 1,
  "unit": "date",
  "title": "Sample projects",
  "magnitudeLabel": "Budget (USD)",
  "spanLabel": "Timeline",
  "countLabel": "Projects",
  "marks": [
    {
      "id": "p1",
      "label": "Mobile App v1",
      "span": { "start": "2020-01-15", "end": "2020-09-30" },
      "magnitude": 250000,
      "cohort": "2020",
      "group": "Product"
    },
    {
      "id": "p2",
      "label": "Data Platform",
      "span": { "start": "2020-06-01", "end": "2022-03-01" },
      "magnitude": 1100000,
      "cohort": "2020",
      "group": "Infrastructure"
    },
    {
      "id": "p3",
      "label": "EU Expansion",
      "span": { "start": "2021-02-01", "end": "2021-12-15" },
      "magnitude": 780000,
      "cohort": "2021",
      "group": "GTM"
    }
  ]
}
```

### 4.7 TypeScript mirror (for implementers)

```ts
export type SpanUnit = "date" | "number";

export interface SpanEndpoints {
  start: string | number;
  end: string | number;
}

export interface SpanMark {
  id: string;
  span: SpanEndpoints;
  magnitude: number;
  label?: string;
  revealAt?: string | number;
  cohort?: string | number;
  group?: string;
  meta?: Record<string, unknown>;
}

export interface SpanMagnitudeDocument {
  version: 1;
  unit: SpanUnit;
  marks: SpanMark[];
  title?: string;
  description?: string;
  magnitudeLabel?: string;
  spanLabel?: string;
  countLabel?: string;
  defaults?: {
    geometry?: "arc" | "bar" | "lane" | "point";
    colorScheme?: string;
    animate?: boolean;
    tickers?: Array<"count" | "magnitudeSum" | "spanSum">;
  };
}
```

### 4.8 Validation checklist (library must implement)

1. `version === 1`
2. `unit` is `"date"` or `"number"`
3. `marks.length ≥ 1`
4. Every `id` unique
5. Every `magnitude` is finite and `≥ 0`
6. Every `span.start` / `span.end` parses for `unit` and `end ≥ start`
7. If `revealAt` present, same type/parse rules as `unit`
8. Reject unknown top-level keys in strict mode (optional flag)

---

## 5. Recommended stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript** | Schema types, publishable typings |
| Scales / time / color | **D3** (`d3-scale`, `d3-time`, `d3-array`, `d3-color`, `d3-interpolate`) | Battle-tested; keep bundle lean via modular imports |
| Primary renderer (v1) | **SVG** via D3 selections **or** thin hyperscript | Crisp strokes, CSS hover, a11y; fine for demos ≤ ~2k marks |
| Dense / high-FPS path | **Canvas 2D** renderer adapter (same layout pipeline) | Matches Periscopic/Pitch performance lessons |
| Animation | **`requestAnimationFrame` + D3 timers** (optionally GSAP later) | Avoid hard GSAP dependency in core; plugin hook for GSAP |
| Schema validation | **Zod** or **Ajv** (JSON Schema file shipped) | Crystal-clear errors against §4 |
| Build | **tsup** or **Vite library mode** | ESM + CJS + `.d.ts` |
| Demo | Vite app in `/demo` | Sample JSON + story controls |
| Docs | README + JSON Schema + typedoc | Schema-first onboarding |
| Test | Vitest + happy-dom | Validate schema + layout math |
| Package manager | pnpm | |

**Explicitly not required for v1:** React/Vue (ship framework-agnostic `mount(el, options)`); Observable Plot (great for static EDA, poor fit for staged cascade + dual tickers as a reusable mark). Optional React wrapper in a later package `@span-magnitude/react`.

### Why not “canvas-only” or “SVG-only”?

- Periscopic proved canvas wins at ~10k animated paths.
- SVG wins for tooling, hit-testing, and demos.
- **Shared layout module → dual renderers** is the OSS pattern to steal from Pitch (D3 layout + canvas draw).

---

## 6. Package structure (publishable GitHub / npm)

```
span-magnitude-viz/
├── DESIGN.md                 ← this document
├── README.md
├── LICENSE                   ← MIT recommended
├── package.json              ← name: "span-magnitude-viz"
├── tsconfig.json
├── tsup.config.ts
├── schema/
│   └── v1.json               ← JSON Schema (Ajv-friendly), mirrors §4
├── src/
│   ├── index.ts              ← public API exports
│   ├── types.ts              ← SpanMark, SpanMagnitudeDocument, …
│   ├── validate.ts           ← parseDocument(json) → Result
│   ├── normalize.ts          ← dates→ms, derived length, defaults
│   ├── layout/
│   │   ├── scales.ts         ← x scale, magnitude→thickness/height
│   │   ├── arcPath.ts        ← cubic/quadratic path from (x0,x1,bulge)
│   │   ├── barGeom.ts
│   │   └── packLanes.ts      ← v1.1
│   ├── render/
│   │   ├── svgRenderer.ts
│   │   └── canvasRenderer.ts ← v1 optional / v1.1
│   ├── animate/
│   │   ├── timeline.ts       ← reveal schedule from revealAt
│   │   └── tickers.ts        ← count + magnitudeSum interpolators
│   ├── interact/
│   │   ├── hover.ts
│   │   └── filters.ts        ← cohort / group filters, small-multiples
│   └── mount.ts              ← mount(element, { data, options })
├── demos/
│   ├── projects.json         ← sample: date unit, budget magnitude
│   ├── numeric-initiatives.json
│   └── index.html + main.ts  ← Vite demo
├── tests/
│   ├── validate.test.ts
│   ├── layout.test.ts
│   └── animate.test.ts
└── .github/workflows/ci.yml
```

### Public API sketch

```ts
import { mount, parseDocument } from "span-magnitude-viz";

const doc = parseDocument(await fetch("./projects.json").then(r => r.json()));

const chart = mount(document.getElementById("app")!, {
  data: doc,
  geometry: "arc",          // "arc" | "bar" | "point"
  persistence: "keep",     // "keep" | "ephemeral" | "finale"
  width: 960,
  height: 540,
  animate: true,
  autoplay: true,
  tickers: true,
  onHover: (mark) => { /* … */ },
});

chart.play();
chart.pause();
chart.setFilter({ cohort: "2021" });
chart.setGeometry("bar");
chart.destroy();
```

---

## 7. Animation & interaction plan

### 7.1 Reveal timeline

1. Sort marks by `revealAt` ascending (stable by `id`).
2. Map reveal times to animation clock `t ∈ [0, 1]` (or real ms duration, default ~8–20s depending on N).
3. **Stagger policy:**
   - First `k` marks (default 3): slow, annotated (optional callouts).
   - Remaining: compressed cascade (ease-in density), still ordered by `revealAt`.
4. Per-mark enter:
   - **Arc:** stroke-dash draw from `start` → `end`; thickness eases from 0 → magnitude-scaled width.
   - **Bar:** width grows `start`→`end` or opacity+height fade-in.
5. Tickers update on each reveal: `count`, `sum(magnitude)`, optionally `sum(spanLength)`.

### 7.2 Interactions (v1)

| Action | Behavior |
|--------|----------|
| Hover mark | Highlight stroke; tooltip with `label`, span, magnitude, `meta` |
| Click mark | Pin tooltip / emit `onSelect` |
| Filter by `group` / `cohort` | Hide non-matching; optionally dim; recompute tickers for visible set |
| Small multiples | Facet by `cohort` (e.g. start year): one panel per cohort, shared x-scale |
| Geometry toggle | `arc` ↔ `bar` with layout transition |
| Play / pause / scrub | Control reveal clock |
| Reset | Clear filters, replay |

### 7.3 Year-over-year / cohort comparison

- **Filter mode:** single chart, `cohort` dropdown (e.g. 2020 vs 2021 starts).
- **Small-multiples mode:** `facet: "cohort"` → N panels; same x-domain for comparison of span positions and magnitude thickness.
- Derived helper: `cohort` can be auto-filled from `year(span.start)` when `unit === "date"` if missing (opt-in `deriveCohort: "startYear"`).

### 7.4 Accessibility & reduced motion

- `prefers-reduced-motion: reduce` → skip cascade; draw final frame; tickers jump to totals.
- SVG title/desc; keyboard focusable marks in SVG mode.
- Tooltip not hover-only (focus + tap).

---

## 8. Layout math (implementation notes)

### Arc path (shared baseline)

For mark with normalized `x0`, `x1` on the baseline y = `yBase`:

- Control point at midpoint `((x0+x1)/2, yBase - bulge)`.
- `bulge` can be constant, or slight function of span length, or jittered by packed index to reduce perfect overlap (Periscopic’s “feather” look).
- Stroke width `w = magnitudeScale(magnitude)` clamped to `[wMin, wMax]`.

### Bar geometry

- `x = xScale(start)`, `width = xScale(end) - xScale(start)`.
- `height = yScale(magnitude)`, `y = yBase - height` (or centered).

### Overlap strategy

1. Low N: accept overlap + hover highlight.  
2. Medium N: vertical jitter / slight bulge variation.  
3. High N: lane packing or canvas + opacity.

---

## 9. Implementation phases (next, after this doc)

| Phase | Deliverable |
|-------|-------------|
| **P0** | JSON Schema `schema/v1.json` + `parseDocument` + fixtures |
| **P1** | SVG `arc` + `bar` renderers, static (no animation) |
| **P2** | Reveal animation + tickers + hover |
| **P3** | Cohort filter + small multiples |
| **P4** | Canvas renderer fallback; React wrapper optional |
| **P5** | npm publish, demo site, README cookbook |

---

## 10. Licensing & attribution

- Library: **MIT** (recommended).
- Demo data: synthetic / openly licensed; do not ship FBI gun-death microdata.
- README “Inspiration” note may cite Periscopic’s public piece as *design inspiration for individual-mark temporal storytelling*, without implying endorsement or affiliation.
- Do not reuse Periscopic assets, copy, or distinctive “stolen years / flame-ash” branding.

---

## 11. Success criteria

1. A newcomer can author a JSON file matching §4 and see a working chart with **zero code changes** beyond `mount`.
2. Same schema drives arc and bar geometries.
3. Animation communicates accumulation (count + magnitude sum) as clearly as static marks encode span × magnitude.
4. Domain words (“project”, “budget”) appear only in demo JSON and README examples — not in core API types (except neutral `magnitude` / `span`).
