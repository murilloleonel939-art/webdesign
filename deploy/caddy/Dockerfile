# Coolify: contexto del repositorio /, Dockerfile /deploy/caddy/Dockerfile.
FROM caddy:2.10.2-alpine
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
RUN caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile > /tmp/config.json \
    && caddy validate --config /tmp/config.json \
    && rm /tmp/config.json
EXPOSE 80
