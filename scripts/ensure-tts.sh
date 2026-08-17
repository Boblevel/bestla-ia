#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$APP_DIR/.venv-tts"
EDGE_TTS_VERSION="7.2.8"

# Les runners GitHub vérifient le code mais n'ont pas besoin du moteur audio système.
if [ "${CI:-}" = "true" ] && [ "${BESTLA_TTS_INSTALL_IN_CI:-false}" != "true" ]; then
  echo "Bestla TTS : installation système ignorée dans CI."
  exit 0
fi

package_manager() {
  if command -v apt-get >/dev/null 2>&1; then echo apt
  elif command -v dnf >/dev/null 2>&1; then echo dnf
  elif command -v yum >/dev/null 2>&1; then echo yum
  elif command -v apk >/dev/null 2>&1; then echo apk
  elif command -v pacman >/dev/null 2>&1; then echo pacman
  elif command -v zypper >/dev/null 2>&1; then echo zypper
  elif command -v xbps-install >/dev/null 2>&1; then echo xbps
  else echo unknown
  fi
}

install_python_runtime() {
  local manager
  manager="$(package_manager)"
  echo "Bestla TTS : préparation automatique de Python/venv ($manager)…"
  case "$manager" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null
      DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-venv python3-pip >/dev/null
      ;;
    dnf) dnf -y install python3 python3-pip >/dev/null ;;
    yum) yum -y install python3 python3-pip >/dev/null ;;
    apk) apk add --no-cache python3 py3-pip py3-virtualenv >/dev/null ;;
    pacman) pacman --noconfirm -S --needed python python-pip >/dev/null ;;
    zypper) zypper --non-interactive install --no-recommends python3 python3-pip python3-virtualenv >/dev/null || zypper --non-interactive install --no-recommends python3 python3-pip >/dev/null ;;
    xbps) xbps-install -y python3 python3-pip python3-virtualenv >/dev/null || xbps-install -y python3 python3-pip >/dev/null ;;
    *)
      echo "Bestla TTS : gestionnaire de paquets non reconnu."
      return 1
      ;;
  esac
}

if ! command -v python3 >/dev/null 2>&1; then
  install_python_runtime
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  manager="$(package_manager)"
  echo "Bestla TTS : installation automatique de FFmpeg…"
  case "$manager" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg >/dev/null ;;
    dnf) dnf -y install ffmpeg >/dev/null || true ;;
    yum) yum -y install ffmpeg >/dev/null || true ;;
    apk) apk add --no-cache ffmpeg >/dev/null ;;
    pacman) pacman --noconfirm -S --needed ffmpeg >/dev/null ;;
    zypper) zypper --non-interactive install --no-recommends ffmpeg >/dev/null || true ;;
    xbps) xbps-install -y ffmpeg >/dev/null || true ;;
  esac
fi

create_venv() {
  rm -rf "$VENV_DIR"
  python3 -m venv "$VENV_DIR"
}

if [ ! -x "$VENV_DIR/bin/python" ]; then
  if ! create_venv 2>/dev/null; then
    install_python_runtime
    create_venv
  fi
fi

if [ ! -x "$VENV_DIR/bin/pip" ]; then
  install_python_runtime
  create_venv
fi

CURRENT_VERSION=""
if [ -x "$VENV_DIR/bin/edge-tts" ]; then
  CURRENT_VERSION="$($VENV_DIR/bin/edge-tts --version 2>/dev/null | awk '{print $NF}' || true)"
fi

if [ "$CURRENT_VERSION" != "$EDGE_TTS_VERSION" ]; then
  echo "Bestla TTS : installation edge-tts $EDGE_TTS_VERSION…"
  "$VENV_DIR/bin/python" -m pip install --disable-pip-version-check --no-input --upgrade "edge-tts==$EDGE_TTS_VERSION"
fi

if [ ! -x "$VENV_DIR/bin/edge-tts" ]; then
  echo "Bestla TTS : installation incomplète."
  exit 1
fi

printf 'Bestla TTS : prêt (%s).\n' "$($VENV_DIR/bin/edge-tts --version 2>/dev/null || echo edge-tts)"
