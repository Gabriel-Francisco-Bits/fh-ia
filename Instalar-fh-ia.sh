#!/usr/bin/env bash
# ============================================================
# Instalación de: fh-ia (extensión VS Code / Cursor)
# Fecha: 2026-09-02
# Solicitado por: gfh
#
# Un comando (repo público, sin descargar a mano):
#   curl -fsSL https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.sh | bash
# ============================================================
set -euo pipefail

echo "[INFO] Iniciando instalación de fh-ia..."

if ! command -v curl >/dev/null 2>&1; then
  echo "[ERROR] Se necesita curl."
  exit 1
fi

src="${BASH_SOURCE[0]:-$0}"
HERE=""
if [ -f "$src" ] && [ -s "$src" ]; then
  if command -v greadlink >/dev/null 2>&1; then
    resolved="$(greadlink -f "$src")"
  elif resolved="$(readlink -f "$src" 2>/dev/null)"; then
    :
  else
    resolved="$(cd "$(dirname "$src")" && pwd)/$(basename "$src")"
  fi
  HERE="$(cd "$(dirname "$resolved")" 2>/dev/null && pwd)" || HERE=""
fi
case "$HERE" in
  /dev/* | /proc/* | "") HERE="" ;;
esac
REPO_SLUG="${FH_IA_REPO:-Gabriel-Francisco-Bits/fh-ia}"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/fh-ia"
mkdir -p "$CACHE"

find_local_vsix() {
  local best="" best_mtime=0 f mtime
  shopt -s nullglob
  local candidates=(
    "$HERE/install/fh-ia.vsix"
    "$HERE/fh-ia.vsix"
    "$HERE"/fh-ia-*.vsix
  )
  shopt -u nullglob
  for f in "${candidates[@]}"; do
    if [ -f "$f" ] && [ -s "$f" ]; then
      mtime="$(stat -c %Y "$f" 2>/dev/null || echo 0)"
      if [ "$mtime" -ge "$best_mtime" ]; then
        best="$f"
        best_mtime="$mtime"
      fi
    fi
  done
  if [ -n "$best" ]; then
    printf '%s\n' "$best"
    return 0
  fi
  return 1
}

download_vsix() {
  local dest="$CACHE/fh-ia.vsix"
  echo "[INFO] Descargando VSIX desde GitHub ($REPO_SLUG)..." >&2
  local url=""
  url="$(curl -fsSL "https://api.github.com/repos/${REPO_SLUG}/releases/latest" \
    | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data.get('assets', []):
    name = a.get('name') or ''
    if name.endswith('.vsix'):
        print(a.get('browser_download_url') or '')
        break
" 2>/dev/null || true)"
  if [ -z "$url" ]; then
    url="https://github.com/${REPO_SLUG}/releases/latest/download/fh-ia.vsix"
  fi
  echo "[INFO] URL: $url" >&2
  curl -fL --progress-bar "$url" -o "$dest" >&2
  if [ ! -s "$dest" ]; then
    echo "[ERROR] La descarga del VSIX quedó vacía" >&2
    exit 1
  fi
  printf '%s\n' "$dest"
}

VSIX=""
if [ -n "$HERE" ] && VSIX="$(find_local_vsix)"; then
  echo "[INFO] VSIX: $VSIX"
else
  VSIX="$(download_vsix)"
  echo "[INFO] VSIX descargado: $VSIX"
fi

editor_ok() {
  local bin="$1"
  [ -n "$bin" ] && [ -x "$bin" ] && "$bin" --version >/dev/null 2>&1
}

add_editor() {
  local bin="$1"
  local resolved existing
  [ -n "$bin" ] || return 0
  resolved="$(readlink -f "$bin" 2>/dev/null || printf '%s' "$bin")"
  for existing in "${editors[@]+"${editors[@]}"}"; do
    if [ "$existing" = "$bin" ] || [ "$(readlink -f "$existing" 2>/dev/null || true)" = "$resolved" ]; then
      return 0
    fi
  done
  if editor_ok "$bin"; then
    editors+=("$bin")
  fi
}

editors=()
for name in code cursor codium antigravity; do
  add_editor "$(command -v "$name" 2>/dev/null || true)"
done
for path in \
  /usr/bin/code /bin/code /usr/local/bin/code /opt/homebrew/bin/code \
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  /usr/bin/cursor /usr/local/bin/cursor /opt/homebrew/bin/cursor \
  "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" \
  /usr/bin/codium /usr/local/bin/codium /opt/homebrew/bin/codium \
  "/Applications/VSCodium.app/Contents/Resources/app/bin/codium" \
  "$HOME/Applications/Antigravity IDE/bin/antigravity-wrapper.sh" \
  /usr/bin/antigravity /usr/local/bin/antigravity
do
  add_editor "$path"
done

if [ "${#editors[@]}" -eq 0 ]; then
  echo "[ERROR] No está VS Code, Cursor, VSCodium ni Antigravity en el PATH."
  echo "        Instala tu editor preferido y vuelve a abrir este archivo."
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
elif command -v osascript >/dev/null 2>&1; then
  osascript -e 'display notification "Extensión instalada. Ábrela desde la barra de VS Code." with title "fh-ia"' || true
fi

if [ -t 0 ] && [ -t 1 ]; then
  echo ""
  read -r -p "Pulsa Enter para cerrar..." _ || true
fi
