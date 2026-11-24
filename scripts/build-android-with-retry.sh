#!/usr/bin/env bash
# Retry only transient dependency-network errors, never mask compiler failures.
set -euo pipefail
umask 077
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
for attempt in 1 2 3; do
  if "$@" 2>&1 | tee "$log"; then
    exit 0
  else
    status=$?
  fi
  if [ "$attempt" -eq 3 ] || ! grep -Eq 'Received status code (429|502|503|504)|Gradle threw an error while downloading artifacts from the network' "$log"; then
    exit "$status"
  fi
  if [ "$attempt" -eq 1 ]; then delay=45; else delay=120; fi
  echo "Transient dependency download failure; retrying after ${delay}s"
  sleep "$delay"
done
exit 1
