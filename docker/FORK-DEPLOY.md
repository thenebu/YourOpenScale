# Fork deploy and rollback (UI overhaul)

The image is built by the owner on the deploy host; there is no GHCR. The web
bundle is built inside the image (`web` stage), so no local build step is needed.

## Build

Tag every deploy so rollback is a tag switch:

```sh
docker build -f docker/Dockerfile -t yow:ui-$(date +%Y%m%d) .
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

Set `image: yow:ui-<date>` in the compose file and run `docker compose up -d`.
Add the `compress` middleware to the Traefik router for `waage.schuessler.cloud`
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
- `curl -I https://waage.schuessler.cloud/assets/<file>` returns 200 with
  `cache-control: public, max-age=31536000, immutable` (take the file name from
  the page source, e.g. `app-*.css`).

## Rollback

Set the compose image back to the previous tag and run `docker compose up -d`.
The database is compatible in both directions. Restore the `.bak` file only if
a data problem is observed.

## Unchanged

The scale endpoints (`/measure`, `/v2/*`, etc.) are unchanged by this work.
