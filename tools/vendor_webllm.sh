#!/usr/bin/env bash
# Trae WebLLM (motor de IA en el navegador, Apache-2.0) desde npm a vendor/webllm/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${WEBLLM_VERSION:-latest}"
T="$(mktemp -d)"
cd "$T"
npm pack "@mlc-ai/web-llm@${VERSION}" --silent >/dev/null 2>&1 || npm pack "@mlc-ai/web-llm" --silent
tar xzf mlc-ai-web-llm-*.tgz
mkdir -p "$ROOT/vendor/webllm"
cp package/lib/index.js "$ROOT/vendor/webllm/web-llm.js"
# El archivo debe ser autónomo (sin importaciones de paquetes por nombre)
if grep -Eq "^import .* from ['\"][^./]" "$ROOT/vendor/webllm/web-llm.js"; then echo "web-llm.js tiene dependencias externas"; exit 1; fi
node -e "const p=require('./package/package.json');console.log('WebLLM',p.version)" | tee "$ROOT/vendor/webllm/VERSION.txt"
ls -la "$ROOT/vendor/webllm"
