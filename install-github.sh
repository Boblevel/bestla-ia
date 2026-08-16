#!/usr/bin/env bash
# Bestla iA v4 - installateur GitHub sans multiplication de dossiers de version.
# Une seule installation permanente : /root/bestla-ia/bestla-ia-bot
set -Eeuo pipefail

REPOSITORY_URL="${BESTLA_REPO_URL:-}"
TARGET_DIR="${BESTLA_DIR:-/root/bestla-ia/bestla-ia-bot}"
WORKSPACE_DIR="$(dirname "$TARGET_DIR")"
TEMP_DIR="$WORKSPACE_DIR/.bestla-install-temp"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      REPOSITORY_URL="${2:-}"
      shift 2
      ;;
    --dir)
      TARGET_DIR="${2:-}"
      WORKSPACE_DIR="$(dirname "$TARGET_DIR")"
      TEMP_DIR="$WORKSPACE_DIR/.bestla-install-temp"
      shift 2
      ;;
    *)
      echo "Option inconnue : $1"
      exit 1
      ;;
  esac
done

if [ "$(uname -s)" != "Linux" ]; then
  echo "Erreur : cet installateur cible Linux."
  exit 1
fi

if [ "${EUID}" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E bash "$0" --repo "$REPOSITORY_URL" --dir "$TARGET_DIR"
  fi
  echo "Erreur : lance avec root ou sudo."
  exit 1
fi

if [ -z "$REPOSITORY_URL" ] || ! [[ "$REPOSITORY_URL" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$ ]]; then
  echo "Indique l'URL HTTPS d'un dépôt GitHub public."
  echo "Exemple : --repo https://github.com/UTILISATEUR/bestla-ia-bot.git"
  exit 1
fi
[[ "$REPOSITORY_URL" == *.git ]] || REPOSITORY_URL="${REPOSITORY_URL}.git"

install_bootstrap_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates rsync unzip
  elif command -v dnf >/dev/null 2>&1; then
    dnf -y install git curl ca-certificates rsync unzip
  elif command -v yum >/dev/null 2>&1; then
    yum -y install git curl ca-certificates rsync unzip
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache git curl ca-certificates rsync unzip
  elif command -v pacman >/dev/null 2>&1; then
    pacman --noconfirm -Sy git curl ca-certificates rsync unzip
  elif command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive refresh
    zypper --non-interactive install --no-recommends git curl ca-certificates rsync unzip
  elif command -v xbps-install >/dev/null 2>&1; then
    xbps-install -S
    xbps-install -y git curl ca-certificates rsync unzip
  else
    echo "Erreur : gestionnaire de paquets non pris en charge."
    exit 1
  fi
}

install_bootstrap_packages
mkdir -p "$WORKSPACE_DIR"
rm -rf "$TEMP_DIR"

if [ -d "$TARGET_DIR/.git" ]; then
  echo "Installation Bestla existante détectée : mise à jour dans le même dossier."
  cd "$TARGET_DIR"
  git remote set-url origin "$REPOSITORY_URL"
  git fetch --prune origin
  BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
  git reset --hard "origin/$BRANCH"
  exec bash "$TARGET_DIR/installer-vps.sh"
fi

# Si un ancien dossier ZIP existe sans Git, on conserve les secrets et sessions,
# puis on remplace seulement le code dans le même chemin permanent.
git clone --depth 1 "$REPOSITORY_URL" "$TEMP_DIR"
mkdir -p "$TARGET_DIR"

ENV_BACKUP=""
DATA_BACKUP=""
if [ -f "$TARGET_DIR/.env" ]; then
  ENV_BACKUP="$WORKSPACE_DIR/.bestla-env-preserve"
  cp -a "$TARGET_DIR/.env" "$ENV_BACKUP"
fi
if [ -d "$TARGET_DIR/data" ]; then
  DATA_BACKUP="$WORKSPACE_DIR/.bestla-data-preserve"
  rm -rf "$DATA_BACKUP"
  cp -a "$TARGET_DIR/data" "$DATA_BACKUP"
fi

rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='node_modules/' \
  "$TEMP_DIR/" "$TARGET_DIR/"

if [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
  mv "$ENV_BACKUP" "$TARGET_DIR/.env"
fi
if [ -n "$DATA_BACKUP" ] && [ -d "$DATA_BACKUP" ]; then
  rm -rf "$TARGET_DIR/data"
  mv "$DATA_BACKUP" "$TARGET_DIR/data"
fi
rm -rf "$TEMP_DIR"

exec bash "$TARGET_DIR/installer-vps.sh"
