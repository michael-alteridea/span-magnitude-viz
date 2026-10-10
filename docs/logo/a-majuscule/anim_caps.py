"""Animation variante capitales : « DATA » → « DATA Anime » → fusion des A jaunes → œil en ▶ → « DATAnime » (C15caps).
Réutilise anim.py en remplaçant la mise en page (DAT capitales, position du A avec crénage T-A)."""
import os, json, anim, caps, build_c as C
dat, xa, nime, width = caps.layout()
anim.DAT, anim.XA, anim.NIME, anim.WIDTH = dat, xa, nime, width
anim.SOLID = C.to_d(C.solid_A(C.BAR[0]), lambda x, y: (xa + x * anim.s, anim.B.BASE - y * anim.s))
for name, th, yk in (("logo-anim-caps.svg", "light", "jaune-or"), ("logo-anim-caps-dark.svg", "dark", "jaune-vif")):
    open(os.path.join(anim.OUT, name), "w").write(anim.svg(th, yk))
print("ok", anim.T)
