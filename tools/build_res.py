#!/usr/bin/env python3
"""Genera res/ (recursos descargables troceados) y res/manifest.json para VOZI.
Uso: python3 tools/build_res.py  (rutas de origen configuradas abajo)"""
import hashlib, json, os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'res')
M = os.environ.get('MODELS_DIR', os.path.join(ROOT, '_modelos'))
CHUNK = 16 * 1024 * 1024

def sha(b): return hashlib.sha256(b).hexdigest()

def add_file(pack_dir, src, fsname):
    data = open(src, 'rb').read()
    chunks = []
    base = os.path.join(RES, pack_dir)
    os.makedirs(base, exist_ok=True)
    safe = fsname.replace('/', '__')
    for i in range(0, max(len(data), 1), CHUNK):
        part = data[i:i + CHUNK]
        name = f'{safe}.{i // CHUNK:03d}'
        open(os.path.join(base, name), 'wb').write(part)
        chunks.append({'url': f'res/{pack_dir}/{name}', 'size': len(part), 'sha256': sha(part)})
    return {'fs': fsname, 'size': len(data), 'sha256': sha(data), 'chunks': chunks}

def add_direct(relpath, fsname=None):
    data = open(os.path.join(ROOT, relpath), 'rb').read()
    return {'fs': fsname or os.path.basename(relpath), 'size': len(data), 'sha256': sha(data),
            'chunks': [{'url': relpath, 'size': len(data), 'sha256': sha(data)}]}

def pack(pid, version, title, desc, files, **extra):
    d = f'{pid}-{version}'
    shutil.rmtree(os.path.join(RES, d), ignore_errors=True)
    fl = [add_file(d, src, fs) for src, fs in files]
    p = {'id': pid, 'version': version, 'title': title, 'description': desc, 'files': fl,
         'size': sum(f['size'] for f in fl)}
    p.update(extra)
    return p

def espeak_es(src_dir):
    """Solo los datos de espeak-ng necesarios para español."""
    out = []
    for rel in ['phontab', 'phonindex', 'phondata', 'intonations', 'es_dict', 'phondata-manifest']:
        p = os.path.join(src_dir, rel)
        if os.path.exists(p): out.append((p, 'espeak-ng-data/' + rel))
    for sub in ['lang/roa/es', 'lang/roa/es-419', 'voices/!v']:
        pass
    for dp, _, fs in os.walk(os.path.join(src_dir, 'lang')):
        for f in fs:
            if f in ('es', 'es-419'):
                full = os.path.join(dp, f)
                out.append((full, 'espeak-ng-data/' + os.path.relpath(full, src_dir)))
    return out

def main(selected):
    packs = []
    S = f'{M}/sherpa-onnx-supertonic-3-tts-int8-2026-05-11'
    if 'supertonic' in selected:
        packs.append(pack('voz-supertonic3', 'int8-2026-05-11', 'Voces naturales (Supertonic 3)',
            'Modelo multilingüe con 5 voces femeninas y 5 masculinas. Recomendado.',
            [(f'{S}/{n}', f'st/{n}') for n in ['duration_predictor.int8.onnx', 'text_encoder.int8.onnx',
             'vector_estimator.int8.onnx', 'vocoder.int8.onnx', 'tts.json', 'unicode_indexer.bin', 'voice.bin']],
            engine='supertonic', license='OpenRAIL-M (modelo) · MIT (código)', sampleRate=44100))
    for vid, title, desc in [('es_MX-ald-medium', 'Voz ligera masculina (Piper «ald», México)', 'Más rápida y liviana, menos natural.'),
                             ('es_MX-claude-high', 'Voz ligera femenina (Piper «claude», México)', 'Más rápida y liviana, menos natural.')]:
        if vid in selected:
            d = f'{M}/vits-piper-{vid}'
            files = [(f'{d}/{vid}.onnx', f'{vid}/model.onnx'), (f'{d}/tokens.txt', f'{vid}/tokens.txt')]
            files += [(s, f'{vid}/{fs}') for s, fs in espeak_es(f'{d}/espeak-ng-data')]
            packs.append(pack('voz-' + vid, '1', title, desc, files, engine='piper', sampleRate=22050))
    if 'ocr' in selected:
        F = os.path.join(M, 'tessdata_fast')  # modelos «fast»: unas 2-3 veces más rápidos y 5 veces más livianos
        packs.append(pack('ocr-spa', 'fast-4.1-es-en', 'Reconocimiento de texto en español e inglés (OCR)',
            'Datos de Tesseract para leer fotos y páginas escaneadas.',
            [(os.path.join(F, 'spa.traineddata'), 'spa.traineddata'), (os.path.join(F, 'eng.traineddata'), 'eng.traineddata')], engine='ocr'))
    if 'motor' in selected:
        fl = [add_direct('vendor/sherpa/' + n) for n in ['sherpa-onnx-wasm-main-tts.js', 'sherpa-onnx-tts.js', 'sherpa-onnx-wasm-main-tts.wasm']]
        packs.append({'id': 'motor-voz', 'version': 'sherpa-onnx-1.13.8-mem64', 'title': 'Motor de voz',
                      'description': 'Programa que convierte el texto en audio dentro del dispositivo.', 'files': fl,
                      'size': sum(f['size'] for f in fl), 'engine': 'motor', 'license': 'Apache-2.0'})
        fl = [add_direct('vendor/tesseract/' + n) for n in ['tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.wasm']]
        packs.append({'id': 'motor-ocr', 'version': 'tesseract-core-7.0.0', 'title': 'Motor de reconocimiento de texto',
                      'description': 'Programa que reconoce letras en imágenes dentro del dispositivo.', 'files': fl,
                      'size': sum(f['size'] for f in fl), 'engine': 'motor', 'license': 'Apache-2.0'})
    man_path = os.path.join(RES, 'manifest.json')
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'format': 1, 'packs': []}
    ids = {p['id'] for p in packs}
    man['packs'] = [p for p in man['packs'] if p['id'] not in ids] + packs
    json.dump(man, open(man_path, 'w'), ensure_ascii=False, indent=1)
    for p in man['packs']: print(p['id'], p['version'], round(p['size'] / 1e6, 1), 'MB')

if __name__ == '__main__':
    main(sys.argv[1:] or ['supertonic', 'ocr'])
