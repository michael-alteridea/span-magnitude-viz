/* Données de démonstration FICTIVES (société Norvia, imaginaire) — aucune donnée réelle. */
(function (g) {
  var mois = [];
  var flux = [-95000, -42000, -18000, 4000, 9000, 14000, 17000, 19000, 21000, 22000, 23000, 24000, 24500, 25000, 25000, 25500, 26000, 26000, 26500, 27000, 27000, 27500, 28000, 28000];
  for (var i = 0; i < flux.length; i++) mois.push({ label: "M" + (i + 1), value: flux[i] });
  g.NORVIA_DEMO = {
    gain: { points: mois, periodUnit: "mois" },
    cascade: {
      items: [
        { label: "Licences", value: -120000 },
        { label: "Intégration", value: -65000 },
        { label: "Formation", value: -18000 },
        { label: "Gain de productivité", value: 210000 },
        { label: "Moins d'erreurs", value: 48000 },
        { label: "Ventes en plus", value: 72000 },
      ],
      total: "Gain net 3 ans",
    },
    avantApres: {
      beforeLabel: "Avant",
      afterLabel: "Après",
      better: "lower",
      items: [
        { label: "Clôture mensuelle", before: 38, after: 16 },
        { label: "Relances clients", before: 22, after: 9 },
        { label: "Rapprochements bancaires", before: 15, after: 6 },
        { label: "Reporting direction", before: 12, after: 4 },
        { label: "Notes de frais", before: 9, after: 10 },
      ],
    },
    cartouche: {
      name: "Norvia (exemple fictif)",
      link: "https://valueroom.io/",
      qr: true,
      dates: ["Données au 8 octobre 2026", "Projection sur 24 mois"],
      source: "Données fictives",
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
