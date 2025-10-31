#!/usr/bin/env bash
# Helper to start the server and the bot locally.
# - Copies .env.example to .env if .env is missing (prompting the user)
# - Starts the Express server with `npm run dev` in the background
# - Starts `bot.js` in the background if present

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo ".env not found. You can create one from .env.example"
  read -p "Copy .env.example to .env now? [y/N] " copyenv
  if [[ "$copyenv" =~ ^[Yy]$ ]]; then
    cp .env.example .env
    echo "Created .env from .env.example — please edit sensitive values before continuing."
  else
    echo "Aborting. Create a .env file and re-run this script." >&2
    exit 1
  fi
fi

echo "Starting server (nodemon) in background..."
npm run dev &
SERVER_PID=$!
echo "Server started (pid: $SERVER_PID)"

if [ -f bot.js ]; then
  echo "Starting bot.js in background..."
  node bot.js &
  BOT_PID=$!
  echo "Bot started (pid: $BOT_PID)"
else
  echo "No bot.js found in repo root. If you have a Venom-based bot, place it at ./bot.js or run it separately."
  echo "To run only the server, open: http://localhost:3000/"
fi

echo "To stop both processes: kill $SERVER_PID ${BOT_PID-}" 
