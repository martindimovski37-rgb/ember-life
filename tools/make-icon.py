"""Ember Life app icon: the Ember flame inside a three-part ring (planner, diet, gym).
Writes icons/icon.svg (rounded, for the browser tab and Mac rail) and icons/icon-full.svg (square, for iPhone/PWA PNGs).
Run: python3 tools/make-icon.py && swift tools/render-png.swift"""
import math, os
P = dict(bg="#7E0E16", glow="#8E1A22", fo="#FF5A36", fm="#FF9A4D", fc="#FFD27A", segs=["#FFFFFF", "#F2CDD0", "#FFD27A"])
FO = "M75,12 C84,26 97,38 97,57 C97,72 87,83 75,84 C63,83 53,72 53,57 C53,47 57,40 62,33 C62,41 64,47 68,50 C66,37 70,24 75,12 Z"
FM = "M76,34 C83,45 89,53 89,64 C89,74 83,80 75,80 C67,80 61,74 61,65 C61,59 64,54 67,50 C67,56 69,60 72,61 C70,52 72,43 76,34 Z"
FC = "M75,55 C79,61 82,66 82,71 C82,76 79,79 75,79 C71,79 68,76 68,71 C68,66 71,61 75,55 Z"
CX, CY, R = 75, 76, 50
def arc(a0, a1):
    p = lambda a: f"{CX + R*math.cos(math.radians(a)):.2f},{CY + R*math.sin(math.radians(a)):.2f}"
    return f"M{p(a0)} A{R},{R} 0 0 1 {p(a1)}"
def art():
    gap = 16
    rings = "".join(f'<path d="{arc(-90 + i*120 + gap/2, -90 + (i+1)*120 - gap/2)}" stroke="{c}" stroke-width="11" stroke-linecap="round" fill="none"/>' for i, c in enumerate(P["segs"]))
    flame = f'<g transform="translate(0,20)"><path d="{FO}" fill="{P["fo"]}"/><path d="{FM}" fill="{P["fm"]}"/><path d="{FC}" fill="{P["fc"]}"/></g>'
    return f'<circle cx="{CX}" cy="{CY}" r="38" fill="{P["glow"]}"/>' + rings + flame
def svg(radius):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150"><rect width="150" height="150" rx="{radius}" fill="{P["bg"]}"/><g transform="translate(6,6) scale(0.92)">{art()}</g></svg>'
open("icons/icon.svg", "w").write(svg(34))
open("icons/icon-full.svg", "w").write(svg(0))
print("ok")
