FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.10.0 --activate

# Copy workspace manifests for install (layer-cache friendly)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY services/scheduler/package.json                 ./services/scheduler/package.json
COPY packages/core/package.json                      ./packages/core/package.json

RUN pnpm install --frozen-lockfile --filter @roadwatch/scheduler... --filter @roadwatch/core

# ── build stage ───────────────────────────────────────────────────────────────
FROM deps AS builder

COPY tsconfig.base.json                              ./
COPY services/scheduler/                             ./services/scheduler/
COPY packages/core/                                  ./packages/core/

RUN cd packages/core && pnpm run build
RUN cd services/scheduler && pnpm run build

# ── runtime image ─────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

# pnpm keeps the content-addressable store at root and links deps per-package.
COPY --from=deps /app/node_modules                         ./node_modules
COPY --from=deps /app/services/scheduler/node_modules      ./services/scheduler/node_modules
COPY --from=deps /app/packages/core/node_modules           ./packages/core/node_modules

# Copy package.json files (needed for workspace package resolution)
COPY --from=deps /app/package.json                   ./package.json
COPY --from=deps /app/pnpm-workspace.yaml            ./pnpm-workspace.yaml
COPY --from=deps /app/services/scheduler/package.json ./services/scheduler/package.json
COPY --from=deps /app/packages/core/package.json     ./packages/core/package.json

# Copy compiled output
COPY --from=builder /app/services/scheduler/dist     ./services/scheduler/dist
COPY --from=builder /app/packages/core/dist          ./packages/core/dist

WORKDIR /app/services/scheduler
EXPOSE 4003
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
