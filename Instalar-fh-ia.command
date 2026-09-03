#!/bin/bash
# macOS: doble clic para instalar fh-ia en VS Code / Cursor / VSCodium
cd "$(dirname "$0")"
if [ -x "./Instalar-fh-ia.sh" ]; then
  exec ./Instalar-fh-ia.sh
fi
exec bash -c 'curl -fsSL https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.sh | bash'
