#!/bin/bash
# Clawscope — Stop backend
DIR="$(cd "$(dirname "$0")" && pwd)"

pkill -f "clawscope/backend/main.py" 2>/dev/null && echo "Backend stopped" || echo "Backend was not running"
