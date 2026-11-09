#!/usr/bin/env python3
"""Иконка приложения: тот же знак, что в шапке (круг + перекрестие + точка).
Пишет desktop/build/icon.ico (16…256 px) и icon.png (512 px) для macOS.
Запуск: python tools/make-icon.py"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "desktop" / "build"
OUT.mkdir(parents=True, exist_ok=True)

MINT = (61, 220, 151, 255)
DARK = (13, 19, 25, 255)
RING = (61, 220, 151, 90)

S = 1024  # рисуем крупно и уменьшаем
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# скруглённый квадрат-подложка
pad = int(S * 0.06)
radius = int(S * 0.22)
d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=radius, fill=DARK)

c = S // 2
# внешнее кольцо
r1 = int(S * 0.30)
d.ellipse([c - r1, c - r1, c + r1, c + r1], outline=RING, width=max(2, int(S * 0.028)))
# перекрестие
w = max(2, int(S * 0.045))
for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
    x0, y0 = c + dx * int(S * 0.10), c + dy * int(S * 0.10)
    x1, y1 = c + dx * int(S * 0.28), c + dy * int(S * 0.28)
    d.line([x0, y0, x1, y1], fill=MINT, width=w)
# точка в центре
r2 = int(S * 0.065)
d.ellipse([c - r2, c - r2, c + r2, c + r2], fill=MINT)

img.resize((512, 512), Image.LANCZOS).save(OUT / "icon.png")
sizes = [16, 24, 32, 48, 64, 128, 256]
img.resize((256, 256), Image.LANCZOS).save(
    OUT / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes]
)
print("иконки:", OUT / "icon.ico", OUT / "icon.png")
