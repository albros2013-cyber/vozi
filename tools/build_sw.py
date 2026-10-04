#!/usr/bin/env python3
"""Genera sw.js con la lista de archivos de la app y una versión basada en su contenido."""
import hashlib, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
incluir = ['index.html', 'licencias.html', 'manifest.webmanifest', 'css/app.css']
for d in ['js', 'icons', 'samples', 'licenses']:
    for dp, _, fs in os.walk(os.path.join(ROOT, d)):
        for f in sorted(fs):
            if f.endswith(('.js', '.png', '.m4a', '.svg', '.txt')): incluir.append(os.path.relpath(os.path.join(dp, f), ROOT))
incluir += ['vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/pdf.worker.mjs']
for dp, _, fs in os.walk(os.path.join(ROOT, 'vendor/pdfjs/standard_fonts')):
    for f in sorted(fs): incluir.append(os.path.relpath(os.path.join(dp, f), ROOT))
h = hashlib.sha256()
for f in sorted(incluir):
    h.update(f.encode()); h.update(open(os.path.join(ROOT, f), 'rb').read())
version = h.hexdigest()[:10]
tpl = open(os.path.join(ROOT, 'sw.template.js')).read()
out = tpl.replace("'__VERSION__'", repr(version)).replace('__SHELL__', json.dumps(['./' + f.replace(os.sep, '/') for f in sorted(incluir)], indent=0))
open(os.path.join(ROOT, 'sw.js'), 'w').write(out)
total = sum(os.path.getsize(os.path.join(ROOT, f)) for f in incluir)
print('sw.js versión', version, len(incluir), 'archivos', round(total / 1e6, 2), 'MB')
