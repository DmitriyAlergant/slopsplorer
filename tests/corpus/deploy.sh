#!/usr/bin/env bash
# Deploy the built artifact.
set -euo pipefail

TARGET="${1:-staging}"   # trailing comment

publish() {
  echo "pushing to # not a comment"
  if [[ "$TARGET" == "prod" ]]; then
    echo "prod"
  fi
}

publish
