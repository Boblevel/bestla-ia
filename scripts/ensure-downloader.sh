#!/usr/bin/env bash
# Installe automatiquement yt-dlp pour les téléchargements publics Bestla.
# Le script est idempotent et peut être relancé au premier usage.
set -u

if command -v yt-dlp >/dev/null 2>&1 && yt-dlp --version >/dev/null 2>&1; then
  # Les sites changent souvent. Une mise à jour Bestla rafraîchit aussi yt-dlp
  # vers le canal nightly recommandé par le projet pour les utilisateurs réguliers.
  if [ "${CI:-}" != "true" ] && [ "${GITHUB_ACTIONS:-}" != "true" ]; then
    yt-dlp --update-to nightly >/dev/null 2>&1 || true
  fi
  exit 0
fi

# Les workflows GitHub n'ont pas besoin de télécharger le binaire : les tests
# valident le code sans exécuter de téléchargement réseau réel.
if [ "${CI:-}" = "true" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  exit 0
fi

TARGET="${BESTLA_YTDLP_PATH:-/usr/local/bin/yt-dlp}"
if ! mkdir -p "$(dirname "$TARGET")" 2>/dev/null || ! touch "${TARGET}.probe" 2>/dev/null; then
  TARGET="${HOME:-/tmp}/.local/bin/yt-dlp"
  mkdir -p "$(dirname "$TARGET")" || exit 1
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
  curl -fL --retry 2 --connect-timeout 15 --max-time 180 "$URL" -o "$TMP" || exit 1
elif command -v wget >/dev/null 2>&1; then
  wget -q --timeout=180 "$URL" -O "$TMP" || exit 1
else
  echo "Bestla : curl ou wget est nécessaire pour installer yt-dlp." >&2
  exit 1
fi

chmod 755 "$TMP" || exit 1
mv -f "$TMP" "$TARGET" || exit 1

"$TARGET" --update-to nightly >/dev/null 2>&1 || true

if ! "$TARGET" --version >/dev/null 2>&1; then
  rm -f "$TARGET"
  echo "Bestla : le binaire yt-dlp téléchargé n'est pas exécutable sur ce système." >&2
  exit 1
fi

exit 0
