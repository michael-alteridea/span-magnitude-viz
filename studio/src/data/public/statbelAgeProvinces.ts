/* Fichier généré par datanime-reels/samples/_build/gen_public_samples.py — ne pas modifier à la main.
 * Population par lieu de résidence, âge et nationalité au 1er janvier 2026 — Statbel (TF_SOC_POP_STRUCT_2026), agrégée par province (10 provinces + Région de Bruxelles-Capitale).
 * https://statbel.fgov.be/fr/open-data/population-par-lieu-de-residence-nationalite-etat-civil-age-et-sexe-14 · téléchargé le 2026-10-08.
 * Maille province = maille la plus fine du fond « FR · BE » de l'app (src/geo/frBeRegions.json, id « BE-BExx », code NIS) ; pas de fond communal (565 communes) dans Datanime.
 * Les extrêmes communaux (part des 65 ans et plus) sont fournis à part, pour les titres et les barres.
 * Licence : Statbel open data, CC BY 4.0 (https://statbel.fgov.be/fr/open-data). */

export const STATBEL_AGE = {
  source: "Source : Statbel, population au 1er janvier 2026 · agrégation par province Datanime",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  doi: null,
  page: "https://statbel.fgov.be/fr/open-data/population-par-lieu-de-residence-nationalite-etat-civil-age-et-sexe-14",
  updated: "2026-06-09",
  downloaded: "2026-10-08",
  unit: "% de la population",
  /** Situation au 1er janvier. */
  years: [2026],
  /** Codes NIS (province ; 04000 = Région de Bruxelles-Capitale). */
  codes: ["04000","10000","20001","20002","30000","40000","50000","60000","70000","80000","90000"],
  names: ["Bruxelles-Capitale","Anvers","Brabant flamand","Brabant wallon","Flandre occidentale","Flandre orientale","Hainaut","Liège","Limbourg","Luxembourg","Namur"],
  /** Identifiant du fond « FR · BE » de l'app (frBeRegions.json). */
  mapIds: ["BE-BE10","BE-BE21","BE-BE24","BE-BE31","BE-BE25","BE-BE23","BE-BE32","BE-BE33","BE-BE22","BE-BE34","BE-BE35"],
  regions: ["Région de Bruxelles-Capitale","Région flamande","Région flamande","Région wallonne","Région flamande","Région flamande","Région wallonne","Région wallonne","Région flamande","Région wallonne","Région wallonne"],
  /** Identifiant de région de l'app (src/data/regions.ts : BE1 Bruxelles, BE2 Flandre, BE3 Wallonie). */
  regionIds: ["BE1","BE2","BE2","BE3","BE2","BE2","BE3","BE3","BE2","BE3","BE3"],
  /** Centroïde du fond FR · BE (vérifié dans le polygone). */
  lat: [50.8361,51.2295,50.873,50.6694,51.0133,51.0375,50.4695,50.5207,50.9912,49.9609,50.2553],
  lon: [4.3706,4.7223,4.5904,4.5836,3.0562,3.8194,3.9613,5.7377,5.4289,5.5131,4.8521],
  /** Part des 65 ans et plus (%), une ligne par code, une colonne par année. */
  values: [[13.4],[20.9],[20.8],[21.6],[25.3],[21.2],[20.4],[20.6],[23.3],[19.0],[21.0]],
  provisional: [[],[],[],[],[],[],[],[],[],[],[]],
  /** Population totale. */
  population: [1255834,1931891,1210797,416947,1235671,1611409,1368562,1125300,908582,296370,506271],
  age0to17: [263454,381929,243817,80207,218645,306163,270802,222351,161683,59929,95693],
  age18to64: [824650,1145507,715683,246772,704981,963429,818214,671035,534995,180262,304484],
  age65plus: [167730,404455,251297,89968,312045,341817,279546,231914,211904,56179,106094],
  age80plus: [46852,114897,73159,24605,94338,98995,68006,58539,56413,13731,25567],
  pct80plus: [3.7,5.9,6.0,5.9,7.6,6.1,5.0,5.2,6.2,4.6,5.1],
  /** Part des résidents de nationalité étrangère (%). */
  pctNonBelgian: [36.7,13.7,11.9,10.7,7.6,9.2,12.7,11.6,12.3,10.5,6.1],
  /** Totaux Belgique (population, 65+, 80+, 100+, part des 65+). */
  belgium: {"total":11867634,"a65":2452949,"a80":675102,"a100":3281,"pct65":20.7},
  /** 5 communes où la part des 65+ est la plus élevée (NIS, nom FR, nom NL, population, % 65+). */
  communesOldest: [{"nis":"38014","name":"Koksijde","nameNl":"Koksijde","population":21072,"pct65":46.5},{"nis":"38016","name":"Nieuport","nameNl":"Nieuwpoort","population":11431,"pct65":41.0},{"nis":"31043","name":"Knokke-Heist","nameNl":"Knokke-Heist","population":32163,"pct65":39.5},{"nis":"35029","name":"De Haan","nameNl":"De Haan","population":12682,"pct65":38.7},{"nis":"35011","name":"Middelkerke","nameNl":"Middelkerke","population":20069,"pct65":37.5}],
  /** 5 communes où la part des 65+ est la plus faible. */
  communesYoungest: [{"nis":"21014","name":"Saint-Josse-ten-Noode","nameNl":"Sint-Joost-ten-Node","population":27003,"pct65":9.6},{"nis":"21013","name":"Saint-Gilles","nameNl":"Sint-Gillis","population":48756,"pct65":10.5},{"nis":"21015","name":"Schaerbeek","nameNl":"Schaarbeek","population":129278,"pct65":10.8},{"nis":"21005","name":"Etterbeek","nameNl":"Etterbeek","population":49638,"pct65":11.2},{"nis":"21011","name":"Koekelberg","nameNl":"Koekelberg","population":22578,"pct65":11.2}],
  /** Nombre de communes au 1er janvier 2026. */
  communes: 565,
} as const;
