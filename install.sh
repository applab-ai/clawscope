#!/bin/bash
set -e

# Clawscope — Interactive Installer
# Usage: bash install.sh [--no-service] [--defaults]

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

NO_SERVICE=false
USE_DEFAULTS=false
for arg in "$@"; do
  case "$arg" in
    --no-service) NO_SERVICE=true ;;
    --defaults) USE_DEFAULTS=true ;;
  esac
done

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  🔬 Clawscope — Installer${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# ── Preflight ─────────────────────────────────────────

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "${RED}✗ $1 not found.${NC} $2"
    exit 1
  fi
}

check_cmd python3 "Install Python 3.9+: brew install python"
check_cmd node "Install Node.js 18+: brew install node"
check_cmd npm "Comes with Node.js"

# Check OpenClaw
if command -v openclaw &>/dev/null; then
  OC_VERSION=$(openclaw --version 2>/dev/null || echo "unknown")
  echo -e "  OpenClaw:  ${GREEN}${OC_VERSION}${NC}"
else
  echo -e "  OpenClaw:  ${YELLOW}not found${NC} — dashboard will start but data collection requires OpenClaw"
fi

PYTHON_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
NODE_VER=$(node -v | sed 's/v//')
echo -e "  Python:    ${GREEN}${PYTHON_VER}${NC}"
echo -e "  Node.js:   ${GREEN}${NODE_VER}${NC}"
echo

# ── Interactive Config ────────────────────────────────

if [ ! -f "$DIR/config.yaml" ]; then
  echo -e "${BOLD}[Setup] Configuration${NC}"
  echo -e "  No config.yaml found — let's create one.\n"

  # Port
  if [ "$USE_DEFAULTS" = true ]; then
    PORT=8000
  else
    read -p "  Port [8000]: " PORT
    PORT=${PORT:-8000}
  fi

  # Host
  if [ "$USE_DEFAULTS" = true ]; then
    HOST="0.0.0.0"
  else
    read -p "  Bind address [0.0.0.0]: " HOST
    HOST=${HOST:-0.0.0.0}
  fi

  # Password
  if [ "$USE_DEFAULTS" = true ]; then
    PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(16))")
  else
    read -sp "  Dashboard password (Enter to generate): " PASSWORD
    echo
    if [ -z "$PASSWORD" ]; then
      PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(16))")
    fi
  fi
  echo -e "  ${CYAN}Password:${NC} $PASSWORD"

  # Secret key (auto-generated)
  SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")

  # OpenClaw paths
  DEFAULT_SESSIONS="~/.openclaw/agents/main/sessions"
  DEFAULT_AGENTS="~/.openclaw/agents"
  if [ "$USE_DEFAULTS" = true ]; then
    SESSIONS_DIR="$DEFAULT_SESSIONS"
    AGENTS_BASE="$DEFAULT_AGENTS"
  else
    echo
    read -p "  OpenClaw sessions dir [$DEFAULT_SESSIONS]: " SESSIONS_DIR
    SESSIONS_DIR=${SESSIONS_DIR:-$DEFAULT_SESSIONS}
    read -p "  OpenClaw agents base [$DEFAULT_AGENTS]: " AGENTS_BASE
    AGENTS_BASE=${AGENTS_BASE:-$DEFAULT_AGENTS}
  fi

  # Users
  echo
  echo -e "  ${CYAN}Add users${NC} (sender IDs from Telegram/Discord/etc.)"
  echo -e "  Leave empty to skip — you can add users later in config.yaml"
  USERS=""
  USER_NUM=1
  while true; do
    if [ "$USE_DEFAULTS" = true ]; then break; fi
    read -p "  User $USER_NUM sender ID (or Enter to finish): " SENDER_ID
    if [ -z "$SENDER_ID" ]; then break; fi
    read -p "  User $USER_NUM display name: " DISPLAY_NAME
    read -p "  User $USER_NUM category [user]: " CATEGORY
    CATEGORY=${CATEGORY:-user}
    USERS="${USERS}\n- id: '${SENDER_ID}'\n  name: ${DISPLAY_NAME}\n  category: ${CATEGORY}"
    USER_NUM=$((USER_NUM + 1))
  done

  # Write config
  cat > "$DIR/config.yaml" <<EOF
server:
  host: ${HOST}
  port: ${PORT}

auth:
  password: ${PASSWORD}
  secret_key: ${SECRET_KEY}
  token_expire_hours: 24

paths:
  sessions_dir: ${SESSIONS_DIR}
  agents_base: ${AGENTS_BASE}

users:
$(if [ -n "$USERS" ]; then echo -e "$USERS"; else echo "# - id: '123456789'\n#   name: Alice\n#   category: user"; fi)

known_sessions: {}

api_key_labels: {}

default_pricing:
  input: 3
  output: 15
  cache_write: 3.75
  cache_read: 0.3

model_pricing:
  claude-opus-4-6:
    input: 5
    output: 25
    cache_write: 6.25
    cache_read: 0.5
  claude-sonnet-4-6:
    input: 3
    output: 15
    cache_write: 3.75
    cache_read: 0.3
  claude-haiku-4-5:
    input: 1
    output: 5
    cache_write: 1.25
    cache_read: 0.1

user_categories:
  cron: Crons
  subagent: Subagents
  unknown: Subagents
EOF

  echo -e "\n  ${GREEN}✓ config.yaml created${NC}"
  echo
else
  echo -e "  ${GREEN}✓ config.yaml exists${NC}"
  # Read port from existing config for LaunchAgent
  PORT=$(python3 -c "import yaml; c=yaml.safe_load(open('$DIR/config.yaml')); print(c.get('server',{}).get('port',8000))" 2>/dev/null || echo "8000")
  echo
fi

# ── Backend ───────────────────────────────────────────

echo -e "${BOLD}[1/4] Python dependencies${NC}"
if [ ! -d "$DIR/.venv" ]; then
  python3 -m venv "$DIR/.venv"
  echo "  Created .venv"
else
  echo "  .venv exists"
fi
"$DIR/.venv/bin/pip" install -q --upgrade pip 2>/dev/null
"$DIR/.venv/bin/pip" install -q -r "$DIR/backend/requirements.txt"
echo -e "  ${GREEN}✓ Backend ready${NC}"
echo

# ── Frontend ──────────────────────────────────────────

echo -e "${BOLD}[2/4] Frontend build${NC}"
cd "$DIR/frontend"
if [ ! -d "node_modules" ]; then
  npm install --silent 2>&1 | tail -1
else
  npm ci --silent 2>&1 | tail -1
fi
npx vite build 2>&1 | grep -v "^$" | tail -3
echo -e "  ${GREEN}✓ Frontend built${NC}"
cd "$DIR"
echo

# ── Database ──────────────────────────────────────────

echo -e "${BOLD}[3/4] Database${NC}"
mkdir -p "$DIR/data"
"$DIR/.venv/bin/python" -c "
import sys; sys.path.insert(0, '$DIR/backend')
from db import create_tables
create_tables()
print('  Tables created/verified')
"
echo -e "  ${GREEN}✓ Database ready${NC}"
echo

# ── LaunchAgent (macOS) ───────────────────────────────

echo -e "${BOLD}[4/4] Auto-start service${NC}"

PLIST_ID="ai.openclaw.clawscope"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_ID}.plist"
COLLECTOR_ID="ai.openclaw.clawscope-collector"
COLLECTOR_PLIST="$HOME/Library/LaunchAgents/${COLLECTOR_ID}.plist"

install_launchagent() {
  cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_ID}</string>
  <key>WorkingDirectory</key><string>${DIR}</string>
  <key>ProgramArguments</key>
  <array><string>${DIR}/start.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${DIR}/data/dashboard.log</string>
  <key>StandardErrorPath</key><string>${DIR}/data/dashboard.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST

  cat > "$COLLECTOR_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${COLLECTOR_ID}</string>
  <key>WorkingDirectory</key><string>${DIR}</string>
  <key>ProgramArguments</key>
  <array><string>${DIR}/collect.sh</string></array>
  <key>StartInterval</key><integer>1800</integer>
  <key>StandardOutPath</key><string>${DIR}/data/collector.log</string>
  <key>StandardErrorPath</key><string>${DIR}/data/collector.log</string>
</dict>
</plist>
PLIST

  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)" "$COLLECTOR_PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  launchctl bootstrap "gui/$(id -u)" "$COLLECTOR_PLIST"
  echo -e "  ${GREEN}✓ LaunchAgents installed — Clawscope starts on login${NC}"
}

if [ "$NO_SERVICE" = true ]; then
  echo -e "  ${YELLOW}Skipped${NC} (--no-service)"
elif [[ "$(uname)" != "Darwin" ]]; then
  echo -e "  ${YELLOW}Skipped${NC} (not macOS — start manually with: bash start.sh)"
else
  read -p "  Start Clawscope automatically on login? [Y/n] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    install_launchagent
  else
    echo -e "  ${YELLOW}Skipped${NC}"
  fi
fi

# ── Done ──────────────────────────────────────────────

echo
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ Clawscope installed!${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "  Dashboard:   ${CYAN}http://localhost:${PORT}${NC}"
echo -e "  Config:      ${DIR}/config.yaml"
echo -e "  Start:       bash start.sh"
echo -e "  Stop:        bash stop.sh"
echo -e "  Collect:     bash collect.sh"
echo
echo -e "  ${YELLOW}Next steps:${NC}"
echo -e "  1. Edit config.yaml (users, API key labels, model pricing)"
echo -e "  2. Run ${CYAN}bash collect.sh${NC} to populate initial data"
echo -e "  3. Open ${CYAN}http://localhost:${PORT}${NC} and log in"
echo
