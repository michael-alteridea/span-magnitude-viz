"""Datanime — variantes C (10 oct. 2026) : A capital DROIT en jaune (comme A1), seul l'œil du A devient un ▶.
C1 : œil remplacé par un ▶ évidé de taille voisine (barre conservée).
C2 : ▶ plus grand (lisible à 32 px), qui mord sur la barre et amincit un peu les jambages.
C3 : barre supprimée ; l'œil devient un ▶ franc au milieu du A.
Géométrie en unités de police Inter Bold (A : 1490 de haut), puis même placement que A1. Lancer : .venv/bin/python build_c.py"""
import os, json, math
import cairosvg
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely import affinity
import build as B

B.X0 = 206.07 - B.gbounds("D", 700)[0][0] * B.SIZE / B.UPEM
OUT = B.OUT

def qpts(p0, c1, c2, p3, n=24):
    """qCurve TrueType à deux points hors-courbe → points échantillonnés."""
    m = ((c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2); pts = []
    for a, c, b in ((p0, c1, m), (m, c2, p3)):
        for i in range(1, n + 1):
            t = i / n; pts.append(((1-t)**2*a[0] + 2*(1-t)*t*c[0] + t*t*b[0], (1-t)**2*a[1] + 2*(1-t)*t*c[1] + t*t*b[1]))
    return pts
# œil du A (contre-forme au-dessus de la barre), d'après les contours d'Inter Bold
LEFT = [(341, 0), (583, 725)] + qpts((583, 725), (628, 868), (719, 1171), (774, 1364))
RIGHT = [(1110, 0), (876, 725)] + qpts((876, 725), (833, 868), (742, 1171), (689, 1364))
INNER = max(Polygon(LEFT + RIGHT[::-1]).buffer(0).geoms if Polygon(LEFT + RIGHT[::-1]).buffer(0).geom_type == "MultiPolygon" else [Polygon(LEFT + RIGHT[::-1]).buffer(0)], key=lambda g: g.area)
BAR = (325, 571)
def solid_A(notch_top):
    """Silhouette du A sans œil : jambages + encoche basse jusqu'à notch_top."""
    xl = lambda y: 341 + (583 - 341) * y / 725; xr = lambda y: 1110 - (1110 - 876) * y / 725
    return Polygon([(9, 0), (532, 1490), (928, 1490), (1451, 0), (1110, 0), (xr(notch_top), notch_top), (xl(notch_top), notch_top), (341, 0)])

def play(xl, c, h, ratio=0.88):
    return Polygon([(xl, c - h / 2), (xl + h * ratio, c), (xl, c + h / 2)])
def fit_play(allowed, ratio=0.88):
    """Plus grand ▶ (bord gauche vertical) contenu dans « allowed » — recherche en grille."""
    best = None; x0, y0, x1, y1 = allowed.bounds
    for h in range(200, 900, 10):
        found = None
        for c in range(int(y0 + h / 2), int(y1 - h / 2) + 1, 8):
            for xl in range(int(x0), int(x1 - h * ratio) + 1, 8):
                if allowed.contains(play(xl, c, h, ratio)): found = (xl, c, h); break
            if found: break
        if found: best = found
        elif best: break
    return best
def rounded(p, r):
    return p.buffer(-r, join_style=1).buffer(r, join_style=1)

def c15_state():
    import c15
    if c15.C15["cx"] is None: c15.C15.update(c15.fit_c15(solid_A(BAR[0]))[1])
    return c15

def design(code):
    if code == "C15":  # ▶ intermédiaire (~19 px à 112 px), barre intacte ; même triangle que l'œil de départ de l'animation
        c15 = c15_state(); hole = c15.hole_font(c15.C15); h = c15.C15["bw"]
        return solid_A(BAR[0]).difference(hole), dict(trou_hauteur_unites=round(h), trou_px_favicon=round(h * 20 / 1490, 1), trou_px_mot_112=round(h * B.SIZE / B.UPEM, 1))
    if code == "C1":   # ▶ de taille voisine de l'œil, marge conservée, barre intacte
        allowed = INNER.buffer(-12, join_style=2).intersection(box(0, BAR[1] + 22, 1500, 1500)); notch = BAR[0]
    elif code == "C2": # plus grand : mord sur la barre (reste ≈ 110) et amincit les jambages
        allowed = INNER.buffer(70, join_style=2).intersection(box(0, BAR[1] - 136, 1500, 1500)); notch = BAR[0]
    else:              # C3 : pas de barre ; ▶ au milieu, encoche basse raccourcie pour garder un pont
        allowed = INNER.buffer(95, join_style=2).intersection(box(0, 330, 1500, 1500)); notch = 170
    xl, c, h = fit_play(allowed)
    # centrage horizontal optique : on recule légèrement le ▶ si de la marge reste à gauche
    hole = rounded(play(xl, c, h), h * 0.045)
    shape = solid_A(notch).difference(hole)
    return shape, dict(trou_hauteur_unites=h, trou_px_favicon=round(h * 20 / 1490, 1), trou_px_mot_112=round(h * B.SIZE / B.UPEM, 1))

def to_d(geom, tf):
    """Polygone(s) shapely (unités police, y haut) → chemin SVG via tf(x,y)."""
    polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]; d = ""
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            pts = list(ring.coords)[:-1]
            d += "M" + "L".join(f"{B.ntos(X)} {B.ntos(Y)}" for X, Y in (tf(x, y) for x, y in pts)) + "Z"
    return d

def wordmark(code, theme, yk, with_bg=True, pad=24):
    shape, _ = design(code)
    parts, width, _ = B.build("A1")
    # remplace le chemin du A (rôle y) par le A modifié, même origine que A1
    s = B.SIZE / B.UPEM
    (tx0, _, _, _), _ = B.gbounds("t", 700)
    t_org = B.ink(B.STUDIO[2])[0] - tx0 * s
    xa = t_org + B.pair_adv("t", "A") + B.TRACK + 1.5
    dA = to_d(shape, lambda x, y: (xa + x * s, B.BASE - y * s))
    T = B.THEMES[theme]; Y = B.YELLOWS[yk][1]; col = {"n": T["n"], "p": T["p"], "y": Y}
    body = "".join(f'<path d="{dA if r == "y" else d}" fill="{col[r]}"{" fill-rule=\"evenodd\"" if r == "y" else ""}/>' for d, r in parts)
    vx, vy, vw, vh = B.X0 - pad, B.TOP - 4 - pad, width + 2 * pad, B.CAP + 8 + 2 * pad
    bg = f'<rect x="{B.ntos(vx)}" y="{B.ntos(vy)}" width="{B.ntos(vw)}" height="{B.ntos(vh)}" fill="{T["bg"]}"/>' if with_bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{B.ntos(vx)} {B.ntos(vy)} {B.ntos(vw)} {B.ntos(vh)}" '
            f'width="{B.ntos(vw)}" height="{B.ntos(vh)}">{bg}{body}</svg>')

def favicon(code, yk):
    shape, _ = design(code); Y = B.YELLOWS[yk][1]
    s = 20 / 1490; w = (1451 - 9) * s; ox = 16 - w / 2 - 9 * s
    d = to_d(shape, lambda x, y: (ox + x * s, 26 - y * s))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">'
            f'<rect width="32" height="32" rx="7" fill="{B.FAV_BG}"/><path d="{d}" fill="{Y}" fill-rule="evenodd"/></svg>')

CODES_C = {
    "C1": "A capital droit en jaune ; l’œil est remplacé par un ▶ évidé de taille voisine, barre conservée.",
    "C2": "A droit ; ▶ évidé plus grand, lisible à 32 px : il mord sur la barre et affine un peu les jambages.",
    "C15": "A droit ; ▶ évidé intermédiaire entre C1 et C2 (≈ 19 px à 112 px), barre conservée.",
    "C3": "A droit sans barre : l’œil devient un ▶ franc au milieu du A, posé sur un pont plein.",
}
if __name__ == "__main__":
    meta = json.load(open(os.path.join(B.HERE, "variantes.json")))
    for code, desc in CODES_C.items():
        meta["variantes"][code] = {"description": desc, "fichiers": {}, "info": design(code)[1]}
        for yk in B.YELLOWS:
            for th in B.THEMES:
                name = f"{code}-{th}-{yk}"
                open(os.path.join(OUT, name + ".svg"), "w").write(wordmark(code, th, yk))
                open(os.path.join(OUT, name + "-transparent.svg"), "w").write(wordmark(code, th, yk, False, 0))
                cairosvg.svg2png(bytestring=wordmark(code, th, yk).encode(), write_to=os.path.join(OUT, name + "-800.png"), output_width=800)
                meta["variantes"][code]["fichiers"][name] = name + ".svg"
            svg = favicon(code, yk); fn = f"{code}-favicon-{yk}"
            open(os.path.join(OUT, fn + ".svg"), "w").write(svg)
            cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(OUT, fn + "-32.png"), output_width=32)
            cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(OUT, fn + "-256.png"), output_width=256)
        print(code, meta["variantes"][code]["info"])
    json.dump(meta, open(os.path.join(B.HERE, "variantes.json"), "w"), ensure_ascii=False, indent=1)
