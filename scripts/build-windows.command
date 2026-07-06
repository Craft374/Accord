#!/bin/zsh
set -e

cd "$(dirname "$0")/.."

echo "Accord Windows x64 build"
echo "------------------------"
npm run build:win
node scripts/prune-dist.js

echo ""
echo "Done:"
echo "dist/Accord Windows x64 Portable.exe"
echo ""
read -k 1 "?Press any key to close..."
