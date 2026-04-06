#!/bin/bash
set -e

# Clawscope — One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/applab-ai/clawscope/main/get.sh | bash

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

REPO="https://github.com/applab-ai/clawscope.git"
INSTALL_DIR="${CLAWSCOPE_DIR:-$HOME/.openclaw/clawscope}"

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  🔬 Clawscope — Installer${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Preflight
for cmd in git python3 node npm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo -e "${RED}✗ $cmd not found.${NC} Please install it first."
    exit 1
  fi
done

# Clone or update
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "  ${YELLOW}Updating existing installation...${NC}"
  cd "$INSTALL_DIR"
  git pull --ff-only
else
  echo -e "  Cloning Clawscope → ${INSTALL_DIR}"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

echo

# Hand off to the full installer
exec bash "$INSTALL_DIR/install.sh" "$@"
