#!/usr/bin/env bash
# Crée une archive portable à joindre à une release GitHub.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
RELEASE_DIR="$ROOT_DIR/releases"
ARCHIVE="$RELEASE_DIR/bestla-ia-bot-v${VERSION}.zip"

if ! command -v zip >/dev/null 2>&1; then
  echo "zip est absent. Installe-le avec le gestionnaire de paquets de ton système (apt, dnf, apk, pacman, zypper ou xbps)."
  exit 1
fi

mkdir -p "$RELEASE_DIR"
if [ -e "$ARCHIVE" ]; then
  echo "Une archive existe déjà : $ARCHIVE"
  echo "Pour éviter tout écrasement, change la version dans package.json avant de créer une nouvelle release."
  exit 1
fi
cd "$ROOT_DIR/.."
zip -qr "$ARCHIVE" "$(basename "$ROOT_DIR")" \
  -x "$(basename "$ROOT_DIR")/node_modules/*" \
  -x "$(basename "$ROOT_DIR")/dist/*" \
  -x "$(basename "$ROOT_DIR")/data/*" \
  -x "$(basename "$ROOT_DIR")/.env" \
  -x "$(basename "$ROOT_DIR")/tmp/*" \
  -x "$(basename "$ROOT_DIR")/output/*" \
  -x "$(basename "$ROOT_DIR")/releases/*" \
  -x "$(basename "$ROOT_DIR")/scripts/__pycache__/*" \
  -x "$(basename "$ROOT_DIR")/*.pyc" \
  -x "$(basename "$ROOT_DIR")/.git/*"
echo "Archive créée : $ARCHIVE"
