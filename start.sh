#!/bin/bash
# Clawscope — Start backend (launchd-compatible)
DIR="$(cd "$(dirname "$0")" && pwd)"

exec "$DIR/.venv/bin/python" "$DIR/backend/main.py"
