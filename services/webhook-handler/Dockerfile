FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.10.0 --activate

# Copy workspace manifests for install (layer-cache friendly)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY services/webhook-handler/package.json           ./services/webhook-handler/package.json

RUN pnpm install --frozen-lockfile

# ── build stage ───────────────────────────────────────────────────────────────
FROM deps AS builder

COPY tsconfig.base.json                              ./
COPY services/webhook-handler/                       ./services/webhook-handler/

RUN cd services/webhook-handler && pnpm run build

# ── runtime image ─────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

# Carry over node_modules from deps stage (pnpm hoists all deps to root)
COPY --from=deps /app/node_modules                       ./node_modules

# Copy package.json files (needed for workspace package resolution)
COPY --from=deps /app/package.json                       ./package.json
COPY --from=deps /app/pnpm-workspace.yaml                ./pnpm-workspace.yaml
COPY --from=deps /app/services/webhook-handler/package.json ./services/webhook-handler/package.json

# Copy compiled output
COPY --from=builder /app/services/webhook-handler/dist   ./services/webhook-handler/dist

WORKDIR /app/services/webhook-handler
EXPOSE 4004
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
