# Validación del borde de hosting — Fase 2, primera tarea

Estado: pendiente de ejecución en un entorno Coolify de prueba (§5.2).
Las pruebas de texto del Caddyfile no validan el servidor ni la convivencia con Traefik.

## Validación previa de Caddy

Ejecutar en una máquina con Docker desde la raíz del repositorio:

```sh
docker compose -f deploy/caddy/compose.test.yaml run --rm validate
```

Este servicio valida el Caddyfile con Caddy 2.10.2, sin publicar puertos.
Solo comprueba la configuración; no sustituye las comprobaciones HTTP y de convivencia siguientes.

## Punto de creación del nuevo contenedor

El siguiente recurso en Coolify es una aplicación Dockerfile llamada `caddy`, en el entorno de prueba.
Usar el mismo repositorio, contexto `/`, Dockerfile `/deploy/caddy/Dockerfile`, puerto interno 80.
La imagen copia y valida el Caddyfile durante el build. No publicar puertos 80/443 del host.
No asignar todavía un dominio público ni habilitar el comodín de sitios.

Antes de desplegar: montar el directorio real de datos del servidor en `/data` como solo lectura;
el mismo directorio debe estar disponible en platform con escritura. No usar volúmenes distintos
para ambos servicios. Montar almacenamiento persistente independiente en `/caddy-data`.
Conectar Caddy, platform y el proxy mediante la red de prueba; verificar que el nombre `platform`
resuelve desde Caddy y que Traefik puede alcanzar el servicio de Caddy por su nombre real.
No asumir que el nombre visible del recurso de Coolify es su nombre DNS en Docker.

No se ha creado este recurso. Confirmar primero rutas de almacenamiento, red y nombres efectivos;
después aplicar las comprobaciones siguientes antes de activar tráfico de clientes.

## Preparación

1. Registrar versión de Coolify y Traefik y respaldar la configuración del proxy.
2. Mantener Traefik como único proceso que publica 80/443; conservar todos sus routers.
3. Desplegar una aplicación de ejemplo accesible directamente, sin Cloudflare.
4. Registrar su respuesta HTTP/HTTPS antes de añadir rutas de la plataforma.
5. Disponer de un hostname de prueba del pool proxificado por Cloudflare y certificados de origen.

## Configuración a validar

- Montar un directorio adicional del proveedor de archivos dinámicos de Traefik.
- Conectar Traefik con Caddy y platform por una red privada compartida.
- Caddy escucha únicamente en la red interna; no publicar sus puertos en el host.
- Montar `deploy/caddy/Caddyfile` como configuración de Caddy.
- Montar `/data` en Caddy en modo lectura y `/caddy-data` en un volumen independiente.
- Crear una release de prueba y el enlace `/data/hosts/<hostname>` hacia `/data/sites/<siteId>/public`.
- Añadir rutas de aplicación y vista previa hacia platform.
- Añadir el router comodín de sitios con prioridad 1 hacia Caddy.
- Aplicar `ipAllowList` con los rangos vigentes de Cloudflare al router de sitios.
- Aplicar Authenticated Origin Pulls exclusivamente a las rutas de sitios.
- Añadir el certificado Origin CA sin reemplazar el resolver ACME de Coolify.
- Usar Full (strict) en Cloudflare para pool y vista previa.

## Aceptación en el entorno de prueba

| Comprobación | Resultado exigido |
| --- | --- |
| App de ejemplo sin Cloudflare | Misma respuesta y HTTPS válido antes y después |
| Host del pool vía Cloudflare | HTML de la release activa |
| `/assets/` de la release | Bytes correctos y MIME correspondiente |
| Página anidada | Resuelve su HTML y assets desde `/assets/` |
| Host inexistente | 404 con la misma respuesta que un sitio apagado |
| Retirar enlace del host | Deja de servir contenido; purgar caché y comprobar en menos de un minuto |
| Entrada directa al origen para un sitio | Rechazada por la restricción de Cloudflare/mTLS |
| Otras apps de Coolify | Conservan sus routers y no requieren certificado de cliente |
| Cambio de release y rollback | HTML y assets corresponden a la versión seleccionada |
| Datos privados | `/caddy-data`, configuración y secretos nunca son accesibles |

Guardar fecha, versiones, hosts de prueba, comandos ejecutados y resultados sin credenciales.
No marcar esta puerta como superada sin evidencias del entorno real.

## Recuperación y decisión

Ante una regresión, retirar únicamente los archivos dinámicos añadidos y comprobar la app de ejemplo.
Si la versión instalada no admite el proveedor de archivos, documentar el resultado en un ADR.
Evaluar la alternativa de Caddy como borde solo en servidor dedicado o tras confirmar que ninguna
otra app necesita los puertos públicos; no reemplazar el proxy compartido automáticamente.
