# VOZI — lector de estudio con voz natural, gratuito y sin conexión

VOZI es una aplicación web instalable (PWA) para iPhone, iPad y computadores. Importa PDF, Word, TXT, fotos o texto pegado, y lo lee en voz alta con una voz sintética natural generada **en el propio dispositivo**, mientras sigues el texto y tomas notas.

- Sin suscripciones, sin cobros y sin APIs de pago.
- Documentos procesados localmente; no se envían a internet.
- Después de una descarga inicial (≈176 MB), funcionan sin conexión: voz, OCR, lectura, notas.

## Publicarla (una sola vez, sin programar)

La forma recomendada es **GitHub Pages**, gratis y con HTTPS (necesario para instalarla en iPhone):

1. Crea una cuenta en github.com y un repositorio nuevo, por ejemplo `vozi` (público).
2. Sube todo el contenido de esta carpeta (botón *Add file → Upload files*, arrastra las carpetas y archivos, incluida `.github`). Si la web no deja subir la carpeta `.github`, créala con *Add file → Create new file* y el nombre `.github/workflows/publicar.yml`, pegando el contenido del archivo.
3. En el repositorio: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
4. Ve a la pestaña *Actions*: el flujo «Publicar VOZI en GitHub Pages» descarga los modelos oficiales, los trocea y verifica, y publica el sitio (5–10 minutos). Si no arranca solo, ábrelo y pulsa *Run workflow*.
5. Tu app queda en `https://TU-USUARIO.github.io/vozi/`.

Alternativa: si ya tienes la carpeta completa con `res/` (el paquete `vozi-sitio.zip`), puedes subirla a cualquier hosting estático con HTTPS (Netlify, Cloudflare Pages…).

## Instalar en iPhone o iPad

1. Abre la dirección en **Safari** (iOS/iPadOS 16.4 o posterior).
2. Toca **Compartir** → **Agregar a inicio** → **Agregar**.
3. Abre VOZI desde el ícono de inicio.
4. Ve a **Ajustes → Recursos sin conexión → Descargar todo lo necesario** (mejor en wifi).
5. En **Ajustes → Lectura → Prueba de rendimiento** mide cuánto tarda tu equipo en preparar audio.

Instalarla en la pantalla de inicio es importante: Safari puede borrar datos de sitios no instalados que no se usan durante varios días.

## Ejecutar en un computador (desarrollo)

```bash
bash tools/descargar_modelos.sh          # modelos → _modelos/
python3 tools/build_res.py supertonic es_MX-ald-medium es_MX-claude-high ocr motor
python3 tools/build_sw.py
python3 -m http.server 8080              # abrir http://localhost:8080
```

## Cómo funciona la voz

- **Motor**: sherpa-onnx 1.13.8 compilado a WebAssembly, ejecutado en un *Web Worker* (la interfaz no se bloquea).
- **Voces naturales (recomendadas)**: Supertonic 3 (Supertone, 2026), un solo modelo de 145 MB con varias voces. VOZI ofrece Valeria y Camila (femeninas) y Mateo y Andrés (masculinas), elegidas por pruebas propias de inteligibilidad y de **seseo** (pronunciación latinoamericana de *c/z*).
- **Voces ligeras**: Piper «claude» (Lucía) y «ald» (Diego), de México, 64 MB cada una; preparan audio unas 3 veces más rápido pero suenan menos naturales.
- **Tramos**: VOZI divide el texto en oraciones completas (nunca por líneas), normaliza cifras, porcentajes, fechas, horas, monedas y abreviaturas para la voz (el texto que ves no cambia), sintetiza el tramo completo (1, 3, 5 o 10 min), lo une con pausas controladas (0,34 s entre oraciones, 0,78 s entre párrafos), iguala el volumen y lo reproduce con **un solo reproductor**. Mientras escuchas, prepara el siguiente tramo.
- **Velocidad** de 0,75× a 2× sin cambiar el tono (`preservesPitch`).
- Los tramos se guardan y se vuelven a escuchar sin sintetizar otra vez.

## Estructura

```
index.html, css/, js/            interfaz (JavaScript sin dependencias ni compilación)
js/tts/                          normalización, oraciones, tramos, motor y worker de voz
js/import/                       PDF (PDF.js), DOCX/TXT, OCR (Tesseract) con su worker
js/vistas/                       Biblioteca, Importar, Leer, Estudiar, Ajustes
vendor/                          sherpa-onnx (wasm), tesseract-core, PDF.js
res/                             recursos descargables troceados (se generan con tools/)
sw.js                            funcionamiento sin conexión y actualizaciones por versión
tests/                           pruebas automáticas (Playwright) y documentos de prueba
docs/PRUEBAS.md                  resultados de las pruebas y limitaciones
```

## Licencias

Ver `licencias.html`. Resumen: Supertonic 3 (modelo) BigScience Open RAIL-M — prohíbe, entre otros, suplantar personas y difundir audio sin indicar que es generado por máquina; Piper «claude» Apache 2.0; Piper «ald» Unlicense; sherpa-onnx, Tesseract y PDF.js Apache 2.0; espeak-ng GPL-3.0; ONNX Runtime MIT.
