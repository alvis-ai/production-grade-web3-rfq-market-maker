FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
RUN corepack enable \
  && pnpm install --filter @rfq-market-maker/backend --frozen-lockfile \
  && pnpm --filter @rfq-market-maker/backend build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
RUN corepack enable && pnpm install --filter @rfq-market-maker/backend --prod --frozen-lockfile
COPY --from=build /app/backend/dist ./backend/dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "backend/dist/main.js"]
