"""Gera o kit de identidade visual do Rambutan Slicer (SVG) a partir das brand-guidelines."""
import math
import os
import re
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(OUT, exist_ok=True)

# Paleta (brand-guidelines)
CARMIM = {50: "#FBEAF0", 200: "#ED93B1", 400: "#D4537E", 600: "#993556", 800: "#72243E", 900: "#4B1528"}
TEAL = {50: "#E1F5EE", 200: "#5DCAA5", 400: "#1D9E75", 600: "#0F6E56", 800: "#085041", 900: "#04342C"}
AMBAR = {50: "#FAEEDA", 200: "#FAC775", 400: "#EF9F27", 600: "#BA7517", 800: "#633806", 900: "#412402"}

FONT_MEDIUM = TTFont("/usr/share/fonts/opentype/inter/Inter-Medium.otf")
FONT_REGULAR = TTFont("/usr/share/fonts/opentype/inter/Inter-Regular.otf")

BRAND_ICON_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "public", "rambutan-icon.svg"))
with open(BRAND_ICON_PATH, "r", encoding="utf-8") as fh:
    BRAND_ICON_SOURCE = fh.read()
BRAND_ICON_CONTENTS = BRAND_ICON_SOURCE.split(">", 1)[1].rsplit("</svg>", 1)[0]
BRAND_ICON_CONTENTS = re.sub(r"<metadata>.*?</metadata>", "", BRAND_ICON_CONTENTS, flags=re.DOTALL)


def text_path(text, font, size, x, y, tracking=0.0):
    """Converte texto em path (sem depender de fonte instalada). Retorna (d, largura)."""
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    s = size / upm
    pen = SVGPathPen(gs)
    cx = x
    hmtx = font["hmtx"]
    for i, ch in enumerate(text):
        gname = cmap[ord(ch)]
        tp = TransformPen(pen, (s, 0, 0, -s, cx, y))
        gs[gname].draw(tp)
        cx += hmtx[gname][0] * s
        if i < len(text) - 1:
            cx += tracking * size
    return pen.getCommands(), cx - x


def f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def fruit(cx, cy, r, uid, simple=False, spine_color=None):
    """Rambutan em corte: casca carmim, espinhos curvos teal, polpa em camadas, núcleo âmbar."""
    n = 10 if simple else 22
    spine_color = spine_color or TEAL[400]
    parts = []
    # Espinhos curvos (desenhados atrás da casca)
    spines = []
    for i in range(n):
        a = -math.pi / 2 + i * 2 * math.pi / n
        w = (0.17 if simple else 0.085)  # meia-largura angular da base
        bend = 0.42 if simple else 0.38
        r0 = r * 0.93
        r1 = r * (1.30 if simple else 1.34)
        b1 = (cx + r0 * math.cos(a - w), cy + r0 * math.sin(a - w))
        b2 = (cx + r0 * math.cos(a + w), cy + r0 * math.sin(a + w))
        tip = (cx + r1 * math.cos(a + bend), cy + r1 * math.sin(a + bend))
        c1 = (cx + r * 1.20 * math.cos(a - w * 0.2), cy + r * 1.20 * math.sin(a - w * 0.2))
        c2 = (cx + r * 1.12 * math.cos(a + w * 1.9), cy + r * 1.12 * math.sin(a + w * 1.9))
        spines.append(
            f"M{f(b1[0])} {f(b1[1])}Q{f(c1[0])} {f(c1[1])} {f(tip[0])} {f(tip[1])}"
            f"Q{f(c2[0])} {f(c2[1])} {f(b2[0])} {f(b2[1])}Z"
        )
    defs = (
        f'<radialGradient id="rind{uid}" cx="38%" cy="32%" r="75%">'
        f'<stop offset="0" stop-color="{CARMIM[200]}"/>'
        f'<stop offset=".45" stop-color="{CARMIM[400]}"/>'
        f'<stop offset="1" stop-color="{CARMIM[600]}"/></radialGradient>'
        f'<radialGradient id="seed{uid}" cx="40%" cy="35%" r="70%">'
        f'<stop offset="0" stop-color="{AMBAR[200]}"/>'
        f'<stop offset=".6" stop-color="{AMBAR[400]}"/>'
        f'<stop offset="1" stop-color="{AMBAR[600]}"/></radialGradient>'
        f'<clipPath id="flesh{uid}"><circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r * 0.70)}"/></clipPath>'
    )
    parts.append(f'<path d="{"".join(spines)}" fill="{spine_color}"/>')
    parts.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="url(#rind{uid})"/>')
    # Polpa (corte) — branca translúcida
    parts.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r * 0.70)}" fill="{CARMIM[50]}"/>')
    if not simple:
        # Camadas de fatiamento na polpa
        lines = []
        step = r * 0.14
        k = -4
        while k <= 4:
            yy = cy + k * step
            lines.append(f"M{f(cx - r)} {f(yy)}H{f(cx + r)}")
            k += 1
        parts.append(
            f'<path d="{"".join(lines)}" stroke="{CARMIM[200]}" stroke-opacity=".55" '
            f'stroke-width="{f(r * 0.022)}" clip-path="url(#flesh{uid})"/>'
        )
    # Núcleo âmbar
    parts.append(
        f'<ellipse cx="{f(cx)}" cy="{f(cy + r * 0.02)}" rx="{f(r * (0.30 if simple else 0.27))}" '
        f'ry="{f(r * (0.34 if simple else 0.32))}" fill="url(#seed{uid})"/>'
    )
    return defs, "".join(parts)


def svg(w, h, body, defs="", label="Rambutan Slicer"):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" role="img" aria-label="{label}">'
        f"<defs>{defs}</defs>{body}</svg>\n"
    )


def write(name, content):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        fh.write(content)


# 1) Ícone (transparente)
d, b = fruit(512, 512, 330, "a")
write("rambutan-icon.svg", svg(1024, 1024, b, d))
# Ícone simplificado para tamanhos pequenos (favicon / 16–32 px)
d, b = fruit(512, 512, 340, "s", simple=True)
write("rambutan-icon-small.svg", svg(1024, 1024, b, d))


# 2) Ícone de app (fundo teal-900 arredondado)
def app_icon(simple):
    uid = "p" if simple else "q"
    bg_defs = (
        f'<radialGradient id="bg{uid}" cx="50%" cy="30%" r="80%">'
        f'<stop offset="0" stop-color="{TEAL[800]}"/><stop offset="1" stop-color="{TEAL[900]}"/></radialGradient>'
    )
    d, b = fruit(512, 512, 285 if not simple else 300, uid, simple=simple, spine_color=TEAL[200])
    body = f'<rect x="32" y="32" width="960" height="960" rx="216" fill="url(#bg{uid})"/>' + b
    return svg(1024, 1024, body, bg_defs + d)


write("rambutan-app-icon.svg", app_icon(False))
write("rambutan-app-icon-small.svg", app_icon(True))


# 3) Wordmarks
def wordmark_line(fg, accent):
    """Uma linha: RAMBUTAN SLICER — proporção ~5.6:1 (mesma do wordmark antigo, usado na placa 3D)."""
    size = 80
    d1, w1 = text_path("RAMBUTAN", FONT_MEDIUM, size, 0, 0, tracking=0.06)
    gap = size * 0.42
    d2, w2 = text_path("SLICER", FONT_REGULAR, size, w1 + gap, 0, tracking=0.06)
    total = w1 + gap + w2
    cap = size * 0.727  # cap height Inter
    h = total / 5.64
    pad_x = 0
    oy = (h + cap) / 2
    body = (
        f'<g transform="translate({f(pad_x)} {f(oy)})">'
        f'<path d="{d1}" fill="{fg}"/><path d="{d2}" fill="{accent}"/></g>'
    )
    return svg(total, h, body)


write("rambutan-wordmark.svg", wordmark_line("#F2F8F6", TEAL[200]))          # fundo escuro (app)
write("rambutan-wordmark-light-bg.svg", wordmark_line(TEAL[800], TEAL[400]))  # fundo claro


def stacked_text(x, top, fg, accent, size=150):
    d1, w1 = text_path("RAMBUTAN", FONT_MEDIUM, size, 0, 0, tracking=0.04)
    cap = size * 0.727
    sub = size * 0.34
    # SLICER espaçado para ocupar a mesma largura de RAMBUTAN
    d2, w2 = text_path("SLICER", FONT_MEDIUM, sub, size * 0.02, 0, tracking=0.42)
    sub_cap = sub * 0.727
    gap = size * 0.24
    g = (
        f'<g transform="translate({f(x)} {f(top + cap)})"><path d="{d1}" fill="{fg}"/></g>'
        f'<g transform="translate({f(x)} {f(top + cap + gap + sub_cap)})"><path d="{d2}" fill="{accent}"/></g>'
    )
    return g, w1, cap + gap + sub_cap


def horizontal(fg, accent, uid):
    icon_r = 120
    d, b = fruit(0, 0, icon_r, uid)
    icon_box = icon_r * 1.32 * 2
    tg, tw, th = stacked_text(0, 0, fg, accent)
    gap = 56
    h = icon_box
    w = icon_box + gap + tw
    body = (
        f'<g transform="translate({f(icon_box / 2)} {f(h / 2)})">{b}</g>'
        f'<g transform="translate({f(icon_box + gap)} {f((h - th) / 2)})">{tg}</g>'
    )
    return svg(w, h, body, d)


def vertical(fg, accent, uid):
    icon_r = 170
    d, b = fruit(0, 0, icon_r, uid)
    icon_box = icon_r * 1.32 * 2
    tg, tw, th = stacked_text(0, 0, fg, accent, size=130)
    gap = 60
    w = max(icon_box, tw)
    h = icon_box + gap + th
    body = (
        f'<g transform="translate({f(w / 2)} {f(icon_box / 2)})">{b}</g>'
        f'<g transform="translate({f((w - tw) / 2)} {f(icon_box + gap)})">{tg}</g>'
    )
    return svg(w, h, body, d)


write("rambutan-logo-horizontal.svg", horizontal(TEAL[800], TEAL[400], "h"))
write("rambutan-logo-horizontal-dark-bg.svg", horizontal("#F2F8F6", TEAL[200], "hd"))
write("rambutan-logo-vertical.svg", vertical(TEAL[800], TEAL[400], "v"))
write("rambutan-logo-vertical-dark-bg.svg", vertical("#F2F8F6", TEAL[200], "vd"))
print("ok")


# 4) Instalador (NSIS header/sidebar, fundo do DMG)
def text_g(text, font, size, x, y, fill, tracking=0.0, anchor="start"):
    d, w = text_path(text, font, size, 0, 0, tracking)
    if anchor == "middle":
        x -= w / 2
    return f'<g transform="translate({f(x)} {f(y)})"><path d="{d}" fill="{fill}"/></g>'


def brand_icon(x, y, size):
    return (
        f'<svg x="{f(x)}" y="{f(y)}" width="{f(size)}" height="{f(size)}" '
        f'viewBox="0 0 1024 1024">{BRAND_ICON_CONTENTS}</svg>'
    )


bgdef = (
    f'<linearGradient id="ibg" x1="0" y1="0" x2="0" y2="1">'
    f'<stop offset="0" stop-color="{TEAL[800]}"/><stop offset="1" stop-color="{TEAL[900]}"/></linearGradient>'
)
installer_bgdef = (
    '<linearGradient id="installer-bg" x1=".15" y1="0" x2=".85" y2="1">'
    '<stop offset="0" stop-color="#191116"/><stop offset=".55" stop-color="#0e0d13"/>'
    '<stop offset="1" stop-color="#090b12"/></linearGradient>'
    '<linearGradient id="installer-glow" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#ed0921" stop-opacity=".22"/>'
    '<stop offset="1" stop-color="#ed0921" stop-opacity="0"/></linearGradient>'
)
# header 150x57
body = (
    '<rect width="150" height="57" fill="url(#installer-bg)"/>'
    '<path d="M150 0H108L150 42Z" fill="url(#installer-glow)"/>'
    + brand_icon(8, 8, 40)
    + text_g("Rambutan", FONT_MEDIUM, 15, 54, 25, "#FFF9F8")
    + text_g("SLICER · Installer", FONT_REGULAR, 8.5, 54, 39, "#ED0921", tracking=0.08)
    + '<rect y="55" width="150" height="2" fill="#ED0921"/>'
)
write("installer-header.svg", svg(150, 57, body, installer_bgdef))

# sidebar 164x314
body = (
    '<rect width="164" height="314" fill="url(#installer-bg)"/>'
    '<path d="M164 0H103L164 61Z" fill="url(#installer-glow)"/>'
    '<path d="M0 314H60L0 254Z" fill="#ED0921" opacity=".08"/>'
    + brand_icon(30, 38, 104)
    + text_g("RAMBUTAN", FONT_MEDIUM, 19, 82, 172, "#FFF9F8", tracking=0.04, anchor="middle")
    + text_g("SLICER", FONT_MEDIUM, 8, 82, 188, "#ED0921", tracking=0.42, anchor="middle")
    + '<rect x="62" y="210" width="40" height="1.5" fill="#ED0921"/>'
    + text_g("Based on DragonFruit", FONT_REGULAR, 7.5, 82, 282, "#C0BDC3", anchor="middle")
    + text_g("Open Resin Alliance · AGPL-3.0", FONT_REGULAR, 7, 82, 294, "#8E8B92", anchor="middle")
)
write("installer-sidebar.svg", svg(164, 314, body, installer_bgdef))

# DMG 660x440 (ícones do app/Applications ficam por cima, então só fundo + rodapé)
body = (
    f'<rect width="660" height="440" fill="url(#ibg)"/>'
    + text_g("Rambutan Slicer  ·  Based on DragonFruit by Open Resin Alliance  ·  AGPL-3.0-or-later",
             FONT_REGULAR, 10, 330, 418, TEAL[50], anchor="middle")
)
write("installer-dmg-background.svg", svg(660, 440, body, bgdef))
print("installer ok")
