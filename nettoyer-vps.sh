#!/usr/bin/env bash
# Nettoyage prudent : conserve le bot actif, .env, sessions et la sauvegarde privée la plus récente.
set -Eeuo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$APP_DIR")"
BACKUP_DIR="$WORKSPACE_DIR/sauvegardes-bestla"
PLATFORM_LIB="$APP_DIR/scripts/platform.sh"

if [ "${1:-}" != "confirmer" ] && [ "${1:-}" != "o" ] && [ "${1:-}" != "oui" ]; then
  echo "Usage : bash nettoyer-vps.sh confirmer"
  exit 1
fi

if [ -r "$PLATFORM_LIB" ]; then
  # shellcheck source=scripts/platform.sh
  source "$PLATFORM_LIB"
  bestla_progress_set 0 "Analyse des anciens fichiers"
fi

shopt -s nullglob
removed=0
[ "$(type -t bestla_progress_set || true)" = "function" ] && bestla_progress_set 25 "Nettoyage des migrations"
for target in \
  "$WORKSPACE_DIR"/bestla-v*-test \
  "$WORKSPACE_DIR"/bestla-ia-bot-v*.zip \
  "$WORKSPACE_DIR"/sauvegarde-bestla-avant-v* \
  "$WORKSPACE_DIR"/sauvegarde-complete-avant-v*; do
  rm -rf "$target"
  removed=$((removed + 1))
done

backup_removed=0
[ "$(type -t bestla_progress_set || true)" = "function" ] && bestla_progress_set 65 "Rotation des sauvegardes"
if [ -d "$BACKUP_DIR" ]; then
  mapfile -t backups < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'bestla-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2-)
  if [ "${#backups[@]}" -gt 1 ]; then
    for file in "${backups[@]:1}"; do
      rm -f -- "$file"
      backup_removed=$((backup_removed + 1))
    done
  fi
fi
shopt -u nullglob

[ "$(type -t bestla_progress_set || true)" = "function" ] && bestla_progress_set 100 "Nettoyage terminé"
echo "✅ $removed ancien(s) ZIP/dossier(s) supprimé(s)."
echo "✅ $backup_removed ancienne(s) sauvegarde(s) privée(s) supprimée(s)."
echo "✅ Bot actuel, .env, sessions WhatsApp et sauvegarde la plus récente conservés."
