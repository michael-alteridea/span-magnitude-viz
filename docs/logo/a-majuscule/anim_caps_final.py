"""Réglages finaux, version capitales (sans accents, sombre) : « DATA » → « Anime » arrive → les deux A glissent
l'un vers l'autre (le A d'« Anime » passe SOUS celui de « DATA ») et fusionnent en gardant leurs couleurs → le A
fusionné passe ensuite au jaune (blanc → jaune vif, transition propre) → l'œil pivote en ▶ (C15) → « DATAnime ».
Sorties : anim/logo-anim-caps-final(-dark).svg (+ MP4/GIF via render.sh)."""
import os
import build as B, build_c as C, anim, caps
from anim import kf, tf, EASE_OUT, EASE_IO, c15
dat, xa, nime, width = caps.layout()
anim.DAT, anim.XA, anim.NIME, anim.WIDTH = dat, xa, nime, width
s = anim.s; H = anim.H
SOLID = C.to_d(C.solid_A(C.BAR[0]), lambda x, y: (xa + x * s, B.BASE - y * s))

def build(theme, yk):
    T = 3.85; anim.T = T
    Th = B.THEMES[theme]; Y = B.YELLOWS[yk][1]; ink, pet = Th["n"], Th["p"]
    pad = 20; vx = B.X0 - H - pad; vw = width + 2 * H + 2 * pad; vy = B.TOP - 6 - pad; vh = B.CAP + 12 + 2 * pad
    TX = lambda v: f"transform:translateX({v:.2f}px)"
    k = "".join([
        kf("dataF", [(0, "opacity:0;transform:translateY(10px)", EASE_OUT), (0.70, "opacity:1;transform:translateY(0)", None), (T, "opacity:1;transform:translateY(0)", None)]),
        kf("dataX", [(0, TX(-H), None), (1.55, TX(-H), EASE_IO), (2.30, TX(0), None), (T, TX(0), None)]),
        kf("animeF", [(0, "opacity:0", None), (0.65, "opacity:0", EASE_OUT), (1.25, "opacity:1", None), (T, "opacity:1", None)]),
        kf("animeX", [(0, TX(H + 80), None), (0.65, TX(H + 80), EASE_OUT), (1.35, TX(H), None), (1.55, TX(H), EASE_IO), (2.30, TX(0), None), (T, TX(0), None)]),
        kf("a1", [(0, f"fill:{ink}", None), (2.38, f"fill:{ink}", EASE_IO), (2.78, f"fill:{Y}", None), (T, f"fill:{Y}", None)]),   # jaunit APRÈS la fusion
        kf("a2", [(0, "opacity:1", None), (2.30, "opacity:1", "steps(1,end)"), (2.31, "opacity:0", None), (T, "opacity:0", None)]),
        kf("eye", anim.rot_frames(2.88, 3.78)),
    ])
    an = lambda n: f"animation:{n} {T}s linear both"
    css = (k + f".dataF{{{an('dataF')}}}.dataX{{{an('dataX')}}}.animeF{{{an('animeF')}}}.animeX{{{an('animeX')}}}"
           f".a1{{fill:{Y};{an('a1')}}}.a2{{fill:{pet};opacity:0;{an('a2')}}}.eye{{transform:{tf(c15.C15)};{an('eye')}}}"
           "@media (prefers-reduced-motion:reduce){.dataF,.dataX,.animeF,.animeX,.a1,.a2,.eye{animation:none}}")
    mask = lambda i, extra: (f'<mask id="eye{i}{theme}" maskUnits="userSpaceOnUse" x="{vx - 200:.1f}" y="{vy:.1f}" width="{vw + 400:.1f}" height="{vh:.1f}">'
                             f'<rect x="{vx - 200:.1f}" y="{vy:.1f}" width="{vw + 400:.1f}" height="{vh:.1f}" fill="#fff"/><path d="{c15.UNIT_D}" fill="#000" {extra}/></mask>')
    defs = mask(1, 'class="eye"') + mask(2, f'style="transform:{tf(c15.EYE)}"')
    # « Anime » dessiné AVANT « DATA » : son A glisse sous celui de DATA
    anime = (f'<g class="animeF"><g class="animeX"><path class="a2" d="{SOLID}" mask="url(#eye2{theme})"/>' +
             "".join(f'<path d="{d}" fill="{pet}"/>' for d in nime) + "</g></g>")
    data = (f'<g class="dataF"><g class="dataX">' + "".join(f'<path d="{d}" fill="{ink}"/>' for d in dat) +
            f'<path class="a1" d="{SOLID}" mask="url(#eye1{theme})"/></g></g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.2f} {vy:.2f} {vw:.2f} {vh:.2f}" width="{vw:.0f}" height="{vh:.0f}" '
            f'role="img" aria-label="DATAnime"><style>{css}</style><defs>{defs}</defs>{anime}{data}</svg>')

if __name__ == "__main__":
    open(os.path.join(anim.OUT, "logo-anim-caps-final-dark.svg"), "w").write(build("dark", "jaune-vif"))
    open(os.path.join(anim.OUT, "logo-anim-caps-final.svg"), "w").write(build("light", "jaune-or"))   # au cas où (clair)
    print("ok")
