FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.10.0 --activate
RUN apk add --no-cache python3 make g++

# Copy workspace manifests for install (layer-cache friendly)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/gateway-api/package.json               ./apps/gateway-api/package.json
COPY packages/adapters/package.json              ./packages/adapters/package.json
COPY packages/core/package.json                  ./packages/core/package.json
COPY packages/kafka/package.json                 ./packages/kafka/package.json
COPY packages/redis/package.json                 ./packages/redis/package.json

RUN pnpm install --frozen-lockfile \
  && mkdir -p \
    apps/gateway-api/node_modules \
    packages/adapters/node_modules \
    packages/core/node_modules \
    packages/kafka/node_modules \
    packages/redis/node_modules

# ── build stage ───────────────────────────────────────────────────────────────
FROM deps AS builder

ARG CACHE_BUST=1
COPY tsconfig.base.json                          ./
COPY apps/gateway-api/                           ./apps/gateway-api/
COPY packages/adapters/                          ./packages/adapters/
COPY packages/core/                              ./packages/core/
COPY packages/kafka/                             ./packages/kafka/
COPY packages/redis/                             ./packages/redis/

RUN cd packages/core        && pnpm run build
RUN cd packages/adapters    && pnpm run build
RUN cd packages/kafka       && pnpm run build
RUN cd packages/redis       && pnpm run build
RUN cd apps/gateway-api      && pnpm run build

# ── runtime image ─────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

# pnpm keeps the content-addressable store at root and links deps per-package.
COPY --from=deps /app/node_modules                         ./node_modules
COPY --from=deps /app/apps/gateway-api/node_modules        ./apps/gateway-api/node_modules
COPY --from=deps /app/packages/adapters/node_modules       ./packages/adapters/node_modules
COPY --from=deps /app/packages/core/node_modules           ./packages/core/node_modules
COPY --from=deps /app/packages/kafka/node_modules          ./packages/kafka/node_modules
COPY --from=deps /app/packages/redis/node_modules          ./packages/redis/node_modules

COPY --from=deps /app/package.json                         ./package.json
COPY --from=deps /app/pnpm-workspace.yaml                  ./pnpm-workspace.yaml
COPY --from=deps /app/apps/gateway-api/package.json        ./apps/gateway-api/package.json
COPY --from=deps /app/packages/adapters/package.json       ./packages/adapters/package.json
COPY --from=deps /app/packages/core/package.json           ./packages/core/package.json
COPY --from=deps /app/packages/kafka/package.json          ./packages/kafka/package.json
COPY --from=deps /app/packages/redis/package.json          ./packages/redis/package.json

COPY --from=builder /app/apps/gateway-api/dist             ./apps/gateway-api/dist
COPY --from=builder /app/packages/adapters/dist            ./packages/adapters/dist
COPY --from=builder /app/packages/core/dist                ./packages/core/dist
COPY --from=builder /app/packages/kafka/dist               ./packages/kafka/dist
COPY --from=builder /app/packages/redis/dist               ./packages/redis/dist

WORKDIR /app/apps/gateway-api
EXPOSE 3100
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
