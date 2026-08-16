#!/usr/bin/env bash
# Bestla iA V4 - désinstallation ciblée. Ne désinstalle pas Node.js, PM2, FFmpeg ou les autres services.
set -Eeuo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$APP_DIR")"
PROCESS_NAME="bestla-ia-bot"

if [ "${EUID}" -ne 0 ]; then
  echo "Erreur : lance ce script avec root ou sudo."
  exit 1
fi

if [ "${1:-}" != "confirmer" ]; then
  echo "Usage : bash desinstaller-vps.sh confirmer"
  echo "Désinstalle complètement Bestla sans toucher aux autres services du serveur."
  exit 1
fi

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete "$PROCESS_NAME" >/dev/null 2>&1 || true
  pm2 save >/dev/null 2>&1 || true
fi

rm -f /usr/local/bin/bestla
rm -rf "$WORKSPACE_DIR/.bestla-rollback"
rm -rf "$APP_DIR"
rm -rf "$WORKSPACE_DIR"/bestla-v*-test
rm -rf "$WORKSPACE_DIR"/bestla-ia-bot-v*.zip
rm -rf "$WORKSPACE_DIR"/sauvegarde-bestla-avant-v*
rm -rf "$WORKSPACE_DIR"/sauvegarde-complete-avant-v*
rm -rf "$WORKSPACE_DIR"/sauvegardes-bestla

echo "✅ Bestla iA a été désinstallée complètement."
echo "✅ Node.js, PM2, FFmpeg et les autres services du VPS n'ont pas été modifiés."
