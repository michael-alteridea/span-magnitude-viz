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
  des exemples datés au 8 octobre 2026 (prévisions jusqu'à fin 2026), dont « Pipeline Salesforce » (300 opportunités FR/BE)
  « Business review grand compte » (Réel / Budget / N-1 / Prévision mensuels, janv. 2025 → déc. 2026)
  et son préréglage « Revue mensuelle (norme) », et trois exemples « barres racontées » (étape I, Norvia, fictifs).
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
  PNG 1× / 2× / 3×, vidéo WebM (MediaRecorder, côté navigateur), PowerPoint de la séquence. Menu **Projets ▾** :
  Mes projets…, Enregistrer, Exporter le projet (.datanime), Ouvrir un fichier… (.datanime ou ancienne configuration
  .r4d.json), Réinitialiser (voir « Projets »). GIF : entrée prévue, V2.
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
- **Séquence** (anciennement « Histoire ») : « 📸 Ajouter la scène » ajoute le graphique (spec, SVG, vignette, textes) au bandeau ; glisser pour
  réordonner, renommer, supprimer, cliquer pour recharger ; « Ordonner en récit » (contexte → tension → révélation →
  recommandation). Persistée dans `localStorage` (`reporting-4d-studio:story:v1`) et dans le JSON enregistré.
- **Exporter › PowerPoint de l'histoire** (pptxgenjs chargé à la demande) : couverture pétrole, sommaire, une diapositive par
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

- **Espace « Revues »** (bouton **Mes revues** de la barre du haut, ou `#/revues`) : liste des revues (persona, date de réunion,
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
- **Option « Transitions Morph »** (case du bandeau Histoire, utilisée par Exporter › PowerPoint de l'histoire, désactivée par défaut) : chaque barre devient
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
- **iPad 1366 / 1180 / 1024 px** : aucun débordement horizontal (barre du haut de 48 px, bande des types sur une seule
  ligne avec « Plus +n », panneau de réglages entièrement visible). Vérifié par
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
- **Barre du haut** : voir « Menu du haut (variante B) » ci-dessous. Menus au clavier (↓ ↑, Échap).

## Identifiants de snapshots stables

Un snapshot de scénario garde le **même identifiant d'une génération à l'autre** : préfixe du scénario + position +
intitulé de l'étape (`dircom-03-mois-focus`, `daf-01-cascade`), **sans empreinte des données**. Cadencer rattache
ses points d'ordre du jour et ses accusés « J'ai vu » à cet identifiant : id stable dans une revue ; le contenu change
→ `empreinte` et `?v=` des images. Même identifiant pour les manifestes, les liens `#/lire/<histoire>/<snapshot>`,
les QR (cartouche, PowerPoint) et les noms d'images publiées (`publie/<revue>/<snapshot>.png?v=…`). Les anciens liens
à suffixe d'empreinte (`…-88z5ap`, `…-14j5oil`, `…-1051jsm`) ouvrent toujours la bonne diapositive
(`matchSnapshotId`, `story/scenarios.ts`) et leurs anciennes adresses d'images servent toujours une vraie image (copies
publiées par `scripts/publish-manifests.mjs`). Un identifiant inconnu affiche « Ce snapshot n'existe plus ou a été
renommé » avec « Ouvrir la diapositive 1 » (capture `docs/shots/103-lecture-snapshot-introuvable.png`).

**Empreintes (contrat 1.1, complément).** L'empreinte d'un snapshot couvre `alt`, `titre`, `a_retenir`,
`commentaire_genere`, `commentaire_animateur` et l'image (contenu, rôle, graphique, données) : une note d'animateur·rice
modifiée seule change l'empreinte et le `?v=`. L'empreinte de la revue (manifeste, `index.json`) couvre les champs de la
revue et la suite ordonnée des empreintes de snapshots ; l'empreinte des données du cartouche est dans
`empreinte_donnees`. Détail : `docs/contrat-cadencer.md`.

## Barres racontées : icônes, pictogrammes, objectif, mise en avant (étape I)

> Galerie des types (au-dessus de l'aperçu) : chaque tuile prend la largeur de son libellé (aucun texte ne déborde,
> points de suspension en dernier recours) ; le type choisi est marqué par un filet pétrole au-dessus du pictogramme et
> sous le libellé (sur iPad, icônes seules : filets au-dessus et au-dessous du pictogramme).

Pour les barres simples (verticales ou horizontales, hors mode norme), **② Graphique › Extrémité des barres** propose :

- **Icône** : une pastille au bout de chaque barre, avec une icône choisie d'après le nom de la catégorie
  (dictionnaire français / anglais : Hébergement → nuage, Équipe → personnes, Licences → clé, Serveurs, Logistique →
  camion, Agences → bâtiments…). Pas de correspondance → pas d'icône. **Plus d'options › Icône par catégorie** : « Auto »,
  « Aucune » ou une icône choisie dans une liste illustrée (chaque pictogramme dessiné à côté de son libellé français,
  recherche, clavier ↑ ↓ Entrée Échap ; icône automatique affichée en gris). Une seule mesure, sans série.
- **Pictos** (isotype) : icônes pleines jointives dans la barre ; l'unité (1, 2 ou 5 × 10ⁿ) est calculée pour garder des
  icônes lisibles, la dernière est coupée à la valeur exacte ; la clé « icône = 50 k€ » est en haut à droite.
- **Objectif** : 1re mesure = réalisé, 2e = objectif. Repère d'objectif sur chaque barre, pastille verte (atteint) ou rouge
  (non atteint), étiquette « 255 k€ · 116 % » toujours au-delà du repère. Le récit devient « 4 commerciaux sur 6 ont atteint
  leur objectif » (meilleur taux, manques, taux global).

**③ Récit › Plus d'options › Mise en avant** : une barre en couleur (catégorie choisie ou « la plus grande »), les autres
en gris, une **annotation reliée** à la barre (titre et texte calculés — valeur, part du total, « N fois la moyenne des
autres » — ou saisis) et la ligne **« Moyenne des autres »** (derrière les barres, jamais sur une étiquette). Toucher
l'annotation ouvre ces réglages ; toucher une icône ouvre « Extrémité des barres ».

Tout est en SVG (chemins d'icônes intégrés, aucune police d'icônes) : rendu identique en SVG, PNG, vidéo et PowerPoint.
Icônes [Phosphor](https://phosphoricons.com) (graisses regular et fill), **licence MIT** : `src/charts/icons/LICENSE-phosphor.txt`,
publiée avec le Studio dans `licences/phosphor-icons-MIT.txt`. Le jeu (77 icônes) est régénéré par
`node studio/scripts/gen-phosphor.mjs [dossier @phosphor-icons/core]`. Exemples fictifs (Norvia) : « Budget informatique
par poste », « Dossiers en retard par gestionnaire », « Objectifs commerciaux T3 2026 ».

## Reel : mini-film pour les réseaux sociaux (étape K)

**Créer un Reel** (bandeau Histoire, ou bouton « Reel » d'une revue) transforme 3 à 5 snapshots en une vidéo courte
pour Instagram, TikTok ou LinkedIn, entièrement dans le navigateur (aucun serveur). Au-delà de 5 snapshots, un
avertissement invite à cocher ceux à garder (les 5 premiers sont cochés). Histoire vide : le Reel d'exemple s'ouvre
en 1 clic (aussi par `?reel=exemple`).

- **Formats** : 9:16 (1080 × 1920, Reels / TikTok / Stories), 1:1 (1080 × 1080), 16:9 (1920 × 1080). Marges de sécurité
  propres à chaque format (en 9:16, 220 px en haut et 400 px en bas restent libres pour l'interface des applications).
- **Durée** : 15 à 30 s au total, carte de fin comprise (3 s). La durée de chaque scène est calculée d'après la longueur
  du titre, la présence d'un chiffre clé et le nombre de marques (2,8 à 5,2 s au rythme « Nerveux »), puis ajustée pour
  rester dans les bornes ; chaque durée reste modifiable (2,5 à 8 s), « Durées auto » revient au calcul.
- **Rythme : Nerveux / Normal / Calme** (Nerveux par défaut, proche du film d'accueil : graphique construit en 1,15 s,
  chiffre qui compte en 0,9 s, coupes de 0,2 s). Normal et Calme multiplient durées de scène, comptage et transitions
  par 1,2 et 1,45 ; les durées saisies à la main sont conservées jusqu'à « Durées auto » ou un changement de rythme.
- **Ordre des scènes** : glisser une scène par sa poignée (souris, doigt sur iPad ou stylet ; la liste défile seule
  quand on approche de son bord), ou boutons « Monter / Descendre la scène » (clavier, lecteurs d'écran). L'ordre du
  Reel ne modifie pas l'histoire.
- **Mise en avant** : un snapshot suivi de sa copie « mise en avant » (même graphique) forme une liaison : pas de fondu,
  le graphique reste en place et la part se détache, les autres passent en gris, la bulle apparaît (0,9 s).
- **Scène** : titre court modifiable (Poppins ExtraBold, retour à la ligne équilibré, jamais un chiffre séparé de son
  unité), chiffre clé qui compte (extrait du titre ou du commentaire : « 26,2 % », « ×7,8 », « 4 sur 6 » ; les années
  sont ignorées), graphique redessiné pour l'image (cadré sur son contenu, textes agrandis) avec les animations 4D
  existantes (barres qui poussent, carte qui se remplit, **zoom dans la marque** entre un parent et son détail), petit
  cartouche en bas à droite : logo, date de génération, source, licence des données et QR.
- **Carte de fin** : logo, « Vos données. Racontées. », lien `PLATFORM_URL` et QR (obligatoires en offre gratuite).
- **Licence des données** : préremplie depuis la source du jeu de données (exemples fictifs : « Données fictives
  (démonstration) ») ; vide → l'export est bloqué et le champ est signalé (raccourcis « CC BY 4.0 », « Données internes »…).
- **Aperçu** dans la fenêtre (lecture, pause, curseur), image par image : chaque image est une fonction du temps, l'aperçu
  et l'export sont identiques.
- **Export** : MP4 H.264 (WebCodecs `VideoEncoder` + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), licence MIT,
  `licences/mp4-muxer-MIT.txt`), 30 images/s, image clé toutes les 2 s, plus rapide que le temps réel. Navigateur sans
  WebCodecs H.264 : repli par `MediaRecorder` en temps réel (WebM VP9/VP8, ou MP4 sur Safari), images sautées si le rendu
  prend du retard. Barre de progression, bouton « Annuler l'export ». Fichier `datanime-reel-<titre>-<format>.mp4`.
- **iPad / Safari : limites** (vérifié dans Chrome sans écran sur le serveur de test ; pas encore essayé sur un iPad
  réel) :
  - iPadOS / Safari **16.4 ou plus** : WebCodecs `VideoEncoder` H.264 disponible → MP4 direct, plus rapide que le temps
    réel (profil High 4.0 essayé d'abord, puis Main, puis Baseline selon `VideoEncoder.isConfigSupported`).
  - iPadOS **14.5 à 16.3** : pas de WebCodecs → repli `MediaRecorder` (MP4 H.264) **en temps réel** : un Reel de 25 s
    prend 25 s, des images peuvent être sautées sur un iPad ancien (le mouvement reste à la bonne vitesse).
    Plus ancien : export impossible, la fenêtre l'indique (ligne « Ce navigateur… » sous les formats).
  - Garder Safari **au premier plan, écran allumé** : en arrière-plan ou écran verrouillé, Safari suspend le rendu et
    l'export s'interrompt (relancer l'export).
  - Mémoire : les images ne sont jamais conservées (encodées au fil de l'eau) ; seul le fichier final (≈ 4 à 8 Mo pour
    25 s en 1080 × 1920) reste en mémoire jusqu'au téléchargement.
  - Polices intégrées à chaque image (Inter, Poppins en data: URL) : aucun appel réseau pendant l'export, rendu
    identique hors ligne.
  - Téléchargement : Safari range la vidéo dans Fichiers › Téléchargements ; pour la publier, l'ouvrir dans Fichiers
    puis « Partager › Enregistrer la vidéo » (Photos) ou directement vers Instagram / LinkedIn.
  - Le MP4 est en plage de couleurs « pleine » (yuvj420p, signalée dans le fichier) : lu correctement par Chrome
    et ffmpeg / VLC ; Instagram, TikTok et LinkedIn réencodent la vidéo de toute façon.
- **Exemple de vidéo** : `docs/reel-exemple-9x16.mp4` (exporté par l'application elle-même, WebCodecs H.264 High,
  1080 × 1920, 30 i/s, 19,2 s au rythme « Nerveux », 576 images, ≈ 4,4 Mo, image clé toutes les 2 s, `moov` en tête) ; carte de fin :
  `docs/reel-exemple-9x16-fin.png`.
- **Exemple intégré** : « Énergies renouvelables dans l'UE », données publiques Eurostat (`nrg_ind_ren`, part des
  renouvelables dans la consommation finale brute d'énergie, 2004-2025), **licence CC BY 4.0** (réutilisation commerciale
  autorisée, source citée) ; 4 scènes : moyenne de l'UE, les 10 premiers, les 5 derniers, la Belgique depuis 2004.
  Jeu régénéré par `node studio/scripts/gen-eurostat-renouvelables.mjs`.
- **Police des titres** : Poppins ExtraBold, licence SIL Open Font License 1.1 (`licences/poppins-OFL.txt`), intégrée
  au fichier vidéo (aucun appel réseau).

Modules : `src/reel/plan.ts` (formats, durées, chiffre clé, mise en page), `compose.ts` (image SVG en fonction du
temps), `charts.ts` (graphique redessiné pour l'image, zoom dans la marque), `encode.ts` (MP4 / WebM), `scenes.ts`,
`example.ts`, `src/ui/reelDialog.ts`. Tests : `test/reel.test.ts`, e2e (création, aperçu, formats, rythme, ordre des
scènes à la souris et au doigt, licence vide, annulation, export MP4 vérifié par ffprobe : 1080 × 1920, durée attendue).
Captures : `docs/shots/84` à `87`, `98`, `101` (rythme), `102` (ordre des scènes, iPad).

## Mise en avant d'un élément (étape L)

La mise en avant des barres (étape I) s'étend à tous les graphiques où un élément se distingue : on met en avant
**un** élément, les autres passent en gris, une bulle d'annotation reliée par un trait le commente.

| Graphique | Élément | Effet |
| --- | --- | --- |
| Barres (une série) | barre | couleur gardée, autres en gris, bulle, « Moyenne des autres » (option) |
| Camembert, donut | part | la part se détache du centre, autres en gris, bulle à côté (paysage) ou dessous / dessus (portrait, Reel) |
| Arcs radiaux | arc | arc en couleur, autres en gris, bulle hors du disque et des libellés |
| Nuage de points | point | halo, autres points estompés, nom en gras, bulle |
| Courbes, aires (une série) | point | halo sur le point, autres points estompés, bulle |
| Courbes, aires (plusieurs séries) | série | série en couleur et plus épaisse, autres en gris, bulle au dernier point |
| Exploration › Carte | région | région en couleur et contour, autres en gris, bulle avec l'écart, **barre d'échelle en km toujours visible** |

- **Choisir** : Récit › Mise en avant (liste des éléments, « La plus grande (auto) »), ou **« Choisir sur le graphique »**
  puis toucher l'élément (bandeau « Touchez l'élément à mettre en avant », « Annuler »). Une fois la mise en avant
  active, toucher un autre élément la déplace (hors exploration, où le toucher sert à descendre d'un niveau). Les
  textes posés sur une marque (pourcentage d'une part) laissent passer le toucher.
- **Commenter** : « Titre de l'annotation » (calculé par défaut : valeur et part du total) et « Texte de l'annotation »
  (calculé : comparaison à la moyenne des autres).
- **Dupliquer et mettre en avant** (icône sur chaque carte de l'histoire) : copie du snapshot insérée juste après lui,
  mise en avant active (la plus grande valeur), choix de l'élément ouvert. Les retouches (élément, titre, texte) sont
  reportées sur la copie tant que le graphique reste le même ; l'original reste neutre. L'histoire passe ainsi de la
  vue d'ensemble à l'élément commenté.
- **Transition animée** neutre → mis en avant : Film et mode lecture (sans fondu : grisé, part tirée, halo, bulle en
  1 s), Reel (liaison « focus », voir ci-dessus), PowerPoint Morph (formes natives : parts de donut en arcs épais,
  parts de camembert en secteurs, arcs radiaux, points et halo du nuage ; noms « !!part:… », « !!arc:… », « !!point:… »
  identiques d'une diapositive à l'autre, Morph anime la part qui se détache et le passage au gris).
- **Limites** : la mise en avant des courbes est un point (une série) ou une série (plusieurs séries), pas les deux à
  la fois. Courbes, aires et carte restent dans l'image de fond en PowerPoint : la transition y est un fondu (pas de
  forme native). La carte « spéciale » de la bibliothèque (points animés en 4D) n'a pas de mise en avant ; la carte
  de l'exploration (« Répartir dans l'espace ») l'a. Barres groupées / empilées, cascade et mode norme : pas de mise en
  avant (plusieurs valeurs par catégorie).
- **Contrat Cadencer inchangé** : aucune nouvelle propriété de spec, mise en avant vide par défaut ; manifestes publiés,
  identifiants de snapshots et empreintes identiques.

Modules : `src/charts/focus.ts` (choix, transitions, bulle et placement), `radial.ts`, `cartesian.ts`, `drill.ts`
(rendus), `src/ui/focusUi.ts`, `settings.ts`, `preview.ts`, `storyStrip.ts`, `storyFilm.ts`, `src/story/morphRender.ts`.
Tests : `test/focus.test.ts`, e2e `--focus` (chaque type, toucher pour choisir, duplication, film, PowerPoint, Reel,
carte, iPad 1024 et 1366 px). Captures : `docs/shots/88` à `100`.

## Données publiques (exemples ouverts, licence compatible usage commercial)

Section **« Données publiques »** du panneau Données, sous les exemples fictifs, groupée par thème. Chaque exemple
porte sa licence (réutilisation commerciale permise, mention de la source) et un raccourci **« Créer un Reel »**
(histoire suggérée de 3 à 5 snapshots, identifiants stables).

| Thème | Exemple | Producteur · licence |
| --- | --- | --- |
| Dette publique | Dette publique dans l'UE (% du PIB, M€, €/habitant) | Eurostat · CC BY 4.0 |
| CO₂ & climat | Énergies renouvelables dans l'UE (déplacé ici) | Eurostat · CC BY 4.0 |
| CO₂ & climat | CO₂ dans l'atmosphère, Mauna Loa (mensuel) | NOAA · domaine public (mesures à partir de mai 1974) |
| CO₂ & climat | CO₂ fossile par pays et zone | Global Carbon Project · CC BY 4.0 |
| CO₂ & climat | Gaz à effet de serre dans l'UE | Eurostat · CC BY 4.0 |
| Démographie | Fécondité et âge médian dans l'UE | Eurostat · CC BY 4.0 |
| Démographie | Population mondiale 1950-2100 | ONU (WPP 2024) · CC BY 3.0 IGO |
| Démographie | Âges par province en Belgique (agrégé aux provinces) | Statbel · CC BY 4.0 |
| Nature | Zones protégées dans l'UE | Eurostat (d'après l'AEE) · CC BY 4.0 |

- **Cartouche prérempli** : « Source : Eurostat (<code du tableau>) · données adaptées · Licence : CC BY 4.0 »
  (idem pour chaque producteur). Le Reel affiche la source et « Licence des données : … ».
- **Modifiable comme vos données** : type, couleurs, libellés, mise en avant, snapshots. Dans l'aperçu,
  **« Modifier »** rend les cellules éditables (virgule décimale acceptée, filtre « Belgique 2024 », 60 lignes
  affichées) : le jeu devient « … (modifié) », la source reçoit « · données modifiées » et la session le conserve.
- **Cartes** : fond Europe (pays, latitude/longitude ; agrégats UE-27, États-Unis, Chine sans position, gardés pour
  barres et courbes), une seule année filtrée. Un taux (%) n'est jamais additionné : titre « X en tête, Y en dernier »,
  moyenne simple, compteur de somme masqué.
- **Modules** : `src/data/public/` (données régénérées par `_build/gen_public_samples.py`), `catalog.ts` (thèmes,
  lignes, histoires suggérées), `src/data/licence.ts`.

Tests : `test/publicData.test.ts` (thèmes, licences commerciales, CC BY 3.0 IGO, NOAA, histoires 3 à 5 snapshots, spec
valides, crédit Eurostat), e2e `--public`. Captures : `docs/shots/104` à `108`.

### Repère de scène : modification ou exploration libre

Un bandeau au-dessus du graphique dit toujours où l'on est (calque HTML : jamais dans les exports PNG, SVG, PowerPoint,
vidéo ni dans les snapshots) :

- **Exploration libre** : « Exploration libre · rien n'est enregistré » et **Ajouter la scène** ; cadre gris discret
  autour du graphique ; aucune carte de la Séquence en surbrillance.
- **Scène de la Séquence ouverte** (toucher sa vignette) : « Scène N de la Séquence · en modification » (+ son nom),
  **Annuler** (la scène reste telle quelle, l'éditeur retrouve l'exploration d'avant) et **Valider** (la scène est
  remplacée par le graphique courant, même place, même identifiant) ; cadre **orange** ; la carte de la scène est en
  surbrillance orange (`aria-current`). Ouvrir une autre scène bascule sur elle ; supprimer la scène revient à
  l'exploration. « Dupliquer et mettre en avant » ouvre la copie en modification.
- **Scène du Reel** (« Modifier le graphique ») : « Scène N du Reel · en modification », Annuler / Valider, cadre orange.
- iPad : textes secondaires masqués sous 1100 px, boutons de 44 px au toucher, pas de débordement.
  Code : `ui/sceneBanner.ts` ; e2e `--repere-scene --shots` (captures 176 et 177).

### Reel : « Modifier le graphique » d'une scène

Chaque scène de la fenêtre « Créer un Reel » a un bouton **« Modifier le graphique »** : la fenêtre se met de côté
(rien n'est perdu), le snapshot s'ouvre dans l'éditeur complet (type, couleurs, mise en avant, réglages) avec le bandeau
**« Scène N du Reel · en modification — Annuler / Valider »** au-dessus du graphique (cadre orange, voir « Repère de
scène »). *Valider* remplace le snapshot sur place (même
position, même identifiant ; aussi dans l'histoire s'il en fait partie) et rouvre le Reel sur la scène redessinée, en
gardant titre, chiffre clé, légende et durée retouchés, le rythme, l'ordre et le format. *Annuler* rouvre le Reel
inchangé et rend à l'éditeur son état d'avant. Boutons de 44 px au toucher (iPad). e2e `--public` ; captures
`docs/shots/109` à `111`.

## Nombre d'éléments et Filtre de vue (Réglages › ① Graphique)

Visibles en haut de ① Graphique (ex-section Données, fusionnée au déploiement 2) (pas sous « Plus d'options ») :

- **Nombre d'éléments** (barres, horizontales, groupées, empilées, secteurs, anneau, arcs, écarts ; catégories non
  temporelles) : *Tous / Top 5 / Top 10 / Top 20 / Perso* (1 à 100), **Classement** *Les plus grands* (valeur
  absolue) ou *Les plus petits* (`encoding.topOrder: "bottom"`), case **Regrouper le reste en « Autres »** (sommes et
  comptages), indication « 10 sur 27 pays affichés ».
- **Filtre de vue** (ex-« Filtrer », ce graphique seulement) : une colonne → *Garder* ou *Exclure* des valeurs (liste à cocher avec recherche, nombre de lignes par
  valeur) ; colonne de dates ou d'années → une année ou une période (*De … À …*). Écrit dans `transform.filters`, mêmes
  pastilles que l'Explorer (une période = une pastille ; × la retire).
- Recherche de réglages : « top », « classement », « nombre de barres », « filtre », « autres ».
- Sous-titre : une période filtrée n'est plus répétée ; données annuelles datées « 2023 » ou « 2000 – 2025 ».
- Titre calculé en mode *Les plus petits* : il parle du dernier affiché (« Finlande en dernier : 13 %, −14 pts vs la
  moyenne »), jamais d'un élément masqué par le classement ; pas de lecture « concentration » dans ce mode.
- Contrat Cadencer inchangé : `topOrder` par défaut (« top ») est exclu de l'empreinte ; empreintes publiées
  identiques.

Tests : `test/model.test.ts` (top / plus petits / Autres), e2e `--topn` (iPad 1024 px, toucher). Captures
`docs/shots/112` et `113`.

## Fenêtre « Données » (une seule porte d'entrée)

- **Où** : barre du haut › **Ouvrir des données**, ou panneau Datasets › Source › **Remplacer**. Lien direct :
  `?donnees=publiques` (onglet Données publiques), `?donnees=ouvrir` (Récents s'il y en a, sinon Importer un fichier) ;
  aussi `fichier`, `coller`, `recents`, `exemples`. `?reel=exemple` reste valable.
- **Onglets** (fenêtre pleine page, onglets à gauche ; en haut sur iPad, cibles de 44 px) :
  1. **Importer un fichier** : zone de dépôt + parcourir (même chemin d'import), « Mise en forme des données… ».
  2. **Coller un tableau** (Excel, Google Sheets).
  3. **Récents** : les 10 derniers jeux ouverts ou importés (nom, type, date, lignes × colonnes), rouverts d'un
     toucher. Gardés dans ce navigateur uniquement (`localStorage`, rien n'est envoyé) ; le tableau n'est gardé que
     s'il reste raisonnable (≈ 300 000 caractères) — sinon « réimportez le fichier ». Logique pure `data/recents.ts`.
  4. **Exemples** (données d'entreprise fictives) et « Scénarios ».
  5. **Données publiques** par thème, puce de licence, « Créer un Reel ».
- Le panneau Données ne garde que l'essentiel : Explorer, jeu courant, « Changer de données », aperçu (Modifier).
- Pas d'ouverture automatique à la première visite : un exemple est toujours chargé au démarrage (et les liens
  directs restent prioritaires).

Tests : `test/recents.test.ts`, e2e `--donnees` (iPad 1024 × 768 tactile puis 1366 × 1024). Captures
`docs/shots/118` (Données publiques, iPad), `118b` (1366), `119` (Récents), `120` / `121` (panneau simplifié).

## Titre calculé et mise en avant

Quand un élément est mis en avant (`style.focus.key` : barre, part, arc, point, série, point de courbe), le titre
calculé parle de cet élément — « Occitanie : 3,1 M€, 14 % du total », « Belgique : 14,9 %, −11 pts vs la moyenne »,
« Julie M. : 47 dossiers en retard, 49 % du total » — et les premiers points à retenir donnent son rang et la moyenne
des autres ; le sous-titre garde le contexte. Un titre saisi l'emporte toujours. Sans mise en avant, le titre
générique revient. Le titre de l'annotation, le snapshot, la copie « Dupliquer et mettre en avant » et le chiffre
clé du Reel suivent l'élément. Logique pure `analyzeFocus` (`story/insights.ts`), tests `test/focusTitle.test.ts`.

## Nuage de points : « Forme des points » (icônes)

Réglages › ① Graphique › « Forme des points » : **Ronds** (par défaut, rendu inchangé), **Une icône** (la même icône pour tous les points, choisie dans la fenêtre illustrée « Icône ▾ ») ou **Par groupe** (une icône par groupe de « Couleur par » ; une ligne « Icône par groupe (colonne) » par groupe, même fenêtre de choix que les extrémités de barres, bibliothèque Phosphor).

- Les icônes prennent la couleur du groupe ; « Taille des bulles » reste active (taille minimale lisible de 16 px).
- Libellés, infobulles, mise en avant (icône choisie en couleur, autres en gris, bulle) et animation d'entrée / Reel fonctionnent comme avec les ronds.
- Légende : chaque groupe affiche son icône.
- Spec : `style.pointShape` (`circle` | `icon` | `iconByGroup`), `style.pointIcon`, `style.pointIcons` (groupe → icône). À leurs valeurs par défaut, ces champs n'entrent pas dans l'empreinte : les empreintes existantes ne changent pas.
- Tests : `test/pointIcons.test.ts`, `node studio/scripts/e2e.mjs --points --shots` (captures 140 à 144).

## Projets (modèle « dataset d'abord », déploiement 1)

Vocabulaire de l'interface : **séquence** (ex-« histoire ») et **scène** (ex-« snapshot »). Le code, le manifeste de
revue et le contrat Cadencer 1.1 (gelé) gardent « snapshot » : mêmes identifiants, mêmes empreintes
(`ce2105aa` / `32865c65` / `4a7f3c6c` / `6696d02e` vérifiées à chaque construction).

- **Un projet** = la source de données courante (exemple intégré référencé, ou lignes importées copiées) + l'état du
  graphique (spec) + la séquence (scènes ordonnées, titre, « Même échelle », « Transitions Morph »).
- **Stockage sur l'appareil** : IndexedDB `datanime-studio` (magasins `projets` et `resumes`), pas `localStorage`
  (plafond ~5 Mo). `localStorage` ne garde que le pointeur du projet ouvert (`datanime:projet-courant:v1`) ; la copie
  de travail reste la session du Studio. Rien n'est envoyé. Sans IndexedDB (navigation privée stricte) : repli en
  mémoire, l'export `.datanime` reste possible.
- **Bande « Séquence »** : ligne d'état « ● Enregistrée sur cet appareil · HH:MM » (ou « Modifications non
  enregistrées »), puis **Enregistrer**, **Ouvrir…** (Mes projets), **Réinitialiser ▾**, **📸 Ajouter la scène**,
  **Ordonner**, **▶ Film** ; seconde rangée **Mode lecture**, **Créer un Reel**, **Cadencer**. « Même échelle » et
  « Transitions Morph » sont passées dans Réglages › Export › « Séquence (film et PowerPoint) ».
- **Réinitialiser ▾** (bande ou Projets ▾), chaque choix confirmé : *Revenir au dernier enregistrement* ;
  *Vider la séquence* (garde la source et le graphique) ; *Tout réinitialiser* (exemple par défaut, séquence vide,
  projet détaché ; les projets enregistrés restent dans Mes projets).
- **Par scène** : badge « modifiée » (ou « nouvelle ») quand la scène diffère du dernier enregistrement (graphique,
  textes, rôle, nom — pas les rendus ni les dates) ; **↺ Réinitialiser la scène** lui rend son état enregistré, à sa
  place, même identifiant. L'état « modifiée » se calcule par comparaison : aucun champ n'est ajouté aux scènes ni au
  spec, donc rien de nouveau dans l'empreinte.
- **Mes projets** (Projets ▾ › Mes projets…, ou Séquence › Ouvrir…) : vignette, nom, date, nombre de scènes, source ;
  Ouvrir, Dupliquer, Exporter (.datanime), Renommer, Supprimer (confirmé) ; recherche ; « Importer un .datanime » ;
  « + Nouveau projet » ; bandeau « Stockés uniquement sur cet appareil » et jauge d'occupation.
- **Fichier `.datanime`** : JSON `{ kind: "datanime-project", version: 1, exportedAt, withData, project }`.
  L'ancienne configuration `.r4d.json` s'ouvre toujours (Projets ▾ › Ouvrir un fichier…).
- **Quitter la page** avec des modifications non enregistrées : avertissement du navigateur (`beforeunload`).
- `?reset` : session neuve, détachée du projet ouvert. Premier lancement avec une histoire existante : elle devient
  le projet « Mon projet » (enregistré).
- Code : `src/project/project.ts` (modèle, signatures, fichier), `src/project/repo.ts` (IndexedDB / mémoire),
  `src/project/controller.ts` (projet ouvert), `src/ui/projectsDialog.ts`, `src/ui/confirm.ts`.
  Tests : `test/project.test.ts` ; e2e `node studio/scripts/e2e.mjs --projets [--shots]` (iPad 1024 et 1366,
  captures `docs/shots/130…136`).

## Datasets dérivés (déploiement 2)

Une source par projet (jamais modifiée) ; des **datasets dérivés** D1, D2… = la source + des filtres permanents + un
choix de colonnes, nommés et réutilisés par les graphiques et les scènes.

- **Créer** : panneau gauche **Datasets** › **+ Nouveau dataset depuis la source** → fenêtre Données, étape
  **② Filtrer** : pastilles empilées (« Pays 4 sur 5 (sans Allemagne) » › « Année 2025 → 2026 » › « Secteur Industrie,
  Santé », chacune avec son nombre de lignes, × la retire, **+ Filtre** en ajoute une), fenêtre de valeurs (Tout / Aucun /
  Inverser, période *De … À …*), compteur en direct « 64 lignes sur 240 · 27 % », colonnes gardées à gauche, nom proposé
  d'après les filtres, puis **Enregistrer comme dataset** (ou *Utiliser sans enregistrer* = filtre de vue).
- **Panneau Datasets** : carte Source (*Remplacer*, *Aperçu*), arbre « Datasets dérivés » (Source entière, D1, D2… avec
  pastilles, lignes, scènes ; ✎ *Modifier*), « Colonnes de D1 », *Explorer ce dataset*, aperçu de la source.
- **Réglages › ① Graphique** (la carte Données disparaît ; cartes renumérotées ① Graphique, ② Récit, ③ Style,
  ④ Export) : en haut **Dataset ▾** + *Modifier*, colonnes, calcul, **Nombre d'éléments** et **Filtre de vue** (ce
  graphique seulement ; le filtre permanent est sur le dataset). Le résumé de carte commence par « D1 · ».
- **Modifier un dataset utilisé** : dialogue « N scènes utilisent ce dataset » (avant → après, lignes, vignettes des
  scènes, avertissement si une scène est partagée dans Cadencer) : **Mettre à jour les N scènes** (chiffres, titres
  calculés et commentaires recalculés ; textes saisis gardés), **Garder les scènes figées** sur la version actuelle
  (le dataset passe en v+1 ; scènes et empreintes inchangées) ou **Enregistrer plutôt comme nouveau dataset**.
- **Séquence** : chaque carte de scène porte sa pastille « D1 », « D1 v2 · figée » ou « Source entière ».
- **Vérifiabilité** : QR et empreinte des données restent ceux du **fichier source** ; le nom du dataset apparaît dans
  le sous-titre. Contrat Cadencer 1.1 inchangé : `dataset` absent (null) n'entre pas dans l'empreinte, les empreintes
  publiées ne changent pas.
- **Spec / projets** : `spec.dataset` = `{ id, version, name, filters, columns }` (recette recopiée : une scène figée
  reste reproductible). Les projets et fichiers `.datanime` enregistrent leurs datasets ; les anciens s'ouvrent sans
  changement (aucun dataset, « Source entière »).
- Tests : `test/datasets.test.ts`, `node studio/scripts/e2e.mjs --datasets --shots` (iPad 1366 et 1024, toucher ;
  captures 150 à 156).

## Sélection par touchers successifs (série A)

Les niveaux : **Page › Graphique › Barres (la série) › une barre › son libellé**. Souris et toucher se comportent de
la même façon.

- **Toucher un objet situé dans la sélection courante** descend d'un niveau **vers lui**, quel que soit l'endroit
  exact : graphique choisi, toucher une barre → sa série ; série choisie, toucher une de ses barres → cette barre ;
  barre choisie, toucher la barre ou son libellé → le libellé. Toucher au même endroit continue donc de descendre.
- **Toucher un objet hors de la sélection courante le sélectionne directement, au même niveau** (choix retenu : plus
  direct que « remonter d'un cran », on garde le niveau où l'on travaille) : une barre choisie, toucher une autre
  barre → cette autre barre ; une série choisie, toucher une barre d'une autre série → cette autre série. Si l'objet
  touché est moins profond, on s'arrête à lui : toucher le **fond du graphique** → le graphique ; toucher **hors du
  graphique** (titre, marges) → la page. Depuis un libellé, toucher une autre barre → cette barre (pas son libellé).
- **Raccourci** : **double-clic** ou **double-toucher** (deux touchers à moins de 320 ms et 24 px) sur une marque →
  directement le niveau **élément** (cette barre, cette part, ce point). Conséquence : pour descendre pas à pas au
  même endroit, laisser un court instant entre deux touchers.
- **Petites marques** (points d'une courbe ou d'un nuage) : au doigt, le point le plus proche à moins de 14 px compte
  comme touché (6 px à la souris) ; les barres et les parts ne sont pas concernées.
- **Échap** ou le bouton **↑** du panneau remonte d'un niveau ; toucher le fond gris autour de la scène aussi (depuis
  la page : plus de sélection).

- **Repères** sur la scène (calque HTML, jamais exporté) : cadre pointillé pétrole autour de l'objet, parent en
  pointillé discret, pastille fil d'Ariane (« Page › Graphique › Barres › Belgique › Libellé »), anneau de toucher
  numéroté (1ᵉʳ… 5ᵉ).
- **Panneau de droite contextuel** (l'accordéon s'efface ; « Tous les réglages » le rappelle) : fil d'Ariane cliquable,
  titre de l'objet, bouton ↑ parent, puis seulement ses réglages :
  - **Graphique** : type (même famille), tri, axes X / Y, légende ;
  - **Série** : couleur de la série, forme (extrémité des barres, forme des points, courbe), étiquettes de valeur,
    mise en avant d'une série (lignes) ;
  - **Élément** (barre, part, arc, point) : couleur propre (« revenir à la série »), « Mettre en avant » + note,
    « Modifier le libellé › » ;
  - **Libellé** : carte **Couleur de la barre** (de la part, du point, de l'arc) en tête — colore l'élément sans
    quitter le niveau, lien « Aller à la barre › » —, texte avec jeton `{valeur}`, taille, graisse,
    **Couleur du texte du libellé** (étiquettes masquées : ce choix les affiche ; camembert : nom et valeur ; norme :
    valeur du réel), « Masquer ce libellé », portée **Ce libellé / Toute la série**, « Rétablir le libellé calculé ».
- **Couleurs proposées** : bleu pétrole (#0E6E8C, #3FA7C4, #08465A), bleu glacier et gris, puis le bouton
  **Nuancier** (`ui/nuancier.ts`, composant commun à la couleur de série, d'élément, de libellé et de fond) :
  - rangée **Couleurs de base** tout en haut (12 couleurs franches, comme les couleurs standard d'un tableur : vrai
    rouge, orange, jaune, vert, vert clair, bleu clair, bleu, bleu foncé, violet, noir, blanc, gris), puis rangée
    **Charte** (pétrole), rangée **Récentes** (8 dernières couleurs choisies, sur cet appareil,
    `localStorage` « datanime.couleursRecentes ») ;
  - grille de 60 pastilles : 10 colonnes de teintes (rouges, oranges, jaunes, verts, turquoises, bleus, violets, roses,
    bruns, gris), 6 rangées du clair au foncé ; chaque pastille porte un nom français (infobulle et `aria-label`,
    ex. « bleu nuit »), aucun code n'est affiché ; pastilles de 34 px (iPad) ;
  - **État des pastilles** : la rangée montre toujours la couleur appliquée — pastille de la rangée active, sinon
    pastille **« couleur perso »** en tête (anneau pointillé, mention « perso ») pour une couleur prise au nuancier,
    aux récentes ou au sélecteur complet ; mise à jour dès le choix, et juste après un nouveau rendu ou une nouvelle
    sélection. Libellé : la couleur effective (la sienne, sinon celle de la série) ; « Toute la série » efface les
    couleurs propres des libellés de la série (sinon ils restaient à l'ancienne couleur). Élément : la sienne, sinon
    celle de la série ou de la palette. e2e `--pastilles` (capture 178).
  - **Plus de couleurs…** ouvre le sélecteur complet du navigateur ; rappel « en mode norme, le rouge et le vert
    restent réservés aux écarts » ; Échap ou un toucher à côté ferme la fenêtre sans toucher à la sélection.
  - Tests : `test/nuancier.test.ts`, `node studio/scripts/e2e.mjs --nuancier --shots` (iPad 1024 et 1366 ; captures
    166 à 168).
- **Spec** : `style.overrides[clé]` = `{ color, label, labelColor, labelBold, labelSize, hideLabel }`, clés
  `s:<série>`, `e:<catégorie>` ou `e:<série>|<catégorie>` (plusieurs séries) ; 300 surcharges au plus. Vide, le champ
  n'entre pas dans l'empreinte (`fingerprintSpec`) ni dans la signature de projet : empreintes Cadencer et projets
  existants inchangés. La légende suit les couleurs de série et de part.
- Les marques portent `data-sel` (`mark` | `label` | `series`), `data-sel-key`, `data-sel-series`, `data-sel-name`,
  `data-sel-value` (charts/overrides.ts) ; contrôleur `ui/selection.ts`, panneau `ui/selectionPanel.ts`.
- **Couverture** : barres (verticales, horizontales, groupées, empilées), lignes et aires (série ; points quand ils
  sont dessinés, ≤ 60 par série), camembert et anneau (parts et leurs étiquettes), arcs radiaux, nuage de points
  (groupe de « Couleur par » = série ; points ; libellés quand ils sont affichés, ≤ 30 points).
- **Limites** :
  - **Exploration** (drill) et carte des régions : un toucher sur une barre ou une région continue d'**explorer** ;
    la sélection s'arrête à Page › Graphique ; pas de couleur par région.
  - **Carte (points) et film 4D** (bibliothèque span-magnitude) : Page › Graphique seulement.
  - **Mode norme** (scénarios AC / PY / PL / FC, notation inspirée d'IBCS) : chaque scénario est une série, chaque
    colonne (scénario, catégorie) un élément, la valeur affichée est le libellé du scénario principal. Une couleur
    choisie (élément, sinon série) **remplace le gris de la notation** en gardant la forme du scénario : réel et N-1
    pleins, budget en contour, prévision hachurée à cette couleur ; sans couleur choisie, la notation reste grise.
    Le panneau l'explique (« Mode norme : les données sont en gris par convention… »). Les barres et épingles
    d'écart (bandeau Δ) ne sont pas sélectionnables.
  - **Mise en avant** : les éléments qui ont leur propre couleur la gardent quand un autre élément est mis en avant
    (barres, parts, arcs, icônes de points) ; les autres passent en gris. Message dans le panneau.
  - Tests : `test/couleurBarre.test.ts`, `node studio/scripts/e2e.mjs --couleur-barre --shots` (souris 1366 et
    toucher iPad ; 6 exemples × 6 voies du nuancier, niveau libellé ; captures 174 et 175).
  - **Graphique d'écarts** (type « Écarts ») : sélection limitée à Page › Graphique.
  - Le « repère » (ligne de référence) de la maquette A3 n'est pas construit.
  - Hors du mode « Choisir sur le graphique », toucher une autre barre ne déplace plus la mise en avant : on la
    déplace depuis le panneau de l'élément (« Mettre en avant »).
- Tests : `test/selection.test.ts` (dont les transitions `nextSelection`), `node studio/scripts/e2e.mjs --selection
  --shots` (iPad 1366 et 1024, toucher ; captures 160 à 164) et `--selection-clics` (vrais clics à des endroits
  différents : page, graphique, barre, même barre, libellé ; souris 1366 et iPad 1024 ; barres, horizontales,
  groupées, empilées, camembert, anneau, lignes, nuage, mode norme ; autre élément ; fond ; double-clic / double-toucher ;
  capture 165).
- **Correctif du 9 octobre 2026** : en mode norme (ex. « Revue mensuelle (norme) »), les colonnes ne portaient pas
  `data-sel` ; un clic sur une colonne laissait la sélection sur « Page › Graphique ».

## Puces colorées « À retenir » par élément

Quand une barre, une part, un point ou une série reçoit **sa propre couleur** (sélection par touchers › Couleur,
ou nuancier) ou est **mise en avant**, il reçoit sa propre puce sous « À retenir » :

- les **puces générales** du graphique ont une pastille de la **couleur principale** (première couleur de la palette) ;
- chaque élément de couleur propre ajoute une puce dont la pastille a **sa couleur**, suivie de son commentaire,
  **calculé à partir des données** : « Lettonie : 46,3 %, +3,7 pts vs la moyenne ; 4e plus élevé » (valeur, part du
  total ou écart à la moyenne des autres selon la mesure, puis rang : « le plus élevé », « 2e plus élevé »,
  « 2e plus faible », « le plus faible »). Séries (plusieurs séries) : dernière valeur pour les courbes, total pour les barres.
- **Regroupement (choix)** : les éléments de **même couleur propre** partagent une seule puce
  (« Lettonie et Portugal : 46,3 % et 36,7 % ; 4e plus élevé et 3e plus faible »), sauf si l'un d'eux a un
  commentaire saisi différent : il a alors sa propre puce. Une saisie faite dans Récit sur une puce regroupée
  s'applique à tous ses éléments (le groupe reste uni). 7 puces d'élément au plus (10 puces avec les 3 générales ; au-delà de 5 puces, le texte de la colonne se réduit pour tenir).
- Types concernés : barres (simples, horizontales, groupées, empilées), courbes, aires, camembert, donut, arcs,
  nuage de points. Pas de puce d'élément en mode norme, exploration, carte, film, course de barres et écarts.

**Modifier le texte** :

- panneau de sélection, niveau **élément** (et série) : carte « **Commentaire** », texte calculé en placeholder,
  saisie libre (300 caractères), « **Rétablir le texte calculé** » ;
- **Récit › À retenir** : « Puces des éléments en couleur », une ligne par puce (pastille, noms, champ, rétablir) ;
- double-clic sur la puce dans le graphique (édition en place, comme les autres puces).

Le texte saisi est stocké dans `style.overrides[clé].comment` ; vide = texte calculé. Comme toutes les surcharges,
il reste **hors empreinte tant qu'il est vide** (`style.overrides` absent) : les 4 empreintes publiées sont inchangées
(ce2105aa, 32865c65, 4a7f3c6c, 6696d02e).

**Partout** : les puces sont recalculées à partir du spec et des données de la scène, donc elles suivent dans les
snapshots (Séquence), le film et le mode lecture (elles arrivent après les puces générales, mise en page réservée
dès la première image), l'export SVG / PNG, le PowerPoint (pastille ■ colorée devant chaque puce : couleur principale
puis couleur de l'élément) et le manifeste Cadencer (`a_retenir` : puces générales puis puces d'élément ; aucun
changement quand il n'y en a pas). **Reel** : le commentaire d'un élément de couleur propre (ou saisi) devient la
légende de la scène ; la mise en avant seule garde la légende habituelle (son titre parle déjà de l'élément).

Tests : `studio/test/elementNotes.test.ts` (textes, rangs, regroupement, mise en avant, rendu SVG, film, PowerPoint,
empreinte) et e2e `e2ePuces` (`node studio/scripts/e2e.mjs --puces`, iPad 1024 × 768). Captures :
`docs/shots/169-puces-couleur-graphique-ipad-1024.png`, `170-puces-couleur-panneau-commentaire-ipad-1024.png`,
`171-puces-couleur-recit-ipad-1024.png`, `172-puces-couleur-powerpoint.png`.

## Menu du haut : variante B « Deux niveaux calmes »

- **Barre du haut (48 px)** : logo Datanime · Studio, puis **Ouvrir des données**, **Mes revues (n)**, **Projets ▾** (ex-« Fichier ») et **Exporter ▾** (seul
  bouton accent). Le slogan et le bouton « Snapshot » du haut disparaissent : 📸 Snapshot reste dans le bandeau
  Histoire. Un seul accès PowerPoint : Exporter › PowerPoint de l'histoire.
- **Bande des types (46 px, une seule ligne, colonne centrale)** : pictogrammes 19 px dans des cibles de 34 px (38 px au
  toucher), filet de 1 px entre familles, aucun intitulé de famille. Seul le type sélectionné affiche son nom, avec le
  filet pétrole au-dessus du pictogramme ; au survol, info-bulle pâle avec le nom complet.
- **« Plus +n ▾ »** à droite : menu pictogramme + nom complet (Échap ou clic extérieur le ferme). Remplissage selon la
  place, dans l'ordre des familles : 12 pictogrammes dès 1200 px (Plus = Aires empilées, Arcs radiaux, Film 4D),
  7 en dessous (Plus +8). Le type sélectionné reste toujours visible (il prend la place du dernier s'il vient de
  « Plus »). Logique pure `stripVisible` dans `ui/gallery.ts` (testée).
- **Panneau Données** : « Explorer mes données » en tête du panneau ; « Scénarios » à côté des Exemples (fenêtre Données).
- Réglages › Graphique : « Type Barres · bande du haut ».
- Aucun débordement à 1024 / 1366 / 1920 px (barre, bande, menu), vérifié par l'e2e. Hauteur au-dessus du graphique
  à 1366 px : 94 px (contre 222 px auparavant).

Tests : `test/gallery.test.ts`, e2e (bande, Plus, Échap, débordements). Captures `docs/shots/114` (1366 px), `115`
(1024 px), `116` (menu Plus ouvert), `117` (1920 px).

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
| `charts/barDeco.ts`, `charts/icons/*` | Barres racontées (étape I) : choix pur (icône, pictogrammes, objectif, mise en avant), icônes Phosphor (MIT) en chemins SVG, dictionnaire nom → icône |
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
