# YourOwnWeigh server image — one plain-HTTP listener, run behind your own
# reverse proxy. Built by the owner on the deploy host (no GHCR); from the repo
# root:
#   docker build -f docker/Dockerfile -t yow:ui-$(date +%Y%m%d) .
#
# Two stages: `web` builds the Vite bundle (dev dependencies, build time only);
# `runtime` is Node 24 + ws + Node built-ins (node:sqlite), types stripped at
# run time, plus the built web/dist. The server listens on plain HTTP; your
# reverse proxy terminates TLS and forwards to it (see README).
FROM node:24-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
COPY server/ts/analysis ./server/ts/analysis
RUN npm run web:build

FROM node:24-slim AS runtime

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY connectors ./connectors
COPY --from=web /app/web/dist ./web/dist

# Run as the base image's unprivileged `node` user (uid 1000), never root
# (server/ts/local.ts says so, and it avoids root-owned files in the bind mount).
# The bind-mounted ./data on the host must be writable by uid 1000 — see README.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

# One plain-HTTP listener. YOW_TRUST_PROXY=1 lets it bind 0.0.0.0 inside the
# container (no TLS here — the reverse proxy in front terminates it) and makes
# failed-login limits use the proxy's X-Forwarded-For. Publish the port to the
# host loopback only (see docker-compose.yml) so it is reachable just through
# the proxy.
ENV YOW_DB_PATH=/data/yow.sqlite3 \
    YOW_PORT=8080 \
    YOW_LISTEN_HOST=0.0.0.0 \
    YOW_TRUST_PROXY=1 \
    YOW_WEB_DIST=/app/web/dist

EXPOSE 8080
CMD ["node", "--experimental-strip-types", "server/ts/local.ts"]
