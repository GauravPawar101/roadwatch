FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.10.0 --activate

# Copy workspace manifests for install (layer-cache friendly)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY services/webhook-handler/package.json           ./services/webhook-handler/package.json
COPY packages/redis/package.json                     ./packages/redis/package.json

RUN pnpm install --frozen-lockfile --filter @roadwatch/webhook-handler... --filter @roadwatch/redis

# ── build stage ───────────────────────────────────────────────────────────────
FROM deps AS builder

COPY tsconfig.base.json                              ./
COPY services/webhook-handler/                       ./services/webhook-handler/
COPY packages/redis/                                 ./packages/redis/

RUN cd packages/redis && pnpm run build
RUN cd services/webhook-handler && pnpm run build

# ── runtime image ─────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

# pnpm keeps the content-addressable store at root and links deps per-package.
COPY --from=deps /app/node_modules                              ./node_modules
COPY --from=deps /app/services/webhook-handler/node_modules     ./services/webhook-handler/node_modules
COPY --from=deps /app/packages/redis/node_modules              ./packages/redis/node_modules

# Copy package.json files (needed for workspace package resolution)
COPY --from=deps /app/package.json                       ./package.json
COPY --from=deps /app/pnpm-workspace.yaml                ./pnpm-workspace.yaml
COPY --from=deps /app/services/webhook-handler/package.json ./services/webhook-handler/package.json
COPY --from=deps /app/packages/redis/package.json         ./packages/redis/package.json

# Copy compiled output
COPY --from=builder /app/services/webhook-handler/dist   ./services/webhook-handler/dist
COPY --from=builder /app/packages/redis/dist             ./packages/redis/dist

WORKDIR /app/services/webhook-handler
EXPOSE 4004
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
