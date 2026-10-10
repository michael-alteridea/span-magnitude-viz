"""Animation « accents » (DatÀnimé / DATÀnimé) : storyboard de anim.py (fusion + pivot du ▶), puis paraphe :
grave tracé sur le A (3,35–3,70 s) puis aigu miroir sur le e (3,50–3,85 s). Durée 4,0 s puis tenue.
Sorties : anim/logo-anim-accents(.svg|-dark.svg), anim/logo-anim-caps-accents(.svg|-dark.svg) + statiques variantes/C15accents-*."""
import os, re, cairosvg
import build as B, build_c as C, anim, caps, accents as A
anim.T = 4.0
DRAW = "cubic-bezier(.3,0,.2,1)"
def add_accents(svg, theme, yk, xa, nime):
    (g, gp), (a, ap) = A.accent_specs(xa, nime); Y = B.YELLOWS[yk][1]; T = anim.T
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    vb[1] -= A.TOP_EXTRA; vb[3] += A.TOP_EXTRA
    svg = re.sub(r'viewBox="[^"]+" width="[^"]+" height="[^"]+"', f'viewBox="{vb[0]:.2f} {vb[1]:.2f} {vb[2]:.2f} {vb[3]:.2f}" width="{vb[2]:.0f}" height="{vb[3]:.0f}"', svg, 1)
    css = (anim.kf("dr1", [(0, "stroke-dashoffset:1", None), (3.35, "stroke-dashoffset:1", DRAW), (3.70, "stroke-dashoffset:0", None), (T, "stroke-dashoffset:0", None)]) +
           anim.kf("dr2", [(0, "stroke-dashoffset:1", None), (3.50, "stroke-dashoffset:1", DRAW), (3.85, "stroke-dashoffset:0", None), (T, "stroke-dashoffset:0", None)]) +
           f".dr1{{stroke-dashoffset:0;animation:dr1 {T}s linear both}}.dr2{{stroke-dashoffset:0;animation:dr2 {T}s linear both}}"
           "@media (prefers-reduced-motion:reduce){.dr1,.dr2{animation:none}}")
    svg = svg.replace("</style>", css + "</style>", 1)
    m = lambda i, p: (f'<mask id="acc{i}{theme}" maskUnits="userSpaceOnUse" x="{vb[0]:.1f}" y="{vb[1]:.1f}" width="{vb[2]:.1f}" height="{vb[3]:.1f}">'
                      f'<path class="dr{i}" d="{p}" fill="none" stroke="#fff" stroke-width="{A.WMAX + 8}" pathLength="1" stroke-dasharray="1 1"/></mask>')
    svg = svg.replace("</defs>", m(1, gp) + m(2, ap) + "</defs>", 1)
    return svg.replace("</svg>", f'<path d="{g}" fill="{Y}" mask="url(#acc1{theme})"/><path d="{a}" fill="{Y}" mask="url(#acc2{theme})"/></svg>')

base = dict(DAT=anim.DAT, XA=anim.XA, NIME=anim.NIME, WIDTH=anim.WIDTH, SOLID=anim.SOLID)
dat, xa_c, nime_c, width_c = caps.layout()
capsg = dict(DAT=dat, XA=xa_c, NIME=nime_c, WIDTH=width_c, SOLID=C.to_d(C.solid_A(C.BAR[0]), lambda x, y: (xa_c + x * anim.s, B.BASE - y * anim.s)))
for tag, g, capsmode in (("logo-anim-accents", base, False), ("logo-anim-caps-accents", capsg, True)):
    for k, v in g.items(): setattr(anim, k, v)
    for suf, th, yk in (("", "light", "jaune-or"), ("-dark", "dark", "jaune-vif")):
        open(os.path.join(anim.OUT, tag + suf + ".svg"), "w").write(add_accents(anim.svg(th, yk), th, yk, g["XA"], g["NIME"]))
    pre = "C15accents-caps" if capsmode else "C15accents"
    for yk in B.YELLOWS:
        for th in B.THEMES:
            n = f"{pre}-{th}-{yk}"
            open(os.path.join(B.OUT, n + ".svg"), "w").write(A.static_svg(capsmode, th, yk))
            open(os.path.join(B.OUT, n + "-transparent.svg"), "w").write(A.static_svg(capsmode, th, yk, False, 0))
            cairosvg.svg2png(bytestring=A.static_svg(capsmode, th, yk).encode(), write_to=os.path.join(B.OUT, n + "-800.png"), output_width=800)
print("ok", anim.T)
