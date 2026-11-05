## 4. Almacenamiento y publicación

### 4.1 Dónde vive cada dato

**PostgreSQL:** borrador (`site_drafts`), versiones inmutables (`site_versions`), checkpoints y todo el estado. Así el control de concurrencia, RLS y los backups son coherentes entre sí.

**Disco:**

```
/data/incoming/<uploadId>          # subidas sin procesar (escribe platform, lee workers)
/data/sites/<siteId>/
├── uploads/<assetId>.<ext>        # imágenes optimizadas (fuente de verdad de imágenes)
├── releases/v<N>/                 # HTML generado e inmutable de cada versión publicada
│   ├── index.html, <slug>/index.html
│   ├── sitemap.xml, robots.txt
│   └── assets/                    # hardlinks a uploads usados + CSS, JS mínimo y fuentes
└── public -> releases/v<N>        # enlace simbólico a la versión activa
/data/hosts/<hostname> -> /data/sites/<siteId>/public
```

- Cada release es autocontenido: incluye sus imágenes (hardlinks desde `uploads/`, mismo sistema de archivos), sus fuentes y su CSS. Un rollback recupera exactamente lo que se publicó.
- `/data/hosts/` tiene un enlace por hostname activo. Caddy resuelve host a carpeta sin consultar la base de datos. Suspender un sitio es borrar sus enlaces y purgar la caché (sección 5.6).

**Montajes por servicio (mínimo privilegio):**

| Servicio | `/data/incoming` | `/data/sites` | `/data/hosts` |
| --- | --- | --- | --- |
| `platform` | lectura y escritura | solo lectura (vista previa de imágenes) | sin montar |
| `workers` | lectura y escritura | lectura y escritura | lectura y escritura |
| `caddy` | sin montar | solo lectura | solo lectura |
| resto | sin montar | sin montar | sin montar |

Los datos propios de Caddy se montan en `/caddy-data`, **nunca bajo `/data`**, para que ninguna ruta servida pueda alcanzarlos.

### 4.2 Reglas de almacenamiento

- Todo acceso a disco pasa por el paquete `storage` (`read`, `write`, `list`, `delete`, `hardlink`, `atomicSwap`), de modo que se pueda cambiar a S3 o a varios servidores sin tocar el resto.
- **Obligatorio:** el `siteId` es un UUID del sistema y los nombres de archivo de assets son `assetId` generados. Nunca se usan nombres escritos por el usuario como ruta. Toda ruta resuelta (con `realpath`) debe quedar dentro de `/data/sites/<siteId>/`; pruebas específicas de path traversal, enlaces simbólicos maliciosos y nombres Unicode.
- Subidas: tipo comprobado por contenido (no por extensión), solo formatos de imagen permitidos, sin SVG del usuario (o SVG saneado y servido como imagen), límite de tamaño y de píxeles (protección contra bombas de descompresión), metadatos EXIF eliminados.
- Cuotas de disco por sitio, calculadas al subir. **No hay límite de número de páginas**; los límites son de peso (20 MB por página y el total de assets de 14.1), de imágenes y de vídeos subidos.
- Conservar los últimos 20 releases por sitio (configurable) y limpiar los demás con `maintenance`. Las versiones en Postgres se conservan según la misma política.
- Disco de datos separado del sistema si es posible, con alerta al 80 % de uso.

### 4.3 Flujo de publicación

1. Toda edición, manual o de un agente, escribe solo en el borrador, con control optimista por `draft_rev` (una escritura con revisión vieja falla y el cliente recarga o fusiona).
2. La vista previa renderiza el borrador con el mismo `renderer` que la publicación, en el **dominio de vista previa** (sección 5.5).
3. Al pulsar **Publicar**, la API comprueba tres cosas y encola un trabajo en `publish` con la revisión del borrador: que la suscripción del sitio esté `active`, en `grace` (4 días, cuenta con plan suscrito) o en `trial` (7 días desde la creación de la cuenta) si es publicación en subdominio del pool; que el sitio no esté suspendido; y que cumpla las cuotas de 14.1. Si la publicación va a un dominio propio, la suscripción debe estar estrictamente `active`. Una cuenta cuyo `trial` terminó sin pago no publica y su sitio ya está apagado.
4. El worker toma el candado del sitio y:
   1. valida el JSON contra el esquema (y migra si es de una versión anterior);
   2. ejecuta el linter estático (sección 6.4), el linter visual (sección 6.5) y la revisión automática de contenido (sección 10.1); solo detienen la publicación los hallazgos `error` de esquema de 6.4 y los de contenido de 10.1; los `error` de 6.5 y todos los `warning` se muestran al dueño, que decide si publica igual, y la decisión queda en `audit_log`;
   3. inserta `site_versions` (N) con el documento y su hash;
   4. genera el HTML en `releases/v<N>.tmp/`, crea los hardlinks de assets y renombra a `releases/v<N>/`;
   5. crea un enlace temporal y lo renombra sobre `public` (cambio atómico);
   6. actualiza `sites.published_version` en una transacción; si falla, revierte el enlace;
   7. purga la caché de Cloudflare de los hostnames del sitio;
   8. registra en `usage_events` la cantidad de páginas de la versión publicada (unidad de cobro);
   9. si el complemento de atención está activo, encola la reindexación del conocimiento del sitio.
5. **Rollback:** repuntar `public` a un release anterior existente, actualizar la versión activa y purgar la caché.
6. **Reconciliación:** al arrancar y cada hora, `maintenance` compara `published_version` con el destino de `public` y los enlaces de `/data/hosts` con los dominios activos; corrige y alerta las diferencias.
7. El panel muestra «Tienes cambios sin publicar» cuando el hash del borrador difiere del de la versión activa.

### 4.4 Ediciones de agentes y del dueño a la vez

- Mientras un agente de diseño trabaja sobre un sitio, el editor queda en solo lectura con un aviso y un botón «Detener agente». La vista previa muestra el progreso.
- Antes de empezar, el agente crea un checkpoint automático. Al terminar, el dueño ve las diferencias y puede aceptar o «Deshacer todo» (revertir al checkpoint).
- Un agente solo puede tener una ejecución activa por sitio.

## 5. Dominios, borde y TLS

### 5.1 Familias de dominios

| Familia | Ejemplo | Sirve | Quién responde |
| --- | --- | --- | --- |
| Aplicación | `app.plataforma.com`, `api.plataforma.com` | Panel, editor, API, auth | `platform` |
| Sitios (pool) | `<sub>.sitios-a.com`, `<sub>.sitios-b.com` | Sitios publicados | `caddy` |
| Vista previa | `<token>.vistaprevia.com` | Borradores renderizados | `platform` (solo la ruta de vista previa) |
| Dominios propios | `www.cafe-siete.com` | Sitios publicados | `caddy` |

Ninguna cookie de sesión de la aplicación es válida en las familias de sitios o de vista previa. Ningún recurso de un sitio se carga desde un host común de la plataforma.

### 5.2 Borde de red

**Esta decisión se prueba el primer día de la Fase 2, antes de construir nada más sobre ella; es la primera tarea de la fase, no una validación al margen.** Todo el tráfico entra por el **proxy de Cloudflare**.

**Diseño elegido (no depende de tocar el borde global de Coolify):**

- **Traefik de Coolify sigue siendo el único proceso en 80/443 y conserva su configuración por defecto.** No se desactiva su proveedor Docker ni se le quita ningún router existente; el resto de aplicaciones desplegadas en el mismo servidor con Coolify siguen funcionando exactamente igual.
- Se añaden **routers y un middleware adicionales** mediante proveedor de archivo dinámico de Traefik (un directorio montado con `.yml`, sin tocar la base de datos de Coolify): un router para los hostnames de la aplicación y de vista previa hacia `platform`, y un router comodín de **prioridad mínima** (`priority: 1`) hacia `caddy:80` que solo captura lo que ningún otro router de Coolify reclama.
- Esto convive con cualquier otra app de Coolify porque Traefik resuelve primero los routers de mayor prioridad (los que Coolify genera para otras apps) y el comodín solo actúa como última opción. Si dos apps definieran el mismo hostname habría conflicto, pero eso ya sería un conflicto sin esta plataforma; los hostnames de sitios (pool y dominios propios) son exclusivos de esta plataforma y no chocan con nada.
- TLS: Traefik usa el `resolver` de ACME de Coolify para la aplicación (como cualquier otra app) y un **certificado de origen de Cloudflare** (Origin CA, comodín por dominio del pool y de vista previa) cargado como `tls.certificates` adicional del proveedor de archivo, solo para los hostnames de sitios. No reemplaza el `tls.certResolver` que usan otras apps.
- **Authenticated Origin Pulls** (mTLS de Cloudflare hacia el origen) se activa **solo en los routers de sitios añadidos**, no de forma global, para no exigir certificado de cliente a quienes entran por otras apps de Coolify sin pasar por Cloudflare.
- Firewall del servidor: en lugar de bloquear 80/443 globalmente (lo que rompería apps de Coolify sin Cloudflare delante), se filtra por hostname dentro de Traefik: los routers de sitios exigen `ClientIP` de los rangos publicados por Cloudflare mediante un middleware `ipAllowList`; el resto de routers de Coolify no se tocan.
- La IP real del visitante se toma de `CF-Connecting-IP` **solo** en las rutas de sitios, donde el `ipAllowList` ya garantiza que la petición viene de Cloudflare.
- Cloudflare en modo SSL **Full (strict)** para los dominios del pool y de vista previa.

**Procedimiento de validación (día 1, Fase 2):** desplegar el proveedor de archivo dinámico en un entorno de prueba de Coolify junto con una app de ejemplo sin Cloudflare; confirmar que la app de ejemplo sigue accesible igual que antes y que un hostname de prueba del pool resuelve por `caddy`. Si Coolify no admite un proveedor de archivo dinámico en la versión instalada, la alternativa (b) de abajo es el valor por defecto inmediato, sin bloquear la fase.

**Alternativa (b), si (a) no es viable:** Caddy como único borde en 80/443, con el proveedor Docker de Traefik limitado a una red distinta o desactivado solo para los puertos públicos, y `reverse_proxy` hacia `platform` para la aplicación. Esto sí puede afectar a otras apps de Coolify que dependan de Traefik en esos puertos; solo se adopta si el servidor es dedicado a esta plataforma o si se confirma que ninguna otra app lo necesita. Se documenta con un ADR en cualquiera de los dos casos.

### 5.3 Subdominios del pool

**Cómo funciona una petición, de principio a fin:**

1. El navegador pide `cliente1.sitios-a.com`. La zona `sitios-a.com` está en Cloudflare con **un único registro comodín `*.sitios-a.com` proxied**. Ese comodín cubre todos los subdominios de primer nivel: no se crea un registro por sitio.
2. Cloudflare termina el TLS del visitante (Universal SSL ya incluye el comodín) y reenvía la petición al origen con `Host: cliente1.sitios-a.com`, usando el certificado de origen comodín instalado en Traefik.
3. Traefik aplica el router comodín de sitios y pasa a `caddy:80`.
4. **Caddy no resuelve DNS, no pide certificados y no consulta la base de datos.** Lee el `Host`, valida que es un nombre DNS correcto y sirve `/data/hosts/cliente1.sitios-a.com`, que es un enlace al sitio.

**Consecuencias:**

- **Una sola llamada a la API de DNS de Cloudflare por dominio del pool**, al darlo de alta. Crear, publicar o borrar un sitio **no toca la API de DNS**.
- Las únicas llamadas por sitio son la **purga de caché** al publicar y al apagar, y el alta de hostnames personalizados de 5.4.
- Si se quisiera un registro por sitio habría que crear y borrar registros en cada alta y baja, con reintentos y sincronización con `/data/hosts/`. No es el diseño elegido: el comodín es más simple y falla menos.

- Tabla `site_domain_pool` (`zone_id`, `domain`, `capacity`, `used`, `status`). Cada dominio aloja como máximo `capacity` sitios (por defecto 180, política propia para limitar el daño si un dominio se marca por abuso). Al 80 % de uso se alerta al operador para añadir otro dominio (paso manual con checklist en `docs/runbooks/`).
- Subdominios reservados no asignables: `app`, `api`, `www`, `admin`, `mail`, `status`, `support`, `login`, nombres de marcas conocidas y una lista mantenida de términos sensibles (banco, pago, verificación, etc.).
- Un subdominio liberado no se reasigna hasta pasados 90 días.

### 5.4 Dominios propios

**El dominio del cliente se queda donde esté registrado.** No se le pide crear una cuenta de Cloudflare, ni cambiar de registrador, ni mover sus nameservers. Da igual que el dominio esté en GoDaddy, Namecheap, Donweb, Hostinger, Cloudflare o cualquier otro: la plataforma funciona de la misma forma en todos.

#### 5.4.1 Qué se le pide al cliente

Un solo registro en su proveedor: **un `CNAME` hacia `origin.sitios-saas.com`** (nuestro *fallback origin*). Nada más.

- El `CNAME` no apunta a la IP del servidor. **Nunca se publica ni se entrega la IP del origen.** El tráfico entra siempre por el proxy de Cloudflare, que aporta WAF, rate limiting y ocultación del origen.
- El certificado del dominio personalizado lo emite y renueva Cloudflare **en nuestra cuenta**, no en la del cliente. El cliente no gestiona certificados ni tiene que activar nada en Cloudflare.
- Cloudflare for SaaS solo necesita que el hostname resuelva hacia el fallback origin. No requiere transferir el dominio ni cambiar los nameservers del cliente.

#### 5.4.2 Qué hace la plataforma

1. El dueño escribe el dominio en el panel. `workers` crea el hostname personalizado en Cloudflare por API (token solo en `workers`, con permiso únicamente sobre hostnames personalizados de esa zona).
2. **Verificación de propiedad obligatoria:** el dueño crea un registro TXT `_plataforma-verify.<hostname>` con el token por sitio que muestra el panel. Sin TXT válido el dominio no se activa, aunque el `CNAME` ya apunte a la plataforma. Esto impide reclamar dominios ajenos y el secuestro de `CNAME` colgados.
3. El job `dns` comprueba TXT y `CNAME` con reintentos y backoff (cada 48 h, hasta 7 días).
4. Al activarse, el worker crea el enlace en `/data/hosts/<hostname>`. **Caddy no habla con Cloudflare**: solo recibe el `Host` y sirve la carpeta enlazada.
5. Estados: `pending`, `verifying`, `active`, `error`, `removed`.
6. HTTPS forzado en Cloudflare y redirección raíz/`www` según la preferencia del dueño.
7. Al quitar un dominio o borrar un sitio: se borra el hostname en Cloudflare y el enlace local. Reconectar el mismo hostname a otro sitio exige un TXT nuevo.

#### 5.4.3 El dominio raíz (`cliente.com` sin `www`)

Aquí está la única dificultad real del flujo, y **no depende de Cloudflare sino del proveedor del cliente**: la raíz de una zona no admite `CNAME` por norma DNS. Caminos, en orden de preferencia:

| Camino | Cuándo aplica | Qué hace el cliente |
| --- | --- | --- |
| 1. `ALIAS` / `ANAME` / CNAME flattening | El proveedor lo soporta (Cloudflare, DNSimple, Route 53 alias, algunos más) | Crea el registro especial en la raíz hacia `origin.sitios-saas.com` |
| 2. Apex Proxying de Cloudflare for SaaS | El proveedor no soporta lo anterior y se contrata esta función (de pago) | Crea un registro `A` normal hacia los prefijos de IP que le damos, que sí admite la raíz |
| 3. Solo `www` con redirección | Ninguna de las dos está disponible | Apunta `www` con `CNAME` y configura en su proveedor la redirección de la raíz hacia `www` |

- El camino 2 lo paga y lo configura la plataforma; el cliente solo copia un registro `A`. Confirma el plan contratado antes de prometerlo.
- **Valor por defecto:** el panel detecta el proveedor del dominio (por sus nameservers), aplica el camino 1 si lo soporta, el 3 si no, y muestra el 2 solo si está contratado.
- Verificar los tres caminos en la Fase 3 con dominios reales en GoDaddy, Namecheap y Cloudflare. Es el punto con más abandonos del flujo de dominio propio.

#### 5.4.4 Si más adelante se descarta Cloudflare for SaaS

Alternativa, solo si se decide abandonarla: el cliente apunta un registro `A` a la IP del servidor y el borde usa TLS bajo demanda con un endpoint `ask` que solo autoriza hostnames `active` en `domains`. Implica publicar la IP del origen, renunciar a WAF y rate limiting de Cloudflare en esos dominios y añadir emisión de certificados por hostname. No es el valor por defecto y requiere ADR.

**Punto a validar en la Fase 3:** cómo valida Cloudflare el certificado de origen para hostnames personalizados en modo estricto. Valor por defecto: Full (strict) si el certificado de origen del fallback origin es aceptado; si no, Full con Authenticated Origin Pulls (el tramo Cloudflare–origen queda cifrado y autenticado por mTLS). Se documenta con un ADR.

### 5.5 Vista previa

**La vista previa aislada se construye en dos variantes desde la Fase 1, no una sola dependiente de la Fase 2:**

- **Local y desarrollo (Fase 1, sin Cloudflare):** `<previewToken>.preview.localhost:3000` (o el puerto local de `platform`). `localhost` y sus subdominios resuelven a `127.0.0.1` sin configuración de DNS en cualquier sistema operativo moderno, así que el aislamiento de origen (cookie de preview distinta del dominio de la app, CSP, `X-Robots-Tag`) puede probarse igual que en producción desde el primer día, sin esperar a Cloudflare ni a dominios reales. `platform` enruta por el subdominio igual que en producción.
- **Producción (Fase 2, con Cloudflare):** `<previewToken>.vistaprevia.com`, mismo mecanismo, con Cloudflare delante.
- En ambos casos: `previewToken` es aleatorio y de un solo uso para iniciar la sesión de vista previa. El panel genera un enlace firmado y de corta duración (15 minutos, valor por defecto, ver 14.1). Al abrirlo, `platform` lo canjea por una cookie `HttpOnly`, `Secure` (en local, `Secure` se relaja solo si se sirve por HTTP puro de desarrollo), `SameSite=Strict`, limitada a ese subdominio y a ese sitio, y redirige quitando el token de la URL.
- Cabeceras: `X-Robots-Tag: noindex`, CSP igual que la del sitio publicado, sin acceso a la API de la aplicación.
- El editor muestra la vista previa en un `iframe` con `sandbox="allow-scripts"` (sin `allow-same-origin` respecto a la aplicación).
- **Aceptación de la Fase 1:** la prueba de aislamiento de origen de la vista previa corre en CI contra `*.preview.localhost`, sin ninguna dependencia de Cloudflare, DNS real o la Fase 2.

### 5.6 Caddy y rutas del propio sitio

Boceto de `Caddyfile` (a validar en la Fase 2):

```
{
  auto_https off
  admin off
  storage file_system /caddy-data
  servers {
    trusted_proxies static private_ranges
  }
}

:80 {
  # Obligatorio: el host se usa como ruta; solo se aceptan nombres DNS válidos.
  @badhost not header_regexp Host ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$
  respond @badhost 404

  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    Content-Security-Policy "default-src 'self'; img-src 'self' data: https://i.ytimg.com; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"
    -Server
  }

  handle /_f/* {
    reverse_proxy platform:3000
  }
  handle /_c/* {
    reverse_proxy platform:3000
  }
  handle {
    root * /data/hosts/{host}
    file_server
    encode zstd gzip
  }
  handle_errors {
    respond "Sitio no disponible" 404
  }
}
```

- Los formularios (`/_f/lead`) y el widget de chat (`/_c/`) usan **la misma dirección del sitio**; Caddy los reenvía a `platform` conservando `Host`. `platform` resuelve el sitio a partir del hostname en la tabla `domains` (nunca de un parámetro del cliente). No hay peticiones a un dominio común ni CORS, y no se revela la plataforma.
- **Respuesta idéntica** para hosts inexistentes, suspendidos o borrados.
- **Apagado y suspensión:** borrar los enlaces de `/data/hosts/` del sitio y **purgar la caché de Cloudflare** de todos sus hostnames en el mismo trabajo. Es el mismo mecanismo para el paso a `dark` por impago y para `suspended` por abuso o contenido prohibido. Prueba de aceptación: un sitio apagado deja de verse en menos de un minuto y responde igual que un host inexistente.
- Reglas de caché de Cloudflare: HTML con caché corta y purga en cada publicación; `assets/` con nombres con hash y caché larga; `/_f/*` y `/_c/*` sin caché.
- Mapas: enlace o imagen estática (los mapas incrustados no están permitidos en la v1).
- **Vídeos incrustados:** el único `iframe` de terceros permitido es el de un proveedor de vídeo de la lista permitida (YouTube con dominio `youtube-nocookie.com`, Vimeo). `frame-src` de la CSP solo admite esos dos orígenes. El reproductor se carga con `loading="lazy"`, sin reproducción automática y con una imagen de portada propia. Nunca se incrusta un `iframe` con URL arbitraria del usuario: el documento solo guarda `provider` e `id` del vídeo y el `renderer` construye la URL a partir de esos campos validados.

## 6. Modelo de sitio (`site-schema`)

Es la pieza central del sistema y se define primero, en `packages/site-schema`, con validación Zod. Es el **formato canónico**: el editor Puck, los agentes y el `renderer` trabajan sobre él.

### 6.1 Estructura

```json
{
  "schemaVersion": 1,
  "meta": { "name": "Café Siete Puertas", "lang": "es", "favicon": "asset_01" },
  "design": {
    "brief": "Cafetería de barrio con tostión propia",
    "idea": "Las siete puertas de la calle se convierten en la navegación",
    "presetId": "editorial-calido",
    "dials": { "variance": 6, "motion": 3, "density": 4 }
  },
  "theme": {
    "colors": { "ground": "#F4EFE6", "ink": "#1B1B1B", "accent": "#B3422B" },
    "typography": { "family": "Source Serif 4", "scale": "large-display" },
    "spacing": { "margin": 24, "sectionGap": 160 },
    "radius": "square"
  },
  "pages": [
    {
      "id": "p_home",
      "slug": "/",
      "seo": { "title": "", "description": "", "ogImage": null, "noindex": false },
      "themeOverrides": {},
      "sections": [
        { "id": "s_hero", "type": "hero", "variant": "image-dominant",
          "props": { "headline": "", "subline": "", "cta": { "label": "", "href": "" }, "image": "asset_02" } }
      ]
    }
  ],
  "assets": [ { "id": "asset_02", "alt": "", "credit": null } ],
  "integrations": { "chatWidget": { "enabled": false }, "whatsapp": { "phone": null, "message": "" } }
}
```

Los assets del documento solo llevan `id`, `alt` y `credit`; la ruta física la resuelve el `renderer` desde la tabla `assets`. El documento nunca contiene rutas.

### 6.2 Reglas

- Todos los ids son estables (nanoid con prefijo). Los agentes editan por id, no por posición.
- `schemaVersion` obligatorio y migraciones encadenadas `migrate(vN → vN+1)`, con pruebas por migración. Al cargar un documento antiguo se migra antes de usarlo.
- Tipos de sección y bloque cerrados: un tipo desconocido falla la validación. Cada tipo declara sus `variants` y sus `props` con límites de longitud.
- **Obligatorio:** sin HTML ni JavaScript crudo. El texto enriquecido usa un subconjunto restringido de markdown (negrita, cursiva, enlaces, listas) y el `renderer` escapa todo lo demás.
- **Enlaces:** solo esquemas `https:`, `http:`, `mailto:`, `tel:` y `https://wa.me/`, y anclas internas. Se rechazan `javascript:`, `data:` y similares. Enlaces externos con `rel="noopener noreferrer"`.
- `slug` validado (minúsculas, guiones, sin `..` ni `/` repetidas, único por sitio).
- `themeOverrides` por página hereda del `theme` global y solo contiene diferencias.
- Colores validados como hexadecimales; tipografías solo de la lista alojada por la plataforma.
- `design` guarda brief, idea y preset para dar contexto a los agentes de diseño y SEO.
- Tipos de bloque multimedia: `video` con `props.source = own|embed`. `own` es un vídeo subido (máximo 2 por página, **8 MB**, con portada, cuenta para el límite de 20 MB). `embed` guarda solo `provider` (`youtube|vimeo`) e `id` validado por expresión regular, más un título y un texto alternativo; no tiene límite de cantidad y no consume disco ni cuenta para el límite de página. Nunca se guarda una URL completa ni HTML de inserción. Tipos de sección: `hero`, `text`, `gallery`, `video`, `feature-list`, `menu-list` (informativo), `pricing` (informativo, con aviso opcional de «precios de referencia»), `faq`, `contact` (información de contacto), `location` (dirección con enlace de mapa), `hours`, `lead-form` (campos configurables, texto de consentimiento y tipo `contact|quote|appointment`), `whatsapp-button`, `cta`, `testimonial`, `footer`. No existen tipos de compra ni de pago.
- `testimonial` lleva `ownerProvided: true`, que **solo** puede fijar el dueño desde la interfaz; las herramientas de agentes no pueden escribir ese campo. El `renderer` no publica testimonios sin él.
- Cada tipo de sección tiene un componente en `ui-components` con variantes de composición.

### 6.3 Editor y renderer

- Los componentes de `ui-components` son componentes React puros. El editor Puck los usa para editar y el `renderer` los convierte a HTML estático con `renderToStaticMarkup`, sin hidratación.
- Un adaptador probado convierte entre el formato de datos de Puck y `site-schema` en ambos sentidos. Prueba de ida y vuelta: `schema → puck → schema` es idéntico para todas las plantillas.
- El JavaScript de los sitios publicados se limita a scripts propios mínimos (menú móvil, envío del formulario, widget de chat), servidos desde `assets/` del propio sitio y compatibles con la CSP. Todo funciona sin JavaScript salvo el chat.

### 6.4 Linter: reglas y severidades

El linter es la guarda de calidad entre el borrador y la publicación. Se compone de dos implementaciones con el mismo contrato (`LintFinding`), para que ningún hallazgo dependa de un navegador salvo los que lo necesitan de verdad.

```ts
type Severity = 'error' | 'warning' | 'info';

interface LintFinding {
  code: string;          // identificador estable, p. ej. MISSING_ALT
  severity: Severity;
  pageId?: string;
  sectionId?: string;
  field?: string;
  message: string;       // texto en español, mostrado al dueño
  fixHint?: string;
  autofixable: boolean;
}
```

**Linter estático** (`packages/site-schema` + `renderer`, sin navegador; corre en la Fase 1 y en cada guardado del editor):

| Código | Severidad | Regla |
| --- | --- | --- |
| `SCHEMA_INVALID` | error | El documento no valida contra `site-schema` |
| `UNKNOWN_SECTION_TYPE` | error | Tipo de sección o variante inexistente |
| `UNSAFE_URL` | error | Enlace con esquema fuera de la lista permitida |
| `RAW_HTML` | error | Intento de HTML/JS en texto enriquecido |
| `DUPLICATE_SLUG` | error | Dos páginas con el mismo slug, o slug inválido |
| `MISSING_TITLE` | error | Página sin `seo.title` o título vacío |
| `EMPTY_PAGE` | error | Página sin secciones |
| `MISSING_ALT` | warning | Imagen sin texto alternativo |
| `MISSING_META_DESCRIPTION` | warning | Sin `seo.description` |
| `TESTIMONIAL_UNVERIFIED` | error | Testimonio sin `ownerProvided` |
| `FABRICATED_DATA` | error | Campos marcados como no confirmados por el dueño (ver 9.1) |
| `BROKEN_INTERNAL_LINK` | warning | Enlace a una página interna inexistente |
| `CTA_MISSING` | warning | Página sin ninguna llamada a la acción |
| `LONG_TEXT` | info | Bloque de texto por encima del límite recomendado |
| `THEME_CONTRAST` | warning | Par de colores con contraste calculado < 4.5:1 (se calcula sin navegador) |
| `FONT_NOT_HOSTED` | error | Tipografía fuera de la lista alojada |
| `IMAGE_TOO_LARGE` | warning | Imagen por encima del peso recomendado |
| `PAGE_TOO_HEAVY` | error | Página con más de 20 MB de peso propio (HTML, imágenes, vídeos subidos y fuentes). Los vídeos incrustados no cuentan |
| `VIDEO_LIMIT` | error | Más de 2 vídeos **subidos** en una página o un vídeo subido de más de **8 MB**. Los incrustados no tienen límite |
| `VIDEO_PROVIDER_UNKNOWN` | error | Vídeo incrustado de un proveedor fuera de la lista permitida |
| `VIDEO_ID_INVALID` | error | Identificador de vídeo incrustado fuera de formato |
| `CONTENT_FLAGGED` | error | El contenido del sitio activó la revisión de 10.1 y está en revisión humana |
| `TOO_MANY_IMAGES` | info | Más imágenes de las sugeridas en una sección |
| `IMAGE_LICENSE_MISSING` | error | Asset sin licencia registrada (ver tabla de 9.1) |

**Linter renderizado** (`sandbox-web` con Playwright, Fase 5; informativo y no bloqueante para publicar en la Fase 1–4):

| Código | Severidad | Regla |
| --- | --- | --- |
| `OVERFLOW_HORIZONTAL` | error | Desbordamiento horizontal en 360, 768, 1280 px |
| `TEXT_CLIPPED` | warning | Texto recortado o superpuesto |
| `HEADLINE_ORPHAN` | warning | Titular con una sola palabra en la última línea |
| `TOUCH_TARGET_SMALL` | warning | Objetivo táctil < 44×44 px |
| `CONTRAST_RENDERED` | warning | Contraste efectivo tras el renderizado |
| `LCP_SLOW` | warning | LCP > 2.5 s en red simulada 4G |

Reglas de aplicación:

- Los `error` del linter estático **bloquean la publicación**. Los `warning` no bloquean nunca; el panel los muestra antes de publicar y en el panel del sitio.
- El bloqueo de 6.4 es **técnico, no de gusto**: solo cae lo que no se puede renderizar (documento inválido, referencia rota, cuota excedida). **Ninguna regla de estilo, de 6.4 o de 6.5, impide publicar lo que el dueño pide**; esas se avisan y se confirman.
- Los `warning` `autofixable` (por ejemplo `MISSING_ALT` con alt generado desde el nombre del negocio) ofrecen un botón «Corregir» que aplica el cambio al borrador.
- En las Fases 1–4, la publicación manual **no requiere ninguna imagen** ni un número mínimo de secciones más allá de `EMPTY_PAGE`. La regla de mínimo de imágenes es una recomendación del agente de diseño (`info`), nunca un bloqueo, para no impedir publicar sitios tipográficos o de una sola sección.
- Añadir una regla exige código estable, severidad, prueba de caso positivo y negativo, y entrada en esta tabla.

### 6.5 Linter de calidad visual (sobre el HTML del release)

Las reglas de 6.4 actúan sobre el **documento JSON**. Este segundo linter actúa sobre el **HTML generado**, justo después del paso 4 del flujo de publicación (4.3) y antes del swap atómico, porque hay defectos que solo se ven en el resultado: tipografías repetidas, degradados genéricos, tarjetas anidadas, jerarquía saltada.

**Origen y licencia:** el conjunto de reglas se adapta de [*impeccable*](https://github.com/pbakaus/impeccable) (Apache 2.0), que aporta 62 reglas deterministas sin LLM. La adaptación es una **copia con atribución en `NOTICE`**, no una dependencia: **no se instala su CLI, no se ejecuta su runtime y no se envía telemetría**. Sus reglas se reimplementan en `packages/lint-visual` para que no dependan de un proyecto externo.

**Motivo:** los agentes y los editores visuales convergen en los mismos tics. Detectarlos por código, con severidad y en CI, es más barato y más fiable que pedírselo a un modelo en el prompt.

| Código | Severidad | Regla |
| --- | --- | --- |
| `SLOP_FONT_MONOCULTURE` | warning | Más del 60 % del texto en una única tipografía genérica del sistema si la entrada del catálogo definía pairing |
| `SLOP_GENERIC_GRADIENT` | warning | Degradado con dos paradas en el rango violeta-azul por defecto sin relación con la paleta de la entrada |
| `SLOP_NESTED_CARDS` | warning | Tarjeta dentro de tarjeta dentro de tarjeta |
| `SLOP_ICON_TILE_ABOVE_EVERY_HEADING` | info | El mismo patrón decorativo sobre más de 3 titulares |
| `SLOP_LOW_CONTRAST_TEXT_ON_COLOR` | error | Texto con contraste < 4.5:1 sobre fondo de color |
| `SLOP_HEADING_SKIP` | error | Jerarquía de encabezados que salta niveles (h1 → h3) |
| `SLOP_PADDING_CRAMPED` | warning | Espaciado interior por debajo del ritmo definido en la entrada |
| `SLOP_CENTERED_EVERYTHING` | info | Todo el contenido centrado sin variación de alineación |
| `SLOP_SAME_CARD_RADIUS` | info | Un único radio en todos los contenedores, incluidos los que no lo piden |
| `SLOP_SHADOW_ON_EVERYTHING` | warning | Sombra aplicada a más del 80 % de los bloques |
| `SLOP_NO_VISUAL_HIERARCHY` | error | Ninguna diferencia de tamaño entre h1, h2 y cuerpo |
| `SLOP_UNRESPONSIVE_GRID` | error | Rejilla de más de 2 columnas que no colapsa por debajo de 768 px |
| `SLOP_FIXED_WIDTH_OVERFLOW` | error | Ancho fijo que provoca desbordamiento en 360 px |
| `SLOP_TOUCH_TARGET_SMALL` | warning | Objetivo táctil < 44×44 px |
| `SLOP_PLACEHOLDER_TEXT` | warning | Texto de relleno tipo «Lorem ipsum» o «pendiente de confirmar» en la versión que se publica |

Reglas de aplicación:

- **Ninguna regla de 6.5 bloquea una publicación pedida por el dueño.** Un `error` de 6.5 exige que el dueño **confirme** antes de publicar, no impide publicar: el panel muestra el hallazgo, el dueño pulsa «Publicar igual» y la publicación continúa. El bloqueo duro es exclusivo de 6.4 (documento inválido) y de la política de contenido (10.1).
- Los `warning` e `info` se muestran en el panel del sitio y **no interrumpen** en ningún caso.
- **El linter nunca actúa como puerta del agente.** Si el dueño pide publicar, se publica: la decisión es suya, la advertencia queda registrada en `audit_log` con quién confirmó y qué códigos había.
- `SLOP_PLACEHOLDER_TEXT` avisa pero no bloquea: un sitio puede publicarse con textos provisionales si el dueño lo decide, y el panel le recuerda que los complete.
- Las reglas de rendimiento y accesibilidad que requieren navegador siguen en el **linter renderizado** de 6.4 (Fase 5) y no se duplican aquí.
- El linter visual es determinista y sin coste de modelo. Se ejecuta en `workers` y en CI, con pruebas de caso positivo y negativo por regla.
- Cada regla nueva lleva su código, severidad, prueba y entrada en esta tabla, igual que en 6.4.
