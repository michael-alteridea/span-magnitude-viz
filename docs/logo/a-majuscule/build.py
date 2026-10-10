"""Datanime — variantes « A majuscule » en jaune (10 oct. 2026).
Base : mot-symbole studio (Inter Bold 112 px, « Dat » encre, « nime » pétrole). Le « a » orange est remplacé
par un A jaune (A1, A2) ou un ▶ dérivé du A (B1, B2, B3). Texte vectorisé (Inter statique + HarfBuzz).
N'écrit que dans ce dossier. Lancer : .venv/bin/python build.py"""
import math, os, json, re
import cairosvg, uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "variantes"); os.makedirs(OUT, exist_ok=True)
FONTS = "/workspace/tell4d-logo/src"
SIZE, BASE = 112, 120.74
X0 = 200.0   # origine du D studio (fût à x = 206.07)
THEMES = {"light": dict(bg="#FFFFFF", n="#16232A", p="#0E6E8C"),   # = WORDMARK_COLORS studio
          "dark":  dict(bg="#0B1A20", n="#FFFFFF", p="#3FA7C4")}
YELLOWS = {"jaune-or": ("jaune or", "#E3A600"), "jaune-vif": ("jaune vif", "#FFD000")}
FAV_BG = "#08465A"   # pétrole foncé
ntos = lambda v: ("%.2f" % v).rstrip("0").rstrip(".")

_fc = {}
def F(w):
    if w not in _fc:
        p = f"{FONTS}/Inter-{w}.ttf"; tt = TTFont(p)
        _fc[w] = (hb.Font(hb.Face(hb.Blob.from_file_path(p))), tt, tt.getGlyphSet(), tt["head"].unitsPerEm, tt.getGlyphOrder())
    return _fc[w]
UPEM = 2048
CAP = F(700)[1]["OS/2"].sCapHeight / UPEM * SIZE      # 81.48
XH = F(700)[1]["OS/2"].sxHeight / UPEM * SIZE         # 57.75
TOP = BASE - CAP

def shape(text, x, weight=700, size=SIZE, base=BASE):
    font, tt, gs, upem, order = F(weight)
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties(); hb.shape(font, buf, {"kern": True, "liga": False})
    s = size / upem; cx = 0; out = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        pen = SVGPathPen(gs, ntos=ntos)
        gs[order[info.codepoint]].draw(TransformPen(pen, (s, 0, 0, -s, x + (cx + pos.x_offset) * s, base)))
        out.append(pen.getCommands()); cx += pos.x_advance
    return out, cx * s

def glyph(name, weight, size, tf):
    """Glyphe → chemin SVG ; tf(x, y_police_unités_scalées) appliqué via matrice affine (a,b,c,d,e,f)."""
    _, tt, gs, upem, _ = F(weight)
    pen = SVGPathPen(gs, ntos=ntos); gs[name].draw(TransformPen(pen, tf)); return pen.getCommands()
def gbounds(name, weight):
    _, tt, gs, upem, _ = F(weight); b = BoundsPen(gs); gs[name].draw(b); return b.bounds, gs[name].width

def rpoly(P, r):
    """Polygone aux angles arrondis ; r = rayon par sommet (liste) ou scalaire."""
    n = len(P); r = r if isinstance(r, (list, tuple)) else [r] * n; d = ""
    for i in range(n):
        p0, p1, p2 = P[i - 1], P[i], P[(i + 1) % n]
        def tw(a, b, t):
            L = math.dist(a, b); t = min(t, L / 2.01); return (a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L)
        if r[i] <= 0:
            d += ("M" if i == 0 else "L") + f"{p1[0]:.2f} {p1[1]:.2f}"; continue
        q0, q1 = tw(p1, p0, r[i]), tw(p1, p2, r[i])
        d += ("M" if i == 0 else "L") + f"{q0[0]:.2f} {q0[1]:.2f}Q{p1[0]:.2f} {p1[1]:.2f} {q1[0]:.2f} {q1[1]:.2f}"
    return d + "Z"

# ---------- le ▶ (coordonnées relatives : x0 = bord gauche, hauteur H, largeur W) ----------
W_RATIO = 0.90
def tri_edges(x0, top, H, W):
    """demi-hauteur du ▶ à l'abscisse x"""
    return lambda x: (x0 + W - x) * (H / 2) / W

def lead_B1(x0, top, H):
    """▶ plein en deux pièces : la barre du A devient une fente verticale (≈ 31 % depuis la base)."""
    W = H * W_RATIO; cy = top + H / 2; hh = tri_edges(x0, top, H, W)
    xs1, xs2 = x0 + W * 0.30, x0 + W * 0.30 + H * 0.085      # fente
    r = H * 0.06
    left = [(x0, top), (xs1, cy - hh(xs1)), (xs1, cy + hh(xs1)), (x0, top + H)]
    right = [(xs2, cy - hh(xs2)), (x0 + W, cy), (xs2, cy + hh(xs2))]
    return [rpoly(left, [r, r * 0.3, r * 0.3, r]), rpoly(right, [r * 0.3, r * 1.2, r * 0.3])], W

def lead_B3(x0, top, H):
    """▶ arrondi évidé : l'œil du A devient un trou triangulaire près de la pointe (fût 0,15 × H)."""
    W = H * W_RATIO; cy = top + H / 2; s = 0.15 * H
    alpha = math.atan((H / 2) / W)
    outer = rpoly([(x0, top), (x0 + W, cy), (x0, top + H)], [H * 0.09, H * 0.11, H * 0.09])
    # trou : côtés obliques décalés de s vers l'intérieur, bord gauche à xc (= la barre du A)
    apex = x0 + W - s / math.sin(alpha)
    xc = x0 + W * 0.36
    hhc = (apex - xc) * math.tan(alpha)
    hole = [(xc, cy + hhc), (apex, cy), (xc, cy - hhc)]          # sens inverse → evenodd de toute façon
    return [outer + rpoly(hole, [H * 0.02, H * 0.03, H * 0.02])], W, (apex - xc, 2 * hhc)

def lead_B2(x0, top, H):
    """Vrai A d'Inter Bold tourné de 90° horaire (pointe → droite), mis à la hauteur de capitale."""
    (gx0, gy0, gx1, gy1), adv = gbounds("A", 700)
    gw, gh = gx1 - gx0, gy1 - gy0            # unités police (y vers le haut)
    s = H / gw                                # largeur du A → hauteur après rotation
    W = gh * s
    # rotation horaire à l'écran : sommet (gy1) → droite, gauche (gx0) → haut.
    # écran : X = x0 + (gy - gy0)*s ; Y = top + (gx - gx0)*s
    tf = (0, s, s, 0, x0 - gy0 * s, top - gx0 * s)
    return [glyph("A", 700, None, tf)], W

# ---------- assemblage d'un mot-symbole ----------
def lead_A(code, x):
    if code == "A1":
        (gx0, _, gx1, _), adv = gbounds("A", 700); s = SIZE / UPEM
        return [glyph("A", 700, None, (s, 0, 0, -s, x, BASE))], adv * s, gx0 * s, (adv - gx1) * s
    if code == "A2":   # A à la hauteur d'x, Inter ExtraBold pour compenser l'amincissement
        sz = SIZE * XH / CAP; s = sz / UPEM
        (gx0, _, gx1, gy1), adv = gbounds("A", 800); s = (XH / gy1) * 1.0   # sommet du A = hauteur d'x
        return [glyph("A", 800, None, (s, 0, 0, -s, x, BASE))], adv * s, gx0 * s, (adv - gx1) * s

STUDIO_SVG = "/workspace/smv-git/studio/src/assets/brand/datanime-wordmark-light.svg"
STUDIO = re.findall(r'd="([^"]+)"', open(STUDIO_SVG).read())     # D a t a n i m e (chemins exacts du studio)
TRACK = -2.8                                                         # approche studio (−0,025 em)
def shift_x(d, dx):
    """Translate horizontalement un chemin absolu M/L/H/V/Q/Z."""
    out, cmd, i = [], None, 0
    toks = re.findall(r"[MLHVQZ]|-?[\d.]+", d)
    for t in toks:
        if t.isalpha(): cmd, i = t, 0; out.append(t); continue
        v = float(t)
        if cmd == "H" or (cmd in "MLQ" and i % 2 == 0): v += dx
        out.append(ntos(v)); i += 1
    s = ""
    for t in out: s += t if (t.isalpha() or not s or s[-1].isalpha()) else " " + t
    return s
def ink(d):
    """Étendue horizontale (min, max) des abscisses d'un chemin absolu M/L/H/V/Q/Z."""
    xs, cmd, i = [], None, 0
    for t in re.findall(r"[MLHVQZ]|-?[\d.]+", d):
        if t.isalpha(): cmd, i = t, 0; continue
        if cmd == "H" or (cmd in "MLQ" and i % 2 == 0): xs.append(float(t))
        i += 1
    return min(xs), max(xs)
def pair_adv(a, b, w=700):
    font = F(w)[0]; buf = hb.Buffer(); buf.add_str(a + b); buf.guess_segment_properties(); hb.shape(font, buf, {"kern": True})
    return buf.glyph_positions[0].x_advance * SIZE / UPEM

def build(code):
    """Renvoie (liste de (d, rôle)), largeur, infos) ; rôles n / o / y / p. « Dat » et « nime » = chemins studio exacts."""
    s = SIZE / UPEM
    if code == "V0":
        return [(d, r) for d, r in zip(STUDIO, ["n"] * 3 + ["o"] + ["p"] * 4)], ink(STUDIO[-1])[1] - X0, {}
    parts = [(d, "n") for d in STUDIO[:3]]
    t_ink_r = ink(STUDIO[2])[1]
    n_ink_l = ink(STUDIO[4])[0]
    info = {}
    if code == "A1":
        (tx0, _, _, _), _ = gbounds("t", 700)
        t_org = ink(STUDIO[2])[0] - tx0 * s
        xa = t_org + pair_adv("t", "A") + TRACK + 1.5   # le crénage t-A d’Inter colle trop la barre du t
        (gx0, _, gx1, _), adv = gbounds("A", 700); (nx0, _, _, _), _ = gbounds("n", 700)
        parts.append((glyph("A", 700, None, (s, 0, 0, -s, xa, BASE)), "y"))
        n_new = xa + pair_adv("A", "n") + TRACK + nx0 * s
    elif code == "A2":   # A à la hauteur d'x ; Inter ExtraBold pour compenser l'amincissement
        (gx0, _, gx1, gy1), adv = gbounds("A", 800); sa = XH / gy1
        xa = t_ink_r + 2.0 - gx0 * sa
        parts.append((glyph("A", 800, None, (sa, 0, 0, -sa, xa, BASE)), "y"))
        n_new = xa + gx1 * sa + 3.0
    else:
        x0 = t_ink_r + 5.5
        if code == "B1": ds, W = lead_B1(x0, TOP, CAP)
        if code == "B2": ds, W = lead_B2(x0, TOP, CAP)
        if code == "B3": ds, W, hole = lead_B3(x0, TOP, CAP); info["trou_px_a_112"] = [round(v, 1) for v in hole]
        parts += [(d, "y") for d in ds]
        n_new = x0 + W + 3.5
    dx = n_new - n_ink_l
    parts += [(shift_x(d, dx), "p") for d in STUDIO[4:]]
    return parts, ink(STUDIO[-1])[1] + dx - X0, info

RULE = lambda code, role: ' fill-rule="evenodd"' if (code == "B3" and role == "y") else ""

def wordmark_svg(code, theme, ykey, with_bg=True, pad=None):
    parts, width, _ = build(code); T = THEMES[theme]; Y = YELLOWS[ykey][1]
    col = {"n": T["n"], "p": T["p"], "y": Y, "o": "#E8870E" if theme == "light" else "#FF9F1C"}
    pad = pad if pad is not None else 0
    vx, vy, vw, vh = X0 - pad, TOP - 4 - pad, width + 2 * pad, CAP + 8 + 2 * pad
    body = "".join(f'<path d="{d}" fill="{col[r]}"{RULE(code, r)}/>' for d, r in parts)
    bg = f'<rect x="{ntos(vx)}" y="{ntos(vy)}" width="{ntos(vw)}" height="{ntos(vh)}" fill="{T["bg"]}"/>' if with_bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{ntos(vx)} {ntos(vy)} {ntos(vw)} {ntos(vh)}" '
            f'width="{ntos(vw)}" height="{ntos(vh)}">{bg}{body}</svg>')

def favicon_svg(code, ykey):
    """32 px : la lettre jaune seule sur carré pétrole foncé arrondi (viewBox 0 0 32 32)."""
    Y = YELLOWS[ykey][1]; H = 19.0
    if code == "V0":
        _, tt, gs, upem, _ = F(700); (gx0, gy0, gx1, gy1), adv = gbounds("a", 700)
        s = 21 / (gy1 - gy0); w = (gx1 - gx0) * s
        d = glyph("a", 700, None, (s, 0, 0, -s, 16 - w / 2 - gx0 * s, 16 + (gy1 - gy0) * s / 2 + gy0 * s)); Y = "#FF9F1C"
        ds = [d]
    elif code in ("A1", "A2"):
        wt = 700 if code == "A1" else 800
        (gx0, gy0, gx1, gy1), adv = gbounds("A", wt); s = 20 / (gy1 - gy0); w = (gx1 - gx0) * s
        ds = [glyph("A", wt, None, (s, 0, 0, -s, 16 - w / 2 - gx0 * s, 16 + 10 + gy0 * s))]
    else:
        H = 20.0; W = H * W_RATIO if code != "B2" else None
        if code == "B2":
            (gx0, gy0, gx1, gy1), _ = gbounds("A", 700); W = (gy1 - gy0) * H / (gx1 - gx0)
        x0 = 16 - W / 3 - (0.6 if code != "B2" else 0)       # centre optique du ▶ (centre de gravité au 1/3)
        if code == "B2": x0 = 16 - W * 0.42
        fn = {"B1": lead_B1, "B2": lead_B2, "B3": lead_B3}[code]
        ds = fn(x0, 16 - H / 2, H)[0]
    body = "".join(f'<path d="{d}" fill="{Y}"{RULE(code, "y")}/>' for d in ds)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">'
            f'<rect width="32" height="32" rx="7" fill="{FAV_BG}"/>{body}</svg>')

CODES = {
    "V0": "Référence actuelle (studio) : « a » orange simple. Pour comparaison.",
    "A1": "« DatAnime » : un A capital normal en jaune, pleine hauteur de capitale.",
    "A2": "A capital réduit à la hauteur d’x de « nime » (Inter ExtraBold pour garder la graisse), en jaune.",
    "B1": "▶ plein = A tourné d’un quart de tour horaire ; la barre du A devient une fente verticale (deux pièces).",
    "B2": "Le vrai A d’Inter Bold tourné de 90° horaire : la pointe regarde à droite (▶), l’œil reste visible.",
    "B3": "▶ arrondi évidé : l’œil du A devient un trou triangulaire près de la pointe (fût 0,15 × hauteur).",
}

if __name__ == "__main__":
    # recalage X0 : le fût du D studio est à x = 206.07
    X0 = 206.07 - gbounds("D", 700)[0][0] * SIZE / UPEM
    meta = {}
    for code in CODES:
        meta[code] = {"description": CODES[code], "fichiers": {}}
        ykeys = ["jaune-or"] if code == "V0" else list(YELLOWS)
        for yk in ykeys:
            for th in THEMES:
                name = f"{code}-{th}-{yk}" if code != "V0" else f"{code}-{th}"
                for bgflag, suf in ((True, ""), (False, "-transparent")):
                    svg = wordmark_svg(code, th, yk, bgflag, pad=0 if not bgflag else 24)
                    p = os.path.join(OUT, name + suf + ".svg"); open(p, "w").write(svg)
                cairosvg.svg2png(bytestring=wordmark_svg(code, th, yk, True, 24).encode(), write_to=os.path.join(OUT, name + "-800.png"), output_width=800)
                meta[code]["fichiers"][name] = name + ".svg"
            fname = f"{code}-favicon-{yk}" if code != "V0" else f"{code}-favicon"
            svg = favicon_svg(code, yk); open(os.path.join(OUT, fname + ".svg"), "w").write(svg)
            cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(OUT, fname + "-32.png"), output_width=32)
            cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(OUT, fname + "-256.png"), output_width=256)
        meta[code]["info"] = build(code)[2]
    json.dump({"jaunes": {k: v[0] for k, v in YELLOWS.items()}, "variantes": meta}, open(os.path.join(HERE, "variantes.json"), "w"), ensure_ascii=False, indent=1)
    # contrôle : V0 doit coïncider avec le fichier studio (premier chemin)
    studio = open("/workspace/smv-git/studio/src/assets/brand/datanime-wordmark-light.svg").read()
    print("Dat/nime studio retrouvés tels quels :", all(build(c)[0][0][0] in studio for c in CODES), "| X0 =", round(X0, 3))
    print({c: meta[c]["info"] for c in meta})
