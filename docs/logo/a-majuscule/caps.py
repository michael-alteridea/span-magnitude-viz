"""Variante capitales : « DAT » (Inter Bold capitales, encre de « Dat ») + A jaune C15 + « nime » (chemins studio).
Même approche que le studio (−2,8 px d'approche par lettre) ; crénage HarfBuzz D-A-T, T-A, A-n."""
import build as B, build_c as C
B.X0 = 206.07 - B.gbounds("D", 700)[0][0] * B.SIZE / B.UPEM
s = B.SIZE / B.UPEM

def layout():
    font, tt, gs, upem, order = B.F(700)
    import uharfbuzz as hb
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    buf = hb.Buffer(); buf.add_str("DATA"); buf.guess_segment_properties(); hb.shape(font, buf, {"kern": True})
    x = B.X0; dat = []; origins = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        origins.append(x)
        pen = SVGPathPen(gs, ntos=B.ntos); gs[order[info.codepoint]].draw(TransformPen(pen, (s, 0, 0, -s, x + pos.x_offset * s, B.BASE)))
        dat.append(pen.getCommands()); x += pos.x_advance * s + B.TRACK
    xa = origins[3]                                   # origine du A (crénage T-A inclus)
    (nx0, _, _, _), _ = B.gbounds("n", 700)
    n_new = xa + B.pair_adv("A", "n") + B.TRACK + nx0 * s
    dx = n_new - B.ink(B.STUDIO[4])[0]
    nime = [B.shift_x(d, dx) for d in B.STUDIO[4:]]
    return dat[:3], xa, nime, B.ink(B.STUDIO[-1])[1] + dx - B.X0

def static_svg(theme, yk, with_bg=True, pad=24):
    dat, xa, nime, width = layout(); T = B.THEMES[theme]; Y = B.YELLOWS[yk][1]
    dA = C.to_d(C.design("C15")[0], lambda x, y: (xa + x * s, B.BASE - y * s))
    body = ("".join(f'<path d="{d}" fill="{T["n"]}"/>' for d in dat) + f'<path d="{dA}" fill="{Y}" fill-rule="evenodd"/>'
            + "".join(f'<path d="{d}" fill="{T["p"]}"/>' for d in nime))
    vx, vy, vw, vh = B.X0 - pad, B.TOP - 4 - pad, width + 2 * pad, B.CAP + 8 + 2 * pad
    bg = f'<rect x="{B.ntos(vx)}" y="{B.ntos(vy)}" width="{B.ntos(vw)}" height="{B.ntos(vh)}" fill="{T["bg"]}"/>' if with_bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{B.ntos(vx)} {B.ntos(vy)} {B.ntos(vw)} {B.ntos(vh)}" '
            f'width="{B.ntos(vw)}" height="{B.ntos(vh)}">{bg}{body}</svg>')

if __name__ == "__main__":
    import os, cairosvg
    for yk in B.YELLOWS:
        for th in B.THEMES:
            n = f"C15caps-{th}-{yk}"
            open(os.path.join(B.OUT, n + ".svg"), "w").write(static_svg(th, yk))
            open(os.path.join(B.OUT, n + "-transparent.svg"), "w").write(static_svg(th, yk, False, 0))
            cairosvg.svg2png(bytestring=static_svg(th, yk).encode(), write_to=os.path.join(B.OUT, n + "-800.png"), output_width=800)
        # favicon identique à C15 (même A) : copie sous le nom caps
        open(os.path.join(B.OUT, f"C15caps-favicon-{yk}.svg"), "w").write(open(os.path.join(B.OUT, f"C15-favicon-{yk}.svg")).read())
    print("ok", [round(v, 1) for v in (layout()[1], layout()[3])])
