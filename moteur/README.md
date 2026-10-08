# AlterideaCharts 0.1.0

Moteur de graphiques partagé (ValueRoom, Datanime…), tiré de span-magnitude-viz (MIT).
Un seul fichier JavaScript, D3 inclus, aucune dépendance à charger.

- **Fichier classique (UMD)** : `alteridea-charts-0.1.0.min.js` → `window.AlterideaCharts`
- **Module ES** : `alteridea-charts-0.1.0.esm.js`
- **Démo** : `demo.html` (données fictives Norvia, thème par défaut et thème perso)

La version est figée dans le nom du fichier : une nouvelle version aura un nouveau nom, les pages existantes ne
changent pas.

## Intégration

```html
<script src="https://alteridea-dashboard.web.app/moteur/alteridea-charts-0.1.0.min.js"></script>
<div id="roi"></div>
<script>
  const roi = AlterideaCharts.cumulativeGain.animate("#roi", {
    points: [{ label: "M1", value: -95000 }, { label: "M2", value: -42000 }, { label: "M3", value: 18000 }],
    periodUnit: "mois",
  }, { title: "Rentabilisé en un an" });
</script>
```

**Depuis un autre domaine (ValueRoom…)** : la balise `<script src>` classique fonctionne depuis n'importe quel site.
L'hébergement ne renvoie pas d'en-tête CORS : un `import` de module ES *depuis un autre domaine* serait refusé par le
navigateur. Pour l'ESM, copiez `alteridea-charts-0.1.0.esm.js` dans votre application (ou votre bundle) et importez-le
localement :

```js
import { waterfall } from "./vendor/alteridea-charts-0.1.0.esm.js";
```

## Les trois graphiques

Chaque graphique expose la même API :

| Méthode | Rôle |
| --- | --- |
| `animate(conteneur, données, options)` | Monte le graphique dans un élément (ou sélecteur CSS) et l'anime. Renvoie un contrôleur : `update(données, options)`, `replay()`, `toSVG()`, `toPNG(échelle)`, `destroy()`, `ready` (promesse de fin d'animation). |
| `toSVG(données, options)` | Chaîne SVG autonome, sans DOM (jsPDF / svg2pdf, e-mail, serveur). |
| `toPNG(données, options)` | PNG en data URL (navigateur). |

### Gain cumulé et retour sur investissement — `cumulativeGain`

```js
{ points: [{ label: "M1", value: -95000 }, …], cumulative: false, periodUnit: "mois", paybackLabel: "…" }
```

`value` est le flux net de la période (gains − coûts) ; `cumulative: true` si les valeurs sont déjà cumulées.
Courbe rouge sous zéro, verte après le point mort, creux de trésorerie, repère « Rentabilisé en 12 mois » (délai
interpolé), cumul final. `cumulativeGain.computePayback(valeurs)` donne le calcul seul.

### Cascade d'investissement — `waterfall`

```js
{ items: [{ label: "Licences", value: -120000 }, { label: "Gain de productivité", value: 210000 }, { label: "Sous-total", kind: "subtotal", value: 0 }], total: "Gain net 3 ans" }
```

Coûts en rouge, gains en vert, sous-totaux et total dans la couleur principale, liaisons en pointillé ; `total: false`
retire la barre de total.

### Avant / après — `beforeAfter`

```js
{ items: [{ label: "Clôture mensuelle", before: 38, after: 16 }], beforeLabel: "Avant", afterLabel: "Après", better: "lower" }
```

Barres horizontales « avant » (gris) et « après » (couleur principale) ; l'écart est vert s'il va dans le bon sens
(`better: "lower"` pour des coûts ou des délais, `"higher"` par défaut), rouge sinon.

## Options communes

| Option | Défaut | |
| --- | --- | --- |
| `title`, `subtitle` | — | Titre et sous-titre dans le SVG. |
| `width`, `height` | largeur du conteneur, hauteur proportionnelle | `toSVG` : 720 px de large par défaut. |
| `format` | `"euro"` | `"euro"`, `"number"` ou `"percent"` (valeurs en points). |
| `unit` | `"€"` en euro | Unité après le nombre (« h », « jours »…). |
| `compact` | `true` | 12,5 k€, 1,2 M€, 3,4 Md€. |
| `decimals` | auto | |
| `theme` | variables CSS du conteneur | Jetons (voir plus bas), prioritaires sur le CSS. |
| `cartouche` | aucun | Voir plus bas. |
| `ariaLabel` | titre + résumé | Texte alternatif. |
| `duration` | 1 600 ms | 0 = sans animation. |

## Thème

Variables CSS lues sur le conteneur (ou passées dans `options.theme`) ; pétrole par défaut.

| Variable | Jeton | Défaut |
| --- | --- | --- |
| `--ac-primary` | `primary` | `#0E6E8C` |
| `--ac-positive` | `positive` | `#1E8E5A` |
| `--ac-negative` | `negative` | `#C8423B` |
| `--ac-grey` | `grey` | `#8C989F` |
| `--ac-text` | `text` | `#14262E` |
| `--ac-bg` | `bg` | `#FFFFFF` (ou `transparent`) |
| `--ac-font` | `font` | `Inter, system-ui, …` |

Le rouge et le vert ne servent qu'aux écarts (pertes / gains, écart avant / après).

## Cartouche neutre

Rien n'est affiché par défaut, aucune marque n'est ajoutée : le cartouche montre uniquement ce que l'hôte fournit.

```js
cartouche: { logo: "data:image/png;base64,…", name: "Votre société", link: "https://exemple.fr", qr: true,
             dates: ["Données au 8 octobre 2026"], source: "Vos données" }
```

`qr: true` encode `link` ; une chaîne encode cette adresse. Préférez une data URL pour le logo (export PNG).
Seul : `AlterideaCharts.cartouche.toSVG(options, { width })` et `cartouche.toPNG(…)`.

## Nombres à la française

`AlterideaCharts.format` : `number(1234567.8)` → « 1 234 568 », `euro(12500, { compact: true })` → « 12,5 k€ »,
`percent(-0.58, { signed: true })` → « −58 % », `duration(13.6)` → « 13,6 mois », `date("2026-10-08")` →
« 8 octobre 2026 ». Espace fine insécable, virgule décimale, signe moins typographique.

## Accessibilité

SVG `role="img"` avec `<title>` et `<desc>` (résumé calculé : creux, délai de retour, total…), tableau des données
invisible à l'écran mais lu par les lecteurs d'écran, contrastes du thème par défaut, animations coupées si
`prefers-reduced-motion`. Le CSS injecté est limité à `.ac-chart`.

## Construction (dépôt span-magnitude-viz)

```bash
npm run build:moteur        # moteur/dist : UMD minifié + ESM
npx vitest run moteur       # tests unitaires
npm run test:e2e:moteur     # page HTML simple qui charge le fichier unique (autre origine), captures
```

Licences : moteur MIT ; inclut D3 (ISC) et qrcode-generator (MIT).
