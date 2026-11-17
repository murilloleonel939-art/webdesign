# Imagen de `llm-gateway`. Coolify: base directory "/", Dockerfile "/apps/llm-gateway/Dockerfile", puerto 3001, healthcheck /healthz.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @webdesign/llm-gateway... build

# pnpm deploy genera una carpeta autocontenida (sin symlinks al monorepo).
FROM build AS bundle
RUN pnpm --filter @webdesign/llm-gateway --prod deploy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=bundle /out ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1
CMD ["node", "dist/server.js"]
