# Local Development Dockerfile - Scheduler
FROM node:22-alpine

WORKDIR /app

# Install pnpm and development tools
RUN corepack enable && corepack prepare pnpm@8.10.0 --activate

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./

# Copy service and dependencies
COPY services/scheduler ./services/scheduler
COPY packages ./packages

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Set working directory to scheduler
WORKDIR /app/services/scheduler

# Expose debug port
EXPOSE 9229

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start scheduler with debug capability
CMD ["node", "--loader", "tsx", "--inspect-brk=0.0.0.0:9229", "index.ts"]
