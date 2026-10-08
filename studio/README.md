# Datanime (moteur Reporting 4D / span-magnitude-viz)

**Datanime · Studio** — data storytelling 4D : explorer, raconter, exporter. Propulsé par Reporting 4D. Anciennement « Tell4D » (renommé le 8 oct. 2026).

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
  cartouche). Fonds IGN (Licence Ouverte), NGI-Statbel (CC BY 4.0) et Natural Earth (domaine public),
  tous réutilisables commercialement : [`docs/licence-cartes.md`](docs/licence-cartes.md).
- **Encodages** : X, une ou plusieurs mesures Y, axe Y secondaire à droite (échelle indépendante), série / couleur,
  temps (4D), taille, étiquette, agrégat, pas temporel.
- **Axes** : linéaire / log / temps, min-max auto ou manuels, unité (€, k€, M€, %, k, M, perso), format français,
  décimales, titre, grille.
- **Mode** : fixe ou dynamique (construction animée) ; 4D sur le champ temps (cumul ou instantané, lecture / pause,
  curseur, vitesse, barre espace).
- **Style** : titre, sous-titre, source, fond sombre / clair / perso, palettes (bleu pétrole par défaut, préréglage « Alteridea (rouge) » conservé),
  5 polices embarquées (OFL, sous-ensembles latin + français), formats 16:9, 1:1, 4:5, perso.
- **Export** (menu **Exporter** de la barre du haut, ou Réglages › ⑤ Export) : SVG autonome (polices en base64),
  PNG 1× / 2× / 3×, vidéo WebM (MediaRecorder, côté navigateur), PowerPoint de l'histoire. Menu **Fichier** :
  configuration JSON (spec validé Zod, données en option), Ouvrir…, Réinitialiser. GIF : entrée prévue, V2.
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
IBCS® est une marque déposée. Activable dans **Réglages › ④ Style › Rendu « Norme (IBCS) »** (`spec.norme.enabled`), badge « Norme » dans
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

Chaque graphique généré (aperçu, SVG, PNG, WebM, snapshots, diapositives) porte en bas à droite le **cartouche Datanime**
(voir ci-dessous) : icône « Bulle + barres » (SVG inline dans les SVG/PNG/WebM, PNG 2× dans le PowerPoint), nom du produit
(`PRODUCT_LABEL` dans `brand.ts`, « Datanime ») en lien `<a href>` vers `PLATFORM_URL`, date de génération (« Généré le 8 oct. 2026 »),
date d'import des données, source, empreinte et QR. Il ne peut être masqué qu'avec `branding: "pro"` + `style.brandMark: false` ;
l'interface ne propose pas de le masquer.

## Cartouche et vérification (étape cartouche)

**Cartouche** (`charts/cartouche.ts`) : petit bloc rectangulaire (≈ 2:1) en bas à droite, discret, lisible sur fond sombre, clair
ou personnalisé et en mode norme (gris ; pétrole seulement sur l'empreinte et le logo) :

- logo Datanime + « Datanime » (lien vers la plateforme) ;
- « Généré le 8 oct. 2026 » ;
- « Données importées le … » (fichier), « Données collées le … » (collage), « Données d'exemple au 8 oct. 2026 » (exemples) ;
- « Source : … » (tronquée avec « … ») ;
- « Empreinte 3f9a·c21e » (8 premiers caractères de l'empreinte SHA-256) ;
- **QR d'empreinte des données** (SVG pur, modules foncés sur plaque blanche, marge claire de 3 modules, version 6-M,
  ≥ 1,5 px par module dès le PNG 1×), lien « Vérifier l'empreinte ».

Placement : sous la colonne « À retenir » quand elle existe (le graphique garde toute sa hauteur), sinon dans une bande
réservée sur toute la largeur ; jamais sur les axes, la légende ni la barre d'échelle des cartes. Offre gratuite : cartouche
obligatoire. **Réglages › ⑤ Export › « QR d'empreinte des données »** (`style.authQr`, activé par défaut) masque seulement le QR.
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
« Selon ce QR, ce graphique a été généré par Datanime le … à partir de données importées le … (n lignes, c colonnes), empreinte … » ;
zone « Déposez le fichier d'origine pour vérifier » (ou texte collé) → empreinte recalculée avec les mêmes règles →
« ✓ Les données correspondent » / « ✗ Les données ne correspondent pas à ce graphique ». Les exemples intégrés sont
reconnus directement. Lien absent ou illisible : message clair, l'empreinte d'un fichier reste calculable. La page précise
qu'il s'agit d'une **empreinte déclarée, pas d'une signature** : elle ne garantit ni que le graphique est fidèle aux données,
ni qu'il provient de Datanime ; elle ne dit rien de l'exactitude des données. Un registre en ligne viendra renforcer cette vérification.

Tests : `test/cartouche.test.ts` (normalisation, lien, QR décodé par jsQR, cartouche, option, PowerPoint) ; e2e : QR décodé
dans les PNG 1×, 2× et 1600 px, carte, mode norme, page de vérification (fichier ✓, fichier modifié ✗, texte collé, exemple,
lien illisible), version hors ligne. Captures : `19-cartouche.png`, `20-verifier-ok.png`, `21-verifier-ko.png`.

## Import intelligent et mise en forme (étape import)

Un classeur « humain » (plan financier, tableau de bord mensuel) s'ouvre dans la fenêtre **« Mise en forme des données »**
au lieu d'être importé tel quel. Elle s'ouvre automatiquement quand le classeur a plusieurs onglets, contient des formules
sans résultat enregistré, ou quand la feuille / le collage n'est pas un simple tableau (titres, sections, mois en colonnes) ;
sinon l'import reste direct. Bouton **Données › « Mise en forme des données… »** pour la rouvrir (dernier fichier, ou tableau courant).

- **Recalcul des formules dans le navigateur** (`data/formula/*`, code maison sous licence MIT, repli sur
  `@formulajs/formulajs`, MIT — pas de HyperFormula ni de bibliothèque copyleft) : un fichier généré par script et jamais
  ouvert dans Excel ne contient pas les résultats des formules ; ils sont recalculés (références relatives / absolues,
  plages, autres onglets, noms définis, 98 fonctions courantes : SI, SOMME, SOMMEPROD, INDEX/EQUIV, RECHERCHEV, NB.SI(S),
  SOMME.SI(S), DATE, FIN.MOIS, ARRONDI…). Ordre topologique itératif, **Web Worker** avec progression au-delà de 3 000
  formules (Blob en version hors ligne), repli sur le fil principal. **Rapport de couverture** en français : nombre de
  formules non évaluées, fonctions non prises en charge, exemples (cellule, formule, raison) — jamais de graphique vide en silence.
  Validation : sur un plan d'affaires réel de 29 848 formules (hors dépôt), **100 % des cellules identiques** au même
  fichier recalculé par LibreOffice (tolérance relative 1e-6), en ≈ 0,3 s ; dans le dépôt, sur le classeur fictif de test.
- **Choix de l'onglet** : vignette des premières cellules, score « tableau de données » (grille chiffrée, en-têtes M1…M60),
  onglet conseillé ; Lisez-moi, Sources, Notes… relégués en dernier.
- **Structure détectée** (`data/structure.ts`) : vraie ligne d'en-têtes (titres, notes, lignes vides ignorés), ligne
  « Mois » datée ou en-têtes temporels (M1, janv. 2027, 2027), lignes de section → champ **Section**, colonne d'unités,
  colonne **Ouverture** facultative (valeur avant M1), nombres et pourcentages français (« 26,7% » → 0,267), colonnes
  annuelles proposées comme tableau séparé (« totaux annuels »), bloc **RÉSUMÉ…** proposé à part, dates répétées →
  **Variante** (« Colonnes B–F » / « Colonnes G–K »). Tableau large → long (Section, Poste, Entité, Indicateur, Unité,
  Date, Période, Valeur) ; libellés répétitifs découpés en **Entité + Indicateur** (« Commercial salarié n°3 — productivité (ramp) »).
- **Grille et rôles** (`data/mapping.ts`, `ui/mapping.ts`) : toucher un libellé de ligne l'ajoute en Y (ou le retire) ;
  toucher un champ ou un en-tête de colonne → X, Y, Y axe 2, Couleur / Groupe, Facette ; **⇄ X / Y** (les séries
  deviennent les catégories) ; cocher des lignes → **Regrouper** avec un agrégat (somme, moyenne, max, dernier) et un nom ;
  filtres Section / Indicateur / Entité / Variante ; type, courbe (escalier pour des effectifs), titre. **Aperçu en direct**
  (rendu du Studio, différé) ; **« Appliquer »** charge le tableau mis en forme dans le Studio. Mode norme, style et
  cartouche sont conservés ; la provenance reste l'empreinte des **octets bruts du fichier** (ou du texte collé) et
  l'onglet utilisé. Facettes : petits multiples dans l'aperçu, la première facette est appliquée (filtre modifiable).
- iPad : cibles ≥ 34 px, aucun survol nécessaire, disposition empilée en portrait ; clavier : Entrée (regrouper,
  renommer), Échap (fermer le menu puis la fenêtre) — aucun raccourci lettre, donc indifférent à l'AZERTY.

Démonstration (classeur fictif `test/fixtures/plan-mini.xlsx`, « Exemple SA ») : filtre Indicateur « en poste (1/0) » →
tout cocher → Regrouper (Somme) → courbe en escalier « Commerciaux en poste par mois » (0 → 24, 2027–2031) ;
« productivité (ramp) » → « Capacité commerciale équivalent temps plein » ; lignes « MRR Produit A » + « MRR Produit B » ;
onglet Synthèse, bloc « Tableau annuel » : CA HT, EBITDA, Résultat net par année.

Limites : INDIRECT / DECALER (références dynamiques), références structurées (Table1[Col]), formules matricielles
dynamiques et macros ne sont pas évaluées (signalées dans le rapport) ; seules les 36 premières périodes sont affichées
dans la grille (toutes sont importées).

Tests : `test/smartImport.test.ts` (analyse, moteur, feuilles croisées, couverture, validation contre LibreOffice sur le
classeur fictif `test/fixtures/plan-mini.xlsx` + `plan-mini.expected.json`, structure, large → long, Entité + Indicateur,
nombres français, regroupements, X ⇄ Y, onglets Lisez-moi / Sources, Synthèse à deux variantes). Fixtures fictives
régénérables (LibreOffice requis) : `npx vite-node --config vitest.config.ts studio/scripts/make-test-fixtures.ts`. e2e : dépôt du classeur, onglet conseillé,
recalcul (Worker), 4 graphiques construits dans la fenêtre, ⇄, regroupement, Appliquer, collage large, version hors ligne.
Captures : `22-choix-onglet.png`, `23-mapping-live.png`, `24-commerciaux-en-poste.png`, `25-mrr-produits.png`.

## Exploration guidée et scénarios de réunion (étape démo)

- **Type « Exploration guidée (zoom temps · espace) »** (`spec.drill`) : barres par trimestre → clic sur un trimestre →
  ses mois (avec le trimestre précédent en contexte) → clic sur un mois → cumul jour par jour vs le rythme moyen des
  3 mois précédents et écart par semaine. **Fil d'Ariane** cliquable (Tout › T2 2026 › Juin 2026) et bouton retour.
  Le décrochage est mesuré (plus forte baisse vs la période précédente, ou vs la moyenne des 3 périodes précédentes)
  et repéré par un contour pointillé (référence) et un encadré d'écart.
- **Répartir dans l'espace** : carte choroplèthe des régions belges et françaises (IGN, NGI ; valeur + écart en %,
  légende, **barre d'échelle en km**, petite région déportée avec filet) ; **Historique par région** : petits multiples
  mensuels à échelle commune, mois focalisé en pétrole, mois saisonnier (bas partout, ex. août) en gris.
- **Focus** : clic sur une région / un panneau / une ligne → la catégorie dans son historique ; **Détailler par…**
  n'importe quelle colonne catégorielle (commercial, secteur, étape…) avec comparaison aux mois précédents.
  Rouge / vert uniquement pour les écarts (au-delà de ±3 %, gris en deçà : stable).
- **Récit calculé** (`story/drillStory.ts`) : titre affirmatif, 3 commentaires chiffrés, piste suivante (« Suggestion »),
  rôle narratif. Les textes restent modifiables (double-clic) et sont conservés dans les snapshots.
- **Scénarios persona** (`story/scenarios.ts`) : objet déclaratif `Scenario` (persona, rôles requis — date, montant,
  région, commercial… —, étapes = opération d'exploration + vue + rôle narratif + gabarit de commentaire facultatif).
  Rejouable sur n'importe quel fichier : fenêtre **Scénarios** (barre du haut) → associer les colonnes aux rôles →
  **▶ Lancer le scénario** (snapshots de chaque étape puis film) ou **Pas à pas** (vous cliquez ; la barre d'exploration
  indique l'étape et la suivante). Les démos intégrées sont des instances : « Scénario Directeur commercial ».
  Chaque snapshot de scénario a un **identifiant stable** (scénario + étape + empreinte des données), pour un futur partage.
- **Transition « zoom dans la marque »** (`ui/drillZoom.ts`) : à la descente, la marque cliquée (barre, région, panneau,
  ligne, marche de cascade) grandit jusqu'à remplir la zone du graphique pendant que le reste s'efface, puis le graphique
  enfant émerge de son empreinte (voile de la couleur du parent qui se dissout) ; à la remontée (fil d'Ariane, retour),
  l'enfant se replie dans ce voile qui rétrécit jusqu'à la marque d'origine. ~800 ms, courbes adoucies ; aucune animation
  avec `prefers-reduced-motion`. Même transition dans l'aperçu, le film et le mode lecture (diapositives parent ↔ enfant).
- **Pas de saut de mise en page** : film et mode lecture mettent en page la colonne (ou le bandeau) « À retenir » pour
  toutes ses puces dès la première image (`commentsAll`) ; le graphique est d'emblée à sa taille finale.
- **Film** (bandeau Histoire → ▶ Film) : rejoue les snapshots en plein écran, construction animée, zoom dans la barre ou la
  région quand l'étape suivante prolonge le chemin (et retour inverse), commentaires révélés un à un ; ←/→, espace, Échap,
  toucher = suivant.
- **Démo fictive** : exemple « Démo : pipeline commercial » et `public/demo/pipeline-commercial-2026.csv`
  (dictionnaire : `public/demo/LISEZMOI-pipeline-commercial-2026.md`), générés par
  `npx vite-node --config vitest.config.ts studio/scripts/make-demo-pipeline.ts`.
  `node studio/scripts/demo-scenario.mjs --out <dossier>` produit les PNG des snapshots et le PowerPoint du scénario.
- Barre d'exploration et fenêtres : cibles tactiles ≥ 44 px (iPad).

## Cascade budget vs réel, tableau croisé et Scénario Directeur financier (étape finance)

- **Mode versions** (`drill.version`, `from`, `to`) : dès qu'une colonne contient deux versions (Réel 2025 / Budget 2026,
  réel / budget / prévision…), l'exploration compare la version d'arrivée à la version de départ. Avec une colonne
  `nature` (revenus / coûts), les coûts comptent en négatif : la mesure devient une marge.
- **Cascade** (vue `bridge`) : départ → un écart par facteur (ligne métier, puis compte) → arrivée ; marches reliées,
  libellés signés, rouge / vert pour les écarts uniquement. Au niveau des comptes : revenus puis coûts avec un
  **sous-total revenus** et des accolades REVENUS / COÛTS. Au-delà de 12 facteurs : « Autres (n) ».
  Clic sur une marche → niveau suivant (`drill.levels`, devinés : ligne métier puis compte), puis **mois**.
- **Par mois** (vue `compare`) : 12 mois alignés, version de départ en gris et d'arrivée en pétrole, panneau d'écart,
  repère « à partir de <mois> » quand l'écart change durablement (rupture), totaux et semestres à droite.
- **Carte** et **Détailler par…** en mode versions : écart par région / catégorie (« +x · y % »).
- **Tableau croisé** (vue `pivot`, `drill.pivot`) : petit panneau X (mois, trimestre, année ou colonne), séries,
  mesure (somme, moyenne, nombre, écart) et graphique (barres, courbes, cascade, carte) ; les filtres du fil d'Ariane
  s'appliquent. Les barres groupées n'étiquettent que les séries principales quand la place manque.
- **Scénario Directeur financier** (`SCENARIO_DAF`) : rôles date, mesure, version, ligne, compte (obligatoires), nature,
  région (facultatifs) ; 7 étapes : cascade, plus forte hausse, ses mois, plus forte baisse, ses mois, carte
  (facultative), tableau croisé par trimestre. Démo : exemple « Démo : réel vs budget » et
  `public/demo/finance-reel-2025-budget-2026.csv` (dictionnaire : `public/demo/LISEZMOI-finance-reel-2025-budget-2026.md`),
  générés par `npx vite-node --config vitest.config.ts studio/scripts/make-demo-finance.ts`.
  `node studio/scripts/demo-scenario.mjs --scenario daf --out <dossier> --pptx <nom>` produit PNG et PowerPoint.
- **PowerPoint lisible** : les graphiques des snapshots sont rendus en PNG à 3× et les commentaires en 15 pt.

## Revues partagées (étape partage)

- **Espace « Revues »** (bouton **Revues** de la barre du haut, ou `#/revues`) : liste des revues (persona, date de réunion,
  statut : brouillon, partagée, en réunion, terminée), recherche et filtres ; détail d'une revue : séquence ordonnée des
  snapshots (les vrais objets `Snapshot`, ids stables des scénarios), lecture avant la réunion (anneau, barres par snapshot,
  « Relancer » = message local, export CSV), participants avec un point par snapshot vu.
- **Partager** : lien et **QR** de la revue (`#/r/<revue>`) et de **chaque snapshot** (`#/r/<revue>/<snapshot>`), téléchargement
  du QR en SVG, accès, options (commentaires, « qui a vu », montants), invitations. Le partage est **local pour l'instant** :
  les liens s'ouvrent dans le Studio, dans ce navigateur (note visible dans l'interface — partage en ligne bientôt).
- **Page participant** (`#/r/…`) : graphique recalculé et animé (format portrait sur téléphone), commentaire généré et
  commentaire de l'animation, **J'ai vu**, réactions (D'accord, Utile, À clarifier, Point d'attention), fil de commentaires et
  **questions pour la séance** (« Moi aussi »), précédent / suivant, flèches ←/→, balayage sur iPad / iPhone,
  **Revoir l'animation**. « Vous êtes » choisit le participant sur cet appareil.
- **Mode réunion** (`#/revues/<id>/reunion`) : chrono, snapshot en cours, **Vu en direct** (présents / absents), **file de
  questions** triée par soutiens (Afficher, Répondue, En action → action préremplie), saisie **Décision / Action** (responsable,
  échéance) rattachée au snapshot, frise, **Projeter** (film plein écran).
- **Compte rendu automatique** (`#/revues/<id>/compte-rendu`) : réunion, présents / absents, indicateurs, décisions, tableau
  des actions, **qui a lu quoi** (avant → après), une section par snapshot (graphique, commentaires, décisions, actions,
  questions) ; **PowerPoint** (exporteur du Studio, commentaires de séance sur chaque diapositive) et **Imprimer / PDF**.
- **Stockage** : `review/storage.ts`, interface `ReviewStorage` (implémentation `LocalReviewStorage` : localStorage, synchronisé
  entre onglets) — Firestore viendra derrière la même interface. Modèle pur et testé : `review/model.ts`.
- **Démo Norvia (fictive)** installée au premier passage : « Revue pipeline — octobre 2026 » (Scénario Directeur commercial,
  réunion du 8 oct. terminée, compte rendu prêt) et « Business review — Budget 2026 vs réel 2025 » (Scénario Directeur
  financier, réunion du 9 oct. à venir). **Réinitialiser la démo** les recharge sans toucher à vos revues.
- **Nouvelle revue** : reprend les snapshots de l'histoire courante.
- Lien direct vers la revue pipeline : `…/reporting/#/revues/norvia-pipeline-oct-2026`.

## Mode lecture et export Morph (étape lecture)

- **Mode lecture** (`#/lire/<histoire>/<snapshot>`) : une diapositive plein écran par snapshot, construction animée du
  graphique (révélation 4D du film, zoom dans la marque quand l'étape prolonge ou remonte le chemin d'exploration), titre d'action, commentaires
  « À retenir » qui apparaissent un à un, cartouche. Navigation : toucher / clic (tiers gauche = précédent), **balayage**
  (iPad, iPhone), ←/→ (et ↑/↓, Page préc. / suiv.), Début / Fin, points de progression, **Pause** (espace : fige
  l'animation), **Rejouer** (R), Échap. Format portrait sur téléphone et tablette en portrait, cibles tactiles ≥ 44 px.
  Le lien de chaque diapositive est tenu à jour dans la barre d'adresse et copiable (bouton lien).
- **Entrées** : bouton **Mode lecture** du bandeau Histoire, de la fiche d'une revue et de la page participant ; tout lien
  `#/lire/…` ouvert directement (QR des diapositives).
- **Histoires** : `demo-dircom` et `demo-daf` = scénarios intégrés « Directeur commercial » et « Directeur financier »,
  **recalculés à l'ouverture depuis les données de démonstration embarquées** (mêmes lignes que les CSV publiés, mêmes
  identifiants de snapshots) : le lien s'ouvre sur **n'importe quel appareil**. `histoire` = histoire courante du Studio,
  `<id de revue>` = revue (les revues Norvia de démonstration existent sur tout appareil) : ces liens-là restent sur
  l'appareil qui les a créés (stockage local) ; ailleurs, un message l'explique et propose les démos.
  Exemples : `https://alteridea-dashboard.web.app/reporting/#/lire/demo-dircom/dircom-03-mois-focus`,
  `https://alteridea-dashboard.web.app/reporting/#/lire/demo-daf/daf-05-baisse-mois`.
- **PowerPoint** : le QR du cartouche de chaque graphique (bas droite) et le lien de l'image / du pied de page
  (« Mode lecture › ») ouvrent la diapositive en mode lecture ; le lien natif « Vérifier l'empreinte des données » reste
  dans le pied de page.
- **Option « Transitions Morph »** (case à côté de « Exporter en PowerPoint », désactivée par défaut) : chaque barre devient
  une **forme native** nommée d'après ses clés de données (`!!barre:<période>#0`, `!!ref:commercial=…#0`…) posée sur l'image
  du graphique sans ses barres ; titre, sous-titre, filet, image, commentaires portent aussi un nom `!!…`. Séquence de
  **construction** : amorce (barres à zéro, sans commentaires) puis graphique complet, donc PowerPoint fait pousser les
  barres. **Zoom** : la barre cliquée d'une étape et la zone du détail de l'étape suivante partagent le nom `!!zoom-<n>`.
  Après pptxgenjs, la transition est injectée dans le XML de chaque diapositive (JSZip) : `p159:morph` dans un
  `mc:AlternateContent`, **repli fondu** pour les logiciels qui ne connaissent pas Morph.
- **Limites** : Morph ne se vérifie vraiment que dans **PowerPoint 2019 / Microsoft 365** (LibreOffice et Keynote affichent
  le fondu) ; seules les barres (rectangles) deviennent natives — courbes, cartes, libellés restent dans l'image.
- **Contrôle** : `node studio/scripts/check-pptx.mjs Fichier.pptx` (transitions, repli, noms « !! » uniques, QR décodé de
  chaque graphique) ; démos : `node studio/scripts/demo-scenario.mjs --scenario dircom --morph Datanime-demo-pipeline-morph.pptx`.

## Pont Cadencer : manifeste de revue (étape Cadencer)

Cadencer anime la réunion (salle en direct, QR `/join/<code>`, accusés de lecture, tâches, PV) ; Datanime fournit les
snapshots. V1 **en tirage, sans secret partagé** : Datanime publie un JSON statique public par revue, Cadencer l'importe
par URL côté serveur et crée un point d'ordre du jour par snapshot. **Contrat complet : [`docs/contrat-cadencer.md`](docs/contrat-cadencer.md).**

- **Publication** : `npm run build:studio` enchaîne `vite build` et `studio/scripts/publish-manifests.mjs` (Chrome headless,
  même rendu que `demo-scenario.mjs`, déterministe) → `studio-dist/publie/index.json`, `publie/<revue>/manifeste.json`,
  une image `<snapshot>.png` (1600 × 900, image complète avec cartouche et QR vers le mode lecture) et `<snapshot>.svg`
  par snapshot, pour les 4 histoires autonomes : `demo-dircom`, `demo-daf`, `norvia-pipeline-oct-2026`, `norvia-budget-2026`.
  Le script valide chaque manifeste (Zod), la taille des PNG et le QR décodé. `DATANIME_SKIP_PUBLIE=1` : étape ignorée.
- **Adresses** : toutes dérivées de `PLATFORM_URL` (`brand.ts`) — ex.
  `https://alteridea-dashboard.web.app/reporting/publie/norvia-pipeline-oct-2026/manifeste.json`.
- **Studio** : bouton **Envoyer vers Cadencer** (bandeau Histoire, fiche d'une revue). Revue ou démo publiée : URL du
  manifeste (Copier) et marche à suivre « Dans Cadencer : ordre du jour › Ajouter › Revue Datanime › coller l'URL ».
  Histoire ou revue locale : **Télécharger le manifeste** (même JSON, PNG intégrés en `data:`) ; la publication en ligne
  des histoires personnelles arrive avec l'enregistrement en ligne.

## Infobulles et iPad (étape infobulles)

- **Partout** : chaque barre, segment, point, région de carte, marche de cascade, mois comparé, cellule du tableau croisé
  et petit multiple porte une infobulle riche — libellé, valeur au format français (k€ / M€), part du total, nombre
  d'opportunités / de lignes quand il est connu, écart vs la référence (moyenne des périodes précédentes, Réel 2025, PL / PY…)
  coloré selon la notation (vert / rouge, gris sous ±3 % ; coûts : une hausse est défavorable) et indication d'action
  (« Cliquer pour zoomer », « Cliquer pour détailler par … »). Vue jour par jour : cumul au jour J vs rythme de référence.
- **Données** : les graphiques posent un attribut `data-tip` (JSON compact, `charts/tip.ts`) ; plus de `<title>` natif
  (pas de double infobulle). `ui/tooltip.ts` affiche l'infobulle pétrole foncé : suit le curseur, reste dans la fenêtre,
  sans clignotement (contenu changé seulement au changement de marque, cible retrouvée pendant l'animation).
- **Toucher** (iPad / iPhone) : un toucher affiche l'infobulle ; sur un élément explorable, un second toucher zoome.
  Mode lecture : un toucher bref sur une marque affiche l'infobulle sans changer de diapositive (le balayage reste actif).
- **Clavier** : tabindex itinérant (une seule marque dans l'ordre de tabulation), flèches pour passer d'une marque à
  l'autre, Entrée pour explorer, Échap pour fermer ; libellé `aria-label` lisible.
- **Où** : prévisualisation du Studio, mode lecture, revues (réunion, compte rendu) et page participant. **Jamais** dans
  le film ni dans les exports : `composeSvg` retire `data-tip` et les attributs d'accessibilité (SVG, PNG, PowerPoint,
  Morph, manifestes publiés).
- **iPad 1366 / 1180 / 1024 px** : aucun débordement horizontal (barre du haut compacte — libellés des boutons Récit en
  infobulle sous 1180 px —, galerie des types sur plusieurs lignes, panneau de réglages entièrement visible). Vérifié par
  les tests de bout en bout. Carte « spéciale » (bibliothèque) : infobulle sur chaque région ; les points et le film 4D gardent l'infobulle de la bibliothèque. Aires empilées : une colonne invisible par catégorie (toutes les séries).

## Panneau de réglages en accordéon (étape H)

- **Cinq sections dans l'ordre du travail** : ① Données → ② Graphique → ③ Récit → ④ Style → ⑤ Export. Une seule
  section ouverte à la fois ; chaque en-tête affiche un **résumé d'une ligne** (« Région → Chiffre d'affaires (€) · Somme »,
  « Barres · tri décroissant · étiquettes · M€ », « Sombre · Bleu pétrole »…), Données coché quand les colonnes minimales
  sont choisies. L'essentiel en haut, le reste dans **« Plus d'options · N »** (aperçu des réglages repliés).
- **Aucun doublon** : un réglage = un seul contrôle (vérifié par les tests : chaque `data-path` est unique).
  « Sens favorable » remplace les anciennes cases « Hausse = défavorable » ; unité et décimales sur une ligne (− auto +).
- **Recherche de réglages** (« décimales », « légende », « unité »…) : sans accents, préfixes acceptés, les sections et
  options concernées s'ouvrent, le reste est masqué ; Échap efface.
- **Toucher un élément du graphique** ouvre la bonne section et met le réglage en surbrillance : titre / sous-titre /
  point à retenir → Récit, axe → Graphique › Axe X ou Y, légende → Légende, barre → tri / étiquettes / unité,
  cartouche ou QR → Export › QR, fond → Style › Fond. Les éléments explorables (zoom) gardent leur clic ; le double-clic
  sur un texte le modifie toujours directement. Logique pure dans `ui/panelMap.ts` (testée).
- **Barre du haut** : Explorer mes données, Scénarios, Snapshot, Revues, menu **Fichier** et bouton **Exporter** (menu)
  remplacent les 13 boutons et cases d'export et de configuration. Menus au clavier (↓ ↑, Échap).

## Identifiants de snapshots stables

Un snapshot de scénario garde le **même identifiant d'une génération à l'autre** : préfixe du scénario + position +
intitulé de l'étape (`dircom-03-mois-focus`, `daf-01-cascade`), **sans empreinte des données**. Cadencer rattache
ses points d'ordre du jour et ses accusés « J'ai vu » à cet identifiant : id stable dans une revue ; le contenu change
→ `empreinte` et `?v=` des images. Même identifiant pour les manifestes, les liens `#/lire/<histoire>/<snapshot>`,
les QR (cartouche, PowerPoint) et les noms d'images publiées (`publie/<revue>/<snapshot>.png?v=…`). Les anciens liens
à suffixe d'empreinte (`…-88z5ap`, `…-14j5oil`, `…-1051jsm`) ouvrent toujours la bonne diapositive
(`matchSnapshotId`, `story/scenarios.ts`).

## Architecture (`studio/src`)

| Module | Rôle |
| --- | --- |
| `spec.ts` | Schéma Zod du spec (`reporting-4d-studio/spec-v1`), valeurs par défaut, formats de fichier |
| `state.ts` | Store (spec + dataset + UI), émissions groupées, persistance localStorage |
| `data/table.ts` | Parsing tolérant FR/EN des nombres et dates, détection des types, `Dataset` |
| `data/files.ts` | Texte collé, JSON, classeurs (SheetJS chargé à la demande), limites d'import |
| `data/formula/*` | Moteur de formules maison (MIT) : analyseur, fonctions, graphe de dépendances, recalcul, Web Worker |
| `data/workbook.ts` | Classeur → modèle de cellules (formules, formats de date), matrices par onglet, score « tableau de données » |
| `data/structure.ts` | Détection de structure (en-tête, temps, sections, unités, Ouverture, résumé), large → long, Entité + Indicateur |
| `data/mapping.ts` | Modèle de la fenêtre « Mise en forme » : rôles, regroupements, filtres, X ⇄ Y, pivot vers le Studio |
| `data/samples.ts` | Jeux d'exemple déterministes ancrés au 8 octobre 2026 |
| `data/model.ts` | Agrégation (catégories, points), modèle temporel 4D et pondérations par image |
| `data/suggest.ts` | Choix automatique des encodages lors d'un changement de type |
| `format.ts` | Locale française d3 (espace insécable, virgule, U+2212), unités, dates |
| `norme.ts` | Mode norme (inspiré d’IBCS® / ISO 24896) : scénarios, écarts, orientation, sous-titre, formats, échelles communes |
| `theme.ts` | Thèmes, palettes, polices (`FontFace`, @font-face embarquées pour l'export) ; identité bleu pétrole (`PETROLE_COLORS`), couleurs d'écart réservées `VARIANCE_NEG` / `VARIANCE_POS` |
| `charts/*` | Rendu SVG pur : cartésien, radial, écarts IBCS (`variance.ts`), spéciaux (film / carte via la lib), mise en page, cartouche |
| `data/transform.ts` | Colonnes calculées et filtres du spec (`spec.transform`), mémoïsés |
| `data/variance.ts` | Modèle d'écarts réel / référence (sommes appariées) |
| `data/drill.ts`, `charts/drill.ts` | Exploration guidée : modèle pur (périodes, mois, carte, historique, détail), navigation, rendu SVG |
| `data/regions.ts`, `data/demoPipeline.ts` | Régions FR·BE ↔ identifiants de carte ; générateur de la démo pipeline (fictive, graine fixe) |
| `story/drillStory.ts`, `story/scenarios.ts` | Récit de l'exploration ; scénarios persona rejouables (rôles, étapes) |
| `story/*` | Rôles des colonnes, statistiques, détecteurs, narration, textes français, snapshots, export PowerPoint |
| `review/*` | Revues partagées : modèle, stockage, démo Norvia, pages liste / partager / participant / réunion / compte rendu, `review.css` |
| `brand.ts` | Nom du produit, URL de la plateforme, règle d'affichage du cartouche |
| `provenance.ts` | Empreinte des données (SHA-256), provenance, lien de vérification (construction / lecture), `VERIFY_BASE` |
| `qr.ts`, `charts/cartouche.ts` | QR en SVG pur (qrcode-generator) ; cartouche Datanime |
| `verifier.ts` | Page `verifier.html` : « Vérifier l'empreinte » |
| `export.ts` | SVG autonome, PNG, WebM, fichier de configuration ; stub GIF |
| `ui/drillBar.ts`, `ui/storyFilm.ts`, `ui/scenarioDialog.ts` | Barre d'exploration (fil d'Ariane), film de l'histoire et mode lecture, fenêtre Scénarios |
| `story/reading.ts`, `story/morph.ts`, `story/morphRender.ts` | Liens `#/lire/…` et démos autonomes ; Morph : noms « !! », injection XML (repli fondu), barres natives extraites du SVG |
| `charts/tip.ts`, `ui/tooltip.ts` | Infobulles : données `data-tip` par marque (tons d'écart, part, nombre, indication), affichage souris / toucher / clavier, nettoyage des exports |
| `publish/manifest.ts`, `ui/cadencerDialog.ts` | Pont Cadencer : schéma Zod du manifeste de revue et de l'index, adresses `publie/…`, empreintes ; fenêtre « Envoyer vers Cadencer » |
| `ui/*`, `main.ts` | Interface trois zones (données · aperçu · réglages), galerie, lecteur, Explorer, bandeau Histoire, édition directe, toasts, fenêtre « Mise en forme des données » (`ui/mapping.ts`) |

## Extensions prévues (V2, non construites)

- **Chartes graphiques** : `style.charterId` est réservé ; une charte surchargera palette, police, fond et logo.
- **Superposition de deux fichiers** : `studioFile.data` deviendra une liste de sources avec jointure par clé.
- **Bibliothèque d'icônes SVG** : marqueurs et pictogrammes référencés par id dans le spec.
- **Export GIF** : `exportGif()` dans `export.ts` (même boucle d'images que le WebM).
- **Firestore** : le fichier `reporting-4d-studio` (spec + données) est déjà du JSON sérialisable et validé.

Captures : `studio/docs/shots/`.

## Identité visuelle

**Datanime**, logo « Bulle + barres » (h1, choisi le 8 oct. 2026) : sources dans `src/assets/brand/` (© Alteridea,
voir son README), favicon SVG et apple-touch-icon 180 px dans `public/`. L'en-tête et le cartouche utilisent l'icône
en SVG inline (`brand.ts`), le PowerPoint son PNG 2×. Les noms techniques (`span-magnitude-viz`, clés
`reporting-4d-studio`, fichier `reporting-4d-studio.html`) restent inchangés.

Bleu pétrole : principal `#0E6E8C`, clair `#3FA7C4` (accents, boutons et mises en avant sur l'interface sombre),
foncé `#08465A`. Le rouge `#d62839` et le vert `#2e9e4f` sont réservés aux écarts défavorables / favorables
(graphique d'écarts normé IBCS / ISO 24896) : ne pas les utiliser comme couleurs d'accent.
