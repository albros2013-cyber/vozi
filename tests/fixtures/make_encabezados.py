from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('Serif', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'))
c = canvas.Canvas('encabezados.pdf', pagesize=letter); W, H = letter
caps = {1: 'Capítulo 1 · Estrategia', 2: 'Capítulo 1 · Estrategia', 3: 'Capítulo 2 · Finanzas', 4: 'Capítulo 3 · Personas'}
for pag in range(1, 5):
    c.setFont('Serif', 8.5)
    # Encabezado distinto según el capítulo, con número de página, alternando lados
    if pag % 2: c.drawRightString(W - 72, H - 42, f'{caps[pag]}   {40 + pag}')
    else: c.drawString(72, H - 42, f'{40 + pag}   Manual de gestión')
    y = H - 92
    if pag in (1, 3, 4):
        c.setFont('Serif', 16); c.drawString(72, y, f'Capítulo {1 if pag == 1 else pag - 1}'); y -= 34
    c.setFont('Serif', 11.5)
    for t in [f'Este es el texto principal de la página {40 + pag}, que debe leerse completo', 'sin incluir los encabezados ni los pies de página del documento.']:
        c.drawString(72, y, t); y -= 17
    c.setFont('Serif', 8.5); c.drawCentredString(W / 2, 40, f'Universidad de Ejemplo — {2026}')
    c.showPage()
c.save(); print('ok')
