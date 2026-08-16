#!/usr/bin/env bash
# Désinstallation complète et ciblée. Ne supprime aucun service partagé du VPS.
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$APP_DIR")"
PROCESS_NAME="bestla-ia-bot"
PM2_HOME_DIR="${PM2_HOME:-/root/.pm2}"
PLATFORM_LIB="$APP_DIR/scripts/platform.sh"

if [ "${EUID}" -ne 0 ]; then
  echo "Erreur : lance ce script avec root ou sudo."
  exit 1
fi

case "${1:-}" in
  confirmer|o|oui|yes|y) ;;
  *)
    echo "Usage : bash desinstaller-vps.sh confirmer"
    echo "Désinstalle complètement le bot sans toucher à Node.js, PM2, FFmpeg, Git ni aux autres services."
    exit 1
    ;;
esac

if [ -r "$PLATFORM_LIB" ]; then
  # shellcheck source=scripts/platform.sh
  source "$PLATFORM_LIB"
  bestla_progress_set 0 "Préparation de la désinstallation"
fi

[ "$(type -t bestla_progress_set || true)" = "function" ] && bestla_progress_set 20 "Arrêt du service"
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete "$PROCESS_NAME" >/dev/null 2>&1 || true
  pm2 save >/dev/null 2>&1 || true
fi

rm -f /usr/local/bin/bestla
[ "$(type -t bestla_progress_set || true)" = "function" ] && bestla_progress_set 45 "Suppression des journaux"
rm -f "$PM2_HOME_DIR"/logs/${PROCESS_NAME}*.log 2>/dev/null || true
rm -f "$PM2_HOME_DIR"/pids/${PROCESS_NAME}*.pid 2>/dev/null || true

[ "$(type -t bestla_progress_set || true)" = "function" ] && bestla_progress_set 70 "Suppression des données"
# Les fonctions de progression restent chargées en mémoire même après suppression du fichier source.
if [ "$(basename "$WORKSPACE_DIR")" = "bestla-ia" ]; then
  rm -rf "$WORKSPACE_DIR"
else
  rm -rf "$APP_DIR"
fi

[ "$(type -t bestla_progress_set || true)" = "function" ] && bestla_progress_set 90 "Nettoyage des anciens emplacements"
rm -rf /root/bestla-install /root/bestla-update-v4
rm -f /root/bestla-ia-bot-v4-final.zip /root/bestla-ia-bot-v4.zip

[ "$(type -t bestla_progress_set || true)" = "function" ] && bestla_progress_set 100 "Désinstallation terminée"
printf '%s\n' "✅ Code, .env, sessions, données, sauvegardes et journaux dédiés ont été supprimés."
printf '%s\n' "✅ Node.js, npm, PM2, FFmpeg, Git et les autres services du VPS n'ont pas été modifiés."
