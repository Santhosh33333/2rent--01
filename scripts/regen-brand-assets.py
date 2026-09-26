#!/usr/bin/env python3
"""Regenerate Nabri brand PNGs from the SVG sources in assets/android-src/.

Covers: public/ images + favicon, apple-touch icon, Android launcher
(ic_launcher, round, adaptive foreground), and every splash density.
"""
import subprocess, os
from PIL import Image, ImageDraw

WEB = os.path.join(os.path.dirname(__file__), "..", "packages", "web")
WEB = os.path.abspath(WEB)
SRC = os.path.join(WEB, "assets", "android-src")
TMP = os.path.join(WEB, "assets", ".tmp-render")
os.makedirs(TMP, exist_ok=True)

def rsvg(svg, out, w, h):
    subprocess.run(
        ["rsvg-convert", "-w", str(w), "-h", str(h), "-o", out, svg],
        check=True, capture_output=True,
    )

# ---------- public images ----------
mark = os.path.join(SRC, "..", "..", "public", "logo-mark.svg")
rsvg(mark, os.path.join(TMP, "mark512.png"), 512, 512)
rsvg(mark, os.path.join(TMP, "mark256.png"), 256, 256)

pub = os.path.join(WEB, "public")
m512 = Image.open(os.path.join(TMP, "mark512.png")).convert("RGBA")
m256 = Image.open(os.path.join(TMP, "mark256.png")).convert("RGBA")

m512.save(os.path.join(pub, "logo-mark.png"))
m512.save(os.path.join(pub, "favicon.png"))
m512.save(os.path.join(pub, "images", "logo-mark.png"))
m512.save(os.path.join(pub, "images", "logo-mark-3d.png"))
m512.save(os.path.join(pub, "images", "logo-mark-3d@2x.png"))
m256.save(os.path.join(pub, "images", "logo-clean.png"))
m512.save(os.path.join(pub, "images", "logo-clean@2x.png"))
m256.save(os.path.join(pub, "images", "nabri-mark.png"))

# ---------- android launcher icons ----------
RES = os.path.join(WEB, "android", "app", "src", "main", "res")
fg_svg = os.path.join(SRC, "icon-foreground.svg")
bg_svg = os.path.join(SRC, "icon-background.svg")

launcher_dp = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
fg_dp = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

bg_full = os.path.join(TMP, "bg_full.png")
rsvg(bg_svg, bg_full, 512, 512)
bg_img = Image.open(bg_full).convert("RGBA")

for dpi, size in launcher_dp.items():
    d = os.path.join(RES, f"mipmap-{dpi}")
    os.makedirs(d, exist_ok=True)
    # square launcher: scale full badge
    m = m512.resize((size, size), Image.LANCZOS)
    m.save(os.path.join(d, "ic_launcher.png"))
    # round launcher: circular mask
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4, size * 4), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    round_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    round_img.paste(m, (0, 0), mask)
    round_img.save(os.path.join(d, "ic_launcher_round.png"))

for dpi, size in fg_dp.items():
    d = os.path.join(RES, f"mipmap-{dpi}")
    out = os.path.join(TMP, f"fg_{dpi}.png")
    rsvg(fg_svg, out, size, size)
    os.replace(out, os.path.join(d, "ic_launcher_foreground.png"))

# ---------- android splash screens (cover-crop from 1280x1920 source) ----------
splash_svg = os.path.join(SRC, "splash.svg")
SW, SH = 1280, 1920
splash_targets = {
    "drawable": (480, 320),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
}
for folder, (w, h) in splash_targets.items():
    d = os.path.join(RES, folder)
    os.makedirs(d, exist_ok=True)
    scale = max(w / SW, h / SH)
    rw, rh = int(SW * scale + 0.5), int(SH * scale + 0.5)
    out = os.path.join(TMP, f"splash_{w}x{h}.png")
    rsvg(splash_svg, out, rw, rh)
    img = Image.open(out).convert("RGB")
    left = (rw - w) // 2
    top = (rh - h) // 2
    img.crop((left, top, left + w, top + h)).save(os.path.join(d, "splash.png"))

print("brand assets regenerated OK")
