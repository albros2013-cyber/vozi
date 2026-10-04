# VOZI — Pruebas realizadas y limitaciones

Fecha: 3 de octubre de 2026. **Todas las pruebas se hicieron en código** (Linux, Chromium sin interfaz mediante Playwright, 2 núcleos virtuales). **Ninguna se hizo en un iPhone o iPad físico**: las de iOS quedan pendientes y se indican abajo.

## 1. Selección del motor y las voces (pruebas nativas con sherpa-onnx)

Inteligibilidad medida transcribiendo el audio con Whisper small y comparándolo con el texto (10 frases, menor es mejor):

| Voz | Error de palabras | Observación |
|---|---|---|
| Supertonic 3 · voces 0, 1, 2, 5, 6 | 0 % | |
| Supertonic 3 · voces 3, 4, 7, 8, 9 | 0,7 % | casi siempre tilde de «¡Qué!» en la transcripción |
| Piper es_MX «ald» | 0,7 % | |
| Piper es_MX «claude» | 1,3 % | |
| Piper es_AR «daniela» | 10,7 % | descartada |
| Kokoro v1.0 (español) | — | descartada: 330 MB, 3 veces más lenta y fonética de España |

Acento: se midió la fuerza de la fricativa inicial en pares «zapato/sapato», «cine/sine»… (10 pares). Con seseo (América Latina) ambas suenan igual; con distinción (España) «z/c» es más débil. Kokoro (referencia de España): −4,9 dB. Supertonic voces 2, 4, 7, 8: ≈0 dB (seseo); voces 0 y 1: −5 dB (distinción, descartadas). Prueba objetiva aproximada, **no sustituye una escucha humana**.

Robustez en oraciones largas (2 repeticiones): voz 8 sin errores; voces 2, 4 y 9 con un error aislado; voz 7 con errores graves (descartada). Resultado: **Valeria = voz 2, Camila = 4, Mateo = 8, Andrés = 9**. Tono medido: Valeria 176 Hz, Mateo 123 Hz.

No se afirma que la voz sea humana ni que iguale a NotebookLM: no se hizo una comparación auditiva con personas.

## 2. Prueba de extremo a extremo en Chromium (35 de 35 superadas)

- Descarga explícita y verificada (SHA-256 por trozo) de motor, voz y OCR.
- Audio real con voz femenina (Valeria) y masculina (Mateo).
- Texto con preguntas, cifras, abreviaturas y varios párrafos; transcripción del audio generado: «Según el doctor Pérez, en 2025 las ventas aumentaron 32 % … equivale a un millón 500 mil pesos por cliente … antes del 15 de noviembre de 2026».
- Continuidad: un solo archivo por tramo, pausas exactas de 0,34 s (oración) y 0,78 s (párrafo); silencio máximo 0,84 s; sin saturación; paso automático al siguiente tramo.
- Pausa, reanudación, velocidad 1,5× con tono conservado, navegación por oración, cancelación de la preparación.
- Resaltado de párrafo y oración, punto de lectura y audio recuperados al recargar, notas recuperadas.
- PDF digital (palabra cortada reconstruida, encabezados y números de página omitidos, páginas conservadas), PDF escaneado con OCR, foto inclinada con ruido con OCR, DOCX, errores claros con PDF dañado y archivo vacío.
- Sin conexión: la app abre, sintetiza audio nuevo y hace OCR.
- Actualización: la nueva versión reemplaza la caché del código, conserva voces, documentos y notas.

Velocidad de preparación (este equipo, 1 núcleo por proceso): factor 0,97 con 1 proceso (5 min de audio ≈ 5 min de espera) y 0,55 con 2 procesos. Piper (voz ligera): factor ≈0,3.

## 2b. Notas al pie (añadido)

PDF de prueba con 2 notas por página (una de dos líneas) y llamadas voladas: las 4 notas se detectan, la de dos líneas se une, las llamadas quedan como superíndice («precios¹») y la voz omite notas y llamadas. Detección solo en PDF con texto digital; en páginas escaneadas (OCR) se puede marcar a mano tocando el párrafo.

## 2c. Inglés y detección automática (añadido)

- Voces en inglés con el mismo modelo Supertonic 3 (sin descarga extra). Error de palabras en inglés: 0 % en 9 de 10 voces; elegidas Emma (0), Grace (3), James (5), Daniel (6).
- Detección por párrafo (palabras frecuentes, ¿¡, tildes, contracciones); párrafos cortos o ambiguos heredan el idioma anterior. Documento mixto de prueba: es, en, en, en, en, es — correcto.
- Normalización inglesa (años, porcentajes, dólares, ordinales, horas, Dr./Mr./e.g.). Transcripción del audio generado: inglés y español correctos en un mismo tramo.
- OCR con español + inglés (paquete de 29 MB).
- Se puede fijar el idioma de un documento (Biblioteca → ⋯ → Idioma).
- Con una voz ligera (Piper) elegida, los tramos con inglés se leen con las voces naturales, porque Piper solo habla español.

## 3. Pendiente de verificar en iPhone/iPad (no probado)

- Que Safari reserve la memoria del motor (512 MB iniciales por proceso). En equipos con poca memoria podría fallar; la voz ligera usa la misma reserva. Corregirlo exige recompilar sherpa-onnx con menos memoria inicial.
- Velocidad real de preparación (usar *Ajustes → Lectura → Prueba de rendimiento*).
- Reproducción con pantalla bloqueada y controles en la pantalla de bloqueo: el audio de un tramo ya preparado debería seguir; la preparación del siguiente tramo puede pausarse cuando la app pasa a segundo plano.
- Desbloqueo de audio: el primer toque en ▶ desbloquea el reproductor; si iOS lo bloquea, VOZI muestra un aviso para tocar ▶ de nuevo.
- Cámara (`capture`), compartir/guardar archivos y persistencia del almacenamiento.

## 4. Limitaciones que requerirían una app nativa

- Preparar audio en segundo plano con la app cerrada o la pantalla apagada (iOS suspende las páginas web).
- Usar el motor neuronal del iPhone (Neural Engine/GPU) para sintetizar más rápido.
- Garantía absoluta de que iOS no borre los datos: en una PWA depende del navegador (instalarla en inicio y hacer copias de seguridad lo mitiga).
