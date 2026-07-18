# syntax=docker/dockerfile:1.7

FROM node:26-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
ENV npm_config_nodedir=/usr/local
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
COPY frontend/tsconfig.json frontend/tsconfig.json
COPY frontend/vite.config.ts frontend/vite.config.ts
COPY frontend/index.html frontend/index.html
COPY frontend/public frontend/public
COPY frontend/src frontend/src
COPY sdk/package.json sdk/package.json
COPY sdk/tsconfig.json sdk/tsconfig.json
COPY sdk/src sdk/src
RUN --mount=type=cache,id=rfq-frontend-corepack,target=/root/.cache \
  --mount=type=cache,id=rfq-frontend-pnpm,target=/root/.local/share/pnpm/store \
  corepack enable \
  && pnpm install --filter @rfq-market-maker/frontend... --frozen-lockfile \
  && pnpm --filter @rfq-market-maker/frontend build

FROM nginx:1.27-alpine AS runtime
RUN rm -f /etc/nginx/conf.d/default.conf
COPY infra/docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
USER nginx
