FROM node:22-alpine AS deps

WORKDIR /app

# media-ingest is a standalone JS service — not part of the pnpm workspace
COPY services/media-ingest/package.json  ./package.json
COPY services/media-ingest/package-lock.json ./package-lock.json 2>/dev/null || true

RUN npm ci --omit=dev

# ── runtime image ─────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

COPY --from=deps /app/node_modules       ./node_modules
COPY services/media-ingest/package.json  ./package.json
COPY services/media-ingest/src           ./src

EXPOSE 4000
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/index.js"]
