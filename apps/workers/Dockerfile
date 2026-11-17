# Imagen de `workers` (Fase 4). Coolify: base directory "/", Dockerfile
# "/apps/workers/Dockerfile". No expone puerto: consume la cola del lint visual.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @webdesign/workers... build

# pnpm deploy genera una carpeta autocontenida (sin symlinks al monorepo).
FROM build AS bundle
RUN pnpm --filter @webdesign/workers --prod deploy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=bundle /out ./
USER node
CMD ["node", "dist/main.js"]
