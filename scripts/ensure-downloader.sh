#!/usr/bin/env bash
# Prépare automatiquement yt-dlp + le fournisseur PO Token YouTube de Bestla.
# Idempotent : peut être relancé à chaque mise à jour et au premier usage.
set -u

is_ci() {
  [ "${CI:-}" = "true" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]
}

warn() {
  printf 'Bestla téléchargement : %s\n' "$*" >&2
}

if is_ci; then
  # Les tests GitHub ne réalisent aucun téléchargement réseau réel.
  exit 0
fi

TARGET="${BESTLA_YTDLP_PATH:-/usr/local/bin/yt-dlp}"

install_ytdlp() {
  if command -v yt-dlp >/dev/null 2>&1 && yt-dlp --version >/dev/null 2>&1; then
    yt-dlp --update-to nightly >/dev/null 2>&1 || true
    return 0
  fi

  if ! mkdir -p "$(dirname "$TARGET")" 2>/dev/null || ! touch "${TARGET}.probe" 2>/dev/null; then
    TARGET="${HOME:-/tmp}/.local/bin/yt-dlp"
    mkdir -p "$(dirname "$TARGET")" || return 1
  else
    rm -f "${TARGET}.probe"
  fi

  ARCH="$(uname -m 2>/dev/null || echo unknown)"
  LIBC="glibc"
  if ldd --version 2>&1 | grep -qi musl; then
    LIBC="musl"
  fi

  ASSET="yt-dlp"
  case "${ARCH}:${LIBC}" in
    x86_64:glibc|amd64:glibc) ASSET="yt-dlp_linux" ;;
    aarch64:glibc|arm64:glibc) ASSET="yt-dlp_linux_aarch64" ;;
    x86_64:musl|amd64:musl) ASSET="yt-dlp_musllinux" ;;
    aarch64:musl|arm64:musl) ASSET="yt-dlp_musllinux_aarch64" ;;
  esac

  URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}"
  TMP="${TARGET}.tmp.$$"
  rm -f "$TMP"

  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 2 --connect-timeout 15 --max-time 180 "$URL" -o "$TMP" || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=180 "$URL" -O "$TMP" || return 1
  else
    warn "curl ou wget est nécessaire pour installer yt-dlp."
    return 1
  fi

  chmod 755 "$TMP" || return 1
  mv -f "$TMP" "$TARGET" || return 1
  "$TARGET" --update-to nightly >/dev/null 2>&1 || true
  "$TARGET" --version >/dev/null 2>&1 || return 1
}

install_pot_provider() {
  # YouTube impose progressivement des Proof-of-Origin Tokens même sur certaines
  # vidéos publiques. Bestla installe le provider recommandé sans demander de
  # cookies, de compte YouTube ou de clé à l'utilisateur.
  if ! command -v git >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    warn "provider YouTube avancé ignoré (git/node/npm indisponible)."
    return 0
  fi

  POT_VERSION="${BESTLA_POT_PROVIDER_VERSION:-1.3.1}"
  POT_ROOT="${BESTLA_POT_PROVIDER_HOME:-${HOME:-/tmp}/.bestla/bgutil-ytdlp-pot-provider}"
  SERVER_DIR="${POT_ROOT}/server"
  XDG_BASE="${XDG_CONFIG_HOME:-${HOME:-/tmp}/.config}"
  PLUGIN_DIR="${XDG_BASE}/yt-dlp/plugins/bgutil-ytdlp-pot-provider"

  mkdir -p "$(dirname "$POT_ROOT")" "$PLUGIN_DIR" || return 0

  NEED_CLONE=0
  if [ ! -d "${POT_ROOT}/.git" ]; then
    NEED_CLONE=1
  else
    CURRENT_TAG="$(git -C "$POT_ROOT" describe --tags --exact-match 2>/dev/null || true)"
    [ "$CURRENT_TAG" = "$POT_VERSION" ] || NEED_CLONE=1
  fi

  if [ "$NEED_CLONE" -eq 1 ]; then
    TMP_ROOT="${POT_ROOT}.tmp.$$"
    rm -rf "$TMP_ROOT"
    if git clone --quiet --depth 1 --branch "$POT_VERSION" \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$TMP_ROOT"; then
      rm -rf "$POT_ROOT"
      mv "$TMP_ROOT" "$POT_ROOT"
    else
      rm -rf "$TMP_ROOT"
      warn "le provider PO Token YouTube n'a pas pu être téléchargé; les autres plateformes restent utilisables."
      return 0
    fi
  fi

  if [ ! -f "${SERVER_DIR}/build/generate_once.js" ] || \
     [ "${SERVER_DIR}/package-lock.json" -nt "${SERVER_DIR}/build/generate_once.js" ]; then
    if ! (cd "$SERVER_DIR" && npm ci --silent >/dev/null 2>&1 && npx tsc >/dev/null 2>&1); then
      warn "le provider PO Token YouTube n'a pas pu être compilé; les autres plateformes restent utilisables."
      return 0
    fi
  fi

  if [ -d "${POT_ROOT}/plugin/yt_dlp_plugins" ]; then
    rm -rf "${PLUGIN_DIR}/yt_dlp_plugins"
    cp -R "${POT_ROOT}/plugin/yt_dlp_plugins" "${PLUGIN_DIR}/yt_dlp_plugins" || true
  fi
}



pot_server_ready() {
  local port="$1"
  node - "$port" >/dev/null 2>&1 <<'NODE'
const net = require('node:net')
const port = Number(process.argv[2])
const socket = net.createConnection({ host: '127.0.0.1', port })
const timer = setTimeout(() => { socket.destroy(); process.exit(1) }, 800)
socket.once('connect', () => { clearTimeout(timer); socket.end(); process.exit(0) })
socket.once('error', () => { clearTimeout(timer); process.exit(1) })
NODE
}

start_pot_provider() {
  local pot_root="${BESTLA_POT_PROVIDER_HOME:-${HOME:-/tmp}/.bestla/bgutil-ytdlp-pot-provider}"
  local server_dir="${pot_root}/server"
  local main_js="${server_dir}/build/main.js"
  local port="${BESTLA_POT_PROVIDER_PORT:-4416}"
  local pid_file="${pot_root}/provider.pid"
  local log_file="${pot_root}/provider.log"

  [ -f "$main_js" ] || return 0
  if pot_server_ready "$port"; then
    return 0
  fi

  if [ -f "$pid_file" ]; then
    local old_pid
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" 2>/dev/null || true
      sleep 0.2
    fi
  fi

  (
    cd "$server_dir" || exit 1
    nohup node build/main.js --port "$port" >>"$log_file" 2>&1 &
    echo $! >"$pid_file"
  ) || return 0

  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if pot_server_ready "$port"; then
      return 0
    fi
    sleep 0.25
  done
  warn "le serveur PO Token local n'a pas démarré; Bestla gardera le mode script et les profils YouTube de secours."
  return 0
}

if ! install_ytdlp; then
  warn "yt-dlp n'a pas pu être installé automatiquement."
  exit 1
fi

install_pot_provider
start_pot_provider
exit 0
