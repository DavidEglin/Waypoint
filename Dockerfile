# syntax=docker/dockerfile:1

# Node 24 is the current LTS. Tests pass on it (and on 26).
ARG NODE_VERSION=24


# ---- 1. Build: install everything, compile the client and the server ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

# Manifests first so the dependency layer is cached until they change.
# --ignore-scripts: the native modules (better-sqlite3, argon2) ship prebuilt
# binaries, so no install scripts or compiler are needed.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
RUN npm run build


# ---- 2. Production dependencies only (no TypeScript, Vite, Vitest...) ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
M
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --ignore-scripts --workspace=@waypoint/server


# ---- 3. The image you run ----
FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    CLIENT_DIR=/app/client/dist

# The server is bundled (shared code included); only third-party packages come from node_modules.
COPY --from=deps  /app/node_modules  node_modules
COPY --from=build /app/server/dist   server/dist
COPY --from=build /app/client/dist   client/dist

# /data holds db/ (SQLite) and uploads/. Mount a host folder or volume here.
# It must be writable by the "node" user (uid 1000).
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3000

# The app answers only to ALLOWED_HOST, so the check has to send that Host header.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT,path:'/api/health',headers:{host:process.env.ALLOWED_HOST}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/dist/main.js"]
