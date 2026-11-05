# Imagen de `platform`. Base directory en Coolify: raíz del monorepo.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @webdesign/platform... build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /repo/apps/platform/dist ./dist
COPY --from=build /repo/apps/platform/package.json ./
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/node_modules ./node_modules
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/server.js"]
