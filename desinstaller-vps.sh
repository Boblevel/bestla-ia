#!/usr/bin/env bash
# Bestla iA V4 - désinstallation complète et ciblée.
# Supprime uniquement Bestla et ses traces, sans désinstaller les outils/services partagés.
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$APP_DIR")"
PROCESS_NAME="bestla-ia-bot"
PM2_HOME_DIR="${PM2_HOME:-/root/.pm2}"

if [ "${EUID}" -ne 0 ]; then
  echo "Erreur : lance ce script avec root ou sudo."
  exit 1
fi

case "${1:-}" in
  confirmer|o|oui|yes|y) ;;
  *)
    echo "Usage : bash desinstaller-vps.sh confirmer"
    echo "Désinstalle complètement Bestla sans toucher à Node.js, PM2, FFmpeg, Git ni aux autres services."
    exit 1
    ;;
esac

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete "$PROCESS_NAME" >/dev/null 2>&1 || true
  pm2 save >/dev/null 2>&1 || true
fi

rm -f /usr/local/bin/bestla

# Journaux et PID appartenant uniquement à Bestla.
rm -f "$PM2_HOME_DIR"/logs/${PROCESS_NAME}*.log 2>/dev/null || true
rm -f "$PM2_HOME_DIR"/pids/${PROCESS_NAME}*.pid 2>/dev/null || true

# Le workspace par défaut /root/bestla-ia est réservé à Bestla. Si le chemin
# a été personnalisé, on supprime seulement APP_DIR pour ne jamais toucher
# un dossier parent qui pourrait contenir d’autres services.
if [ "$(basename "$WORKSPACE_DIR")" = "bestla-ia" ]; then
  rm -rf "$WORKSPACE_DIR"
else
  rm -rf "$APP_DIR"
fi

# Anciens emplacements temporaires utilisés par les versions précédentes.
rm -rf /root/bestla-install
rm -rf /root/bestla-update-v4
rm -f /root/bestla-ia-bot-v4-final.zip
rm -f /root/bestla-ia-bot-v4.zip

printf '%s\n' "✅ Bestla iA a été désinstallée complètement."
printf '%s\n' "✅ Code, .env, sessions, données, sauvegardes et journaux PM2 Bestla ont été supprimés."
printf '%s\n' "✅ Node.js, npm, PM2, FFmpeg, Git et les autres services du VPS n'ont pas été modifiés."
