from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('Serif', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'))
c = canvas.Canvas('notas.pdf', pagesize=letter); W, H = letter
for pag in (1, 2):
    y = H - 90
    c.setFont('Serif', 11.5)
    lineas = [('La inflación de servicios explicó buena parte del alza de precios', '1'), ('durante el segundo semestre, según el banco central.', None),
              ('Los analistas recomiendan revisar los contratos indexados', '2'), ('antes de la próxima negociación colectiva.', None)]
    for t, ref in lineas:
        c.setFont('Serif', 11.5); c.drawString(72, y, t)
        if ref:
            c.setFont('Serif', 7); c.drawString(72 + c.stringWidth(t, 'Serif', 11.5) + 1, y + 4.5, ref)
        y -= 17
    c.setLineWidth(0.5); c.line(72, 110, 200, 110)
    c.setFont('Serif', 8.5)
    c.drawString(72, 95, '1 Banco de la República, Informe de Política Monetaria, julio de 2026, pág. 14.')
    c.drawString(72, 83, '2 Véase también el capítulo 4 sobre indexación y su efecto en la')
    c.drawString(72, 72, 'negociación de salarios.')
    c.setFont('Serif', 9); c.drawString(W / 2, 40, str(pag))
    c.showPage()
c.save(); print('ok')
