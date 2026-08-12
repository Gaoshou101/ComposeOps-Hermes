# syntax=docker/dockerfile:1

# ---------- Stage 1: build the Vue frontend ----------
FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Output: /app/frontend/dist (hash-history SPA, no server rewrites needed)
RUN npm run build


# ---------- Stage 2: install backend deps + compile native modules ----------
# better-sqlite3 ships N-API prebuilds; fall back to source build if absent.
FROM node:22-bookworm-slim AS backend-build

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci


# ---------- Stage 3: runtime ----------
# Node 22 base (matches local dev v22) + docker CLI + compose plugin
# (compose route spawns `docker compose` as a child process).
FROM node:22-bookworm-slim AS runtime

# docker CLI + compose v2 plugin (for the /compose control route)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" \
        > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Native node_modules (better-sqlite3 compiled for this base) then source
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY backend/ ./

# Built frontend, placed so index.js staticRoot (backend/src/../../frontend/dist) resolves
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# SQLite lives here by default (DB_PATH = backend/src/lib/../../data/opsdash.db).
# Persist this dir via a volume in docker-compose.yml to keep AI config + history.
RUN mkdir -p /app/backend/data

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    SERVE_FRONTEND=1

EXPOSE 3001

# No API keys in env — AI config is entered via the Settings UI and stored in SQLite.
CMD ["node", "src/index.js"]
