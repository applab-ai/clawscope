#!/bin/bash
# Clawscope — Start backend
DIR="$(cd "$(dirname "$0")" && pwd)"

# Kill any existing backend process on port 8000
lsof -ti :8000 | xargs kill -9 2>/dev/null
sleep 1

if [ -t 0 ] && [ -z "$LAUNCHED_BY_LAUNCHD" ]; then
  # Interactive terminal — run in background
  nohup "$DIR/.venv/bin/python" "$DIR/backend/main.py" > "$DIR/backend.log" 2>&1 &
  sleep 2
  if lsof -ti :8000 > /dev/null 2>&1; then
    echo "Backend started (PID $!, log: $DIR/backend.log)"
  else
    echo "ERROR: Backend failed to start. Check $DIR/backend.log"
    tail -5 "$DIR/backend.log"
  fi
else
  # LaunchAgent — stay in foreground
  exec "$DIR/.venv/bin/python" "$DIR/backend/main.py"
fi
