#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-5055}"
echo "╔══════════════════════════════════════╗"
echo "║  iHack Audio — AI-Powered Editor     ║"
echo "╚══════════════════════════════════════╝"
echo "🌐 http://localhost:$PORT"
echo "⏹  Ctrl+C to stop"
cd "$SCRIPT_DIR/src"
python3 -m http.server "$PORT"
