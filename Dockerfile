# Gadget Swap trade-in platform — Node admin/API + Python scraper sidecar.
#
# A Dockerfile is here because Railway's rollout of Railpack as the default
# builder keeps ignoring both nixpacks.toml and the "builder": "NIXPACKS"
# override in railway.json, then auto-detects Python from requirements.txt
# and fails ("No start command detected" — the app is Node, not Python).
# Railway honors a Dockerfile unconditionally, so the build plan stops
# being Railway's guess and becomes this file.
#
# The root package.json's `build` script does its own `npm ci` inside
# trade-in-backend and trade-in-platform (the real package roots) and
# runs Playwright's install:scraper-browser hook, so this file keeps
# it simple: install Python + scrapling, copy source, build, start.

FROM node:20-bookworm-slim

# Python for the scrapling sidecar + a C toolchain for better-sqlite3 / bcrypt
# native builds. Playwright's own apt deps come in through the install:scraper-
# browser step the backend runs during `npm run build`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    build-essential ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps (scrapling + patchright) first so a code-only change does not
# reinstall pip packages. --break-system-packages is required on bookworm
# because Debian 12 ships PEP 668.
COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt

# App source — the root `npm run build` does `npm ci` inside each of the two
# workspaces (backend + platform) and runs the backend's scraper-browser
# install hook on the way through.
COPY . .

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
