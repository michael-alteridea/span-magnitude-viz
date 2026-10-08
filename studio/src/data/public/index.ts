/* Fichier généré par datanime-reels/samples/_build/gen_public_samples.py — ne pas modifier à la main.
 * Section « Données publiques » de Datanime Studio : exemples sur données ouvertes réutilisables commercialement.
 * Chaque entrée : identifiant, titre, description courte, thème, licence, fond de carte conseillé, types de graphiques
 * conseillés (ChartType de studio/src/spec.ts) et récit de Reel en 3 à 5 snapshots (rôles NARRATIVE_ROLES) dont
 * tous les chiffres sont calculés depuis les données du module (aucune saisie à la main).
 * Exclus (licence non commerciale ou soumise à autorisation) : Liste rouge UICN, WDPA, base brute du Living Planet Index,
 * EDGAR CO₂ fossile (part AIE en CC BY-NC-ND), FMI, indices oiseaux / papillons PECBMS-eBMS. Voir datasets.md. */
import { EUROSTAT_DETTE } from "./eurostatDettePublique";
import { NOAA_CO2 } from "./noaaCo2MaunaLoa";
import { GCB_CO2 } from "./gcbCo2Fossile";
import { EUROSTAT_GES } from "./eurostatGes";
import { EUROSTAT_FECONDITE } from "./eurostatFecondite";
import { ONU_WPP } from "./onuPopulationMondiale";
import { STATBEL_AGE } from "./statbelAgeProvinces";
import { EUROSTAT_ZONES_PROTEGEES } from "./eurostatZonesProtegees";

export type PublicTheme = "dette" | "climat" | "demographie" | "biodiversite";
export type PublicChartType = "bar" | "barH" | "groupedBar" | "stackedBar" | "line" | "area" | "stackedArea" | "donut" | "map";
export type PublicRole = "context" | "tension" | "revelation" | "recommendation";

export interface PublicStoryStep {
  id: string;
  role: PublicRole;
  chart: PublicChartType;
  title: string;
  keyNumbers: string[];
  /** Indication de construction du snapshot (filtre, maille, période). */
  hint: string;
}

export interface PublicSample {
  id: string;
  title: string;
  description: string;
  theme: PublicTheme;
  source: string;
  licence: string;
  licenceUrl: string;
  /** Fond de carte de l'app (special.mapRegion) ; null : pas de carte pertinente. */
  mapRegion: "europe" | "fr-be" | null;
  chartTypes: PublicChartType[];
  story: PublicStoryStep[];
  data: unknown;
}

export const PUBLIC_THEME_LABELS: Record<PublicTheme, string> = {
  dette: "Dette publique",
  climat: "Climat et CO₂",
  demographie: "Démographie",
  biodiversite: "Biodiversité",
};

export const PUBLIC_SAMPLES: PublicSample[] = [
{
  "id": "dette-publique-ue",
  "theme": "dette",
  "title": "Dette publique dans l'UE (Eurostat)",
  "description": "Dette publique en % du PIB · UE-27, zone euro et 27 pays · 2000 → 2025 · dette par habitant 2025 calculée · Eurostat, CC BY 4.0",
  "source": "Source : Eurostat (gov_10dd_edpt1)",
  "licence": "CC BY 4.0",
  "licenceUrl": "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
  "mapRegion": "europe",
  "chartTypes": [
    "map",
    "barH",
    "line",
    "bar"
  ],
  "story": [
    {
      "id": "dette-01-ue",
      "role": "context",
      "chart": "line",
      "title": "L'UE à 81,7 % du PIB",
      "keyNumbers": [
        "UE-27 : 66,6 % en 2000",
        "pic à 89,5 % en 2020",
        "81,7 % en 2025"
      ],
      "hint": "Ligne UE-27, 2000 → 2025"
    },
    {
      "id": "dette-02-carte",
      "role": "revelation",
      "chart": "map",
      "title": "Grèce 146,1 %, Italie 137,1 %",
      "keyNumbers": [
        "Grèce : 146,1 %",
        "Italie : 137,1 %",
        "France : 115,6 %",
        "Belgique : 107,9 %",
        "Espagne : 100,7 %",
        "plus faible : Estonie 24,1 %"
      ],
      "hint": "Carte Europe des 27 pays, 2025 (mapIds + lat/lon)"
    },
    {
      "id": "dette-03-frbe",
      "role": "tension",
      "chart": "line",
      "title": "France : de 59,7 % à 115,6 % en 25 ans",
      "keyNumbers": [
        "France ×1,94 depuis 2000",
        "Belgique : 109,7 % (2000) → 87,5 % (2007) → 107,9 % (2025)"
      ],
      "hint": "Lignes France vs Belgique, 2000 → 2025"
    },
    {
      "id": "dette-04-habitant",
      "role": "revelation",
      "chart": "barH",
      "title": "≈ 50 070 € de dette par Français",
      "keyNumbers": [
        "Belgique : 57 921 €",
        "Italie : 52 524 €",
        "France : 50 070 €",
        "France : 50 070 €",
        "Belgique : 57 921 €",
        "UE-27 : 34 015 €"
      ],
      "hint": "Barres horizontales, dette par habitant 2025 (calculée)"
    },
    {
      "id": "dette-05-trimestre",
      "role": "recommendation",
      "chart": "bar",
      "title": "Dernier point (2026-Q1) : France 117,6 %, Belgique 109,1 %",
      "keyNumbers": [
        "zone euro (20) : 89,4 %",
        "UE-27 : 82,9 %",
        "valeurs provisoires"
      ],
      "hint": "Barres, dernier trimestre (quarterValues)"
    }
  ],
  "data": EUROSTAT_DETTE
},
{
  "id": "co2-mauna-loa",
  "theme": "climat",
  "title": "CO₂ dans l'atmosphère, Mauna Loa (NOAA)",
  "description": "Concentration de CO₂ (ppm) · annuel 1975 → 2025, mensuel mai 1974 → août 2026 · NOAA, domaine public",
  "source": "Source : NOAA Global Monitoring Laboratory (Mauna Loa)",
  "licence": "Domaine public (NOAA)",
  "licenceUrl": "https://gml.noaa.gov/about/disclaimer.html",
  "mapRegion": null,
  "chartTypes": [
    "line",
    "area",
    "bar"
  ],
  "story": [
    {
      "id": "co2-01-courbe",
      "role": "context",
      "chart": "line",
      "title": "427,35 ppm de CO₂ en 2025",
      "keyNumbers": [
        "331,13 ppm en 1975",
        "427,35 ppm en 2025",
        "+96,22 ppm en 50 ans"
      ],
      "hint": "Ligne annuelle 1975 → 2025"
    },
    {
      "id": "co2-02-dentscie",
      "role": "tension",
      "chart": "line",
      "title": "Record mensuel : 432,34 ppm (mai 2026)",
      "keyNumbers": [
        "dernier mois publié : 427,55 ppm (août 2026)",
        "tendance désaisonnalisée : 429,51 ppm"
      ],
      "hint": "Ligne mensuelle des 5 dernières années (respiration saisonnière)"
    },
    {
      "id": "co2-03-acceleration",
      "role": "revelation",
      "chart": "bar",
      "title": "La hausse accélère : +2,63 ppm/an sur 2016-2025",
      "keyNumbers": [
        "1976-1985 : +1,52 ppm/an",
        "1996-2005 : +1,90 ppm/an",
        "2016-2025 : +2,63 ppm/an",
        "année record : 2024 (+3,53 ppm)"
      ],
      "hint": "Barres de la hausse annuelle moyenne par décennie (calculée)"
    },
    {
      "id": "co2-04-seuil",
      "role": "recommendation",
      "chart": "line",
      "title": "Au-dessus de 420 ppm depuis 2023",
      "keyNumbers": [
        "2022 : 418,53 ppm",
        "2023 : 421,08 ppm",
        "2024 : 424,61 ppm",
        "2025 : 427,35 ppm"
      ],
      "hint": "Ligne annuelle avec seuil 420 ppm"
    }
  ],
  "data": NOAA_CO2
},
{
  "id": "co2-fossile-pays",
  "theme": "climat",
  "title": "Émissions de CO₂ fossile par pays (Global Carbon Project)",
  "description": "CO₂ fossile total et par habitant · monde, Chine, États-Unis, Inde, UE-27 et ses 27 pays · 1990 → 2024 · GCB 2025, CC BY 4.0",
  "source": "Source : Global Carbon Project (GCB 2025 v15)",
  "licence": "CC BY 4.0",
  "licenceUrl": "https://creativecommons.org/licenses/by/4.0/",
  "mapRegion": "europe",
  "chartTypes": [
    "line",
    "barH",
    "map",
    "stackedArea",
    "donut"
  ],
  "story": [
    {
      "id": "gcb-01-monde",
      "role": "context",
      "chart": "line",
      "title": "Record : 38,6 Gt de CO₂ fossile en 2024",
      "keyNumbers": [
        "1990 : 22,7 Gt",
        "2024 : 38,6 Gt",
        "+70 % depuis 1990"
      ],
      "hint": "Ligne Monde 1990 → 2024"
    },
    {
      "id": "gcb-02-qui",
      "role": "revelation",
      "chart": "donut",
      "title": "La Chine émet 32 % du CO₂ fossile mondial",
      "keyNumbers": [
        "Chine : 12,3 Gt (31,8 %)",
        "États-Unis : 4,9 Gt (12,7 %)",
        "Inde : 3,2 Gt (8,3 %)",
        "UE-27 : 2,4 Gt (6,3 %)"
      ],
      "hint": "Donut ou barres 2024 : Chine, États-Unis, Inde, UE-27, reste du monde"
    },
    {
      "id": "gcb-03-habitant",
      "role": "tension",
      "chart": "map",
      "title": "Par habitant : Luxembourg 10,5 t, la France 4,0 t",
      "keyNumbers": [
        "Luxembourg : 10,5 t",
        "Belgique : 7,3 t",
        "Pologne : 7,1 t",
        "Belgique : 7,3 t",
        "France : 4,0 t",
        "moyenne mondiale : 4,7 t",
        "États-Unis : 14,2 t"
      ],
      "hint": "Carte Europe, t CO₂/hab 2024"
    },
    {
      "id": "gcb-04-frbe",
      "role": "recommendation",
      "chart": "line",
      "title": "Belgique −29 %, France −33 % depuis 1990",
      "keyNumbers": [
        "Belgique : 120,3 → 85,5 Mt",
        "France : 394,9 → 264,2 Mt",
        "UE-27 : −37 %"
      ],
      "hint": "Lignes Belgique et France 1990 → 2024 (base 100 possible)"
    },
    {
      "id": "gcb-05-charbon",
      "role": "revelation",
      "chart": "stackedArea",
      "title": "Le charbon pèse encore 41 % des émissions mondiales",
      "keyNumbers": [
        "charbon 15,8 Gt",
        "pétrole 12,5 Gt",
        "gaz 8,0 Gt (2024)"
      ],
      "hint": "Aires empilées worldByFuel 1990 → 2024"
    }
  ],
  "data": GCB_CO2
},
{
  "id": "ges-ue",
  "theme": "climat",
  "title": "Gaz à effet de serre dans l'UE (Eurostat)",
  "description": "Émissions de GES totales et par habitant · UE-27 et 27 pays · 1990 → 2024 · Eurostat, CC BY 4.0",
  "source": "Source : Eurostat (env_air_gge, sdg_13_10)",
  "licence": "CC BY 4.0",
  "licenceUrl": "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
  "mapRegion": "europe",
  "chartTypes": [
    "line",
    "barH",
    "map",
    "bar"
  ],
  "story": [
    {
      "id": "ges-01-ue",
      "role": "context",
      "chart": "line",
      "title": "L'UE a réduit ses émissions de 38 % depuis 1990",
      "keyNumbers": [
        "1990 : 4 867 Mt éq. CO₂",
        "2024 : 3 017 Mt",
        "indice 2024 : 62,0 (1990 = 100)"
      ],
      "hint": "Ligne UE-27 1990 → 2024"
    },
    {
      "id": "ges-02-classement",
      "role": "revelation",
      "chart": "barH",
      "title": "Estonie −75 %, Chypre +58 % depuis 1990",
      "keyNumbers": [
        "Estonie : −75 %",
        "Lettonie : −63 %",
        "Roumanie : −62 %",
        "Belgique : −33 %",
        "France : −33 %",
        "Irlande : −3 %",
        "Chypre : +58 %"
      ],
      "hint": "Barres horizontales : variation 1990 → 2024 (index1990 − 100)"
    },
    {
      "id": "ges-03-habitant",
      "role": "tension",
      "chart": "map",
      "title": "Par habitant : Luxembourg 11,1 t, Belgique 8,3 t",
      "keyNumbers": [
        "Luxembourg : 11,1 t",
        "Irlande : 10,0 t",
        "Pologne : 9,3 t",
        "Belgique : 8,3 t (contre 14,6 t en 1990)",
        "France : 5,3 t",
        "plus bas : Malte 3,8 t"
      ],
      "hint": "Carte Europe, t éq. CO₂/hab 2024"
    },
    {
      "id": "ges-04-frbe",
      "role": "recommendation",
      "chart": "line",
      "title": "Belgique −33 %, France −33 % depuis 1990",
      "keyNumbers": [
        "Belgique : 145,5 → 98,0 Mt",
        "France : 546,9 → 367,0 Mt"
      ],
      "hint": "Lignes index1990 Belgique, France, UE-27"
    }
  ],
  "data": EUROSTAT_GES
},
{
  "id": "fecondite-ue",
  "theme": "demographie",
  "title": "Fécondité et âge médian dans l'UE (Eurostat)",
  "description": "Enfants par femme 2000 → 2024 et âge médian 2000 → 2025 · UE-27 et 27 pays · Eurostat, CC BY 4.0",
  "source": "Source : Eurostat (demo_find, demo_pjanind)",
  "licence": "CC BY 4.0",
  "licenceUrl": "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
  "mapRegion": "europe",
  "chartTypes": [
    "line",
    "map",
    "barH",
    "bar"
  ],
  "story": [
    {
      "id": "fec-01-ue",
      "role": "context",
      "chart": "line",
      "title": "L'UE à 1,34 enfant par femme, au plus bas depuis 2001",
      "keyNumbers": [
        "pic : 1,57 en 2008",
        "2024 : 1,34",
        "seuil de renouvellement : 2,1"
      ],
      "hint": "Ligne UE-27 2001 → 2024"
    },
    {
      "id": "fec-02-carte",
      "role": "revelation",
      "chart": "map",
      "title": "Malte 1,01, Bulgarie 1,72",
      "keyNumbers": [
        "Malte : 1,01",
        "Espagne : 1,10",
        "Lituanie : 1,11",
        "Slovénie : 1,52",
        "France : 1,61",
        "Bulgarie : 1,72",
        "Belgique : 1,44"
      ],
      "hint": "Carte Europe, fécondité 2024"
    },
    {
      "id": "fec-03-frbe",
      "role": "tension",
      "chart": "line",
      "title": "Même la France décroche : 2,03 → 1,61",
      "keyNumbers": [
        "France : 2,03 (2010) → 1,61 (2024)",
        "Belgique : 1,86 → 1,44"
      ],
      "hint": "Lignes France, Belgique, UE-27"
    },
    {
      "id": "fec-04-age",
      "role": "revelation",
      "chart": "barH",
      "title": "Âge médian : 44,9 ans dans l'UE",
      "keyNumbers": [
        "UE-27 : 38,4 ans (2001) → 44,9 ans (2025)",
        "plus âgé : Italie 49,1 ans",
        "plus jeune : Irlande 39,6 ans",
        "France 42,8 · Belgique 42,1"
      ],
      "hint": "Barres horizontales, âge médian 2025"
    }
  ],
  "data": EUROSTAT_FECONDITE
},
{
  "id": "population-mondiale",
  "theme": "demographie",
  "title": "Population mondiale 1950-2100 (ONU)",
  "description": "Population, fécondité, âge médian, espérance de vie · Monde, Europe, Belgique, France · 1950 → 2100 (projections dès 2024) · ONU WPP 2024, CC BY 3.0 IGO",
  "source": "Source : ONU, World Population Prospects 2024",
  "licence": "CC BY 3.0 IGO",
  "licenceUrl": "https://creativecommons.org/licenses/by/3.0/igo/",
  "mapRegion": null,
  "chartTypes": [
    "line",
    "area",
    "bar"
  ],
  "story": [
    {
      "id": "wpp-01-monde",
      "role": "context",
      "chart": "area",
      "title": "De 2,49 à 8,16 milliards d'humains",
      "keyNumbers": [
        "1950 : 2,49 Md",
        "2024 : 8,16 Md",
        "×3,3 en 74 ans"
      ],
      "hint": "Aire Monde 1950 → 2024"
    },
    {
      "id": "wpp-02-pic",
      "role": "revelation",
      "chart": "line",
      "title": "Pic attendu en 2084 : 10,29 milliards",
      "keyNumbers": [
        "2050 : 9,66 Md",
        "pic 2084 : 10,29 Md",
        "2100 : 10,18 Md"
      ],
      "hint": "Ligne Monde 1950 → 2100, projections en pointillé (firstProjectedYear)"
    },
    {
      "id": "wpp-03-europe",
      "role": "tension",
      "chart": "line",
      "title": "L'Europe a déjà passé son pic (2020)",
      "keyNumbers": [
        "pic 2020 : 749,5 M",
        "2100 : 592,3 M (−21 %)",
        "Belgique : pic en 2044 (11,90 M)",
        "France : pic en 2095 (68,53 M)"
      ],
      "hint": "Lignes Europe (ou Belgique/France en base 100)"
    },
    {
      "id": "wpp-04-pourquoi",
      "role": "recommendation",
      "chart": "bar",
      "title": "Fécondité mondiale : 4,85 → 2,25 enfants par femme",
      "keyNumbers": [
        "1950 : 4,85",
        "2024 : 2,25",
        "2100 (projection) : 1,84",
        "espérance de vie : 46,4 → 73,3 ans"
      ],
      "hint": "Barres fécondité Monde par décennie"
    }
  ],
  "data": ONU_WPP
},
{
  "id": "belgique-age-provinces",
  "theme": "demographie",
  "title": "Belgique : la part des 65 ans et plus par province (Statbel)",
  "description": "Population au 1er janvier 2026 par âge · 10 provinces + Bruxelles-Capitale (fond FR · BE), extrêmes communaux · Statbel, CC BY 4.0",
  "source": "Source : Statbel (population au 1er janvier 2026)",
  "licence": "CC BY 4.0",
  "licenceUrl": "https://creativecommons.org/licenses/by/4.0/",
  "mapRegion": "fr-be",
  "chartTypes": [
    "map",
    "barH",
    "bar",
    "donut"
  ],
  "story": [
    {
      "id": "be-01-pays",
      "role": "context",
      "chart": "donut",
      "title": "20,7 % des Belges ont 65 ans ou plus",
      "keyNumbers": [
        "11 867 634 habitants au 1er janvier 2026",
        "2 452 949 de 65 ans et plus",
        "675 102 de 80 ans et plus",
        "3 281 centenaires"
      ],
      "hint": "Donut 0-17 / 18-64 / 65+ (somme des provinces)"
    },
    {
      "id": "be-02-carte",
      "role": "revelation",
      "chart": "map",
      "title": "Flandre occidentale en tête : 25,3 % de 65+",
      "keyNumbers": [
        "Flandre occidentale : 25,3 %",
        "Limbourg : 23,3 %",
        "Brabant wallon : 21,6 %",
        "plus jeune : Bruxelles-Capitale 13,4 %"
      ],
      "hint": "Carte FR · BE au niveau province (mapIds BE-BExx / lat-lon)"
    },
    {
      "id": "be-03-communes",
      "role": "tension",
      "chart": "barH",
      "title": "Koksijde : 46,5 % de 65+, Saint-Josse-ten-Noode : 9,6 %",
      "keyNumbers": [
        "Koksijde : 46,5 %",
        "Nieuport : 41,0 %",
        "Knokke-Heist : 39,5 %",
        "Saint-Josse-ten-Noode : 9,6 %",
        "Saint-Gilles : 10,5 %",
        "Schaerbeek : 10,8 %"
      ],
      "hint": "Barres horizontales des communes extrêmes (communesOldest / communesYoungest)"
    },
    {
      "id": "be-04-regions",
      "role": "recommendation",
      "chart": "bar",
      "title": "Flandre, Wallonie, Bruxelles : trois pyramides",
      "keyNumbers": [
        "Flandre : 22,1 % de 65+",
        "Wallonie : 20,6 % de 65+",
        "Bruxelles-Capitale : 13,4 % de 65+"
      ],
      "hint": "Barres par région (agréger par regions / regionIds)"
    }
  ],
  "data": STATBEL_AGE
},
{
  "id": "zones-protegees-ue",
  "theme": "biodiversite",
  "title": "Zones protégées dans l'UE (Eurostat · AEE)",
  "description": "Part de la surface terrestre protégée (Natura 2000 + aires nationales) · UE-27 et 27 pays · 2011 → 2023 · Eurostat, CC BY 4.0",
  "source": "Source : Eurostat (sdg_15_20), d'après l'AEE",
  "licence": "CC BY 4.0",
  "licenceUrl": "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
  "mapRegion": "europe",
  "chartTypes": [
    "map",
    "barH",
    "bar",
    "line"
  ],
  "story": [
    {
      "id": "zp-01-ue",
      "role": "context",
      "chart": "bar",
      "title": "26,4 % du territoire de l'UE est protégé",
      "keyNumbers": [
        "1 089 885 km² en 2023",
        "UE-27 : 24,6 % (2011) → 26,4 % (2023)"
      ],
      "hint": "Barre ou ligne UE-27"
    },
    {
      "id": "zp-02-carte",
      "role": "revelation",
      "chart": "map",
      "title": "Bulgarie championne : 44,2 %",
      "keyNumbers": [
        "Bulgarie : 44,2 %",
        "Slovénie : 40,5 %",
        "Pologne : 39,6 %",
        "plus faible : Finlande 13,4 %"
      ],
      "hint": "Carte Europe 2023"
    },
    {
      "id": "zp-03-frbe",
      "role": "tension",
      "chart": "barH",
      "title": "La Belgique à 15,5 %, loin de l'objectif de 30 %",
      "keyNumbers": [
        "Belgique : 15,5 % (4 739 km²)",
        "France : 28,3 % (155 092 km²)",
        "UE-27 : 26,4 %",
        "objectif UE 2030 (Stratégie biodiversité) : 30 % des terres"
      ],
      "hint": "Barres horizontales classées, Belgique et France mises en avant"
    }
  ],
  "data": EUROSTAT_ZONES_PROTEGEES
}
];

export function publicSampleById(id: string | null | undefined): PublicSample | undefined {
  return PUBLIC_SAMPLES.find((s) => s.id === id);
}
