#!/usr/bin/env bash
# Bestla iA v4 - mise à jour en place, sans dossier versionné supplémentaire.
# Conserve .env et data. Une seule sauvegarde de rollback est maintenue.
set -Eeuo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-/root/bestla-ia/bestla-ia-bot}"
PROCESS_NAME="bestla-ia-bot"
PLATFORM_LIB="$SOURCE_DIR/scripts/platform.sh"
WORKSPACE_DIR="$(dirname "$TARGET_DIR")"
ROLLBACK_DIR="$WORKSPACE_DIR/.bestla-rollback"

if [ "$(uname -s)" != "Linux" ]; then
  echo "Erreur : la mise à jour cible Linux."
  exit 1
fi
if [ ! -f "$SOURCE_DIR/package.json" ]; then
  echo "Erreur : lance ce script depuis le dossier du projet à appliquer."
  exit 1
fi
if [ ! -f "$TARGET_DIR/package.json" ]; then
  echo "Erreur : installation introuvable dans $TARGET_DIR"
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Erreur : Node.js 22 et npm sont nécessaires."
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Erreur : Node.js 22 ou plus récent est requis."
  exit 1
fi

if [ ! -r "$PLATFORM_LIB" ]; then
  echo "Erreur : fichier système introuvable : $PLATFORM_LIB"
  exit 1
fi
# shellcheck source=scripts/platform.sh
source "$PLATFORM_LIB"
PACKAGE_MANAGER="$(bestla_detect_package_manager || true)"
bestla_progress_set 0 "Préparation de la mise à jour"

if ! command -v rsync >/dev/null 2>&1; then
  if [ "${EUID}" -eq 0 ] && [ -n "$PACKAGE_MANAGER" ]; then
    bestla_run_progress 8 "Installation de rsync" bestla_refresh_packages "$PACKAGE_MANAGER"
    bestla_run_progress 14 "Outils système" bestla_install_core_packages "$PACKAGE_MANAGER"
  else
    echo "Erreur : rsync est absent."
    exit 1
  fi
else
  bestla_progress_set 8 "Outils système prêts"
fi

prepare_rollback() {
  rm -rf "$ROLLBACK_DIR"
  mkdir -p "$ROLLBACK_DIR"
  [ -f "$TARGET_DIR/.env" ] && cp -a "$TARGET_DIR/.env" "$ROLLBACK_DIR/.env"
  [ -d "$TARGET_DIR/data" ] && cp -a "$TARGET_DIR/data" "$ROLLBACK_DIR/data"
  [ -f "$TARGET_DIR/package.json" ] && cp -a "$TARGET_DIR/package.json" "$ROLLBACK_DIR/package.json"
  chmod 700 "$ROLLBACK_DIR"
}
bestla_run_progress 18 "Point de restauration" prepare_rollback

sync_code() {
  rsync -a --delete \
    --exclude='.env' \
    --exclude='data/' \
    --exclude='node_modules/' \
    --exclude='.bin/' \
    --exclude='output/' \
    --exclude='tmp/' \
    --exclude='releases/' \
    --exclude='.git/' \
    "$SOURCE_DIR/" "$TARGET_DIR/"
}
bestla_run_progress 32 "Application des nouveaux fichiers" sync_code

cd "$TARGET_DIR"
bestla_run_progress 52 "Dépendances Node.js" npm ci
bestla_run_progress 64 "Vérification TypeScript" npm run typecheck
bestla_run_progress 76 "Tests automatiques" npm test
bestla_run_progress 88 "Construction" npm run build
chmod 755 dist/cli.js

if [ "${EUID}" -eq 0 ]; then
  ln -sfn "$TARGET_DIR/dist/cli.js" /usr/local/bin/bestla
fi
bestla_progress_set 91 "Commande bestla prête"

restart_service() {
  if ! command -v pm2 >/dev/null 2>&1; then return 0; fi
  if pm2 describe "$PROCESS_NAME" >/dev/null 2>&1; then
    pm2 restart "$PROCESS_NAME" --update-env
  else
    pm2 start ecosystem.config.cjs --only "$PROCESS_NAME" --update-env
  fi
  pm2 save
}
bestla_run_progress 97 "Redémarrage du service" restart_service

cleanup_legacy() {
  shopt -s nullglob
  for target in \
    "$WORKSPACE_DIR"/bestla-v*-test \
    "$WORKSPACE_DIR"/bestla-ia-bot-v*.zip \
    "$WORKSPACE_DIR"/sauvegarde-bestla-avant-v* \
    "$WORKSPACE_DIR"/sauvegarde-complete-avant-v*; do
    rm -rf "$target"
  done
  shopt -u nullglob
}
bestla_run_progress 99 "Nettoyage final" cleanup_legacy
bestla_progress_set 100 "Mise à jour terminée"

echo "✅ .env, clé Gemini et sessions WhatsApp conservés."
echo "Vérifie avec : bestla statut"
