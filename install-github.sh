#!/usr/bin/env bash
# Bestla iA v4 - installation GitHub dans un dossier permanent unique.
set -Eeuo pipefail

REPOSITORY_URL="${BESTLA_REPO_URL:-}"
TARGET_DIR="${BESTLA_DIR:-/root/bestla-ia/bestla-ia-bot}"
WORKSPACE_DIR="$(dirname "$TARGET_DIR")"
TEMP_DIR="$WORKSPACE_DIR/.bestla-install-temp"
PROGRESS_CURRENT=0
SPINNER_INDEX=0

progress_draw() {
  local percent="$1" label="$2" spinner="${3:-}"
  local width=28 filled=$((percent * width / 100)) empty
  local a b
  empty=$((width - filled))
  printf -v a '%*s' "$filled" ''
  printf -v b '%*s' "$empty" ''
  a="${a// /█}"; b="${b// /░}"
  if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
    printf '\r\033[2K\033[38;5;45m[%s%s]\033[0m \033[38;5;42m%3d%%\033[0m  %-34s %s' "$a" "$b" "$percent" "$label" "$spinner"
  else
    printf '\r[%s%s] %3d%%  %-34s %s' "$a" "$b" "$percent" "$label" "$spinner"
  fi
}

run_progress() {
  local target="$1" label="$2"; shift 2
  local log pid status gap step spinner
  local -a spin=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  log="$(mktemp -t bestla-bootstrap.XXXXXX)"
  ( "$@" ) >"$log" 2>&1 & pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$PROGRESS_CURRENT" -lt $((target - 1)) ]; then
      gap=$((target - PROGRESS_CURRENT)); step=$(((gap + 9) / 10)); [ "$step" -lt 1 ] && step=1
      PROGRESS_CURRENT=$((PROGRESS_CURRENT + step)); [ "$PROGRESS_CURRENT" -ge "$target" ] && PROGRESS_CURRENT=$((target - 1))
    fi
    spinner="${spin[$((SPINNER_INDEX % ${#spin[@]}))]}"; SPINNER_INDEX=$((SPINNER_INDEX + 1))
    progress_draw "$PROGRESS_CURRENT" "$label" "$spinner"
    sleep 0.18
  done
  set +e; wait "$pid"; status=$?; set -e
  if [ "$status" -ne 0 ]; then
    printf '\nErreur pendant : %s\n' "$label"
    tail -n 50 "$log" || true
    rm -f "$log"
    return "$status"
  fi
  rm -f "$log"
  PROGRESS_CURRENT="$target"
  progress_draw "$PROGRESS_CURRENT" "$label"
}

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
    return 1
  fi
}

echo
progress_draw 0 "Préparation"
run_progress 14 "Outils de téléchargement" install_bootstrap_packages
mkdir -p "$WORKSPACE_DIR"
rm -rf "$TEMP_DIR"

if [ -d "$TARGET_DIR/.git" ]; then
  update_existing_checkout() {
    cd "$TARGET_DIR"
    git remote set-url origin "$REPOSITORY_URL"
    git fetch --prune origin
    local branch
    branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
    git reset --hard "origin/$branch"
  }
  run_progress 30 "Synchronisation GitHub" update_existing_checkout
  printf '\n'
  export BESTLA_PROGRESS_START=30
  exec bash "$TARGET_DIR/installer-vps.sh"
fi

clone_repository() {
  git clone --depth 1 "$REPOSITORY_URL" "$TEMP_DIR"
}
run_progress 24 "Téléchargement du projet" clone_repository
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

sync_project() {
  rsync -a --delete \
    --exclude='.env' \
    --exclude='data/' \
    --exclude='node_modules/' \
    "$TEMP_DIR/" "$TARGET_DIR/"
}
run_progress 30 "Préparation du dossier" sync_project

if [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
  mv "$ENV_BACKUP" "$TARGET_DIR/.env"
fi
if [ -n "$DATA_BACKUP" ] && [ -d "$DATA_BACKUP" ]; then
  rm -rf "$TARGET_DIR/data"
  mv "$DATA_BACKUP" "$TARGET_DIR/data"
fi
rm -rf "$TEMP_DIR"
printf '\n'
export BESTLA_PROGRESS_START=30
exec bash "$TARGET_DIR/installer-vps.sh"
