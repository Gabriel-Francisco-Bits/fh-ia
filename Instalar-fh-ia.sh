#!/usr/bin/env bash
# ============================================================
# Instalación de: fh-ia (extensión VS Code / Cursor)
# Fecha: 2026-09-02
# Solicitado por: gfh
# Doble clic o: ./Instalar-fh-ia.sh
# ============================================================
set -euo pipefail

echo "[INFO] Iniciando instalación de fh-ia..."

HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO_SLUG="${FH_IA_REPO:-Gabriel-Francisco-Bits/fh-ia}"
VSIX=""

find_local_vsix() {
  local candidates=(
    "$HERE/install/fh-ia.vsix"
    "$HERE/fh-ia.vsix"
    "$HERE"/fh-ia-*.vsix
  )
  local f
  for f in "${candidates[@]}"; do
    if [ -f "$f" ]; then
      echo "$f"
      return 0
    fi
  done
  return 1
}

download_vsix() {
  local dest="$HERE/install"
  mkdir -p "$dest"
  echo "[INFO] Descargando VSIX desde GitHub ($REPO_SLUG)..."
  local url
  url="$(curl -fsSL "https://api.github.com/repos/${REPO_SLUG}/releases/latest" \
    | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data.get('assets', []):
    name = a.get('name') or ''
    if name.endswith('.vsix'):
        print(a['browser_download_url'])
        break
")"
  if [ -z "${url:-}" ]; then
    url="https://github.com/${REPO_SLUG}/raw/main/install/fh-ia.vsix"
  fi
  curl -fL --progress-bar "$url" -o "$dest/fh-ia.vsix"
  echo "$dest/fh-ia.vsix"
}

if VSIX="$(find_local_vsix)"; then
  echo "[INFO] VSIX local: $VSIX"
else
  VSIX="$(download_vsix)"
fi

if [ ! -f "$VSIX" ]; then
  echo "[ERROR] No se encontró el paquete .vsix"
  exit 1
fi

editors=()
if command -v code >/dev/null 2>&1; then
  editors+=("code")
fi
if command -v cursor >/dev/null 2>&1; then
  editors+=("cursor")
fi
if command -v codium >/dev/null 2>&1; then
  editors+=("codium")
fi

if [ "${#editors[@]}" -eq 0 ]; then
  echo "[ERROR] No está VS Code, Cursor ni VSCodium en el PATH."
  echo "        Instala VS Code y vuelve a abrir este archivo."
  exit 1
fi

ok=0
for bin in "${editors[@]}"; do
  echo "[INFO] Instalando en $bin..."
  if "$bin" --install-extension "$VSIX" --force; then
    echo "[OK] $bin: fh-ia instalada"
    ok=1
  else
    echo "[WARN] $bin no pudo instalar la extensión"
  fi
done

if [ "$ok" -ne 1 ]; then
  echo "[ERROR] Ningún editor instaló fh-ia"
  exit 1
fi

echo ""
echo "[OK] fh-ia instalada correctamente."
echo "Abre VS Code / Cursor → icono fh-ia en la barra izquierda"
echo "o Command Palette → fh-ia: Open Chat Panel"

if command -v notify-send >/dev/null 2>&1; then
  notify-send "fh-ia" "Extensión instalada. Ábrela desde la barra de VS Code." || true
fi

if [ -t 0 ] && [ -t 1 ]; then
  echo ""
  read -r -p "Pulsa Enter para cerrar..." _ || true
fi
