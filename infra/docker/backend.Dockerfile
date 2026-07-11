FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
COPY sdk/package.json sdk/package.json
COPY sdk/tsconfig.json sdk/tsconfig.json
COPY sdk/src sdk/src
RUN corepack enable \
  && pnpm install --filter @rfq-market-maker/backend... --frozen-lockfile --no-optional \
  && pnpm --filter @rfq-market-maker/backend build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY sdk/package.json sdk/package.json
RUN corepack enable && pnpm install --filter @rfq-market-maker/backend... --prod --frozen-lockfile --no-optional
COPY --from=build /app/backend/dist ./backend/dist
COPY sdk/src sdk/src
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "backend/dist/main.js"]
