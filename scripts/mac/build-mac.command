#!/bin/zsh
set -euo pipefail

cd "${0:A:h}/../.."

pause() {
  echo ""
  read -k 1 "?Press any key to close..."
  echo ""
}

on_error() {
  local code=$?
  echo ""
  echo "Build failed. exit code: $code"
  echo "Check the message above."
  pause
  exit "$code"
}

trap on_error ERR

echo "Accord Mac arm64 build"
echo "----------------------"

if [[ ! -f package.json ]]; then
  echo "package.json not found."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "node_modules not found. Run npm install first."
  exit 1
fi

npm run build:mac
node scripts/prune-dist.js

if [[ ! -f "dist/Accord Mac arm64.zip" ]]; then
  echo "Build output not found: dist/Accord Mac arm64.zip"
  exit 1
fi

echo ""
echo "Done:"
echo "dist/Accord Mac arm64.zip"
pause
