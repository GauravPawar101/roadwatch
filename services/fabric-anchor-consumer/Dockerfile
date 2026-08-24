FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.10.0 --activate

# Copy workspace manifests for install (layer-cache friendly)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY services/fabric-anchor-consumer/package.json    ./services/fabric-anchor-consumer/package.json
COPY packages/core/package.json                      ./packages/core/package.json
COPY packages/kafka/package.json                     ./packages/kafka/package.json

# Only install this service + its workspace deps (not the whole monorepo).
# pkcs11js native build is skipped via root .npmrc never-built-dependencies.
RUN pnpm install --frozen-lockfile --filter @roadwatch/fabric-anchor-consumer...

# ── build stage ───────────────────────────────────────────────────────────────
FROM deps AS builder

COPY tsconfig.base.json                              ./
COPY services/fabric-anchor-consumer/                ./services/fabric-anchor-consumer/
COPY packages/core/                                  ./packages/core/
COPY packages/kafka/                                 ./packages/kafka/

RUN cd packages/core         && pnpm run build
RUN cd packages/kafka        && pnpm run build
RUN cd services/fabric-anchor-consumer && pnpm run build

# ── runtime image ─────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init ca-certificates

# pnpm keeps the content-addressable store at root and links deps per-package.
COPY --from=deps /app/node_modules                                      ./node_modules
COPY --from=deps /app/services/fabric-anchor-consumer/node_modules      ./services/fabric-anchor-consumer/node_modules
COPY --from=deps /app/packages/core/node_modules                        ./packages/core/node_modules
COPY --from=deps /app/packages/kafka/node_modules                       ./packages/kafka/node_modules

# Copy package.json files
COPY --from=deps /app/package.json                               ./package.json
COPY --from=deps /app/pnpm-workspace.yaml                        ./pnpm-workspace.yaml
COPY --from=deps /app/services/fabric-anchor-consumer/package.json ./services/fabric-anchor-consumer/package.json
COPY --from=deps /app/packages/core/package.json                 ./packages/core/package.json
COPY --from=deps /app/packages/kafka/package.json                ./packages/kafka/package.json

# Copy compiled output
COPY --from=builder /app/services/fabric-anchor-consumer/dist    ./services/fabric-anchor-consumer/dist
COPY --from=builder /app/packages/core/dist                      ./packages/core/dist
COPY --from=builder /app/packages/kafka/dist                     ./packages/kafka/dist

WORKDIR /app/services/fabric-anchor-consumer
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
