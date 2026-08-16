#!/usr/bin/env bash
# Fonctions communes d'installation pour les distributions Linux prises en charge.
# Ce fichier est sourcé par les installateurs Bestla iA ; ne pas l'exécuter seul.

bestla_detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    printf 'apt\n'
  elif command -v dnf >/dev/null 2>&1; then
    printf 'dnf\n'
  elif command -v yum >/dev/null 2>&1; then
    printf 'yum\n'
  elif command -v apk >/dev/null 2>&1; then
    printf 'apk\n'
  elif command -v pacman >/dev/null 2>&1; then
    printf 'pacman\n'
  elif command -v zypper >/dev/null 2>&1; then
    printf 'zypper\n'
  elif command -v xbps-install >/dev/null 2>&1; then
    printf 'xbps\n'
  else
    return 1
  fi
}

bestla_package_manager_name() {
  case "${1:-}" in
    apt) printf 'APT (Debian / Ubuntu)\n' ;;
    dnf) printf 'DNF (Fedora / Rocky / Alma / RHEL)\n' ;;
    yum) printf 'YUM (anciens systèmes RPM)\n' ;;
    apk) printf 'APK (Alpine)\n' ;;
    pacman) printf 'Pacman (Arch / Manjaro)\n' ;;
    zypper) printf 'Zypper (openSUSE)\n' ;;
    xbps) printf 'XBPS (Void Linux)\n' ;;
    *) printf 'inconnu\n' ;;
  esac
}

bestla_node_major() {
  if ! command -v node >/dev/null 2>&1; then
    printf '0\n'
    return
  fi
  node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0\n'
}

bestla_refresh_packages() {
  case "$1" in
    apt) apt-get update -y ;;
    dnf) dnf -y makecache ;;
    yum) yum -y makecache ;;
    apk) apk update ;;
    pacman) pacman --noconfirm -Sy ;;
    zypper) zypper --non-interactive refresh ;;
    xbps) xbps-install -S ;;
  esac
}

bestla_install_core_packages() {
  local manager="$1"
  echo "Installation des outils système avec $(bestla_package_manager_name "$manager")…"
  case "$manager" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates git build-essential python3 zip unzip tar rsync
      ;;
    dnf)
      dnf -y install curl ca-certificates git gcc-c++ make python3 zip unzip tar rsync
      ;;
    yum)
      yum -y install curl ca-certificates git gcc-c++ make python3 zip unzip tar rsync
      ;;
    apk)
      apk add --no-cache curl ca-certificates git build-base python3 zip unzip tar rsync
      ;;
    pacman)
      pacman --noconfirm -S curl ca-certificates git base-devel python zip unzip tar rsync
      ;;
    zypper)
      zypper --non-interactive install --no-recommends curl ca-certificates git gcc-c++ make python3 zip unzip tar rsync
      ;;
    xbps)
      xbps-install -y curl ca-certificates git base-devel python3 zip unzip tar rsync
      ;;
  esac
}

bestla_install_ffmpeg() {
  local manager="$1"
  if command -v ffmpeg >/dev/null 2>&1; then
    return 0
  fi
  echo "Installation de FFmpeg pour les commandes audio et vidéo…"
  case "$manager" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg ;;
    dnf) dnf -y install ffmpeg ;;
    yum) yum -y install ffmpeg ;;
    apk) apk add --no-cache ffmpeg ;;
    pacman) pacman --noconfirm -S ffmpeg ;;
    zypper) zypper --non-interactive install --no-recommends ffmpeg ;;
    xbps) xbps-install -y ffmpeg ;;
  esac
}

bestla_install_node_22() {
  local manager="$1"
  local current_major
  current_major="$(bestla_node_major)"
  if [ "$current_major" -ge 22 ]; then
    echo "Node.js $(node --version) est déjà compatible."
    return 0
  fi

  echo "Installation de Node.js 22 ou plus récent…"
  case "$manager" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
      ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      "$manager" -y install nodejs
      ;;
    apk)
      if ! apk add --no-cache nodejs-current npm; then
        apk add --no-cache nodejs npm
      fi
      ;;
    pacman)
      pacman --noconfirm -S nodejs npm
      ;;
    zypper)
      if ! zypper --non-interactive install --no-recommends nodejs22 npm22; then
        zypper --non-interactive install --no-recommends nodejs npm
      fi
      ;;
    xbps)
      xbps-install -y nodejs npm
      ;;
  esac

  current_major="$(bestla_node_major)"
  if [ "$current_major" -lt 22 ]; then
    echo "Erreur : Node.js 22 ou plus récent est requis ; version détectée : $(node --version 2>/dev/null || echo absente)."
    echo "Ta distribution fournit une version trop ancienne. Installe Node.js 22+, puis relance Bestla iA."
    return 1
  fi
}

bestla_enable_pm2_startup() {
  if ! command -v pm2 >/dev/null 2>&1; then
    return 1
  fi
  if command -v systemctl >/dev/null 2>&1; then
    pm2 startup systemd -u root --hp /root || return 1
    pm2 save
    return 0
  fi
  if command -v rc-service >/dev/null 2>&1; then
    pm2 startup openrc -u root --hp /root || return 1
    pm2 save
    return 0
  fi
  echo "Aucun système d'initialisation compatible détecté."
  echo "Le bot fonctionne avec PM2, mais utilise la politique de redémarrage de ton conteneur/VPS pour le relancer après reboot."
  return 1
}
