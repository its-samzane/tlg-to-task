#!/usr/bin/env bash
# Deploys tlg-to-task to a server over SSH and runs it with PM2.
#
# Usage:
#   DEPLOY_HOST=bot.example.com scripts/deploy.sh [--setup]
#
# Environment:
#   DEPLOY_HOST       server address (required)
#   DEPLOY_USER       SSH user (default: root)
#   DEPLOY_PORT       SSH port (default: 22)
#   DEPLOY_PASSWORD   SSH password; uses sshpass when set (default: key-based authentication)
#   DEPLOY_PATH       application directory on the server (default: /opt/tlg-to-task)
#   DEPLOY_REPO       git repository to clone (default: https://github.com/its-samzane/tlg-to-task.git)
#   DEPLOY_BRANCH     branch to deploy (default: main)
#   DEPLOY_ENV_FILE   local .env whose variables are merged into the server's .env (optional)
#   SKIP_BACKUP=1     skip the database dump that normally runs before migrations
#
# --setup runs scripts/setup-server.sh first (Node.js, PM2, PostgreSQL, database, DATABASE_URL).
set -euo pipefail

HOST="${DEPLOY_HOST:?DEPLOY_HOST is required}"
USER_NAME="${DEPLOY_USER:-root}"
PORT="${DEPLOY_PORT:-22}"
APP_DIR="${DEPLOY_PATH:-/opt/tlg-to-task}"
REPO="${DEPLOY_REPO:-https://github.com/its-samzane/tlg-to-task.git}"
BRANCH="${DEPLOY_BRANCH:-main}"
ENV_FILE="${DEPLOY_ENV_FILE:-}"
SETUP=0
[ "${1:-}" = "--setup" ] && SETUP=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_OPTS=(-p "$PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
SSH=(ssh "${SSH_OPTS[@]}" "$USER_NAME@$HOST")
SCP=(scp -P "$PORT" -o StrictHostKeyChecking=accept-new)
if [ -n "${DEPLOY_PASSWORD:-}" ]; then
  command -v sshpass >/dev/null || { echo "DEPLOY_PASSWORD is set but sshpass is not installed." >&2; exit 1; }
  export SSHPASS="$DEPLOY_PASSWORD"
  SSH=(sshpass -e "${SSH[@]}" -o PreferredAuthentications=password -o PubkeyAuthentication=no)
  SCP=(sshpass -e "${SCP[@]}" -o PreferredAuthentications=password -o PubkeyAuthentication=no)
fi

log() { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }

if [ "$SETUP" -eq 1 ]; then
  log "Preparing the server"
  "${SSH[@]}" "bash -s -- '$APP_DIR'" <"$SCRIPT_DIR/setup-server.sh"
fi

log "Fetching $BRANCH into $APP_DIR"
"${SSH[@]}" bash -s <<REMOTE
set -euo pipefail
if [ ! -d "$APP_DIR/.git" ]; then
  mkdir -p "$APP_DIR"
  git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
else
  cd "$APP_DIR"
  git remote set-url origin "$REPO"
  git fetch --quiet --prune origin
  git checkout --quiet "$BRANCH" 2>/dev/null || git checkout --quiet -b "$BRANCH" "origin/$BRANCH"
  git reset --quiet --hard "origin/$BRANCH"
fi
cd "$APP_DIR" && echo "at commit \$(git rev-parse --short HEAD)"
REMOTE

if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || { echo "DEPLOY_ENV_FILE $ENV_FILE does not exist." >&2; exit 1; }
  log "Merging $ENV_FILE into $APP_DIR/.env"
  "${SCP[@]}" "$ENV_FILE" "$USER_NAME@$HOST:$APP_DIR/.env.upload"
  "${SSH[@]}" bash -s <<REMOTE
set -euo pipefail
cd "$APP_DIR"
touch .env
# Variables in the uploaded file replace existing ones; other existing variables are kept.
awk -F= '
  FNR == NR { if (\$0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) { uploaded[\$1] = \$0 } ; order[++n] = \$1; next }
  /^[A-Za-z_][A-Za-z0-9_]*=/ && (\$1 in uploaded) { next }
  { print }
  END { for (i = 1; i <= n; i++) if (order[i] in uploaded && !(order[i] in printed)) { print uploaded[order[i]]; printed[order[i]] = 1 } }
' .env.upload .env >.env.merged
mv .env.merged .env
rm -f .env.upload
chmod 600 .env
REMOTE
fi

log "Installing dependencies and building"
"${SSH[@]}" bash -s <<REMOTE
set -euo pipefail
cd "$APP_DIR"
[ -f .env ] || { echo ".env is missing in $APP_DIR. Run with --setup and/or DEPLOY_ENV_FILE." >&2; exit 1; }
grep -q '^TELEGRAM_BOT_TOKEN=.\+' .env || { echo "TELEGRAM_BOT_TOKEN is not set in $APP_DIR/.env" >&2; exit 1; }
grep -q '^DATABASE_URL=.\+' .env || { echo "DATABASE_URL is not set in $APP_DIR/.env" >&2; exit 1; }
npm ci --no-audit --no-fund --loglevel=error
npm run -s build
npm prune --omit=dev --no-audit --no-fund --loglevel=error
mkdir -p storage backups
REMOTE

if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  log "Backing up the database before migrations"
  "${SSH[@]}" bash -s <<REMOTE
set -euo pipefail
cd "$APP_DIR"
if ! command -v pg_dump >/dev/null; then echo "pg_dump not found; set SKIP_BACKUP=1 to deploy without a backup." >&2; exit 1; fi
url="\$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"\$//')"
file="backups/db-\$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
pg_dump "\$url" | gzip >"\$file"
ls -1t backups/db-*.sql.gz | tail -n +11 | xargs -r rm -f
echo "backup written to \$file"
REMOTE
fi

log "Starting with PM2 (migrations run on startup)"
"${SSH[@]}" bash -s <<REMOTE
set -euo pipefail
cd "$APP_DIR"
pm2 startOrReload ecosystem.config.cjs --update-env >/dev/null
pm2 save >/dev/null
sleep 3
pm2 describe tlg-to-task | grep -E 'status|restarts|uptime' || true
echo "--- recent log ---"
pm2 logs tlg-to-task --nostream --lines 15 2>/dev/null | tail -n 20
REMOTE

log "Done."
