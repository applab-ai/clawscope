#!/bin/bash
# Clawscope — Run all collectors
DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="$DIR/.venv/bin/python"
export PATH="/opt/homebrew/bin:$PATH"

echo "=== Collection $(date) ==="
"$PYTHON" "$DIR/backend/collector.py"
"$PYTHON" "$DIR/backend/transcript_collector.py"
"$PYTHON" "$DIR/backend/prompt_collector.py"
echo "=== Done ==="
