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

## 2d. Fluidez, sesiones y encabezados (añadido)

- Fluidez: las oraciones cortas consecutivas de un párrafo se sintetizan juntas (hasta 220 caracteres), para que la voz enlace la entonación; los títulos no se agrupan. El resaltado por oración se mantiene ubicando la pausa real dentro del audio (transcripción de cada segmento: cortes correctos). Recorte de silencios más suave (no corta finales de palabra) y pausas de 0,30 s entre grupos y 0,75 s entre párrafos.
- Sesiones de usuario: cada persona tiene su propia base de datos local (biblioteca, notas, progreso, audios, ajustes); PIN opcional; las voces se comparten. Probado: PIN incorrecto rechazado, bibliotecas independientes, reapertura en la última sesión.
- Encabezados y pies de página: se omiten números de página, líneas de margen repetidas y líneas de margen aisladas en letra pequeña o con número (encabezados que cambian por capítulo); los títulos más grandes que el cuerpo se conservan. Opción para desactivarlo al importar. En OCR se quitan las primeras/últimas líneas repetidas entre páginas.
- Regresión completa: 50 de 50 pruebas superadas.

## 2e. Rapidez y errores reportados en iPhone (añadido)

- «Escuchar desde aquí»: inicio rápido con la primera oración sola; voz audible en ~13 s en el equipo de prueba (antes ~78 s con tramo de 1 min). Toques repetidos durante la preparación: sin errores (corregido «Object.assign requires…»), empieza en el último párrafo elegido (~15 s; antes ~37 s).
- Volver a un párrafo con audio ya preparado (aunque esté en medio de un tramo): 15–25 ms, sin sintetizar.
- La voz se carga en memoria al abrir el documento y se prepara el comienzo en el punto guardado.
- Tramos siguientes de tamaño adaptativo según la velocidad medida del dispositivo; pueden cortarse entre oraciones.
- Biblioteca y estudio leen fichas ligeras (no el texto completo); el avance de lectura ya no reescribe el documento entero; el texto de lectura se reutiliza al cambiar de pestaña.
- Sellos laterales verticales («For the exclusive use of…») se omiten al importar PDF; los documentos ya importados con letras sueltas se reparan al abrirlos.
- Regresión completa: 55 de 55.

## 2f. Cuentas en la nube (añadido)

Probado contra un servidor que imita Supabase (el entorno de pruebas no puede conectarse al Supabase real): crear cuenta, contraseña corta/incorrecta con mensajes claros, sincronización de biblioteca y notas entre dos dispositivos, cambios sin conexión que se suben al volver, borrados que se propagan, aislamiento entre cuentas, sesión que se mantiene al reabrir y cierre de sesión con borrado local. 12/12. **Pendiente: primera prueba con el Supabase real desde el iPhone.**

## 2g. Velocidad de procesamiento (añadido)

Medido en Chromium con 2 núcleos (el iPhone tiene 6, así que allí debería rendir igual o mejor):
- **Motor de voz:** la memoria inicial del motor bajó de 512 MB a 64 MB por proceso (crece solo si hace falta; en la prueba usó unos 230 MB con la voz natural y 190 MB con las ligeras). El audio generado es idéntico.
- **Dos procesos por defecto («Automática»):** el primero empieza a hablar y el segundo se suma al cargar. Factor de preparación 0,94 → 0,55 (casi el doble de rápido). Primera voz en 11,4 s (antes 13,9 s). Si la app se cierra preparando con dos procesos, al reabrir pasa sola a uno y lo avisa; si un proceso falla, el trabajo sigue en el otro.
- **Preparar todo el documento** (menú ••• del reproductor): 5 tramos contiguos, 84 s de audio en 44 s. Después, la lectura continua pasó por los 5 tramos sin sintetizar nada (cada salto entre tramos: 20-40 ms). Muestra tiempo y espacio estimados, mantiene la pantalla encendida, se puede detener y conserva lo hecho.
- **OCR:** modelos «tessdata_fast» (6 MB en vez de 29 MB) y dos páginas a la vez. 10 páginas escaneadas: 15,8 s → 4,6 s. Precisión en los documentos de prueba: 0 % de error de caracteres (antes 0-0,4 %). En fotos muy malas, «fast» puede fallar algo más que el modelo anterior.
- **Sin cuelgues al final de un tramo:** si el tramo termina antes de que el siguiente esté completo, VOZI entrega en ese momento las oraciones ya listas y sigue preparando el resto (prueba: espera de 0,6 s en vez de esperar el tramo entero, sin saltar ni repetir texto). Si el equipo prepara casi tan lento como lee, sugiere una vez «Preparar todo el documento».
- **Avisos de sincronización:** «Se actualizó tu información desde otro dispositivo» salía cada vez, porque la base de datos devuelve el JSON con las claves en otro orden. Corregido; además solo avisa por cambios de contenido y como mucho cada 10 minutos.
- **Calidad de voz** (Ajustes → Voz): Rápida (3 pasos, por defecto), Equilibrada (4) y Natural (5). Transcripción automática de la misma frase con voz femenina y masculina: con 5 y 3 pasos se entiende igual (una sílaba dudosa con 3 pasos en la voz masculina); con 2 pasos se cambian palabras («competencia» → «convidencia»), por eso no se ofrece. Preparación: factor 0,94 → 0,65 con un proceso y 0,55 → 0,39 con dos.
- **Hasta 3 procesos**: «Automática» usa 3 en equipos de 6 núcleos (iPhone Pro); si la app se cierra por memoria baja uno. En el equipo de prueba (2 núcleos) 3 procesos no aportan, como era de esperar.
- **Escuchar mientras termina de preparar:** «Preparar todo» puede empezar a sonar sola cuando hay suficiente audio adelantado para que la lectura no alcance a la preparación (umbral calculado con la velocidad medida del equipo, nunca más del 50 %). Prueba: empezó al 20 % desde el primer párrafo y terminó sin errores.
- Regresión completa: 78/78 fases superadas; cuentas en la nube 16/16.

## 2h. Asistente de estudio con IA en el equipo (añadido)

Motor WebLLM (tarjeta gráfica, WebGPU) con modelos Qwen: Equilibrado (Qwen3 1,7B, por defecto), Ligero (Qwen2.5 1,5B) y Más capaz (Qwen3 4B). Funciones: resumen por partes, preguntas de repaso que se convierten en tarjetas, preguntas libres sobre el texto (con páginas) y «Explicar con IA» en cada párrafo.
- Probado aquí con un motor simulado (este entorno no tiene tarjeta gráfica ni acceso a los modelos): interfaz, partición del texto, resumen en dos niveles, tarjetas, notas, preguntas con páginas y explicación. 7/7.
- **No probado todavía con el modelo real.** Se verifica en el iPhone con Ajustes → Inteligencia artificial → «Descargar y probar».

## 2i. Pronunciación (añadido)

Nuevas reglas: siglas (como palabra si se pueden pronunciar: ONU, RETIE, DIAN; letra por letra si no: PDF, NTC, EPS), códigos (ASN-61-I68, COVID-19, A4), unidades eléctricas (V, A, W, Hz, Ω, kVA…), fracciones y pulgadas (3/4"), comparaciones (<, ≥, ±, ×), ordinales abreviados (1er., 2do., 3ra.), reyes y papas (Juan Pablo II), palabras en mayúsculas de énfasis (MUY, NO), títulos en mayúsculas y anglicismos comunes (e-mail, WiFi, breaker, router, software…).
Comparación con transcripción automática, misma voz, antes → después:
- «ASN-61-I68 exige 120 V y 15 A» → antes «ASS-61-68… 120B y 15A»; después «…120 voltios y 15 amperios».
- «< 25 Ω a 60 Hz» → antes «25 o 6.6»; después «menor que 25 ohmios a 60 hercios».
- «3/4" y un breaker de 20 A… 3φ» → antes «break de 20 APA… 3/5»; después «3/4 de pulgada y un breaker de 20 amperios… 3 fases».
- «2do. informe» → antes «doso "Informe"»; después «segundo informe».

## 2j. Cuadros y tablas (añadido)

- PDF: las celdas se separan por los huecos horizontales entre columnas; 3 o más filas alineadas forman un cuadro. Se reconoce el título («Tabla 1…», «Cuadro 2…»). Word: las tablas se toman con su estructura.
- Lectura: título, columnas, y luego una oración por fila con el nombre de cada columna («Residencial: consumo en gigavatios hora, mil doscientos cincuenta; variación, seis coma cinco por ciento…»). Se muestra como tabla y se resalta la fila que suena.
- IA (✨ → «Interpretar cuadros», o al usar «Preparar todo» si la IA está descargada): explica cada cuadro en 2-4 oraciones; la voz la dice antes de las filas. Ajustes → Lectura → Cuadros: interpretación y filas / solo interpretación / solo filas.
- Pruebas: sin cuadros falsos en los 4 PDF de prueba sin tablas; tabla de PDF (5×4) y de Word detectadas con título; lectura ordenada; resaltado de fila; interpretación guardada y leída primero (motor de IA simulado). 11/11.
- Límite: los cuadros que son imágenes (gráficos, tablas escaneadas) no tienen texto con estructura; se leen como texto OCR.

## 3. Pendiente de verificar en iPhone/iPad (no probado)

- Que dos procesos de voz quepan en la memoria del iPhone (unos 250 MB cada uno). Si no, VOZI vuelve sola a uno.
- Que la pantalla se mantenga encendida durante «Preparar todo el documento» (Wake Lock, iOS 16.4 o posterior).
- Velocidad real de preparación (usar *Ajustes → Lectura → Prueba de rendimiento*).
- Reproducción con pantalla bloqueada y controles en la pantalla de bloqueo: el audio de un tramo ya preparado debería seguir; la preparación del siguiente tramo puede pausarse cuando la app pasa a segundo plano.
- Desbloqueo de audio: el primer toque en ▶ desbloquea el reproductor; si iOS lo bloquea, VOZI muestra un aviso para tocar ▶ de nuevo.
- Cámara (`capture`), compartir/guardar archivos y persistencia del almacenamiento.

## 4. Limitaciones que requerirían una app nativa

- Preparar audio en segundo plano con la app cerrada o la pantalla apagada (iOS suspende las páginas web).
- Usar el motor neuronal del iPhone (Neural Engine/GPU) para sintetizar más rápido.
- Garantía absoluta de que iOS no borre los datos: en una PWA depende del navegador (instalarla en inicio y hacer copias de seguridad lo mitiga).
