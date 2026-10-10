"""C15 : œil du A en ▶ de taille intermédiaire (~19 px à 112 px), barre conservée.
Le ▶ est le MÊME triangle arrondi (chemin unitaire) que l'œil droit du A de départ, simplement tourné de 90° horaire
et remis à l'échelle — l'image finale de l'animation est donc exactement C15. Unités : police Inter Bold (y vers le haut)."""
import math
from shapely.geometry import Polygon

# ---- triangle unitaire arrondi, repère écran (y vers le bas), pointe en haut, centre de gravité à l'origine ----
def _unit(r=0.07, n=10):
    P = [(-0.5, 1 / 3), (0.0, -2 / 3), (0.5, 1 / 3)]; out = []
    for i in range(3):
        p0, p1, p2 = P[i - 1], P[i], P[(i + 1) % 3]
        def tw(a, b, t):
            L = math.dist(a, b); return (a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L)
        q0, q1 = tw(p1, p0, r), tw(p1, p2, r)
        for k in range(n + 1):
            t = k / n
            out.append(((1-t)**2*q0[0] + 2*(1-t)*t*p1[0] + t*t*q1[0], (1-t)**2*q0[1] + 2*(1-t)*t*p1[1] + t*t*q1[1]))
    return out
UNIT = _unit()
UNIT_D = "M" + "L".join(f"{x:.5f} {y:.5f}" for x, y in UNIT) + "Z"

# états (unités police) : centre (cx, cy), largeur de base bw, hauteur ht, angle horaire θ
EYE = dict(cx=729.0, cy=571 + 640 / 3, bw=404.0, ht=640.0, th=0.0)       # œil « normal » d'un A droit (base sur la barre)
H15 = 19.0 / 112 * 2048                                                  # ≈ 347 unités = 19 px à 112 px
C15 = dict(cx=None, cy=None, bw=H15, ht=H15 * 0.88, th=90.0)            # centre fixé par fit_c15()

def hole_font(st):
    """Polygone du trou en unités police pour un état donné."""
    c, s = math.cos(math.radians(st["th"])), math.sin(math.radians(st["th"])); pts = []
    for u, v in UNIT:
        x, y = u * st["bw"], v * st["ht"]
        xr, yr = x * c - y * s, x * s + y * c          # rotation horaire à l'écran (y bas)
        pts.append((st["cx"] + xr, st["cy"] - yr))
    return Polygon(pts)

def fit_c15(solid, bar_top=571):
    """Place le ▶ C15 : bas du trou ≥ haut de la barre (barre intacte), marge maximale aux bords du A."""
    best = None
    for cy in range(int(bar_top + H15 / 2), int(bar_top + H15 / 2) + 120, 4):
        for cx in range(560, 900, 4):
            st = dict(C15, cx=float(cx), cy=float(cy)); hp = hole_font(st)
            if hp.bounds[1] < bar_top - 1: continue
            m = solid.exterior.distance(hp) if solid.contains(hp) else -1
            if best is None or m > best[0]: best = (m, st)
    return best

def interp(p, a, b, shrink=0.10):
    """État intermédiaire (p ∈ [0,1] déjà lissé) ; léger rétrécissement à mi-course pour ne pas trancher les jambages."""
    k = 1 - shrink * math.sin(math.pi * p)
    return dict(cx=a["cx"] + (b["cx"] - a["cx"]) * p, cy=a["cy"] + (b["cy"] - a["cy"]) * p,
                bw=(a["bw"] + (b["bw"] - a["bw"]) * p) * k, ht=(a["ht"] + (b["ht"] - a["ht"]) * p) * k,
                th=a["th"] + (b["th"] - a["th"]) * p)
