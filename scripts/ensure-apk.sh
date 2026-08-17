#!/usr/bin/env bash
# Installe/répare le moteur APK local utilisé par .telechargerapk.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/.bin"
TARGET="$TARGET_DIR/apkeep"
VERSION="${BESTLA_APKEEP_VERSION:-1.0.0}"

if [ -x "$TARGET" ] && "$TARGET" --version >/dev/null 2>&1; then
  exit 0
fi

mkdir -p "$TARGET_DIR"

# Réutilise une installation système valide lorsqu'elle existe déjà.
if command -v apkeep >/dev/null 2>&1 && apkeep --version >/dev/null 2>&1; then
  cp "$(command -v apkeep)" "$TARGET"
  chmod 755 "$TARGET"
  exit 0
fi

ARCH="$(uname -m)"
LIBC="gnu"
if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
  LIBC="musl"
fi

# apkeep 1.0.0 publie des binaires Linux GNU pour ces architectures.
case "$ARCH:$LIBC" in
  x86_64:gnu|amd64:gnu)
    ASSET="apkeep-x86_64-unknown-linux-gnu"
    EXPECTED_SHA256="a23579a3ba366d25a6d69848189b983d65662f4ecf4b9e11e16510811659de4e"
    ;;
  aarch64:gnu|arm64:gnu)
    ASSET="apkeep-aarch64-unknown-linux-gnu"
    EXPECTED_SHA256="5410acebd1b69427adcf98ccfdda6fa4dd3201e0540e5e2c01037b68e0a84049"
    ;;
  armv7l:gnu|armv7:gnu)
    ASSET="apkeep-armv7-unknown-linux-gnueabihf"
    EXPECTED_SHA256="c561060b6e0bdf0b080c8d0c58253281dd2a080001e6564e70ee45e8be5da8eb"
    ;;
  i386:gnu|i486:gnu|i586:gnu|i686:gnu)
    ASSET="apkeep-i686-unknown-linux-gnu"
    EXPECTED_SHA256="194351b2ad857332a34cfded760955b5a339e875a50dc2fe5b5786b33e9d7d2c"
    ;;
  *:musl)
    echo "Le binaire officiel apkeep ${VERSION} n'est pas publié pour Linux musl. Installe apkeep avec le gestionnaire de paquets ou cargo, puis relance la mise à jour Bestla." >&2
    exit 1
    ;;
  *)
    echo "Architecture non prise en charge automatiquement pour le moteur APK : $ARCH/$LIBC" >&2
    exit 1
    ;;
esac

URL="https://github.com/EFForg/apkeep/releases/download/${VERSION}/${ASSET}"
TMP="${TARGET}.tmp.$$"
rm -f "$TMP"
trap 'rm -f "$TMP"' EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fL --retry 2 --connect-timeout 15 --max-time 180 "$URL" -o "$TMP"
elif command -v wget >/dev/null 2>&1; then
  wget -q --timeout=180 "$URL" -O "$TMP"
else
  echo "curl ou wget est nécessaire pour installer le moteur APK." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(sha256sum "$TMP" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(shasum -a 256 "$TMP" | awk '{print $1}')"
else
  echo "sha256sum ou shasum est nécessaire pour vérifier le moteur APK téléchargé." >&2
  exit 1
fi

if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "Échec de vérification SHA256 du moteur APK. Installation annulée." >&2
  exit 1
fi

chmod 755 "$TMP"
mv -f "$TMP" "$TARGET"
trap - EXIT
"$TARGET" --version >/dev/null
