#!/usr/bin/env bash
# Fonctions communes d'installation pour les distributions Linux prises en charge.
# Ce fichier est sourcé par les installateurs Bestla iA ; ne pas l'exécuter seul.


# Barre de progression commune aux opérations longues. Le pourcentage est
# monotone : une étape ne passe à sa valeur cible qu'une fois réellement terminée.
BESTLA_PROGRESS_CURRENT="${BESTLA_PROGRESS_START:-0}"
BESTLA_PROGRESS_LABEL="Préparation"
BESTLA_PROGRESS_SPINNER_INDEX=0

bestla_progress_draw() {
  local percent="${1:-0}"
  local label="${2:-Traitement}"
  local spinner="${3:-}"
  # Barre volontairement compacte pour rester sur UNE ligne sur mobile/SSH.
  # Le format précédent pouvait dépasser la largeur du terminal, se replier puis
  # donner l'impression que la progression se répétait verticalement.
  local columns=80
  if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    columns="$(tput cols 2>/dev/null || printf '80')"
  fi
  [ "$columns" -lt 36 ] && columns=36
  local max_label=$((columns - 31))
  [ "$max_label" -lt 10 ] && max_label=10
  [ "$max_label" -gt 26 ] && max_label=26
  if [ "${#label}" -gt "$max_label" ]; then
    label="${label:0:$((max_label - 1))}…"
  fi
  local width=$((columns - ${#label} - 14))
  [ "$width" -lt 8 ] && width=8
  [ "$width" -gt 20 ] && width=20
  local filled=$((percent * width / 100))
  local empty=$((width - filled))
  local bar_fill bar_empty
  printf -v bar_fill '%*s' "$filled" ''
  printf -v bar_empty '%*s' "$empty" ''
  bar_fill="${bar_fill// /█}"
  bar_empty="${bar_empty// /░}"
  if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
    printf '\r\033[2K\033[38;5;45m%s\033[0m \033[38;5;42m%3d%%\033[0m %s%s' "[$bar_fill$bar_empty]" "$percent" "$label" "${spinner:+ $spinner}"
  else
    printf '\r[%s%s] %3d%% %s%s' "$bar_fill" "$bar_empty" "$percent" "$label" "${spinner:+ $spinner}"
  fi
}

bestla_progress_set() {
  local target="${1:-0}"
  local label="${2:-Traitement}"
  local spinner=""
  local -a spinners=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  [ "$target" -lt "$BESTLA_PROGRESS_CURRENT" ] && target="$BESTLA_PROGRESS_CURRENT"
  [ "$target" -gt 100 ] && target=100
  BESTLA_PROGRESS_LABEL="$label"

  if [ -t 1 ] && [ "${TERM:-}" != "dumb" ] && [ "$target" -gt "$BESTLA_PROGRESS_CURRENT" ]; then
    while [ "$BESTLA_PROGRESS_CURRENT" -lt "$target" ]; do
      BESTLA_PROGRESS_CURRENT=$((BESTLA_PROGRESS_CURRENT + 1))
      spinner="${spinners[$((BESTLA_PROGRESS_SPINNER_INDEX % ${#spinners[@]}))]}"
      BESTLA_PROGRESS_SPINNER_INDEX=$((BESTLA_PROGRESS_SPINNER_INDEX + 1))
      bestla_progress_draw "$BESTLA_PROGRESS_CURRENT" "$BESTLA_PROGRESS_LABEL" "$spinner"
      sleep 0.015
    done
  else
    BESTLA_PROGRESS_CURRENT="$target"
    bestla_progress_draw "$BESTLA_PROGRESS_CURRENT" "$BESTLA_PROGRESS_LABEL"
  fi

  if [ "$BESTLA_PROGRESS_CURRENT" -ge 100 ]; then
    printf '\n'
  fi
}

bestla_progress_target() {
  local stage="${1:-0}"
  local base="${BESTLA_PROGRESS_START:-0}"
  [ "$base" -lt 0 ] && base=0
  [ "$base" -gt 95 ] && base=95
  printf '%d\n' $((base + ((100 - base) * stage / 100)))
}

bestla_run_progress() {
  local target="$1"
  local label="$2"
  shift 2
  local log_file status pid gap step spinner
  local -a spinners=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  log_file="$(mktemp -t bestla-progress.XXXXXX)"

  ( "$@" ) >"$log_file" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$BESTLA_PROGRESS_CURRENT" -lt $((target - 1)) ]; then
      gap=$((target - BESTLA_PROGRESS_CURRENT))
      step=$(((gap + 9) / 10))
      [ "$step" -lt 1 ] && step=1
      BESTLA_PROGRESS_CURRENT=$((BESTLA_PROGRESS_CURRENT + step))
      [ "$BESTLA_PROGRESS_CURRENT" -ge "$target" ] && BESTLA_PROGRESS_CURRENT=$((target - 1))
    fi
    spinner="${spinners[$((BESTLA_PROGRESS_SPINNER_INDEX % ${#spinners[@]}))]}"
    BESTLA_PROGRESS_SPINNER_INDEX=$((BESTLA_PROGRESS_SPINNER_INDEX + 1))
    bestla_progress_draw "$BESTLA_PROGRESS_CURRENT" "$label" "$spinner"
    sleep 0.18
  done

  set +e
  wait "$pid"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    printf '\n'
    echo "Erreur pendant : $label"
    tail -n 50 "$log_file" || true
    rm -f "$log_file"
    return "$status"
  fi
  rm -f "$log_file"
  bestla_progress_set "$target" "$label"
}

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
