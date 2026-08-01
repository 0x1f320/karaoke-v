#!/bin/sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$(uname)" != "Darwin" ]; then
  echo "macos-helper: skipping native build (macOS only)"
  exit 0
fi

# Builds against the Node ABI (compile check + node usage). The Electron runtime
# needs an ABI-matched rebuild — apps/karaoke-v runs @electron/rebuild before dev/start.
cd "$DIR"
node-gyp rebuild
echo "macos-helper: built stick.node"
