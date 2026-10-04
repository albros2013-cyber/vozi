from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('Serif', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'))
c = canvas.Canvas('sello.pdf', pagesize=letter); W, H = letter
for pag in (1, 2):
    y = H - 100
    c.setFont('Serif', 11.5)
    for t in ['de shut or open only for limited hours, and with people fearful of going', 'out or facing long waiting periods, the company decided to reach out to', 'customers living in gated communities near every store.']:
        c.drawString(72, y, t); y -= 17
    c.saveState(); c.translate(30, 150); c.rotate(90); c.setFont('Serif', 9)
    c.drawString(0, 0, 'For the exclusive use of M. Perez, 2026.'); c.restoreState()
    c.showPage()
c.save(); print('ok')
