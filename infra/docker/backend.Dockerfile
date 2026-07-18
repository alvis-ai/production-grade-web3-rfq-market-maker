FROM node:26-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY sdk/package.json sdk/package.json
RUN corepack enable \
  && pnpm install --filter @rfq-market-maker/backend... --frozen-lockfile --no-optional
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
COPY sdk/tsconfig.json sdk/tsconfig.json
COPY sdk/src sdk/src
RUN pnpm --filter @rfq-market-maker/sdk build \
  && pnpm --filter @rfq-market-maker/backend build

FROM node:26-alpine AS runtime
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
COPY --from=build /app/sdk/dist ./sdk/dist
COPY scripts/chainlink-integration-check.mjs scripts/chainlink-integration-check.mjs
COPY scripts/aws-kms-integration-check.mjs scripts/aws-kms-integration-check.mjs
COPY scripts/target-api-quote-integration-check.mjs scripts/target-api-quote-integration-check.mjs
COPY scripts/target-settlement-integration-check.mjs scripts/target-settlement-integration-check.mjs
COPY scripts/quote-issuance-redis-integration-check.mjs scripts/quote-issuance-redis-integration-check.mjs
EXPOSE 3000 3001 3002 3003 3004 3005 3006
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
USER node
CMD ["node", "backend/dist/main.js"]
