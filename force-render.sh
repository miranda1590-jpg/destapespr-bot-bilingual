#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-main}"
FILE="${2:-server.js}"
RENDER_DEPLOY_HOOK="${RENDER_DEPLOY_HOOK:-}"

ts_utc() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "❌ Falta comando: $1"; exit 1; }
}

require_cmd git
require_cmd sed

if [[ ! -f "$FILE" ]]; then
  echo "❌ No existe el archivo: $FILE"
  echo "➡️  Uso: bash force-render.sh <branch> <archivo>"
  exit 1
fi

git rev-parse --is-inside-work-tree >/dev/null

git checkout "$BRANCH" >/dev/null 2>&1 || git checkout -b "$BRANCH"

STAMP="$(ts_utc)"

if grep -q "DEPLOY_BUMP:" "$FILE"; then
  # macOS sed (BSD) requiere -i '' ; Linux sed (GNU) usa -i
  if sed --version >/dev/null 2>&1; then
    sed -i "s@/\* DEPLOY_BUMP:.*\*/@/* DEPLOY_BUMP: ${STAMP} */@g" "$FILE"
  else
    sed -i '' "s@/\* DEPLOY_BUMP:.*\*/@/* DEPLOY_BUMP: ${STAMP} */@g" "$FILE"
  fi
else
  tmp="$(mktemp)"
  printf "/* DEPLOY_BUMP: %s */\n" "$STAMP" > "$tmp"
  cat "$FILE" >> "$tmp"
  mv "$tmp" "$FILE"
fi

git add "$FILE"

if git diff --cached --quiet; then
  git commit --allow-empty -m "chore: force redeploy ${STAMP}"
else
  git commit -m "chore: force redeploy ${STAMP}"
fi

git push origin "$BRANCH"

echo "✅ Push listo. Render debería redeployear (si está conectado a Git)."

if [[ -n "$RENDER_DEPLOY_HOOK" ]]; then
  require_cmd curl
  echo "🚀 Llamando Deploy Hook de Render..."
  CODE="$(curl -sS -o /tmp/render_hook.txt -w "%{http_code}" -X POST "$RENDER_DEPLOY_HOOK")"
  echo "📡 HTTP: $CODE"
  cat /tmp/render_hook.txt || true
  echo
  if [[ "$CODE" != "200" && "$CODE" != "201" && "$CODE" != "202" ]]; then
    echo "⚠️ Hook no aceptado (HTTP $CODE). Pero el push ya debe disparar el deploy."
  else
    echo "✅ Hook aceptado. Redeploy solicitado."
  fi
fi
