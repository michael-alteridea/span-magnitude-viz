# Tell4D (moteur Reporting 4D / span-magnitude-viz)

**Tell4D · Studio** — data storytelling 4D : explorer, raconter, exporter. Propulsé par Reporting 4D.

Générateur de graphiques SVG (D3 v7, sans canvas) pour Alteridea — futur hébergement : `reporting.alteridea.com`.
Nom technique du dépôt : `span-magnitude-viz` ; le Studio réutilise sa bibliothèque (`src/`) pour l'import,
les couleurs, la carte FR·BE·Europe et le « film » span/magnitude.

## Lancer

```bash
npm install
npm run dev:studio            # http://localhost:5174 (Vite)
npm run build:studio          # site statique → studio-dist/ (index.html + verifier.html, base relative)
npm run preview:studio        # sert studio-dist/
npm run build:studio:offline  # un seul fichier HTML → studio-offline/reporting-4d-studio.html (marche en file://)
npm test                      # tests unitaires (vitest)
npm run test:e2e:studio       # Chrome headless sur studio-dist/ (après build:studio) ; --shots régénère docs/shots/
```

Le test e2e utilise `puppeteer-core` (variable `PUPPETEER_DIR` si non installé dans le projet) et Chrome
(`CHROME_PATH`, défaut `/usr/bin/google-chrome`). Paramètres d'URL : `?reset=1` (oublie la session), `?sample=canaux`.

## Fonctionnalités V1

- **Données** : CSV / TSV / JSON / XLSX / XLS (glisser-déposer ou parcourir), collage Excel / Sheets
  (tabulation, `;` ou `,`, virgule décimale), aperçu avec types détectés et modifiables (nombre, date, texte, catégorie),
  5 exemples datés au 8 octobre 2026 (prévisions jusqu'à fin 2026), dont « Pipeline Salesforce » (300 opportunités FR/BE)
  « Business review grand compte » (Réel / Budget / N-1 / Prévision mensuels, janv. 2025 → déc. 2026)
  et son préréglage « Revue mensuelle (norme) ».
- **Import sécurisé** : SheetJS **0.20.3** (CDN officiel SheetJS, corrige CVE-2023-30533 et CVE-2024-22363 ; la version npm 0.18.5
  n'est plus utilisée). Limites (`IMPORT_LIMITS`, `data/files.ts`) : fichier ≤ 20 Mo, ≤ 100 000 lignes, ≤ 2 000 colonnes,
  ≤ 2 millions de cellules par feuille, texte collé ≤ 20 Mo ; au-delà, message clair en français (« Gardez seulement l'onglet utile… »).
- **Types** : barres (verticales, horizontales, groupées, empilées), lignes, aires (empilées), points / bulles,
  camembert, donut, arcs radiaux, **écarts IBCS** (réel vs budget / N-1 / prévision, écarts absolus en barres ou
  relatifs en épingles, rouge / vert réservés aux écarts) ; spéciaux : film 4D (span/magnitude) et carte FR·BE / Europe
  (toujours avec une **barre d'échelle en km** adaptée à la projection et au cadrage ; source et licence du fond dans le
  cartouche). Licences des fonds (Natural Earth, Eurostat GISCO / EuroGeographics non commercial) et options pour un usage
  commercial : [`docs/licence-cartes.md`](docs/licence-cartes.md).
- **Encodages** : X, une ou plusieurs mesures Y, axe Y secondaire à droite (échelle indépendante), série / couleur,
  temps (4D), taille, étiquette, agrégat, pas temporel.
- **Axes** : linéaire / log / temps, min-max auto ou manuels, unité (€, k€, M€, %, k, M, perso), format français,
  décimales, titre, grille.
- **Mode** : fixe ou dynamique (construction animée) ; 4D sur le champ temps (cumul ou instantané, lecture / pause,
  curseur, vitesse, barre espace).
- **Style** : titre, sous-titre, source, fond sombre / clair / perso, palettes (bleu pétrole par défaut, préréglage « Alteridea (rouge) » conservé),
  5 polices embarquées (OFL, sous-ensembles latin + français), formats 16:9, 1:1, 4:5, perso.
- **Export** : SVG autonome (polices en base64), PNG 1× / 2× / 3×, vidéo WebM (MediaRecorder, côté navigateur),
  configuration JSON (spec validé Zod, données en option). GIF : bouton prévu, V2.
- Dernière session conservée dans `localStorage` (`reporting-4d-studio:session:v1`).

## Récit (étape 1)

- **Explorer mes données** (panneau Données ou barre du haut) : 5 à 8 pistes classées, chacune avec mini-graphique
  lisible (forme + chiffre clé, sans axes ; vraie mini-carte choroplèthe FR/BE et image du film 4D — `ui/miniCharts.ts`),
  titre calculé, « pourquoi c'est important » et « Ouvrir ». Détecteurs déterministes (`story/insights.ts`) :
  tendance robuste (périodes complètes seulement, cumul depuis janvier ou 12 mois glissants vs N-1, contrôle par les
  médianes, la constance mois par mois et l'effet d'un mois isolé ; au-delà de +100 % : « ×2,5 » si le constat est net,
  valeurs absolues sinon ; constats fragiles qualifiés et classés plus bas), concentration / Pareto, classement / dispersion,
  saisonnalité (mois de pic, médiane des années, qualifiée si une seule année), valeurs atypiques (IQR k = 3 ou z ≥ 3,5), écarts de scénarios (budget, N-1,
  atterrissage), pipeline (pondéré, affaires en retard, ancienneté, taux de transformation, clôtures d'ici fin d'année),
  géographie (carte FR/BE), corrélation. Score = 0,6 × force + 0,25 × couverture + 0,15 × a priori, sans quasi-doublons.
- **Titres et commentaires calculés** (`story/narrate.ts`) : titre affirmatif, sous-titre IBCS (entité · mesure ·
  unité · période), 1 à 3 points « À retenir » au format français. Modifiables dans « Récit » ou par double-clic
  sur le graphique ; les saisies sont marquées (`story.edited`) et survivent aux changements de données ;
  « Régénérer » rétablit le calcul. Interface `NarrativeRewriter` prévue pour une réécriture LLM (non branchée).
- **Histoire** : « 📸 Snapshot » ajoute le graphique (spec, SVG, vignette, textes) au bandeau ; glisser pour
  réordonner, renommer, supprimer, cliquer pour recharger ; « Ordonner en récit » (contexte → tension → révélation →
  recommandation). Persistée dans `localStorage` (`reporting-4d-studio:story:v1`) et dans le JSON enregistré.
- **Exporter en PowerPoint** (pptxgenjs chargé à la demande) : couverture pétrole, sommaire, une diapositive par
  snapshot (rôle, titre d'action, sous-titre, graphique PNG 2×, commentaires, filet d'accent).

## Mode norme (étape 2)

Notation **inspirée d’IBCS® et de la notation ISO 24896** (« Notation for business reporting ») ;
IBCS® est une marque déposée. Activable dans **Réglages › Mode norme** (`spec.norme.enabled`), badge « Norme » dans
l'en-tête et bouton **ℹ Notation** (légende en français : scénarios, écarts). Module pur `norme.ts`, rendu `charts/norme.ts`.

- **Scénarios** détectés d'après les noms de colonnes (Réel / Actual / AC, Budget / Plan / PL, N-1 / PY / Année
  précédente, Prévision / Forecast / FC / Landing), forçables par mesure dans « Encodages » (`encoding.scenarios`).
  Réel plein foncé (gris clair sur fond sombre), N-1 gris clair plein, Budget en contour sans remplissage,
  Prévision hachurée (motif SVG `pattern.r4d-hatch`). Colonnes par scénario superposées (N-1 derrière, Budget en
  contour, Réel / Prévision devant) ; données en gris, pétrole réservé à l'interface et aux repères.
- **Écarts** : rouge / vert réservés aux écarts — barres ΔPL / ΔPY en valeur absolue ou épingles (aiguille + point) en %,
  écarts sur prévision hachurés ; « Hausse = défavorable » inverse le sens (coûts, délais).
- **Orientation** : temps à l'horizontale (colonnes, lignes), structure à la verticale (barres horizontales) ; bascule
  douce avec message (désactivable : simple avis).
- **Types déconseillés** : camembert, donut, arcs radiaux désactivés (« déconseillé par la notation IBCS — utilisez
  des barres ») et remplacés par des barres triées ; le film 4D et la carte restent permis.
- **Message** : sous-titre qui · quoi · quand (« Alteridea SA · Chiffre d’affaires en k€ · 2026 Réel vs Budget »),
  entité et mesure saisissables ; le titre affirmatif calculé est conservé.
- **Unités et formats** : unité dans le sous-titre, pas sur chaque étiquette ; mêmes décimales partout.
- **Échelles communes** : les snapshots de même mesure (même unité) sont regroupés ; « ≠ échelle » signalé dans
  l'histoire, case **Même échelle** pour aligner les diapositives ; indicateur d'échelle sur la diapositive.
- **Explorer et PowerPoint** : pistes en notation norme (vignettes grises, sous-titre structuré, pas de camembert) ;
  diapositives avec ligne de légende de notation. Préréglage **« Revue mensuelle (norme) »** (business review 2026).

Captures : `16-norme-ecarts.png`, `17-norme-colonnes-scenarios.png`, `18-norme-pptx.png`.

## Label qualité

Chaque graphique généré (aperçu, SVG, PNG, WebM, snapshots, diapositives) porte en bas à droite le **cartouche Tell4D**
(voir ci-dessous) : icône « Bulle + barres » (SVG inline dans les SVG/PNG/WebM, PNG 2× dans le PowerPoint), nom du produit
(`PRODUCT_LABEL` dans `brand.ts`, « Tell4D ») en lien `<a href>` vers `PLATFORM_URL`, date de génération (« Généré le 8 oct. 2026 »),
date d'import des données, source, empreinte et QR. Il ne peut être masqué qu'avec `branding: "pro"` + `style.brandMark: false` ;
l'interface ne propose pas de le masquer.

## Cartouche et vérification (étape cartouche)

**Cartouche** (`charts/cartouche.ts`) : petit bloc rectangulaire (≈ 2:1) en bas à droite, discret, lisible sur fond sombre, clair
ou personnalisé et en mode norme (gris ; pétrole seulement sur l'empreinte et le logo) :

- logo Tell4D + « Tell4D » (lien vers la plateforme) ;
- « Généré le 8 oct. 2026 » ;
- « Données importées le … » (fichier), « Données collées le … » (collage), « Données d'exemple au 8 oct. 2026 » (exemples) ;
- « Source : … » (tronquée avec « … ») ;
- « Empreinte 3f9a·c21e » (8 premiers caractères de l'empreinte SHA-256) ;
- **QR d'empreinte des données** (SVG pur, modules foncés sur plaque blanche, marge claire de 3 modules, version 6-M,
  ≥ 1,5 px par module dès le PNG 1×), lien « Vérifier l'empreinte ».

Placement : sous la colonne « À retenir » quand elle existe (le graphique garde toute sa hauteur), sinon dans une bande
réservée sur toute la largeur ; jamais sur les axes, la légende ni la barre d'échelle des cartes. Offre gratuite : cartouche
obligatoire. **Réglages › Style › « QR d'empreinte des données »** (`style.authQr`, activé par défaut) masque seulement le QR.
Le PowerPoint reprend le cartouche dans l'image de chaque diapositive et ajoute un lien natif « Vérifier l'empreinte des données ».

**Empreinte** (`provenance.ts`, WebCrypto `crypto.subtle.digest`) calculée à l'import et enregistrée dans `spec.provenance`
(empreinte, horodatage ISO, nom du fichier, lignes, colonnes) — donc dans la session, les snapshots, la configuration JSON et
les métadonnées du SVG exporté :

- fichier déposé / choisi : SHA-256 des **octets bruts** ;
- texte collé : SHA-256 du texte UTF-8 normalisé (BOM retiré, fins de ligne LF, espaces de fin de ligne et blancs finaux retirés) ;
- exemples intégrés (et configuration ouverte sans fichier d'origine) : SHA-256 du JSON canonique des lignes (clés triées).

**Lien du QR** (fragment `#…` : rien n'est envoyé au serveur), forme compacte en mode alphanumérique :
`https://alteridea-dashboard.web.app/reporting/verifier.html#1.F.<32 hex>.<import AAAAMMJJ>.<génération AAAAMMJJ>.<lignes>.<colonnes>`
(type F fichier, P collage, E exemple, C configuration ; forme longue `#h=…&i=…&g=…&n=…&c=…` acceptée).
Le domaine est la seule constante `VERIFY_BASE` de `provenance.ts` (passage à reporting.alteridea.com : une ligne).
La version hors ligne pointe aussi vers la page en ligne.

**Page `verifier.html`** (seconde entrée Vite, même identité, en français, sans serveur) : lit le fragment et affiche
« Selon ce QR, ce graphique a été généré par Tell4D le … à partir de données importées le … (n lignes, c colonnes), empreinte … » ;
zone « Déposez le fichier d'origine pour vérifier » (ou texte collé) → empreinte recalculée avec les mêmes règles →
« ✓ Les données correspondent » / « ✗ Les données ne correspondent pas à ce graphique ». Les exemples intégrés sont
reconnus directement. Lien absent ou illisible : message clair, l'empreinte d'un fichier reste calculable. La page précise
qu'il s'agit d'une **empreinte déclarée, pas d'une signature** : elle ne garantit ni que le graphique est fidèle aux données,
ni qu'il provient de Tell4D ; elle ne dit rien de l'exactitude des données. Un registre en ligne viendra renforcer cette vérification.

Tests : `test/cartouche.test.ts` (normalisation, lien, QR décodé par jsQR, cartouche, option, PowerPoint) ; e2e : QR décodé
dans les PNG 1×, 2× et 1600 px, carte, mode norme, page de vérification (fichier ✓, fichier modifié ✗, texte collé, exemple,
lien illisible), version hors ligne. Captures : `19-cartouche.png`, `20-verifier-ok.png`, `21-verifier-ko.png`.

## Architecture (`studio/src`)

| Module | Rôle |
| --- | --- |
| `spec.ts` | Schéma Zod du spec (`reporting-4d-studio/spec-v1`), valeurs par défaut, formats de fichier |
| `state.ts` | Store (spec + dataset + UI), émissions groupées, persistance localStorage |
| `data/table.ts` | Parsing tolérant FR/EN des nombres et dates, détection des types, `Dataset` |
| `data/files.ts` | Texte collé, JSON, classeurs (SheetJS chargé à la demande) |
| `data/samples.ts` | Jeux d'exemple déterministes ancrés au 8 octobre 2026 |
| `data/model.ts` | Agrégation (catégories, points), modèle temporel 4D et pondérations par image |
| `data/suggest.ts` | Choix automatique des encodages lors d'un changement de type |
| `format.ts` | Locale française d3 (espace insécable, virgule, U+2212), unités, dates |
| `norme.ts` | Mode norme (inspiré d’IBCS® / ISO 24896) : scénarios, écarts, orientation, sous-titre, formats, échelles communes |
| `theme.ts` | Thèmes, palettes, polices (`FontFace`, @font-face embarquées pour l'export) ; identité bleu pétrole (`PETROLE_COLORS`), couleurs d'écart réservées `VARIANCE_NEG` / `VARIANCE_POS` |
| `charts/*` | Rendu SVG pur : cartésien, radial, écarts IBCS (`variance.ts`), spéciaux (film / carte via la lib), mise en page, cartouche |
| `data/transform.ts` | Colonnes calculées et filtres du spec (`spec.transform`), mémoïsés |
| `data/variance.ts` | Modèle d'écarts réel / référence (sommes appariées) |
| `story/*` | Rôles des colonnes, statistiques, détecteurs, narration, textes français, snapshots, export PowerPoint |
| `brand.ts` | Nom du produit, URL de la plateforme, règle d'affichage du cartouche |
| `provenance.ts` | Empreinte des données (SHA-256), provenance, lien de vérification (construction / lecture), `VERIFY_BASE` |
| `qr.ts`, `charts/cartouche.ts` | QR en SVG pur (qrcode-generator) ; cartouche Tell4D |
| `verifier.ts` | Page `verifier.html` : « Vérifier l'empreinte » |
| `export.ts` | SVG autonome, PNG, WebM, fichier de configuration ; stub GIF |
| `ui/*`, `main.ts` | Interface trois zones (données · aperçu · réglages), galerie, lecteur, Explorer, bandeau Histoire, édition directe, toasts |

## Extensions prévues (V2, non construites)

- **Chartes graphiques** : `style.charterId` est réservé ; une charte surchargera palette, police, fond et logo.
- **Superposition de deux fichiers** : `studioFile.data` deviendra une liste de sources avec jointure par clé.
- **Bibliothèque d'icônes SVG** : marqueurs et pictogrammes référencés par id dans le spec.
- **Export GIF** : `exportGif()` dans `export.ts` (même boucle d'images que le WebM).
- **Firestore** : le fichier `reporting-4d-studio` (spec + données) est déjà du JSON sérialisable et validé.

Captures : `studio/docs/shots/`.

## Identité visuelle

**Tell4D**, logo « Bulle + barres » (h1, choisi le 8 oct. 2026) : sources dans `src/assets/brand/` (© Alteridea,
voir son README), favicon SVG et apple-touch-icon 180 px dans `public/`. L'en-tête et le cartouche utilisent l'icône
en SVG inline (`brand.ts`), le PowerPoint son PNG 2×. Les noms techniques (`span-magnitude-viz`, clés
`reporting-4d-studio`, fichier `reporting-4d-studio.html`) restent inchangés.

Bleu pétrole : principal `#0E6E8C`, clair `#3FA7C4` (accents, boutons et mises en avant sur l'interface sombre),
foncé `#08465A`. Le rouge `#d62839` et le vert `#2e9e4f` sont réservés aux écarts défavorables / favorables
(graphique d'écarts normé IBCS / ISO 24896) : ne pas les utiliser comme couleurs d'accent.
