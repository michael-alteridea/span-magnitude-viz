/** Nuage de points : « Forme des points » (ronds, une icône, une icône par groupe) et empreinte inchangée par défaut. */
import { describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec";
import { defaultPointIcon, effectivePointShape, groupIcons, pointIconSize, POINT_ICON_CYCLE } from "../src/charts/pointIcons";
import { fingerprintSpec } from "../src/publish/manifest";

function spec(style: Record<string, unknown> = {}, enc: Record<string, unknown> = {}) {
  const r = parseSpec({ type: "scatter", encoding: { x: "Leads", y: ["Budget 2026 (€)"], series: "Région", ...enc }, style });
  if (!r.ok) throw new Error(r.issues.join("; "));
  return r.spec;
}

describe("forme des points", () => {
  it("ronds par défaut ; « par groupe » sans « Couleur par » → une seule icône", () => {
    expect(spec().style.pointShape).toBe("circle");
    expect(groupIcons(spec(), ["A", "B"])).toEqual([null, null]);
    expect(effectivePointShape(spec({ pointShape: "iconByGroup" }, { series: null }))).toBe("icon");
  });

  it("une icône : choisie, sinon automatique d'après la mesure, sinon l'étoile", () => {
    expect(groupIcons(spec({ pointShape: "icon", pointIcon: "rocket" }), ["A", "B"])).toEqual(["rocket", "rocket"]);
    expect(defaultPointIcon(spec({}, { y: ["Chiffre d'affaires (€)"] }))).toBe("currency-eur");
    expect(defaultPointIcon(spec({}, { x: "zz", y: ["qq"], label: null }))).toBe("star");
  });

  it("par groupe : choix manuel, sinon d'après le nom, sinon icônes distinctes ; « » garde un rond", () => {
    const s = spec({ pointShape: "iconByGroup", pointIcons: { Nord: "leaf", Sud: "" } });
    const icons = groupIcons(s, ["Nord", "Sud", "Usine", "Alpha", "Bêta"]);
    expect(icons[0]).toBe("leaf");
    expect(icons[1]).toBeNull();
    expect(icons[2]).toBe("factory");
    expect(icons[3]).toBe(POINT_ICON_CYCLE[0]);
    expect(new Set(icons.filter(Boolean)).size).toBe(4);
  });

  it("taille : suit la taille des bulles, avec un minimum lisible", () => {
    expect(pointIconSize(2, 1)).toBe(16);
    expect(pointIconSize(20, 1)).toBeCloseTo(46);
    expect(pointIconSize(2, 2)).toBe(32);
  });

  it("empreinte : valeurs par défaut absentes (empreintes publiées inchangées), choix présents", () => {
    const base = fingerprintSpec(spec()) as { style: Record<string, unknown> };
    expect(base.style.pointShape).toBeUndefined();
    expect(base.style.pointIcon).toBeUndefined();
    expect(base.style.pointIcons).toBeUndefined();
    const on = fingerprintSpec(spec({ pointShape: "iconByGroup", pointIcons: { Nord: "leaf" } })) as { style: Record<string, unknown> };
    expect(on.style.pointShape).toBe("iconByGroup");
    expect(on.style.pointIcons).toEqual({ Nord: "leaf" });
  });
});
