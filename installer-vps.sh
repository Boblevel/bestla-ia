#!/usr/bin/env bash
# Installation complète de Bestla iA sur les distributions Linux prises en charge.
# Réexécutable : un .env et des sessions WhatsApp existants ne sont jamais écrasés.
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROCESS_NAME="bestla-ia-bot"
PLATFORM_LIB="$APP_DIR/scripts/platform.sh"

if [ "$(uname -s)" != "Linux" ]; then
  echo "Erreur : l'installation automatique Bestla iA cible les serveurs Linux."
  echo "Systèmes pris en charge : Debian/Ubuntu, Fedora/RHEL/Rocky/Alma, Alpine, Arch/Manjaro, openSUSE et Void Linux."
  exit 1
fi

if [ "${EUID}" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    echo "Passage administrateur nécessaire pour installer Node.js, FFmpeg et PM2…"
    exec sudo -E bash "$0" "$@"
  fi
  echo "Erreur : lance ce script avec root ou sudo."
  exit 1
fi

if [ ! -r "$PLATFORM_LIB" ]; then
  echo "Erreur : fichier système Bestla introuvable : $PLATFORM_LIB"
  exit 1
fi
# shellcheck source=scripts/platform.sh
source "$PLATFORM_LIB"

PACKAGE_MANAGER="$(bestla_detect_package_manager || true)"
if [ -z "$PACKAGE_MANAGER" ]; then
  echo "Erreur : gestionnaire de paquets non reconnu."
  echo "Bestla iA prend en charge apt, dnf, yum, apk, pacman, zypper et xbps."
  exit 1
fi

set_env_value() {
  local key="$1"
  local value="$2"
  local file="$APP_DIR/.env"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

valid_phone() {
  [[ "$1" =~ ^[0-9]{8,15}$ ]]
}

prompt_initial_configuration() {
  local owner="${BESTLA_OWNER_NUMBER:-}"
  local auth="${BESTLA_AUTH_MODE:-}"

  owner="${owner//[^0-9]/}"
  auth="${auth,,}"
  if [ -z "$owner" ] || [ -z "$auth" ]; then
    if [ ! -r /dev/tty ]; then
      echo "Impossible d’ouvrir le clavier pour la configuration initiale."
      echo "Relance avec BESTLA_OWNER_NUMBER=22670000000 BESTLA_AUTH_MODE=qr."
      exit 1
    fi
    echo
    echo "Configuration du premier compte WhatsApp"
    while ! valid_phone "$owner"; do
      read -r -p "Ton numéro WhatsApp international (sans +, espace ni tiret) : " owner </dev/tty
      owner="${owner//[^0-9]/}"
      valid_phone "$owner" || echo "Numéro invalide. Exemple : 22670000000"
    done
    while [ "$auth" != "qr" ] && [ "$auth" != "pairing" ]; do
      read -r -p "Connexion souhaitée [qr/pairing] (qr recommandé) : " auth </dev/tty
      auth="${auth,,}"
      [ -z "$auth" ] && auth="qr"
      { [ "$auth" = "qr" ] || [ "$auth" = "pairing" ]; } || echo "Écris exactement qr ou pairing."
    done
  fi

  if ! valid_phone "$owner"; then
    echo "Erreur : BESTLA_OWNER_NUMBER doit contenir 8 à 15 chiffres internationaux."
    exit 1
  fi
  if [ "$auth" != "qr" ] && [ "$auth" != "pairing" ]; then
    echo "Erreur : BESTLA_AUTH_MODE doit être qr ou pairing."
    exit 1
  fi

  set_env_value "OWNER_NUMBERS" "$owner"
  set_env_value "SESSION_NAMES" "main"
  set_env_value "AUTH_MODE" "$auth"
  set_env_value "SESSION_PHONES" "main:$owner"
  set_env_value "SESSION_AUTH_MODES" "main:$auth"

  chmod 600 "$APP_DIR/.env"
}

echo "┌────────────────────────────────────────────────────────┐"
echo "│                  R H A F F   S E R V I C E             │"
echo "│       Installation Bestla iA - contrôle WhatsApp        │"
echo "└────────────────────────────────────────────────────────┘"
echo "Système détecté : $(bestla_package_manager_name "$PACKAGE_MANAGER")"

bestla_refresh_packages "$PACKAGE_MANAGER"
bestla_install_core_packages "$PACKAGE_MANAGER"
bestla_install_node_22 "$PACKAGE_MANAGER"
if ! bestla_install_ffmpeg "$PACKAGE_MANAGER"; then
  echo "Attention : FFmpeg n'a pas pu être installé automatiquement."
  echo "Le bot fonctionne, mais les commandes audio et vidéo resteront indisponibles jusqu'à son installation."
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Erreur : npm est absent après l'installation de Node.js."
  exit 1
fi

cd "$APP_DIR"
if [ ! -f package.json ] || [ ! -f .env.example ]; then
  echo "Erreur : le dossier ne semble pas contenir Bestla iA."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  prompt_initial_configuration
else
  chmod 600 .env
  echo "Configuration existante conservée (.env et sessions WhatsApp)."
fi

echo "Installation des dépendances Node.js…"
npm ci

echo "Vérification TypeScript…"
npm run typecheck

echo "Tests…"
npm test

echo "Construction de Bestla iA…"
npm run build
chmod 755 dist/cli.js
ln -sfn "$APP_DIR/dist/cli.js" /usr/local/bin/bestla

if ! command -v pm2 >/dev/null 2>&1; then
  echo "Installation de PM2…"
  npm install -g pm2@latest
fi

if pm2 describe "$PROCESS_NAME" >/dev/null 2>&1; then
  pm2 restart "$PROCESS_NAME" --update-env
else
  pm2 start ecosystem.config.cjs --only "$PROCESS_NAME" --update-env
fi
pm2 save

if ! bestla_enable_pm2_startup; then
  echo "Note : configure le redémarrage automatique avec le gestionnaire de ton hébergeur si ce VPS est un conteneur sans systemd/OpenRC."
fi

# Affiche immédiatement la liaison WhatsApp de la première session, sans passer par les journaux PM2.
echo
echo "Préparation de la liaison WhatsApp…"
node "$APP_DIR/dist/cli.js" sessions liaison main 30 || echo "La liaison pourra être générée depuis : bestla → Numéros WhatsApp → Générer / afficher QR ou code"

echo
echo "✅ Bestla iA est installée et enregistrée dans PM2."
echo "• Tape : bestla"
echo "• Ajoute d'autres numéros : bestla puis 1"
echo "• Vérifie : bestla statut"
echo "• QR / code de liaison : bestla → Numéros WhatsApp → Générer / afficher QR ou code"
echo "• Dossier permanent : $APP_DIR"
echo "• Nettoyage anciens fichiers Bestla : bestla nettoyer confirmer"
echo "• Désinstallation complète : bash desinstaller-vps.sh confirmer"
echo "• Dans WhatsApp : .menu"
