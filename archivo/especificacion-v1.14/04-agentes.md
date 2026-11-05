## 9. Agentes

### 9.1 Diseño

El agente de diseño recoge un brief, inventario del negocio, argumento por sección, dirección visual, idea diferenciadora y copy deck. Opera únicamente sobre `site-schema`, presenta diferencias y crea un checkpoint antes de mutar.

Herramientas: `get_site`, `plan_site`, `recommend_design_system`, `apply_preset`, `set_theme`, `add_section`, `update_section`, `move_section`, `remove_section`, `generate_copy`, `attach_asset`, `run_lint`, `request_visual_review`, `create_checkpoint`, `revert_to_checkpoint` y `analyze_reference`.

El modo rápido usa una ronda y presupuesto limitado. El modo completo y la revisión visual pueden usar un modelo superior si la evaluación lo justifica. El agente no inventa clientes, cifras, testimonios, precios, citas ni certificaciones. Todo contenido pendiente queda marcado para confirmación del dueño.

**Flujo paso a paso (modo completo):**

1. **Brief:** el agente pregunta tipo de negocio, nombre, ciudad, servicios principales, público, tono deseado, idioma, llamada a la acción principal y datos de contacto. Cada respuesta se guarda en `design.brief`.
2. **Inventario:** lista lo que el dueño ya tiene (logo, fotos, carta, horarios, dirección). Lo que falte se marca como pendiente, nunca se inventa.
3. **Recomendación:** consulta el catálogo (`design_product_types`, `design_styles`, `design_palettes`) y propone 2 o 3 presets con motivo para cada uno.
4. **Plan:** `plan_site` devuelve páginas, secciones y orden. El dueño aprueba o ajusta antes de construir.
5. **Checkpoint:** `create_checkpoint` antes de cualquier mutación.
6. **Construcción:** `apply_preset`, `set_theme`, `add_section`, `update_section` y `generate_copy`, solo sobre el esquema.
7. **Imágenes:** `attach_asset` solo con assets que cumplan la política de la tabla siguiente.
8. **Validación:** `run_lint` (6.4) y `run_visual_lint` (6.5). Un `error` de 6.4 vuelve al paso 6. **Un `error` de 6.5 no vuelve al paso 6 cuando fue el dueño quien pidió el cambio:** se aplica, se registra el aviso y se le informa. El agente nunca se bloquea a sí mismo ni bloquea al dueño por una regla de estilo.

**Herramienta `critique_draft`** (adaptada del comando `critique` de *impeccable*, con atribución): puntúa el borrador contra heurísticas de usabilidad y devuelve **como máximo los 3 problemas prioritarios**, con qué tocar y por qué. No devuelve una lista larga: obliga al agente a priorizar. Es determinista sobre tokens y estructura; el modelo solo redacta la explicación. Se ejecuta antes de la revisión visual con captura (`request_visual_review`, Fase 5).

**Vocabulario de dirección:** las 24 direcciones de *impeccable* (`bolder`, `quieter`, `distill`, `colorize`, `typeset`, `layout` y el resto) se adoptan como **nombres de variante del catálogo**, para que el dueño pida «más sobrio» o «más llamativo» y el agente sepa exactamente qué grupo de tokens mover.

**Biblioteca de estilos:** el agente elige la entrada con `recommend_design_system`, que **ordena las variantes por similitud con el vector de preferencia aprendido del usuario** (7.7.3). Solo puede aplicar entradas `active`. Si ninguna encaja, lo dice y aplica el preset más cercano, sin inventar una familia nueva.
9. **Entrega:** resumen de cambios, lista de datos pendientes de confirmar y diferencias contra el checkpoint. El dueño acepta o usa «Deshacer todo».

**Modo rápido (Fase 4):** una sola ronda con los campos mínimos (tipo de negocio, nombre, ciudad, un servicio y un contacto). Omite el paso 4 y usa el preset más adecuado. Los datos que faltan se dejan como marcadores visibles `pendiente de confirmar`, y el presupuesto de la ejecución está en 14.1.

**Política de imágenes y licencias (obligatoria):**

| Origen | Permitido | Requisito |
| --- | --- | --- |
| `own` (subida del dueño) | Sí | El dueño declara en la subida que tiene derechos sobre la imagen; se registra en `assets.license = owner-declared` |
| `generated` (IA de la plataforma) | Sí | Sin personas reconocibles ni marcas de terceros; se registra el modelo en `assets.license = platform-generated` |
| `open-collection` (CC0 o CC BY verificada) | Sí | Licencia y autor en `assets.license` y `assets.author`; crédito visible en `credit_text` cuando la licencia lo exija |
| Imágenes de Internet, redes sociales, carta o sitios de competidores | No | Prohibido. El scraper de referencia (Fase 5) extrae estructura y estilo, nunca imágenes ni textos |
| Logos o marcas | Solo si el dueño los sube y declara derechos | Igual que `own` |

Reglas adicionales:

- Un asset sin licencia registrada no puede publicarse: el linter lo marca como `IMAGE_LICENSE_MISSING` (error).
- El agente no busca imágenes en Internet ni las descarga por sí mismo.
- Las fotos de personas identificables de terceros requieren autorización escrita del dueño, guardada como asset con `license = consent-document`.
- Las imágenes se procesan con `sharp` (formato, tamaño y EXIF) según la sección 4.2 antes de entrar al sitio.
- Los vídeos se transcodifican en `workers` a H.264 720p o WebM, se eliminan sus metadatos y se genera una imagen de portada. Se cargan con `preload="none"` y sin reproducción automática.
- Las mismas reglas de origen y licencia de la tabla anterior aplican a los vídeos subidos.
- **Vídeos incrustados:** el dueño declara que tiene derecho a incrustar ese vídeo (propio o de un canal que lo permite). El agente no elige vídeos por sí mismo: el dueño pega el enlace o lo busca y lo confirma. La plataforma no descarga, transcodifica ni rehostea el vídeo de terceros; solo incrusta el reproductor del proveedor.
- El peso de una página se calcula sumando el HTML generado y todos sus assets **propios** referenciados (imágenes, vídeos subidos, portadas, fuentes y CSS). Los vídeos incrustados de plataformas externas no suman porque se sirven desde su origen. Si supera 20 MB, la publicación se bloquea con `PAGE_TOO_HEAVY` y el mensaje indica qué elemento ocupa más espacio.

### 9.2 Flujo de construcción del sitio (experiencia del dueño)

Tres caminos, todos válidos, todos dentro del mismo editor y con el mismo resultado: un borrador en `site-schema` que se previsualiza y se publica con las reglas de 4.3.

#### 9.2.1 Camino A · Elegir del catálogo

1. Entra al panel y ve el **catálogo de estilos activos** (7.7): familia, variante, vista previa y una muestra de tokens (paleta, tipografía, densidad).
2. Filtra por tipo de negocio, por familia o por lo que otros usuarios como él suelen elegir (ordenado por el vector de preferencia de 7.7.3).
3. Elige una entrada. El agente aplica sus tokens y propone una estructura de secciones acorde a su tipo de negocio.
4. Puede pedir variantes de esa misma entrada con las direcciones del vocabulario (`bolder`, `quieter`, `distill`, `typeset`…) sin salir de la vista previa.

**No hace falta escribir nada.** Es el camino más rápido y el que menos fricción tiene.

#### 9.2.2 Camino B · Describir con lenguaje natural

1. El dueño escribe lo que quiere: «una landing para una clínica dental en Valencia, con horarios, servicios y un formulario de cita; tonos claros y sensación de confianza».
2. El agente interpreta, elige la entrada del catálogo más cercana (por similitud con el vector de preferencia del usuario y el tipo de negocio) y construye el borrador con `plan_site` → `fill_page` → `attach_asset`.
3. El plan se le muestra **antes de construir** y él lo aprueba o lo ajusta (9.1, paso 4).
4. Puede corregir en cualquier momento hablando: «sube el titular», «quita la galería», «hazlo más sobrio».

El agente nunca inventa datos del negocio: si faltan horarios, teléfono o dirección, pregunta o deja el campo marcado y visible en el panel, no un texto inventado.

#### 9.2.3 Camino C · Partir de una referencia

El dueño señala una página que le gusta. Dos formas de darla:

- **Un enlace** a una página pública.
- **Una captura de pantalla** subida al panel.

**Qué hace el sistema con ella, en ambos casos:**

1. Se registra como **origen temporal** con `kind = reference`, ligado al dueño y no visible para nadie más. Caduca a los 30 días.
2. Se extraen **las mismas propiedades medibles del catálogo** (7.7.4): escala tipográfica, paleta en OKLCH, espaciado, radios, elevación, densidad y patrones de sección.
3. El agente **no copia la página**. Combina esos descriptores con una entrada del catálogo, de modo que el resultado sea del dueño y no un clon.
4. El dueño ajusta a partir de ahí por cualquiera de las dos vías de 9.2.4.

**Con un enlace:** pasa por el mismo pipeline que el crawler del catálogo, con las mismas garantías: `sandbox-web`, `egress-proxy`, sin IPs privadas, respetando `robots.txt` y leyendo solo CSS computado y DOM. No se descarga ni se conserva ninguna imagen de la página.

**Con una captura:** la imagen **no se usa para entrenar nada ni se envía a un modelo con la página entera**. Se procesa para extraer la paleta y las proporciones de la composición, y se descarta al terminar el borrador. Si la captura contiene personas identificables, se le advierte al dueño de que es responsable de tener derecho a usarla.

**Límites de la referencia, siempre aplicados:**

- Solo se extraen propiedades visuales. **Cero texto, cero imágenes y cero logotipos ajenos** pasan al sitio.
- Si la referencia es una galería o un sitio sin licencia que permita derivados, el sistema lo advierte y **aplica solo el ajuste de estilo**, no la composición literal.
- Si la referencia y el catálogo no encajan en ninguna combinación razonable, el agente lo dice y propone la entrada más cercana en lugar de forzar el parecido.

#### 9.2.4 Cambiar lo que no le gustó

Dos vías, siempre disponibles a la vez, y el dueño elige:

**Vía 1 · Hablar con el agente.** Pide un cambio con sus palabras o con una dirección del vocabulario: «más sobrio», «más llamativo», «quita lo que sobra», «arregla la tipografía», «reordena». El agente aplica el cambio sobre el borrador con las herramientas de 9.1 y vuelve a validar.

**Vía 2 · Editar a mano.** El editor visual (Puck) sobre el mismo `site-schema`, con las mismas restricciones: solo escribe en el borrador, control optimista por `draft_rev`, y todo cambio queda en `audit_log`.

En ambas vías:

- El cambio va **al borrador**, nunca directo a producción. Publicar sigue siendo un acto explícito.
- Se crea un **checkpoint** antes de cada aplicación del agente, así que se puede volver atrás.
- Los avisos del linter visual (6.5) se muestran y **no bloquean**: el dueño decide si publica igual.

#### 9.2.5 Lo que el dueño ve en cada paso

| Momento | Qué ve |
| --- | --- |
| Entrada | Catálogo con vistas previas y una caja para describir lo que quiere |
| Elección | Vista previa del borrador con el diseño aplicado, en escritorio y en móvil |
| Ajuste | Panel para hablar con el agente y editor para tocar a mano, en la misma pantalla |
| Publicación | Avisos del linter, la cuenta de páginas que se facturarán y el botón de publicar |
| Después | Estado del sitio, dominios, analítica básica y la opción de volver a cualquier versión |

### 9.3 Soporte

Responde preguntas del constructor con RAG filtrado por producto, usuario y sitio. Herramientas: `search_docs`, `get_user_plan`, `get_site_status`, `get_domain_status`, `create_ticket` y `escalate_to_human`. No puede modificar sitios ni datos salvo crear tickets.

### 9.4 SEO

El publicador genera determinísticamente sitemap, robots, canonical, Open Graph y metadatos base. El agente propone títulos, descripciones, alt text, jerarquía, JSON-LD de negocio local y enlaces rotos. Sus cambios van al borrador y requieren aprobación del dueño.

### 9.5 Programación

Solo corrige bugs de la plataforma. Un worker crea un entorno efímero con una copia del repositorio y entrega al sandbox un token temporal de alcance mínimo. El sandbox devuelve un parche y resultados de pruebas; el worker crea el Pull Request mediante una GitHub App limitada. No puede hacer merge, desplegar, leer secretos ni acceder a producción. Un humano aprueba y el despliegue pasa primero por staging.

### 9.6 Atención al cliente por sitio

Canales iniciales: chat web y Telegram; WhatsApp mediante OpenClaw queda condicionado a la prueba de concepto y al complemento opcional. Todos los adaptadores normalizan mensajes a `InboundMessage` y verifican firmas o autenticidad del proveedor.

Procesamiento: verificar e idempotentizar el mensaje, guardar y encolar, cargar conocimiento filtrado por `site_id`, decidir respuesta/herramienta/escalado, pasar por `sendReply` y registrar resultado.

El primer contacto de cada conversación pasa por un paso de consentimiento, **valor por defecto cerrado**:

1. Antes de guardar datos personales o crear el contacto, el agente envía un mensaje de bienvenida: que es un asistente virtual del negocio, un enlace a privacidad y términos, y la pregunta de aceptación («Para continuar, responde SÍ o acepta aquí»).
2. Sin aceptación, el agente responde solo con información general pública del sitio y no guarda nombre, teléfono ni mensajes personales.
3. Con aceptación, se crea `consents` (`purpose = attention`, `evidence_text_version` y `evidence_message_id`) y se crea o actualiza el `contacts`.
4. El consentimiento de seguimiento o mercadeo es un paso aparte y opcional, nunca se pide junto con el de atención.
5. Si el abogado relaja este paso, cambia el valor en la configuración de la plataforma y se registra como ADR; el código no cambia.

**Herramientas del agente de atención** (todas validadas con Zod y acotadas al `site_id` de la conversación):

| Herramienta | Qué hace | Restricción |
| --- | --- | --- |
| `search_knowledge` | Busca en `knowledge_items` del sitio (RAG) | Solo ese sitio; devuelve fuente y fragmento |
| `get_site_info` | Lee datos públicos del sitio publicado (horarios, dirección, servicios) | Solo lectura, de la versión publicada |
| `upsert_contact` | Crea o actualiza `contacts` | Requiere `consents` de atención vigente |
| `create_lead` | Crea `leads` (`contact`, `quote` o `appointment`) | Requiere `consent_id`; no crea leads sin aceptación |
| `escalate_to_human` | Crea `escalations` y pausa la conversación para el dueño | Siempre disponible |
| `notify_owner` | Envía el aviso al dueño por WhatsApp (9.6) con uno de los motivos permitidos | Máximo un aviso cada 15 minutos por dueño; resto agrupado |
| `send_reply` (`sendReply`) | Envía la respuesta al canal | Única vía de salida; ver reglas abajo |

**Trato humano y personalidad.** Configurables en `agent_settings`:

- **Persona por defecto:** cordial, breve y clara, en español neutro, tratando de «usted», sin emojis y sin nombre propio del agente. El dueño puede cambiar tono (`formal`, `cercano`) y nombre visible, pero no las reglas de honestidad de la sección 9.5.
- **Mensajes cortos:** un máximo de 3 frases por mensaje. Si la respuesta es larga, se divide en dos mensajes con una pausa natural de 2 segundos (el envío sigue siendo una sola respuesta lógica para la puerta de solo respuesta).
- **Horario:** fuera de `hours` el agente lo indica y registra la consulta para respuesta humana posterior.
- **Memoria:** el agente conserva el nombre y las preferencias que el contacto declara, durante la retención de `contacts` (14.1). No guarda datos sensibles ni inferidos. Al revisar una conversación recupera el resumen de las últimas 20 interacciones o 90 días, lo que ocurra antes.

**Pausa por mensaje manual del dueño.** Si el dueño escribe a un contacto desde el canal real (panel, app de WhatsApp de OpenClaw o chat de Telegram del negocio), el agente deja de responder esa conversación:

- La conversación pasa a `human` y el agente queda pausado durante 2 horas sin actividad, renovables por cada mensaje del dueño.
- Detección: en el panel, por `role = owner`; en OpenClaw, por mensajes salientes que la plataforma no originó (eco `fromMe`); en Telegram, por mensajes del operador en el chat vinculado al bot.
- El dueño puede pulsar «Devolver al agente» en cualquier momento. Sin esa acción, el agente vuelve automáticamente al terminar la pausa.

**Escalado y tiempos** (valores en 14.1):

- Se escala ante petición de humano, baja confianza, queja grave, asunto legal o sensible, pagos, descuentos, datos no disponibles o bucles.
- Al escalar, el agente avisa al cliente que el negocio responderá y no promete plazos que no conoce.
- El dueño recibe el aviso al momento. Si no responde en 15 minutos, se envía un recordatorio por el segundo canal disponible.
- Si pasan 60 minutos sin respuesta, el agente informa al cliente que el equipo responderá y mantiene la conversación en `waiting_owner`. Tras 24 horas sin atención, la conversación queda marcada como pendiente en el panel y no se devuelve al agente sin aprobación.

`sendReply(conversationId, content)` deduce el destinatario de la conversación. Solo permite responder dentro de la ventana configurada tras un mensaje entrante, si no existe baja, y dentro de límites por conversación, contacto, sitio y día (14.1). No existen envíos arbitrarios, campañas, grupos ni mensajes programados.

Las lecciones se proponen, editan y aprueban por el dueño antes de entrar al conocimiento. WhatsApp mediante OpenClaw implica riesgo de bloqueo: se registra la aceptación del cliente, se recomienda número dedicado y se desactivan herramientas de ejecución, difusión y envío arbitrario en OpenClaw.

### 9.7 Avisos al dueño por WhatsApp

Decisión: se mantiene OpenClaw también para avisos. El número de la plataforma envía avisos, pero solo bajo estas reglas:

- **Solo al número del dueño verificado** por el mismo número, mediante un código enviado desde el panel. Sin verificación no hay avisos.
- **Cuándo se envía:** solo cuando el agente de atención llama a la herramienta `notify_owner` con uno de estos motivos: `needs_more_info` (el visitante pide más información que el agente no puede dar con fiabilidad), `requests_contact` (el visitante pide que lo contacten) o `escalation` (escalado según 9.5). El sistema no envía avisos por WhatsApp en otros casos.
- **Recordatorio:** si el dueño no responde en 15 minutos a un aviso, se reenvía el recordatorio por el canal de respaldo (9.5, escalado).
- **Alertas operativas** (sitio suspendido, dominio en error, número de avisos desconectado): panel, correo y Web Push, no WhatsApp.
- **Contenido mínimo:** nombre parcial del contacto, motivo y un enlace al panel. Ningún dato personal completo viaja por WhatsApp.
- **Agrupación:** un máximo de un aviso cada 15 minutos por dueño; los demás se agrupan en un resumen.
- **Canales de respaldo:** panel, correo, Telegram y Web Push. Si WhatsApp falla, el aviso sigue por esos canales. Ningún aviso depende solo de WhatsApp.
- **Sin mensajes proactivos a clientes finales:** el número de la plataforma nunca escribe a los visitantes; solo avisa al dueño.
- **Riesgo y monitoreo:** el número de avisos es un punto único de fallo y de bloqueo. Se monitorean entregas, se alerta si el número se desconecta y el procedimiento de reconexión por QR está en `docs/runbooks/`. La decisión de usar OpenClaw queda registrada como ADR con el riesgo aceptado.
