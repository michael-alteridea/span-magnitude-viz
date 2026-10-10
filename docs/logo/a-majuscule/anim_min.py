"""Animation « minuscules » : « Data » + « anime » (deux a minuscules) → les deux a glissent l'un vers l'autre en
jaunissant (balayage net), se superposent puis se MÉTAMORPHOSENT en un A capital jaune (fondu + échelle, même ligne de
base, jaune sur jaune → aucun ton terne) → « DatAnime » → l'œil pivote en ▶ (C15) → [accents À / é].
Pendant « Data anime », « Dat » et « nime » sont rapprochés pour l'approche naturelle du a, puis rejoignent l'approche du A.
Sorties : anim/logo-anim-minuscules(.svg|-dark.svg) et anim/logo-anim-minuscules-accents(.svg|-dark.svg)."""
import os, re
import build as B, build_c as C, anim, accents as A
from anim import kf, tf, pc, EASE_OUT, EASE_IO, WIPE, c15, s, XA, DAT, NIME, WIDTH, SOLID
DRAW = "cubic-bezier(.3,0,.2,1)"
(gx0, _, gx1, _), a_adv = B.gbounds("a", 700)
AXIS = XA + (9 + 1451) / 2 * s                         # axe du A capital (écran)
AO = AXIS - (gx0 + gx1) / 2 * s                        # origine du a minuscule centré sur cet axe
A_LOW = B.glyph("a", 700, None, (s, 0, 0, -s, AO, B.BASE))
ax0, ax1 = AO + gx0 * s, AO + gx1 * s; AWL = ax1 - ax0 + 2
DD = (ax0 - (B.ink(B.STUDIO[2])[1] + 3.11))            # « Dat » rapproché du a (approche studio t→a)
DN = (B.ink(NIME[0])[0] - (ax1 + 8.57))                # « nime » rapproché du a (approche studio a→n)
D = a_adv * s + B.TRACK + 0.27 * B.SIZE; H = D / 2

def build(theme, yk, accents):
    T = 4.3 if accents else 3.75; anim.T = T
    Th = B.THEMES[theme]; Y = B.YELLOWS[yk][1]; ink, pet = Th["n"], Th["p"]
    top_extra = A.TOP_EXTRA if accents else 0
    pad = 20; vx = B.X0 - H - pad; vw = WIDTH + 2 * H + 2 * pad; vy = B.TOP - 6 - pad - top_extra; vh = B.CAP + 12 + 2 * pad + top_extra
    TX = lambda v: f"transform:translateX({v:.2f}px)"
    Mo = f"{AXIS:.2f}px {B.BASE:.2f}px"                # origine de la métamorphose : axe du A sur la ligne de base
    k = [
        kf("dataF", [(0, "opacity:0;transform:translateY(10px)", EASE_OUT), (0.70, "opacity:1;transform:translateY(0)", None), (T, "opacity:1;transform:translateY(0)", None)]),
        kf("dataX", [(0, TX(-H), None), (1.55, TX(-H), EASE_IO), (2.30, TX(0), None), (T, TX(0), None)]),
        kf("datS", [(0, TX(DD), None), (2.22, TX(DD), EASE_IO), (2.62, TX(0), None), (T, TX(0), None)]),
        kf("animeF", [(0, "opacity:0", None), (0.65, "opacity:0", EASE_OUT), (1.25, "opacity:1", None), (T, "opacity:1", None)]),
        kf("animeX", [(0, TX(H + 80), None), (0.65, TX(H + 80), EASE_OUT), (1.35, TX(H), None), (1.55, TX(H), EASE_IO), (2.30, TX(0), None), (T, TX(0), None)]),
        kf("nimS", [(0, TX(-DN), None), (2.22, TX(-DN), EASE_IO), (2.62, TX(0), None), (T, TX(0), None)]),
        # jaunissement pendant le glissement (balayage net, côté tourné vers l'autre a)
        kf("l1", [(0, f"fill:{ink}", None), (2.02, f"fill:{ink}", "steps(1,end)"), (2.03, f"fill:{Y}", None), (T, f"fill:{Y}", None)]),
        kf("l2", [(0, "opacity:1", None), (2.02, "opacity:1", "steps(1,end)"), (2.03, "opacity:0", None), (T, "opacity:0", None)]),
        kf("ly1", [(0, "opacity:1", None), (2.02, "opacity:1", "steps(1,end)"), (2.03, "opacity:0", None), (T, "opacity:0", None)]),
        kf("w1", [(0, TX(0), None), (1.55, TX(0), WIPE), (2.02, TX(-AWL), None), (T, TX(-AWL), None)]),
        kf("w2", [(0, TX(0), None), (1.55, TX(0), WIPE), (2.02, TX(AWL), None), (T, TX(AWL), None)]),
        # métamorphose a → A (2,22–2,62 s) : le a jaune grandit et s'efface, le A jaune grandit de 0,8 à 1 et apparaît
        kf("mLow", [(0, "opacity:1;transform:scale(1)", None), (2.22, "opacity:1;transform:scale(1)", EASE_IO), (2.42, "opacity:1;transform:scale(1.2,1.24)", EASE_OUT), (2.62, "opacity:0;transform:scale(1.32,1.38)", None), (T, "opacity:0;transform:scale(1.32,1.38)", None)]),
        kf("mCap", [(0, "opacity:0;transform:scale(.78,.72)", None), (2.22, "opacity:0;transform:scale(.78,.72)", EASE_IO), (2.46, "opacity:1;transform:scale(.93,.9)", EASE_OUT), (2.62, "opacity:1;transform:scale(1)", None), (T, "opacity:1;transform:scale(1)", None)]),
        kf("eye", anim.rot_frames(2.72, 3.62)),
    ]
    an = lambda n: f"animation:{n} {T}s linear both"
    cls = ["dataF", "dataX", "datS", "animeF", "animeX", "nimS", "l1", "l2", "ly1", "w1", "w2", "mLow", "mCap", "eye"]
    css = ("".join(k) + f".dataF{{{an('dataF')}}}.dataX{{{an('dataX')}}}.datS{{{an('datS')}}}.animeF{{{an('animeF')}}}.animeX{{{an('animeX')}}}.nimS{{{an('nimS')}}}"
           f".l1{{fill:{Y};{an('l1')}}}.l2{{fill:{pet};opacity:0;{an('l2')}}}.ly1{{fill:{Y};opacity:0;{an('ly1')}}}.ly2{{fill:{Y}}}"
           f".w1{{{TX(-AWL)};{an('w1')}}}.w2{{{TX(AWL)};{an('w2')}}}"
           f".mLow{{opacity:0;transform-origin:{Mo};{an('mLow')}}}.mCap{{transform-origin:{Mo};{an('mCap')}}}"
           f".eye{{transform:{tf(c15.C15)};{an('eye')}}}")
    if accents:
        css += (kf("dr1", [(0, "stroke-dashoffset:1", None), (3.67, "stroke-dashoffset:1", DRAW), (4.02, "stroke-dashoffset:0", None), (T, "stroke-dashoffset:0", None)]) +
                kf("dr2", [(0, "stroke-dashoffset:1", None), (3.82, "stroke-dashoffset:1", DRAW), (4.17, "stroke-dashoffset:0", None), (T, "stroke-dashoffset:0", None)]) +
                f".dr1{{stroke-dashoffset:0;{an('dr1')}}}.dr2{{stroke-dashoffset:0;{an('dr2')}}}"); cls += ["dr1", "dr2"]
    css += "@media (prefers-reduced-motion:reduce){" + ",".join("." + c for c in cls) + "{animation:none}}"
    eyemask = (f'<mask id="eye1{theme}" maskUnits="userSpaceOnUse" x="{vx - 200:.1f}" y="{vy:.1f}" width="{vw + 400:.1f}" height="{vh:.1f}">'
               f'<rect x="{vx - 200:.1f}" y="{vy:.1f}" width="{vw + 400:.1f}" height="{vh:.1f}" fill="#fff"/><path d="{c15.UNIT_D}" fill="#000" class="eye"/></mask>')
    clip = lambda i, x: f'<clipPath id="w{i}{theme}"><rect class="w{i}" x="{x:.2f}" y="{vy:.1f}" width="{AWL:.2f}" height="{vh:.1f}"/></clipPath>'
    defs = eyemask + clip(1, ax1 + 1) + clip(2, ax0 - 1 - AWL)
    acc = ""
    if accents:
        (g, gp), (a, ap) = A.accent_specs(XA, NIME)
        m = lambda i, p: (f'<mask id="acc{i}{theme}" maskUnits="userSpaceOnUse" x="{vx:.1f}" y="{vy:.1f}" width="{vw:.1f}" height="{vh:.1f}">'
                          f'<path class="dr{i}" d="{p}" fill="none" stroke="#fff" stroke-width="{A.WMAX + 8}" pathLength="1" stroke-dasharray="1 1"/></mask>')
        defs += m(1, gp) + m(2, ap)
        acc = f'<path d="{g}" fill="{Y}" mask="url(#acc1{theme})"/><path d="{a}" fill="{Y}" mask="url(#acc2{theme})"/>'
    data = (f'<g class="dataF"><g class="dataX"><g class="datS">' + "".join(f'<path d="{d}" fill="{ink}"/>' for d in DAT) + "</g>"
            f'<g class="mLow"><path class="l1" d="{A_LOW}"/><g clip-path="url(#w1{theme})"><path class="ly1" d="{A_LOW}"/></g></g>'
            f'<g class="mCap"><path d="{SOLID}" fill="{Y}" mask="url(#eye1{theme})"/></g></g></g>')
    anime = (f'<g class="animeF"><g class="animeX"><g class="mLow"><path class="l2" d="{A_LOW}"/>'
             f'<g clip-path="url(#w2{theme})"><path class="ly2" d="{A_LOW}"/></g></g>'
             f'<g class="nimS">' + "".join(f'<path d="{d}" fill="{pet}"/>' for d in NIME) + "</g></g></g>")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.2f} {vy:.2f} {vw:.2f} {vh:.2f}" width="{vw:.0f}" height="{vh:.0f}" '
            f'role="img" aria-label="Datanime"><style>{css}</style><defs>{defs}</defs>{data}{anime}{acc}</svg>')

if __name__ == "__main__":
    for acc in (False, True):
        tag = "logo-anim-minuscules" + ("-accents" if acc else "")
        for suf, th, yk in (("", "light", "jaune-or"), ("-dark", "dark", "jaune-vif")):
            open(os.path.join(anim.OUT, tag + suf + ".svg"), "w").write(build(th, yk, acc))
    print("ok", round(DD, 1), round(DN, 1), round(D, 1))
