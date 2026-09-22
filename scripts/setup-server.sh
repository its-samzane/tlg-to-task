#!/usr/bin/env bash
# Prepares a Debian/Ubuntu server for tlg-to-task: Node.js 22, PM2, PostgreSQL, a dedicated
# database role and an .env file holding DATABASE_URL. Idempotent: safe to run again.
#
# Usage (as root on the server):
#   bash scripts/setup-server.sh [APP_DIR]
#
# Environment overrides:
#   DB_NAME   database name   (default: tlg_to_task)
#   DB_USER   database role   (default: tlg_to_task)
#   DB_HOST   host written into DATABASE_URL (default: 127.0.0.1)
#   DB_PORT   port written into DATABASE_URL (default: 5432)
set -euo pipefail

APP_DIR="${1:-/opt/tlg-to-task}"
DB_NAME="${DB_NAME:-tlg_to_task}"
DB_USER="${DB_USER:-tlg_to_task}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
ENV_FILE="$APP_DIR/.env"

log() { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must run as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  log "Installing Node.js 22"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs >/dev/null
else
  log "Node.js $(node -v) already installed"
fi

if ! command -v git >/dev/null 2>&1; then
  log "Installing git"
  apt-get install -y -qq git >/dev/null
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2"
  npm install -g pm2 >/dev/null
else
  log "PM2 $(pm2 -v | tail -1) already installed"
fi

if ! command -v psql >/dev/null 2>&1; then
  log "Installing PostgreSQL"
  apt-get update -qq
  apt-get install -y -qq postgresql >/dev/null
  systemctl enable --now postgresql >/dev/null 2>&1 || true
else
  log "PostgreSQL client found: $(psql --version)"
fi

mkdir -p "$APP_DIR"

# Database role and database. The password is generated once and stored only in .env.
role_exists() { sudo -u postgres psql -Atc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -q 1; }
db_exists() { sudo -u postgres psql -Atc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; }

if [ -f "$ENV_FILE" ] && grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  log "DATABASE_URL already present in $ENV_FILE, keeping the existing database credentials"
  if ! role_exists; then
    echo "Role $DB_USER does not exist but DATABASE_URL is set; remove the line to recreate it." >&2
    exit 1
  fi
else
  # od reads a fixed number of bytes, so no process in the pipeline is killed early (pipefail-safe).
  DB_PASSWORD="$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')"
  if role_exists; then
    log "Resetting password of existing role $DB_USER"
    sudo -u postgres psql -v ON_ERROR_STOP=1 -qc "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASSWORD'"
  else
    log "Creating role $DB_USER"
    sudo -u postgres psql -v ON_ERROR_STOP=1 -qc "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASSWORD'"
  fi
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  printf 'DATABASE_URL=postgres://%s:%s@%s:%s/%s\n' "$DB_USER" "$DB_PASSWORD" "$DB_HOST" "$DB_PORT" "$DB_NAME" >>"$ENV_FILE"
  log "DATABASE_URL written to $ENV_FILE"
fi

if db_exists; then
  log "Database $DB_NAME already exists"
else
  log "Creating database $DB_NAME"
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

if ! systemctl list-unit-files 2>/dev/null | grep -q '^pm2-root.service'; then
  log "Registering PM2 to start on boot"
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
fi

log "Server is ready. Application directory: $APP_DIR"
log "Next: fill in the remaining variables in $ENV_FILE (see .env.example) and run scripts/deploy.sh."
