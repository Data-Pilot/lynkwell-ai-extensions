#!/bin/sh
# Run ReachAI API from this folder (after npm install and .env configured).
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  echo "Missing .env — run:  cp .env.example .env  then edit credentials."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi
exec node index.js
