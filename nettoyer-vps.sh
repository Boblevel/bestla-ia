#!/usr/bin/env bash
# Bestla iA V4 - nettoyage prudent : conserve le bot actif, les sessions et une sauvegarde privée récente.
set -Eeuo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$APP_DIR")"
BACKUP_DIR="$WORKSPACE_DIR/sauvegardes-bestla"

if [ "${1:-}" != "confirmer" ]; then
  echo "Usage : bash nettoyer-vps.sh confirmer"
  echo "Supprime uniquement les anciens fichiers Bestla et garde la sauvegarde privée la plus récente."
  exit 1
fi

shopt -s nullglob
removed=0
for target in \
  "$WORKSPACE_DIR"/bestla-v*-test \
  "$WORKSPACE_DIR"/bestla-ia-bot-v*.zip \
  "$WORKSPACE_DIR"/sauvegarde-bestla-avant-v* \
  "$WORKSPACE_DIR"/sauvegarde-complete-avant-v*; do
  rm -rf "$target"
  removed=$((removed + 1))
done

backup_removed=0
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

echo "✅ Nettoyage terminé : $removed ancien(s) ZIP/dossier(s) Bestla supprimé(s)."
echo "✅ $backup_removed ancienne(s) sauvegarde(s) privée(s) supprimée(s)."
echo "✅ Bot actuel, .env, sessions WhatsApp et sauvegarde la plus récente conservés."
