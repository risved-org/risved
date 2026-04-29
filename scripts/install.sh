#!/usr/bin/env bash
# Risved Installation Script
# Usage: curl -fsSL https://risved.org/install | bash
#
# Installs Docker, Bun, and Risved on Ubuntu/Debian.
# Idempotent — safe to re-run.

set -euo pipefail

RISVED_VERSION="${RISVED_VERSION:-latest}"
RISVED_DISPLAY_VERSION="$RISVED_VERSION"
if [ "$RISVED_DISPLAY_VERSION" = "latest" ]; then
  RISVED_DISPLAY_VERSION=$(curl -fsSL --max-time 5 "https://api.github.com/repos/risved-org/risved/tags?per_page=1" 2>/dev/null \
    | grep '"name"' | head -1 | cut -d'"' -f4 | sed 's/^v//') || true
  RISVED_DISPLAY_VERSION="${RISVED_DISPLAY_VERSION:-latest}"
fi
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
  printf "\n"
  printf "  ${GREEN}    ▲${RESET}       ${BOLD}Risved${RESET} v${RISVED_DISPLAY_VERSION}\n"
  printf "  ${GREEN}   ▲█▲${RESET}      ${DIM}Deploy from here${RESET}\n"
  printf "  ${GREEN}  ▲███▲${RESET}\n"
  printf "  ${GREEN} ▲█████▲${RESET}\n"
  printf "  ${GREEN}    █${RESET}\n\n"
}

# ── Checks ──────────────────────────────────────────────────────

check_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fatal "This script must be run as root. Try: sudo bash -c 'curl -fsSL https://risved.org/install | bash'"
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
    # Allow if the port is held by an existing Risved container
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^risved-"; then
      return 0
    fi
    fatal "Port $port is already in use. Risved needs ports 80 and 443 for HTTPS."
  fi
}

check_ports() {
  check_port 80
  check_port 443
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^risved-"; then
    ok "Ports 80 and 443 in use by existing Risved install"
  else
    ok "Ports 80 and 443 are available"
  fi
}

# ── Installers ──────────────────────────────────────────────────

install_docker() {
  if command -v docker >/dev/null 2>&1; then
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
  if command -v bun >/dev/null 2>&1; then
    ok "Bun already installed: $(bun --version)"
    return
  fi

  info "Installing Bun..."
  if ! command -v unzip >/dev/null 2>&1; then
    apt-get install -y -qq unzip >/dev/null
  fi
  local tmp_installer bun_log
  tmp_installer=$(mktemp)
  bun_log=$(mktemp)
  curl -fsSL https://bun.sh/install -o "$tmp_installer"
  BUN_INSTALL="$HOME/.bun" bash "$tmp_installer" </dev/null >"$bun_log" 2>&1 || true
  rm -f "$tmp_installer"
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun >/dev/null 2>&1; then
    err "Bun installer output:"
    cat "$bun_log" >&2
    rm -f "$bun_log"
    fatal "Bun installation failed"
  fi
  rm -f "$bun_log"

  ok "Bun installed: $(bun --version)"
}

# ── Setup ───────────────────────────────────────────────────────

setup_network() {
  if docker network inspect "$RISVED_DOCKER_NETWORK" >/dev/null 2>&1; then
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

  # Write a Caddyfile that exposes the admin API on all interfaces
  # so the control plane container can reach it over the Docker network
  mkdir -p "$RISVED_DATA_DIR/caddy"
  rm -rf "$RISVED_DATA_DIR/caddy/Caddyfile"
  rm -f "$RISVED_DATA_DIR/caddy/config/caddy/autosave.json"
  cat > "$RISVED_DATA_DIR/caddy/Caddyfile" <<'CADDYEOF'
{
	admin 0.0.0.0:2019
}
CADDYEOF

  docker run -d \
    --name "$container_name" \
    --network "$RISVED_DOCKER_NETWORK" \
    --restart unless-stopped \
    --add-host host.docker.internal:host-gateway \
    -p 80:80 \
    -p 443:443 \
    -p 2019:2019 \
    -v "$RISVED_DATA_DIR/caddy/data:/data" \
    -v "$RISVED_DATA_DIR/caddy/config:/config" \
    -v "$RISVED_DATA_DIR/caddy/Caddyfile:/etc/caddy/Caddyfile" \
    "$CADDY_IMAGE" \
    caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

  # Wait for Caddy to be ready
  local retries=0
  while [ $retries -lt 15 ]; do
    if docker exec "$container_name" wget -qO- http://localhost:2019/config/ >/dev/null 2>&1; then
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

  # Generate a secret if one doesn't exist yet
  local secret_file="$RISVED_DATA_DIR/data/.auth-secret"
  if [ ! -f "$secret_file" ]; then
    openssl rand -hex 32 > "$secret_file"
    chmod 600 "$secret_file"
  fi
  local auth_secret
  auth_secret=$(cat "$secret_file")

  docker run -d \
    --name "$container_name" \
    --network "$RISVED_DOCKER_NETWORK" \
    --restart unless-stopped \
    -p "${RISVED_PORT}:3000" \
    -e "DATABASE_URL=file:data/risved.db" \
    -e "BETTER_AUTH_SECRET=${auth_secret}" \
    -e "ORIGIN=http://$(format_ip_url "$(detect_server_ip)"):${RISVED_PORT}" \
    -e "CADDY_ADMIN_URL=http://risved-caddy:2019" \
    -v "$RISVED_DATA_DIR/data:/app/data" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    "ghcr.io/risved-org/risved:${RISVED_VERSION#v}" >/dev/null 2>&1 || true

  ok "Risved control plane started"
}

detect_server_ip() {
  local ip
  # Try IPv4 first, then fall back to any public IP
  ip=$(curl -4 -fsSL --max-time 5 https://ifconfig.me 2>/dev/null) \
    || ip=$(curl -fsSL --max-time 5 https://ifconfig.me 2>/dev/null) \
    || ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null) \
    || ip=$(hostname -I | awk '{print $1}') \
    || ip="<server-ip>"
  echo "$ip"
}

# Format IP for use in URLs (wrap IPv6 in brackets)
format_ip_url() {
  local ip="$1"
  if echo "$ip" | grep -q ':'; then
    echo "[${ip}]"
  else
    echo "$ip"
  fi
}

fetch_builder_scripts() {
  local builder_dir="$RISVED_DATA_DIR/scripts/builders"
  local tag="v${RISVED_DISPLAY_VERSION}"
  local base_url="https://raw.githubusercontent.com/risved-org/risved/${tag}/scripts/builders"

  if [ "$RISVED_DISPLAY_VERSION" = "latest" ]; then
    warn "Could not resolve version, skipping builder scripts download"
    return
  fi

  if [ -f "$builder_dir/build.sh" ]; then
    ok "Builder scripts already present"
    return
  fi

  info "Downloading builder scripts..."
  mkdir -p "$builder_dir"
  local files="build.sh node.Dockerfile bun.Dockerfile node-build.Dockerfile"
  for f in $files; do
    curl -fsSL "$base_url/$f" -o "$builder_dir/$f" || true
  done
  chmod +x "$builder_dir/build.sh"
  ok "Builder scripts downloaded"
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
  start_caddy
  start_risved

  local server_ip
  server_ip=$(detect_server_ip)

  printf "\n"
  printf "${GREEN}${BOLD}  ✓ Risved installed successfully!${RESET}\n\n"
  printf "  Open your browser to complete setup:\n\n"
  printf "    ${BOLD}http://$(format_ip_url "$server_ip"):${RISVED_PORT}${RESET}\n\n"
  printf "  ${DIM}This will guide you through creating your admin\n"
  printf "  account, configuring your domain, and deploying\n"
  printf "  your first app.${RESET}\n\n"

  # Build pre-warmed builder images in the background
  info "Building builder images in the background..."
  (fetch_builder_scripts && build_builder_images && setup_builder_cron) >/dev/null 2>&1 &
}

# Allow sourcing without executing (for testing)
if [ "${RISVED_TESTING:-}" != "1" ]; then
  main "$@"
fi
