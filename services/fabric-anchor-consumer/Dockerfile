# Local Development Dockerfile - Fabric Anchor Consumer
FROM node:22-alpine

WORKDIR /app

# Install pnpm and development tools
RUN corepack enable && corepack prepare pnpm@8.10.0 --activate

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init ca-certificates python3 make g++

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./

# Copy service and dependencies
COPY services/fabric-anchor-consumer ./services/fabric-anchor-consumer
COPY packages ./packages
COPY providers ./providers

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Set working directory to fabric-anchor-consumer
WORKDIR /app/services/fabric-anchor-consumer

# Expose debug port
EXPOSE 9229

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start fabric-anchor-consumer with debug capability
CMD ["node", "--loader", "tsx", "--inspect-brk=0.0.0.0:9229", "index.ts"]
