FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
RUN corepack enable && pnpm install --filter @rfq-market-maker/frontend --prod --frozen-lockfile=false

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY frontend ./frontend
EXPOSE 5173
CMD ["pnpm", "--dir", "frontend", "dev", "--host", "0.0.0.0"]
