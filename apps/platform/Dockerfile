# Imagen de `platform`. Coolify: base directory "/", Dockerfile "/apps/platform/Dockerfile", puerto 3000, healthcheck /healthz.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @webdesign/platform... build

# pnpm deploy genera una carpeta autocontenida (sin symlinks al monorepo).
FROM build AS bundle
RUN pnpm --filter @webdesign/platform --prod deploy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=bundle /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/server.js"]
