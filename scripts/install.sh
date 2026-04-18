#!/usr/bin/env bash
# Risved Installation Script
# Usage: curl -fsSL https://risved.org/install | sh
#
# Installs Docker, Bun, and Risved on Ubuntu/Debian.
# Idempotent — safe to re-run.

set -euo pipefail

RISVED_VERSION="${RISVED_VERSION:-latest}"
RISVED_PORT="${RISVED_PORT:-3000}"
RISVED_DOCKER_NETWORK="risved"
CADDY_IMAGE="caddy:2-alpine"
RISVED_DATA_DIR="/opt/risved"
MIN_RAM_MB=2048
REC_RAM_MB=4096
MIN_DISK_MB=10240

# ── Output helpers ──────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${BLUE}▸${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}⚠${RESET} %s\n" "$*"; }
err()   { printf "${RED}✗${RESET} %s\n" "$*" >&2; }
fatal() { err "$@"; exit 1; }

banner() {
  printf "\n${BOLD}"
  cat <<'LOGO'
       _                  _
  _ __(_)_____   _____  _| |
 | '__| / __\ \ / / _ \/ _` |
 | |  | \__ \\ V /  __/ (_| |
 |_|  |_|___/ \_/ \___|\__,_|

LOGO
  printf "${RESET}"
  printf "  ${DIM}Deploy to Risved${RESET}\n\n"
}

# ── Checks ──────────────────────────────────────────────────────

check_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fatal "This script must be run as root. Try: sudo sh -c 'curl -fsSL https://risved.org/install | sh'"
  fi
  ok "Running as root"
}

detect_os() {
  if [ ! -f /etc/os-release ]; then
    fatal "Cannot detect OS: /etc/os-release not found"
  fi

  # shellcheck disable=SC1091
  . /etc/os-release

  OS_ID="${ID:-unknown}"
  OS_VERSION="${VERSION_ID:-unknown}"

  case "$OS_ID" in
    ubuntu|debian)
      ok "Detected $PRETTY_NAME"
      ;;
    *)
      fatal "Unsupported OS: $PRETTY_NAME. Risved requires Ubuntu or Debian."
      ;;
  esac
}

check_ram() {
  local total_kb total_mb
  total_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
  total_mb=$((total_kb / 1024))

  if [ "$total_mb" -lt "$MIN_RAM_MB" ]; then
    fatal "Insufficient RAM: ${total_mb}MB available, ${MIN_RAM_MB}MB required"
  fi

  if [ "$total_mb" -lt "$REC_RAM_MB" ]; then
    warn "RAM: ${total_mb}MB available (${REC_RAM_MB}MB recommended for running multiple apps)"
  else
    ok "RAM: ${total_mb}MB available"
  fi
}

check_disk() {
  local free_kb free_mb
  free_kb=$(df --output=avail / | tail -1 | tr -d ' ')
  free_mb=$((free_kb / 1024))

  if [ "$free_mb" -lt "$MIN_DISK_MB" ]; then
    fatal "Insufficient disk: ${free_mb}MB free, ${MIN_DISK_MB}MB required"
  fi

  ok "Disk: ${free_mb}MB free"
}

check_port() {
  local port="$1"
  if ss -tlnp | grep -q ":${port} "; then
    fatal "Port $port is already in use. Risved needs ports 80 and 443 for HTTPS."
  fi
}

check_ports() {
  check_port 80
  check_port 443
  ok "Ports 80 and 443 are available"
}

# ── Installers ──────────────────────────────────────────────────

install_docker() {
  if command -v docker &>/dev/null; then
    ok "Docker already installed: $(docker --version)"
    return
  fi

  info "Installing Docker Engine..."

  # Install prerequisites
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null

  # Add Docker's official GPG key
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  # Set up the Docker repository
  if [ ! -f /etc/apt/sources.list.d/docker.list ]; then
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${OS_ID} \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  fi

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin >/dev/null

  systemctl enable docker --now

  ok "Docker installed: $(docker --version)"
}

install_bun() {
  if command -v bun &>/dev/null; then
    ok "Bun already installed: $(bun --version)"
    return
  fi

  info "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun &>/dev/null; then
    fatal "Bun installation failed"
  fi

  ok "Bun installed: $(bun --version)"
}

# ── Setup ───────────────────────────────────────────────────────

setup_network() {
  if docker network inspect "$RISVED_DOCKER_NETWORK" &>/dev/null; then
    ok "Docker network '$RISVED_DOCKER_NETWORK' already exists"
    return
  fi

  docker network create "$RISVED_DOCKER_NETWORK" >/dev/null
  ok "Created Docker network '$RISVED_DOCKER_NETWORK'"
}

setup_directories() {
  mkdir -p "$RISVED_DATA_DIR"/{data,caddy/data,caddy/config}
  ok "Data directory: $RISVED_DATA_DIR"
}

start_caddy() {
  local container_name="risved-caddy"

  if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
    ok "Caddy already running"
    return
  fi

  # Stop existing stopped container if present
  docker rm -f "$container_name" 2>/dev/null || true

  docker run -d \
    --name "$container_name" \
    --network "$RISVED_DOCKER_NETWORK" \
    --restart unless-stopped \
    -p 80:80 \
    -p 443:443 \
    -p 2019:2019 \
    -v "$RISVED_DATA_DIR/caddy/data:/data" \
    -v "$RISVED_DATA_DIR/caddy/config:/config" \
    "$CADDY_IMAGE" \
    caddy run --config /etc/caddy/Caddyfile --adapter caddyfile --resume >/dev/null

  # Wait for Caddy to be ready
  local retries=0
  while [ $retries -lt 15 ]; do
    if docker exec "$container_name" wget -qO- http://localhost:2019/config/ &>/dev/null; then
      ok "Caddy started and accepting connections"
      return
    fi
    retries=$((retries + 1))
    sleep 1
  done

  warn "Caddy started but admin API not yet responsive (may need a moment)"
}

start_risved() {
  local container_name="risved-control"

  if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
    ok "Risved control plane already running"
    return
  fi

  # Stop existing stopped container if present
  docker rm -f "$container_name" 2>/dev/null || true

  info "Starting Risved control plane..."

  docker run -d \
    --name "$container_name" \
    --network "$RISVED_DOCKER_NETWORK" \
    --restart unless-stopped \
    -p "${RISVED_PORT}:3000" \
    -e "DATABASE_URL=file:data/risved.db" \
    -v "$RISVED_DATA_DIR/data:/app/data" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    "ghcr.io/ralf/risved:${RISVED_VERSION}" >/dev/null 2>&1 || true

  ok "Risved control plane started"
}

detect_server_ip() {
  local ip
  # Try multiple methods to detect the public IP
  ip=$(curl -fsSL --max-time 5 https://ifconfig.me 2>/dev/null) \
    || ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null) \
    || ip=$(hostname -I | awk '{print $1}') \
    || ip="<server-ip>"
  echo "$ip"
}

build_builder_images() {
  info "Building pre-warmed builder images..."
  local builder_dir="$RISVED_DATA_DIR/scripts/builders"

  if [ ! -f "$builder_dir/build.sh" ]; then
    warn "Builder scripts not found at $builder_dir, skipping"
    return
  fi

  bash "$builder_dir/build.sh"
  ok "Builder images ready"
}

setup_builder_cron() {
  local cron_line="0 3 * * 0 bash $RISVED_DATA_DIR/scripts/builders/build.sh >> /var/log/risved-builders.log 2>&1"

  if crontab -l 2>/dev/null | grep -q "risved-builders"; then
    ok "Builder cron already configured"
    return
  fi

  (crontab -l 2>/dev/null; echo "$cron_line") | crontab -
  ok "Weekly builder image rebuild scheduled (Sunday 03:00)"
}

# ── Main ────────────────────────────────────────────────────────

main() {
  banner

  info "Checking prerequisites..."
  check_root
  detect_os
  check_ram
  check_disk
  check_ports

  printf "\n"
  info "Installing dependencies..."
  install_docker
  install_bun

  printf "\n"
  info "Setting up Risved..."
  setup_directories
  setup_network
  build_builder_images
  start_caddy
  start_risved
  setup_builder_cron

  local server_ip
  server_ip=$(detect_server_ip)

  printf "\n"
  printf "${GREEN}${BOLD}  ✓ Risved installed successfully!${RESET}\n\n"
  printf "  Open your browser to complete setup:\n\n"
  printf "    ${BOLD}http://${server_ip}:${RISVED_PORT}${RESET}\n\n"
  printf "  ${DIM}This will guide you through creating your admin\n"
  printf "  account, configuring your domain, and deploying\n"
  printf "  your first app.${RESET}\n\n"
}

# Allow sourcing without executing (for testing)
if [ "${RISVED_TESTING:-}" != "1" ]; then
  main "$@"
fi
