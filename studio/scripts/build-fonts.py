"""
Génère les polices embarquées du Studio (WOFF2 statiques, sous-ensemble Latin + français).
Toutes sont sous licence SIL OFL 1.1 (Google Fonts). Usage :
  python3 studio/scripts/build-fonts.py [dossier_source_google_fonts]
Requiert fonttools + brotli.
"""
import sys, os, io
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

SRC = sys.argv[1] if len(sys.argv) > 1 else "/usr/share/fonts/truetype/sand-box/google"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "fonts")

FONTS = {
    "inter": ("Inter/Inter-VariableFont_opsz,wght.ttf", {"opsz": 14}),
    "plex": ("IBM Plex Sans/IBMPlexSans-VariableFont_wdth,wght.ttf", {"wdth": 100}),
    "grotesk": ("Space Grotesk/SpaceGrotesk-VariableFont_wght.ttf", {}),
    "playfair": ("Playfair Display/PlayfairDisplay-VariableFont_wght.ttf", {}),
    "barlow": (None, {}),  # static files
}
WEIGHTS = [400, 700]
UNICODES = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) +
    [0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2022, 0x2026,
     0x2009, 0x202F, 0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x00B7,
     0x2264, 0x2265, 0x00D7, 0x25B2, 0x25BC, 0x2039, 0x203A]
)

def finish(font: TTFont, out_path: str):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern", "liga", "tnum", "lnum", "calt"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(options=opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    font.flavor = "woff2"
    font.save(out_path)
    print(out_path, os.path.getsize(out_path))

os.makedirs(OUT, exist_ok=True)
for key, (rel, pins) in FONTS.items():
    for w in WEIGHTS:
        out = os.path.join(OUT, f"{key}-{w}.woff2")
        if key == "barlow":
            name = "Regular" if w == 400 else "Bold"
            font = TTFont(os.path.join(SRC, "Barlow Condensed", f"BarlowCondensed-{name}.ttf"))
        else:
            vf = TTFont(os.path.join(SRC, rel))
            axes = {a.axisTag for a in vf["fvar"].axes}
            loc = {"wght": w}
            for k, v in pins.items():
                if k in axes:
                    loc[k] = v
            for a in vf["fvar"].axes:
                if a.axisTag not in loc:
                    loc[a.axisTag] = a.defaultValue
            font = instancer.instantiateVariableFont(vf, loc, updateFontNames=False)
        finish(font, out)
