#!/usr/bin/env bash
# Descarga los modelos de voz y OCR desde sus publicaciones oficiales (GitHub) a ./_modelos
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p _modelos && cd _modelos
R=https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models
for m in sherpa-onnx-supertonic-3-tts-int8-2026-05-11 vits-piper-es_MX-ald-medium vits-piper-es_MX-claude-high; do
  if [ ! -d "$m" ]; then curl -fSL -o "$m.tar.bz2" "$R/$m.tar.bz2" && tar xjf "$m.tar.bz2" && rm "$m.tar.bz2"; fi
done
mkdir -p tessdata_fast
for l in spa eng; do
  [ -f tessdata_fast/$l.traineddata ] || curl -fSL -o tessdata_fast/$l.traineddata https://github.com/tesseract-ocr/tessdata_fast/raw/main/$l.traineddata
done
ls -la
