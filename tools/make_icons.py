from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
def icon(size, maskable=False, radius=True):
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    verde = (31, 77, 58, 255); crema = (247, 243, 234, 255); salvia = (169, 196, 164, 255)
    if radius and not maskable: d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=verde)
    else: d.rectangle([0, 0, S, S], fill=verde)
    pad = 0.2 if maskable else 0.12
    # Libro abierto estilizado (dos páginas) con ondas de voz
    cx, cy = S / 2, S * 0.56
    w = S * (1 - 2 * pad) / 2
    hgt = S * 0.30
    d.polygon([(cx, cy - hgt * 0.35), (cx - w, cy - hgt * 0.55), (cx - w, cy + hgt * 0.55), (cx, cy + hgt * 0.75)], fill=crema)
    d.polygon([(cx, cy - hgt * 0.35), (cx + w, cy - hgt * 0.55), (cx + w, cy + hgt * 0.55), (cx, cy + hgt * 0.75)], fill=(233, 227, 212, 255))
    # Ondas (barras) sobre el libro
    barras = [0.35, 0.6, 1.0, 0.75, 0.45]
    bw = S * 0.045; gap = S * 0.03
    total = len(barras) * bw + (len(barras) - 1) * gap
    x0 = cx - total / 2; base = cy - hgt * 0.62
    for i, b in enumerate(barras):
        hh = S * 0.20 * b
        x = x0 + i * (bw + gap)
        d.rounded_rectangle([x, base - hh, x + bw, base], radius=bw / 2, fill=salvia if i % 2 else crema)
    return im.resize((size, size), Image.LANCZOS)
os.makedirs(OUT, exist_ok=True)
icon(192).save(f'{OUT}/icon-192.png'); icon(512).save(f'{OUT}/icon-512.png')
icon(512, maskable=True).save(f'{OUT}/icon-maskable-512.png')
icon(180, radius=False).convert('RGB').save(f'{OUT}/apple-touch-icon.png')
print('ok')
