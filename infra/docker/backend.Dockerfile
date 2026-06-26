FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
RUN corepack enable \
  && pnpm install --filter @rfq-market-maker/backend --frozen-lockfile=false \
  && pnpm --filter @rfq-market-maker/backend build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
RUN corepack enable && pnpm install --filter @rfq-market-maker/backend --prod --frozen-lockfile=false
COPY --from=build /app/backend/dist ./backend/dist
EXPOSE 3000
CMD ["node", "backend/dist/main.js"]
