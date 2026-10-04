# Genera documentos de prueba: PDF digital, PDF escaneado, imagen tipo foto y DOCX.
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random, docx

pdfmetrics.registerFont(TTFont('Serif', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'))
TEXTO = [
 ("Capítulo 1. Estrategia comercial", True),
 ("¿Qué factores explican el crecimiento de una empresa en un mercado competitivo? Según el Dr. Pérez, en 2025 las ventas aumentaron 32 % y el margen operativo llegó a 18,5 %, lo que equivale a $1.500.000 por cliente.", False),
 ("Sin embargo, la directora advirtió: ¡no podemos confiarnos! La competencia regional se intensificó durante el segundo semestre, y las ventajas obtenidas podían desaparecer con rapidez si no se invertía en innovación y en la formación de los equipos comerciales.", False),
 ("Para el análisis del caso, los estudiantes deberán identificar a los actores principales, describir sus intereses, comparar las alternativas disponibles (p. ej., expansión o consolidación) y justificar cuál resulta más conveniente.", False),
]
def wrap(c, text, font, size, width):
    words = text.split(); lines = []; cur = ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if c.stringWidth(t, font, size) > width and cur: lines.append(cur); cur = w
        else: cur = t
    lines.append(cur); return lines

def pdf_digital(path):
    c = canvas.Canvas(path, pagesize=letter); W, H = letter
    pag = 1
    for rep in range(2):
        y = H - 72
        c.setFont('Serif', 9); c.drawString(72, H - 40, 'Manual de casos — Universidad de Ejemplo')
        for t, tit in TEXTO:
            size = 15 if tit else 11.5
            c.setFont('Serif', size)
            # Fuerza una palabra cortada con guion al final de línea en el segundo párrafo
            lines = wrap(c, t, 'Serif', size, W - 144)
            if not tit and 'competencia' in t:
                lines = ['Sin embargo, la directora advirtió: ¡no podemos confiarnos! La compe-',
                         'tencia regional se intensificó durante el segundo semestre, y las ventajas',
                         'obtenidas podían desaparecer con rapidez si no se invertía en innovación y',
                         'en la formación de los equipos comerciales.']
            for l in lines:
                c.drawString(72, y, l); y -= size * 1.45
            y -= size * 0.9
        c.setFont('Serif', 9); c.drawString(W / 2, 40, str(pag))
        c.showPage(); pag += 1
    c.save()

def render_page_image(lines_spec, w=1700, h=2200, ruido=False, rot=0):
    im = Image.new('L', (w, h), 250 if not ruido else 235)
    d = ImageDraw.Draw(im)
    fnt = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 40)
    ft = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 52)
    y = 160
    for t, tit in lines_spec:
        f = ft if tit else fnt
        words = t.split(); cur = ''
        for wd in words:
            tt = (cur + ' ' + wd).strip()
            if d.textlength(tt, font=f) > w - 300 and cur: d.text((150, y), cur, fill=20, font=f); y += 62; cur = wd
            else: cur = tt
        d.text((150, y), cur, fill=20, font=f); y += 100
    if ruido:
        px = im.load()
        for _ in range(60000):
            x, yy = random.randrange(w), random.randrange(h); px[x, yy] = max(0, px[x, yy] - random.randrange(40, 120))
        im = im.filter(ImageFilter.GaussianBlur(0.8))
    if rot: im = im.rotate(rot, expand=True, fillcolor=235)
    return im

def pdf_escaneado(path):
    p1 = render_page_image(TEXTO[:2]); p2 = render_page_image(TEXTO[2:], ruido=True)
    p1.convert('RGB').save(path, save_all=True, append_images=[p2.convert('RGB')], resolution=200)

def foto(path):
    im = render_page_image(TEXTO[1:3], w=1600, h=1500, ruido=True, rot=2.5)
    # Simula una foto: tono cálido y viñeteado leve
    rgb = Image.merge('RGB', (im.point(lambda v: min(255, v + 8)), im, im.point(lambda v: max(0, v - 18))))
    rgb.save(path, quality=85)

def docx_doc(path):
    d = docx.Document()
    d.add_heading('Capítulo 1. Estrategia comercial', level=1)
    for t, tit in TEXTO[1:3]: d.add_paragraph(t)
    d.add_page_break()
    d.add_heading('Capítulo 2. Caso práctico', level=1)
    d.add_paragraph(TEXTO[3][0])
    d.save(path)

random.seed(7)
pdf_digital('digital.pdf'); pdf_escaneado('escaneado.pdf'); foto('foto.jpg'); docx_doc('documento.docx')
open('protegido.txt','w').write('x')
print('ok')
