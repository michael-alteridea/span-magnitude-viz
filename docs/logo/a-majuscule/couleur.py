"""Interpolation de couleur en OKLCH (perceptuelle) pour le passage encre/pétrole → jaune pendant la fusion."""
import math
def _lin(c): c /= 255; return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def _gam(c): c = max(0, min(1, c)); return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
def hex2oklch(h):
    r, g, b = (_lin(int(h[i:i + 2], 16)) for i in (1, 3, 5))
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b; m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b; s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l, m, s = (v ** (1/3) for v in (l, m, s))
    L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s; a = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s; bb = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s
    return L, math.hypot(a, bb), math.degrees(math.atan2(bb, a)) % 360
def oklch2hex(L, C, H):
    a, b = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
    l = (L + 0.3963377774*a + 0.2158037573*b) ** 3; m = (L - 0.1055613458*a - 0.0638541728*b) ** 3; s = (L - 0.0894841775*a - 1.2914855480*b) ** 3
    r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s; g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s; bl = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return "#" + "".join(f"{round(_gam(v) * 255):02X}" for v in (r, g, bl))
def mix(h1, h2, p, chroma_floor=True):
    """p ∈ [0,1]. Teinte : on part directement de celle du jaune quand la couleur de départ est quasi neutre (pas de détour
    par le vert) ; chroma au moins égale à p × chroma du jaune (évite les tons ternes/olive à mi-course)."""
    L1, C1, H1 = hex2oklch(h1); L2, C2, H2 = hex2oklch(h2)
    if C1 < 0.04: H1 = H2
    dh = (H2 - H1 + 180) % 360 - 180
    L = L1 + (L2 - L1) * p; C = C1 + (C2 - C1) * p; H = H1 + dh * p
    if chroma_floor: C = max(C, C2 * min(1, p * 1.6))
    return oklch2hex(L, C, H)
