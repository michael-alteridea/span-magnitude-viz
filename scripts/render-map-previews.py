"""Render docs/maps/*.svg → docs/maps/previews/*.png (CairoSVG)."""
import glob
import os

import cairosvg

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
src = os.path.join(root, "docs", "maps")
out = os.path.join(src, "previews")
os.makedirs(out, exist_ok=True)
for f in sorted(glob.glob(os.path.join(src, "*.svg"))):
    png = os.path.join(out, os.path.basename(f)[:-4] + ".png")
    cairosvg.svg2png(url=f, write_to=png, output_width=1200 if "europe" in f else 1000)
    print(f"✓ {os.path.relpath(png, root)}  {os.path.getsize(png) / 1024:.1f} KB")
