"""Animation du logo (storyboard Michaël, 10 oct. 2026) — SVG animé en CSS, sans script.
1) « Data » apparaît (son A en couleur du texte).  2) « Anime » arrive à droite : on lit « Data Anime ».
3) Les deux A glissent l'un vers l'autre et fusionnent en un seul A jaune → « DatAnime ».
4) L'œil du A (triangle pointe en haut) pivote de 90° horaire et devient le ▶ de C15. Puis tenue.
Sorties : anim/logo-anim.svg (clair, jaune or), anim/logo-anim-dark.svg (sombre, jaune vif), anim/apercu.html."""
import math, os, json
import build as B, build_c as C
c15 = C.c15_state()
HERE = B.HERE; OUT = os.path.join(HERE, "anim"); os.makedirs(OUT, exist_ok=True)
T = 3.4                                   # durée totale (s), puis tenue
s = B.SIZE / B.UPEM
(tx0, _, _, _), _ = B.gbounds("t", 700)
XA = B.ink(B.STUDIO[2])[0] - tx0 * s + B.pair_adv("t", "A") + B.TRACK + 1.5     # origine du A (= A1/C15)
parts, WIDTH, _ = B.build("A1")
DAT = [d for d, r in parts if r == "n"]; NIME = [d for d, r in parts if r == "p"]
A_ADV = B.gbounds("A", 700)[1] * s
D = A_ADV + B.TRACK + 0.27 * B.SIZE       # décalage du 2e A dans « Data Anime » (A + espace)
H = D / 2
SOLID = C.to_d(C.solid_A(C.BAR[0]), lambda x, y: (XA + x * s, B.BASE - y * s))

def tf(st):
    return (f"translate({XA + st['cx'] * s:.3f}px,{B.BASE - st['cy'] * s:.3f}px) rotate({st['th']:.3f}deg) "
            f"scale({st['bw'] * s:.4f},{st['ht'] * s:.4f})")
pc = lambda t: f"{100 * t / T:.3f}%"
EASE_OUT, EASE_IO = "cubic-bezier(.22,1,.36,1)", "cubic-bezier(.65,0,.35,1)"
def kf(name, frames):
    """frames : liste (t, déclarations, easing du segment suivant)."""
    body = "".join(f"{pc(t)}{{{decl}" + (f";animation-timing-function:{e}" if e else "") + "}" for t, decl, e in frames)
    return f"@keyframes {name}{{{body}}}"

def rot_frames(t0=2.40, t1=3.30, n=36):
    """Pivot de l'œil : courbe lissée (in-out cubique) précalculée, segments linéaires."""
    fr = [(0, f"transform:{tf(c15.EYE)}", "linear")]
    for i in range(n + 1):
        u = i / n; p = 4 * u**3 if u < .5 else 1 - (-2 * u + 2)**3 / 2
        fr.append((t0 + (t1 - t0) * u, f"transform:{tf(c15.interp(p, c15.EYE, c15.C15))}", "linear"))
    fr.append((T, f"transform:{tf(c15.C15)}", None)); return fr

def svg(theme, yk):
    Th = B.THEMES[theme]; Y = B.YELLOWS[yk][1]; ink, pet = Th["n"], Th["p"]
    pad = 20; vx = B.X0 - H - pad; vw = WIDTH + 2 * H + 2 * pad; vy = B.TOP - 6 - pad; vh = B.CAP + 12 + 2 * pad
    css = "".join([
        kf("dataF", [(0, "opacity:0;transform:translateY(10px)", EASE_OUT), (0.70, "opacity:1;transform:translateY(0)", None), (T, "opacity:1;transform:translateY(0)", None)]),
        kf("dataX", [(0, f"transform:translateX({-H:.2f}px)", None), (1.55, f"transform:translateX({-H:.2f}px)", EASE_IO), (2.30, "transform:translateX(0)", None), (T, "transform:translateX(0)", None)]),
        kf("animeF", [(0, "opacity:0", None), (0.65, "opacity:0", EASE_OUT), (1.25, "opacity:1", None), (T, "opacity:1", None)]),
        kf("animeX", [(0, f"transform:translateX({H + 80:.2f}px)", None), (0.65, f"transform:translateX({H + 80:.2f}px)", EASE_OUT),
                      (1.35, f"transform:translateX({H:.2f}px)", None), (1.55, f"transform:translateX({H:.2f}px)", EASE_IO),
                      (2.30, "transform:translateX(0)", None), (T, "transform:translateX(0)", None)]),
        kf("a1", [(0, f"fill:{ink}", None), (1.40, f"fill:{ink}", EASE_IO), (1.75, f"fill:{Y}", None), (T, f"fill:{Y}", None)]),
        kf("a2", [(0, f"fill:{pet};opacity:1", None), (1.40, f"fill:{pet};opacity:1", EASE_IO), (1.75, f"fill:{Y};opacity:1", None),
                  (2.30, f"fill:{Y};opacity:1", "steps(1,end)"), (2.31, f"fill:{Y};opacity:0", None), (T, f"fill:{Y};opacity:0", None)]),
        kf("eye", rot_frames()),
    ])
    anim = lambda n: f"animation:{n} {T}s linear both"
    style = (f"<style>{css}"
             f".dataF{{{anim('dataF')}}}.dataX{{{anim('dataX')}}}.animeF{{{anim('animeF')}}}.animeX{{{anim('animeX')}}}"
             f".a1{{fill:{Y};{anim('a1')}}}.a2{{fill:{Y};opacity:0;{anim('a2')}}}"
             f".eye{{transform:{tf(c15.C15)};{anim('eye')}}}"   # sans animation → image finale = C15
             f"@media (prefers-reduced-motion:reduce){{.dataF,.dataX,.animeF,.animeX,.a1,.a2,.eye{{animation:none}}}}</style>")
    mask = lambda i, extra: (f'<mask id="eye{i}{theme}" maskUnits="userSpaceOnUse" x="{vx - 200:.1f}" y="{vy:.1f}" width="{vw + 400:.1f}" height="{vh:.1f}">'
                             f'<rect x="{vx - 200:.1f}" y="{vy:.1f}" width="{vw + 400:.1f}" height="{vh:.1f}" fill="#fff"/>'
                             f'<path d="{c15.UNIT_D}" fill="#000" {extra}/></mask>')
    defs = "<defs>" + mask(1, 'class="eye"') + mask(2, f'style="transform:{tf(c15.EYE)}"') + "</defs>"
    data = (f'<g class="dataF"><g class="dataX">' + "".join(f'<path d="{d}" fill="{ink}"/>' for d in DAT) +
            f'<path class="a1" d="{SOLID}" mask="url(#eye1{theme})"/></g></g>')
    anime = (f'<g class="animeF"><g class="animeX"><path class="a2" d="{SOLID}" mask="url(#eye2{theme})"/>' +
             "".join(f'<path d="{d}" fill="{pet}"/>' for d in NIME) + "</g></g>")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.2f} {vy:.2f} {vw:.2f} {vh:.2f}" width="{vw:.0f}" height="{vh:.0f}" '
            f'role="img" aria-label="Datanime">{style}{defs}{data}{anime}</svg>')

if __name__ == "__main__":
    for name, th, yk in (("logo-anim.svg", "light", "jaune-or"), ("logo-anim-dark.svg", "dark", "jaune-vif")):
        open(os.path.join(OUT, name), "w").write(svg(th, yk))
    json.dump({"duree_s": T, "D": D}, open(os.path.join(OUT, "anim.json"), "w"))
    print("ok", T, round(D, 1))
