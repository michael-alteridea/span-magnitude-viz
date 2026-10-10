"""zoom-c15.png : C1, C15, C2 empilés (fond clair, jaune or), gros plan + mention de la hauteur du ▶."""
import io, json, cairosvg
from PIL import Image, ImageDraw, ImageFont
m = json.load(open("variantes.json"))["variantes"]
f = ImageFont.truetype("/workspace/tell4d-logo/src/Inter-600.ttf", 34)
rows = []
for c in ["C1", "C15", "C2"]:
    png = cairosvg.svg2png(url=f"variantes/{c}-light-jaune-or.svg", output_width=2000)
    im = Image.open(io.BytesIO(png)).convert("RGB")
    fav = Image.open(f"variantes/{c}-favicon-jaune-or-32.png").convert("RGBA")
    canvas = Image.new("RGB", (2000, im.height + 60), "white"); canvas.paste(im, (0, 60))
    d = ImageDraw.Draw(canvas)
    d.text((40, 18), f"{c} — ▶ {str(m[c]['info']['trou_px_mot_112']).replace('.', ',')} px à 112 px · favicon 32 px réel →", fill="#4a5a62", font=f)
    canvas.paste(fav, (1080, 18), fav); canvas.paste(fav.resize((128, 128), Image.LANCZOS), (1140, 0), fav.resize((128, 128), Image.LANCZOS)) if False else None
    rows.append(canvas)
out = Image.new("RGB", (2000, sum(r.height for r in rows) + 20 * (len(rows) - 1)), "#E6EAEC"); y = 0
for r in rows: out.paste(r, (0, y)); y += r.height + 20
out.save("zoom-c15.png"); print(out.size)
