"""Réglages finaux, minuscules (sans accents, sombre) : « Data » + « anime » → les deux a glissent l'un vers l'autre
SANS changer de couleur (le a d'« anime » passe sous celui de « Data ») → métamorphose a → A dans la même couleur neutre
→ le A passe ensuite au jaune vif → l'œil pivote en ▶ (C15). Sorties : anim/logo-anim-minuscules-final(-dark).svg."""
import os
import build as B, anim, anim_min as M
from anim import kf, tf, EASE_OUT, EASE_IO, c15
XA, DAT, NIME, WIDTH, SOLID = M.XA, M.DAT, M.NIME, M.WIDTH, M.SOLID
H, DD, DN, AXIS, A_LOW = M.H, M.DD, M.DN, M.AXIS, M.A_LOW

def build(theme, yk):
    T = 4.2; anim.T = T
    Th = B.THEMES[theme]; Y = B.YELLOWS[yk][1]; ink, pet = Th["n"], Th["p"]
    pad = 20; vx = B.X0 - H - pad; vw = WIDTH + 2 * H + 2 * pad; vy = B.TOP - 6 - pad; vh = B.CAP + 12 + 2 * pad
    TX = lambda v: f"transform:translateX({v:.2f}px)"; Mo = f"{AXIS:.2f}px {B.BASE:.2f}px"
    k = "".join([
        kf("dataF", [(0, "opacity:0;transform:translateY(10px)", EASE_OUT), (0.70, "opacity:1;transform:translateY(0)", None), (T, "opacity:1;transform:translateY(0)", None)]),
        kf("dataX", [(0, TX(-H), None), (1.55, TX(-H), EASE_IO), (2.30, TX(0), None), (T, TX(0), None)]),
        kf("datS", [(0, TX(DD), None), (2.40, TX(DD), EASE_IO), (2.80, TX(0), None), (T, TX(0), None)]),
        kf("animeF", [(0, "opacity:0", None), (0.65, "opacity:0", EASE_OUT), (1.25, "opacity:1", None), (T, "opacity:1", None)]),
        kf("animeX", [(0, TX(H + 80), None), (0.65, TX(H + 80), EASE_OUT), (1.35, TX(H), None), (1.55, TX(H), EASE_IO), (2.30, TX(0), None), (T, TX(0), None)]),
        kf("nimS", [(0, TX(-DN), None), (2.40, TX(-DN), EASE_IO), (2.80, TX(0), None), (T, TX(0), None)]),
        kf("l2", [(0, "opacity:1", None), (2.30, "opacity:1", "steps(1,end)"), (2.31, "opacity:0", None), (T, "opacity:0", None)]),
        # métamorphose a → A (2,40–2,80 s) dans la couleur neutre
        kf("mLow", [(0, "opacity:1;transform:scale(1)", None), (2.40, "opacity:1;transform:scale(1)", EASE_IO), (2.60, "opacity:1;transform:scale(1.2,1.24)", EASE_OUT), (2.80, "opacity:0;transform:scale(1.32,1.38)", None), (T, "opacity:0;transform:scale(1.32,1.38)", None)]),
        kf("mCap", [(0, "opacity:0;transform:scale(.78,.72)", None), (2.40, "opacity:0;transform:scale(.78,.72)", EASE_IO), (2.64, "opacity:1;transform:scale(.93,.9)", EASE_OUT), (2.80, "opacity:1;transform:scale(1)", None), (T, "opacity:1;transform:scale(1)", None)]),
        # puis le A jaunit (2,90–3,30 s), puis pivot (3,35–4,15 s)
        kf("cap", [(0, f"fill:{ink}", None), (2.90, f"fill:{ink}", EASE_IO), (3.30, f"fill:{Y}", None), (T, f"fill:{Y}", None)]),
        kf("eye", anim.rot_frames(3.35, 4.15)),
    ])
    an = lambda n: f"animation:{n} {T}s linear both"
    cls = ["dataF", "dataX", "datS", "animeF", "animeX", "nimS", "l2", "mLow", "mCap", "cap", "eye"]
    css = (k + "".join(f".{c}{{{an(c)}}}" for c in ["dataF", "dataX", "datS", "animeF", "animeX", "nimS"]) +
           f".l2{{fill:{pet};opacity:0;{an('l2')}}}.mLow{{opacity:0;transform-origin:{Mo};{an('mLow')}}}.mCap{{transform-origin:{Mo};{an('mCap')}}}"
           f".cap{{fill:{Y};{an('cap')}}}.eye{{transform:{tf(c15.C15)};{an('eye')}}}"
           "@media (prefers-reduced-motion:reduce){" + ",".join("." + c for c in cls) + "{animation:none}}")
    defs = (f'<mask id="eye1{theme}" maskUnits="userSpaceOnUse" x="{vx - 200:.1f}" y="{vy:.1f}" width="{vw + 400:.1f}" height="{vh:.1f}">'
            f'<rect x="{vx - 200:.1f}" y="{vy:.1f}" width="{vw + 400:.1f}" height="{vh:.1f}" fill="#fff"/><path d="{c15.UNIT_D}" fill="#000" class="eye"/></mask>')
    anime = (f'<g class="animeF"><g class="animeX"><g class="mLow"><path class="l2" d="{A_LOW}"/></g>'
             f'<g class="nimS">' + "".join(f'<path d="{d}" fill="{pet}"/>' for d in NIME) + "</g></g></g>")
    data = (f'<g class="dataF"><g class="dataX"><g class="datS">' + "".join(f'<path d="{d}" fill="{ink}"/>' for d in DAT) + "</g>"
            f'<g class="mLow"><path d="{A_LOW}" fill="{ink}"/></g>'
            f'<g class="mCap"><path class="cap" d="{SOLID}" mask="url(#eye1{theme})"/></g></g></g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.2f} {vy:.2f} {vw:.2f} {vh:.2f}" width="{vw:.0f}" height="{vh:.0f}" '
            f'role="img" aria-label="Datanime"><style>{css}</style><defs>{defs}</defs>{anime}{data}</svg>')

if __name__ == "__main__":
    open(os.path.join(anim.OUT, "logo-anim-minuscules-final-dark.svg"), "w").write(build("dark", "jaune-vif"))
    print("ok")
