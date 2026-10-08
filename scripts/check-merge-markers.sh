#!/usr/bin/env bash
set -euo pipefail
if rg -n "^(<<<<<<<|=======|>>>>>>>)" apps docs; then
  echo "Merge markers detected"
  exit 1
fi
