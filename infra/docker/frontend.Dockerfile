FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
COPY frontend/tsconfig.json frontend/tsconfig.json
COPY frontend/vite.config.ts frontend/vite.config.ts
COPY frontend/index.html frontend/index.html
COPY frontend/src frontend/src
COPY sdk/package.json sdk/package.json
COPY sdk/tsconfig.json sdk/tsconfig.json
COPY sdk/src sdk/src
ARG VITE_RFQ_API_BASE_URL=http://localhost:3000
ENV VITE_RFQ_API_BASE_URL=$VITE_RFQ_API_BASE_URL
RUN corepack enable \
  && pnpm install --filter @rfq-market-maker/frontend --frozen-lockfile \
  && pnpm --filter @rfq-market-maker/frontend build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
