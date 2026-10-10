"""Variante « accents » : après le pivot du ▶, deux accents jaunes symétriques signent le mot :
grave sur le A (À) et aigu sur le e final (é) → « DatÀnimé » / « DATÀnimé ». L'aigu est le miroir exact du grave
(même longueur, même angle, même effilement). Tracé rapide (~0,35 s chacun, léger décalage) façon paraphe."""
import math, os, re
import build as B, build_c as C, anim, caps
B.X0 = 206.07 - B.gbounds("D", 700)[0][0] * B.SIZE / B.UPEM
L, ANG, WMAX, BOW, GAP = 30.0, 36.0, 10.0, 1.1, 7.0     # longueur, angle / horizontale, épaisseur max, galbe, écart

def local_grave():
    """Grave en repère local (centre à l'origine) : départ en haut à gauche (épais) → fin en bas à droite (effilée)."""
    a = math.radians(ANG); dx, dy = L * math.cos(a) / 2, L * math.sin(a) / 2
    p0, p1 = (-dx, -dy), (dx, dy); nx, ny = -math.sin(a), math.cos(a)            # normale (vers le bas-gauche)
    c = (nx * BOW * 2, ny * BOW * 2)                                             # contrôle : galbe léger
    q = lambda t: ((1-t)**2*p0[0] + 2*(1-t)*t*c[0] + t*t*p1[0], (1-t)**2*p0[1] + 2*(1-t)*t*c[1] + t*t*p1[1])
    left, right = [], []
    N = 24
    for i in range(N + 1):
        t = i / N; x, y = q(t); x2, y2 = q(min(1, t + 1e-3)) if t < 1 else q(t); x1, y1 = q(t - 1e-3) if t == 1 else (x, y)
        tx, ty = (x2 - x1, y2 - y1); n = math.hypot(tx, ty) or 1; ux, uy = -ty / n, tx / n
        w = WMAX * (1 - 0.82 * t ** 1.3) / 2
        left.append((x + ux * w, y + uy * w)); right.append((x - ux * w, y - uy * w))
    # bout épais arrondi (demi-cercle)
    x0, y0 = q(0); tx, ty = q(1e-3)[0] - x0, q(1e-3)[1] - y0; base = math.atan2(ty, tx)
    cap = [(x0 + WMAX / 2 * math.cos(base - math.pi / 2 - k * math.pi / 8), y0 + WMAX / 2 * math.sin(base - math.pi / 2 - k * math.pi / 8)) for k in range(1, 8)]
    poly = left + right[::-1] + cap
    centre = [q(i / 24) for i in range(25)]
    ext = [(centre[0][0] - math.cos(base) * WMAX, centre[0][1] - math.sin(base) * WMAX)] + centre + \
          [(centre[-1][0] + (centre[-1][0] - centre[-2][0]) * 4, centre[-1][1] + (centre[-1][1] - centre[-2][1]) * 4)]
    return poly, ext, L * math.sin(a)

def placed(cx, bottom, mirror):
    poly, ext, h = local_grave(); sx = -1 if mirror else 1; cy = bottom - h / 2
    tf = lambda P: [(cx + sx * x, cy + y) for x, y in P]
    d = lambda P, close: "M" + "L".join(f"{x:.2f} {y:.2f}" for x, y in P) + ("Z" if close else "")
    return d(tf(poly), True), d(tf(ext), False)

def accent_specs(xa, nime):
    """(d_forme, d_trajet) pour le grave sur le A et l'aigu sur le e."""
    s = B.SIZE / B.UPEM
    a_cx = xa + 730 * s                                    # axe du A (sommet)
    e0, e1 = B.ink(nime[-1]); e_cx = (e0 + e1) / 2 + 1.0   # axe optique du e
    grave = placed(a_cx, B.TOP - GAP, False)
    aigu = placed(e_cx, B.BASE - B.XH - GAP + 0.5, True)
    return grave, aigu
TOP_EXTRA = 30                                             # marge ajoutée en haut du cadre

def static_svg(caps_mode, theme, yk, with_bg=True, pad=24):
    base = (caps.static_svg if caps_mode else (lambda th, y, bg, p: open(os.path.join(B.OUT, f"C15-{th}-{y}{'' if bg else '-transparent'}.svg")).read()))(theme, yk, with_bg, pad)
    if caps_mode: _, xa, nime, _ = caps.layout()
    else: xa, nime = anim.XA, anim.NIME
    (g, _), (a, _) = accent_specs(xa, nime); Y = B.YELLOWS[yk][1]
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', base).group(1).split()]
    vb[1] -= TOP_EXTRA; vb[3] += TOP_EXTRA
    nv = " ".join(B.ntos(v) for v in vb)
    out = re.sub(r'viewBox="[^"]+" width="[^"]+" height="[^"]+"', f'viewBox="{nv}" width="{B.ntos(vb[2])}" height="{B.ntos(vb[3])}"', base, 1)
    out = re.sub(r'<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+"', f'<rect x="{B.ntos(vb[0])}" y="{B.ntos(vb[1])}" width="{B.ntos(vb[2])}" height="{B.ntos(vb[3])}"', out, 1) if with_bg else out
    return out.replace("</svg>", f'<path d="{g}" fill="{Y}"/><path d="{a}" fill="{Y}"/></svg>')
