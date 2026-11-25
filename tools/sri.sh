#!/usr/bin/env bash
# Confere os hashes SRI de index.html contra os arquivos reais dos CDNs.
# Uso: bash tools/sri.sh          (verifica)
#      bash tools/sri.sh --print  (só imprime os hashes atuais, para colar em index.html)
set -euo pipefail
cd "$(dirname "$0")/.."
URLS=(
  "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js"
  "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs"
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs"
)
bad=0
for u in "${URLS[@]}"; do
  h="sha384-$(curl -fsSL "$u" | openssl dgst -sha384 -binary | openssl base64 -A)"
  if [[ "${1:-}" == "--print" ]]; then echo "$h  $u"; continue; fi
  if grep -qF "$h" index.html; then echo "OK    $u"; else echo "ERRO  $u -> $h (não consta em index.html)"; bad=1; fi
done
exit $bad
