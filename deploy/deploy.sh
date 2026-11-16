#!/usr/bin/env bash
set -euo pipefail

# Deploy a prebuilt GitHub Actions release, without touching existing NASQO/WAHA containers.
SHA="${1:?Usage: deploy.sh COMMIT_SHA}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit SHA" >&2; exit 1; }
ROOT="$HOME/apps/nsqo-mobile"
RELEASE="$ROOT/releases/$SHA"
NAME="nsqo-mobile-app"
IMAGE="nsqo-mobile:$SHA"
PORT=18176

test -f "$RELEASE/Dockerfile.deploy"
test -f "$RELEASE/dist/client/index.html"
docker build --pull -t "$IMAGE" -f "$RELEASE/Dockerfile.deploy" "$RELEASE"

# Verify candidate health on a dynamically assigned localhost port before promoting.
CANDIDATE="${NAME}-candidate"
if docker container inspect "$CANDIDATE" >/dev/null 2>&1; then
  echo "Existing candidate container; refusing to overwrite" >&2; exit 1
fi
docker run -d --name "$CANDIDATE" -p 127.0.0.1::3000 "$IMAGE" >/dev/null
cleanup() { docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true; }
trap cleanup EXIT
HOST_PORT="$(docker port "$CANDIDATE" 3000/tcp | head -1 | awk -F: '{print $NF}')"
healthy=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$HOST_PORT/api/health" | grep -q '"ok":true'; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1 || { echo "Candidate health check failed" >&2; docker logs "$CANDIDATE" --tail 40 >&2; exit 1; }
cleanup
trap - EXIT

# Keep the old container stopped but available for rollback until new instance is healthy.
OLD="${NAME}-previous"
if docker container inspect "$OLD" >/dev/null 2>&1; then
  echo "Previous backup container still exists; refusing deployment" >&2; exit 1
fi
had_old=0
if docker container inspect "$NAME" >/dev/null 2>&1; then
  had_old=1
  docker stop "$NAME" >/dev/null
  docker rename "$NAME" "$OLD"
fi
restore_previous() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if [[ "$had_old" = 1 ]]; then
    docker rename "$OLD" "$NAME"
    docker start "$NAME" >/dev/null
  fi
}
if ! docker run -d --name "$NAME" --restart unless-stopped \
  -p "127.0.0.1:$PORT:3000" \
  --env-file "$ROOT/production.env" \
  "$IMAGE" >/dev/null; then
  restore_previous
  exit 1
fi
live=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then live=1; break; fi
  sleep 2
done
if [[ "$live" != 1 ]]; then
  echo "Production health check failed; rolling back" >&2
  restore_previous
  exit 1
fi
if [[ "$had_old" = 1 ]]; then docker rm "$OLD" >/dev/null; fi
printf '%s\n' "$SHA" > "$ROOT/current-release"
echo "Deployed $SHA; listening only on localhost:$PORT"
