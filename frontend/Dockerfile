FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.10.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY .npmrc ./
COPY frontend ./frontend
COPY packages ./packages

RUN pnpm install --frozen-lockfile --filter roadwatch-frontend...

WORKDIR /app/frontend
ARG VITE_API_BASE=http://localhost:3100
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm build

FROM nginx:1.25-alpine
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
