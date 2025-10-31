#!/usr/bin/env bash
# Run in a git clone of the project. Creates a single patch file for the last commit.
set -e
BRANCH=${1:-chore/ci-docs}
MSG=${2:-"chore: apply workspace changes"}

echo "Creating branch $BRANCH and commit..."
git checkout -b "$BRANCH"
git add .
git commit -m "$MSG"

OUT=../destapespr-changes-$(date +%Y%m%dT%H%M%S).patch
git format-patch -1 HEAD --stdout > "$OUT"

echo "Patch created: $OUT"

echo "To apply in another repo: git am < $OUT"
