# Fork deploy and rollback

Deploy with one command from the repo root, on a clean, committed tree:

```sh
tools/deploy.sh              # typecheck + tests, backup, build on the host, switch, smoke check
tools/deploy.sh --dry-run    # everything up to the build, changes nothing on the host
tools/deploy.sh status       # running tag, previous tag, images on the host
tools/deploy.sh rollback     # back to the previous image
```

What it does: ships `git archive HEAD` to the host over ssh, backs up the SQLite DB
(`data/yow.sqlite3.bak-<timestamp>`), builds `yos-local:<short-commit>`, sets that tag in
the compose file (remembering the old one in `.deploy-prev`), runs `docker compose up -d`,
waits for the container's healthcheck, checks that the public `/login` shows the new version
and that `/offline`, `/sw.js` and `/manifest.webmanifest` return 200. If the container does
not become healthy or the smoke check fails it rolls back by itself. It keeps the last 3
images and 5 DB backups. The version shown in the footer comes from `package.json`, so bump
it (see CONTRIBUTING.md) before deploying a user-visible change.

Configure it once: copy `tools/deploy.local.env.example` to `tools/deploy.local.env`
(git-ignored) and set `DEPLOY_HOST` (ssh host), `DEPLOY_DIR` (directory with
`docker-compose.yml`, relative to the ssh home) and `PUBLIC_URL`. The same variables work
from the environment, and `KEEP_IMAGES` / `KEEP_BACKUPS` tune the pruning. The compose file
must reference the image as `image: yos-local:<tag>`.

The notes below are the manual steps the script automates (UI overhaul era), kept for
reference and for a fresh host.

The image is built by the owner on the deploy host; there is no GHCR. The web
bundle is built inside the image (`web` stage), so no local build step is needed.

## Build

Tag every deploy so rollback is a tag switch:

```sh
docker build -f docker/Dockerfile -t yos-local:ui-$(date +%Y%m%d) .
```

## Before deploy

Back up the database. Either stop the container and copy the file:

```sh
cp data/yow.sqlite3 data/yow.sqlite3.bak-$(date +%Y%m%d)
```

or, with the container running,
`sqlite3 data/yow.sqlite3 ".backup data/yow.sqlite3.bak-$(date +%Y%m%d)"`.
Settings, Export Database works as well (or in addition).

No schema migration is part of this effort. The only new DB rows are `settings`
keys `goal:<id>`, which older versions ignore.

## Deploy

Set `image: yos-local:ui-<date>` in the compose file and run `docker compose up -d`.
Add the `compress` middleware to the Traefik router for `scale.example.com`
(gzip for HTML, JSON, JS and CSS), for example:

```yaml
labels:
  - traefik.http.middlewares.yow-compress.compress=true
  - traefik.http.routers.<router>.middlewares=yow-compress
```

(append to any middlewares the router already lists).

## Smoke check

- Log in.
- `/` loads.
- `/users/<id>/overview?range=all` loads.
- `/firmware` works ("Generate Connection Invitation" responds).
- `curl -I https://scale.example.com/assets/<file>` returns 200 with
  `cache-control: public, max-age=31536000, immutable` (take the file name from
  the page source, e.g. `app-*.css`).

## Install as app

Over the https origin the dashboard is installable: desktop Chrome/Edge show an
Install button (address bar, or "Install app" in the footer); on Android use
Install app; on iOS Safari use Share, then Add to Home Screen. The service worker
(`/sw.js`) precaches only hashed `/assets/*`, icons, the manifest and `/offline`;
pages and API responses are never cached. After a deploy the new worker takes
over on the next reload: an "Update available" toast offers Reload, otherwise it
activates once all old tabs are closed. Smoke check:
`curl -sI https://scale.example.com/sw.js` returns 200 with `cache-control: no-cache`
(no login needed for `/sw.js`, `/manifest.webmanifest`, `/offline`, `/icons/*`).

## Rollback

Set the compose image back to the previous tag and run `docker compose up -d`.
The database is compatible in both directions. Restore the `.bak` file only if
a data problem is observed.

## Unchanged

The scale endpoints (`/measure`, `/v2/*`, etc.) are unchanged by this work.
