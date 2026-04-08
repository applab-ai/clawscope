#!/bin/bash
# Clawscope — Start backend (launchd-compatible)
DIR="$(cd "$(dirname "$0")" && pwd)"

# Kill any existing backend process on port 8000
lsof -ti :8000 | xargs kill -9 2>/dev/null
sleep 1

exec "$DIR/.venv/bin/python" "$DIR/backend/main.py"
