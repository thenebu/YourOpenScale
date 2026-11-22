#!/usr/bin/env bash
# Deploy the current commit to the Docker host and roll back if it does not come up.
#
#   tools/deploy.sh [deploy] [--skip-tests] [--dry-run]
#   tools/deploy.sh rollback
#   tools/deploy.sh status
#
# Flow: clean-tree check, typecheck + tests, ship `git archive HEAD` over ssh, back up the
# SQLite DB, build the image (tag = short commit hash), switch the tag in the compose file,
# `docker compose up -d`, wait for the container, smoke-check the public URL, prune old
# images/backups. Any failure after the switch rolls back to the previous tag automatically.
#
# Settings come from the environment or from tools/deploy.local.env (git-ignored, see
# tools/deploy.local.env.example):
#   DEPLOY_HOST   ssh host that runs the container            (required)
#   DEPLOY_DIR    compose directory on that host (relative to the ssh home) (required)
#   PUBLIC_URL    public origin for the smoke check           (required)
#   KEEP_IMAGES   image tags to keep                          (3)
#   KEEP_BACKUPS  DB backups to keep                          (5)
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[ -f tools/deploy.local.env ] && . tools/deploy.local.env

: "${DEPLOY_HOST:?set DEPLOY_HOST (ssh host), e.g. in tools/deploy.local.env}"
: "${DEPLOY_DIR:?set DEPLOY_DIR (compose directory on the host)}"
: "${PUBLIC_URL:?set PUBLIC_URL (public https origin)}"
HOST="$DEPLOY_HOST"
DIR="$DEPLOY_DIR"
URL="${PUBLIC_URL%/}"
KEEP_IMAGES="${KEEP_IMAGES:-3}"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
CONTAINER="yourownweigh"
IMAGE="yos-local"

cmd="deploy"
skip_tests=0
dry=0
for arg in "$@"; do
  case "$arg" in
    deploy | rollback | status) cmd="$arg" ;;
    --skip-tests) skip_tests=1 ;;
    --dry-run) dry=1 ;;
    -h | --help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
remote() { ssh -o BatchMode=yes "$HOST" "cd '$DIR' && $*"; }

current_tag() { remote "sed -n -E 's#^ *image: *${IMAGE}:([A-Za-z0-9._-]+).*#\\1#p' docker-compose.yml | head -1"; }

# Wait until the container is running and, when the image defines a healthcheck, healthy.
wait_ready() {
  local i state
  for i in $(seq 1 30); do
    state="$(remote "docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' $CONTAINER" 2>/dev/null || echo missing)"
    case "$state" in
      "running healthy") return 0 ;;
      "running nohealth") [ "$i" -ge 3 ] && return 0 ;;   # old image without HEALTHCHECK: 6 s of staying up
      "exited "* | "dead "*) return 1 ;;
    esac
    sleep 2
  done
  return 1
}

smoke() {
  local want="$1" code
  curl -fsS --max-time 15 "$URL/login" | grep -q "v$want" || { echo "login page does not show v$want"; return 1; }
  for path in /offline /sw.js /manifest.webmanifest; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$URL$path")"
    [ "$code" = "200" ] || { echo "$path returned $code"; return 1; }
  done
}

switch_to() {
  local tag="$1"
  remote "sed -i -E 's#(image: *${IMAGE}:)[A-Za-z0-9._-]+#\\1${tag}#' docker-compose.yml && docker compose up -d"
}

rollback() {
  local prev
  prev="$(remote 'cat .deploy-prev 2>/dev/null || true')"
  [ -n "$prev" ] || die "no previous tag recorded (.deploy-prev); roll back by hand"
  say "Rolling back to $IMAGE:$prev"
  remote "docker image inspect ${IMAGE}:${prev} >/dev/null" || die "image $IMAGE:$prev no longer exists on $HOST"
  switch_to "$prev"
  wait_ready || die "rollback container did not become ready"
  echo "Rolled back to $prev."
}

case "$cmd" in
  status)
    echo "running tag : $(current_tag)"
    remote "docker ps --filter name=$CONTAINER --format '{{.Image}} {{.Status}}'; echo \"previous    : \$(cat .deploy-prev 2>/dev/null || echo -)\"; docker images $IMAGE --format '{{.Tag}} {{.CreatedSince}}'"
    exit 0
    ;;
  rollback)
    rollback
    exit 0
    ;;
esac

# ---- deploy ----
git diff --quiet HEAD -- . || die "uncommitted changes to tracked files; commit first (the image tag is the commit hash)"
tag="$(git rev-parse --short HEAD)"
version="$(node -p "require('./package.json').version")"
prev="$(current_tag)"
[ -n "$prev" ] || die "could not read the current image tag from $HOST:$DIR/docker-compose.yml"
say "Deploying $tag (v$version) to $HOST:$DIR; currently running: $prev"
[ "$prev" = "$tag" ] && die "$tag is already deployed"

if [ "$skip_tests" = 0 ]; then
  say "Typecheck and tests"
  npm run -s server:typecheck
  npm run -s server:test >/dev/null
  echo "ok"
fi

if [ "$dry" = 1 ]; then
  say "Dry run: would back up the DB, build $IMAGE:$tag on $HOST, switch from $prev and smoke-check $URL"
  exit 0
fi

build="build-yow-$tag"
say "Uploading source"
ssh -o BatchMode=yes "$HOST" "rm -rf ~/$build && mkdir ~/$build"
git archive HEAD | ssh -o BatchMode=yes "$HOST" "tar -x -C ~/$build"

say "Backing up the database"
backup="data/yow.sqlite3.bak-$(date +%Y%m%d-%H%M%S)"
remote "sqlite3 data/yow.sqlite3 \".backup $backup\" && ls -la $backup"

say "Building image $IMAGE:$tag (on $HOST)"
remote "docker build -q -f ~/$build/docker/Dockerfile -t ${IMAGE}:${tag} ~/$build"
ssh -o BatchMode=yes "$HOST" "rm -rf ~/$build"

say "Switching to $tag"
remote "cp docker-compose.yml docker-compose.yml.bak-prev && echo '$prev' > .deploy-prev"
switch_to "$tag"

if ! wait_ready; then
  echo "Container did not become ready; last log lines:" >&2
  remote "docker logs --tail 20 $CONTAINER" >&2 || true
  rollback
  die "deploy of $tag failed and was rolled back to $prev"
fi

say "Smoke check $URL"
if ! smoke "$version"; then
  rollback
  die "smoke check failed; rolled back to $prev"
fi

say "Pruning (keep $KEEP_IMAGES images, $KEEP_BACKUPS backups)"
remote "docker images $IMAGE --format '{{.Tag}}' | grep -v -x -e '$tag' -e '$prev' | tail -n +\$(( $KEEP_IMAGES - 1 )) | xargs -r -I{} docker rmi ${IMAGE}:{} >/dev/null; ls -1t data/yow.sqlite3.bak-* 2>/dev/null | tail -n +$(( KEEP_BACKUPS + 1 )) | xargs -r rm -f --; true"

say "Done: $IMAGE:$tag (v$version) is live, previous was $prev. 'tools/deploy.sh rollback' returns to it."
