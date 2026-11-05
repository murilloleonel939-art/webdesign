## 7. Modelo de datos (PostgreSQL)

Migraciones versionadas con Drizzle. Toda tabla con datos de un sitio incluye `site_id` y `owner_id`.

### 7.1 Aislamiento por fila (RLS)

- RLS activada y forzada (`FORCE ROW LEVEL SECURITY`) en todas las tablas con datos de usuario o sitio.
- Cada petición abre una transacción y ejecuta `SET LOCAL app.user_id = …` (y `app.site_id` cuando aplica); las políticas comparan con `current_setting('app.user_id')`. Una prueba falla si alguna consulta se ejecuta fuera de ese contexto.
- Roles de base de datos:

| Rol | Uso | RLS |
| --- | --- | --- |
| `app_platform` | `platform` | Sujeto a RLS |
| `app_internal_api` | `internal-api` | Sujeto a RLS; solo tablas que exponen las herramientas |
| `app_workers` | `workers` | Sujeto a RLS; los trabajos fijan el contexto del sitio que procesan |
| `app_maintenance` | Trabajos de mantenimiento y reconciliación | `BYPASSRLS`, solo en la cola `maintenance`, auditado |
| `app_llm_gateway` | `llm-gateway` | Solo `INSERT` en `usage_events` y lectura de presupuestos |
| `app_migrator` | Migraciones en despliegue | Propietario del esquema; nunca usado en ejecución |

### 7.2 Núcleo

- `users` (id, email, email_verified_at, name, role `owner|operator`, mfa_enabled, created_at)
- `sites` (id uuid, owner_id, name, status `draft|active|dark|suspended|deleted`, published_page_count, subdomain único, domain_pool_id, published_version, created_at, dark_since, delete_after, deleted_at) — sin cupo de páginas; `published_page_count` es la unidad de cobro. `dark_since` es cuando el sitio dejó de servirse y `delete_after` es la fecha de borrado total (`payment_due_date + 30 días`), calculada al entrar en `dark`
- `account_terms` (user_id, account_created_at, trial_ends_at) — el fin de la prueba se fija al crear la cuenta y no se recalcula. La gracia no vive aquí: depende del ciclo de cobro de cada suscripción
- `site_members` (site_id, user_id, role `owner|editor|viewer`) — permisos por sitio
- `site_drafts` (site_id, rev, doc jsonb, doc_hash, updated_by_type `user|agent`, updated_by, updated_at)
- `site_versions` (id, site_id, version, schema_version, doc jsonb, doc_hash, created_by, note, created_at) — inmutable
- `draft_checkpoints` (id, site_id, rev, doc jsonb, created_by_type, label, created_at)
- `subscriptions` (id, site_id, status `trial|active|grace|dark|expired|canceled`, quantity_pages, provider, provider_ref, current_period_start, current_period_end, grace_until, cancel_at_period_end) — `grace_until` solo se rellena cuando falla el cobro de una suscripción ya activa; nunca se rellena en una cuenta que jamás pagó
- `payment_events` (id, subscription_id, provider_event_id único, type, payload jsonb, received_at) — idempotencia de webhooks del proveedor de cobros
- `invoices` (id, subscription_id, provider_invoice_id único, amount, currency, pages_billed, status, issued_at, paid_at)
- `ai_credit_ledger` (id, owner_id, site_id, delta, reason, run_id, created_at) — saldo de créditos de IA
- `content_reviews` (id, site_id, version, source `auto|report|periodic`, categories jsonb, score, status `pending|clear|blocked|human_review`, reviewer_id, notes, created_at, resolved_at)
- `domains` (id, site_id, hostname único, kind `subdomain|custom`, status `pending|verifying|active|error|removed`, verify_token, cf_hostname_id, verified_at, last_check_at, error)
- `site_domain_pool` (id, zone_id, domain, capacity, used, status `active|full|flagged|retired`)
- `released_hostnames` (hostname, released_at) — periodo de espera antes de reasignar
- `assets` (id, site_id, path, kind `image|video|poster`, bytes, mime, width, height, duration_s, source `own|generated|open-collection`, license, author, source_url, credit_text, created_at)
- `legal_acceptances` (id, user_id, site_id, document `terms|privacy|whatsapp_risk|whatsapp_notice`, text_version, accepted_at, ip)
- `abuse_reports` (id, site_id, hostname, reporter_contact, reason, status, created_at, resolved_by, resolved_at)
- `audit_log` (id, actor_type `user|operator|agent|system`, actor_id, site_id, action, target, meta jsonb, at) — solo inserción

### 7.3 Agentes y uso

- `agent_runs` (id, agent_id, user_id, site_id, status, model, prompt_tokens_max, tokens_in, tokens_out, trace_id, started_at, ended_at, stop_reason)
- `agent_tool_calls` (id, run_id, tool, input_hash, ok, error_code, ms)
- `agent_tokens` (jti, run_id, scopes, site_id, expires_at, revoked_at) — tokens acotados emitidos a agentes, sandboxes e instancias
- `usage_events` (id, user_id, site_id, kind, qty, at)
- `tickets` (id, user_id, subject, status, source_run_id, sentry_issue_id, assigned_to)
- `docs_chunks` (id, source, content, embedding vector(N), embedding_model) para el RAG de soporte

La dimensión `N` y el modelo de embeddings se fijan en la Fase 7 y se guardan por fila; cambiar de modelo implica reindexar, no migrar el esquema.

### 7.4 Atención al cliente y contactos

- `agent_settings` (site_id, enabled, persona, tone, rules jsonb, hours, escalation_timeout_min, channels_enabled)
- `owner_notification_prefs` (user_id, site_id, channels jsonb `panel|email|telegram|webpush|whatsapp`, quiet_hours, digest)
- `push_subscriptions` (id, user_id, endpoint, keys_encrypted, created_at)
- `channels` (id, site_id, kind `web|telegram|whatsapp`, credentials_encrypted, webhook_secret, status, instance_id)
- `openclaw_instances` (id, site_id, container_id, status `provisioning|linked|unlinked|stopped`, linked_phone_hash, created_at, last_seen_at)
- `contacts` (id, site_id, name, phone, channel, identifiers jsonb por canal, source, first_seen_at, last_interaction_at, status, tags, notes, created_at)
- `consents` (id, contact_id, purpose `attention|followup|marketing`, channel, granted_at, revoked_at, evidence_text_version, evidence_message_id)
- `leads` (id, site_id, contact_id, type `contact|quote|appointment`, message, consent_id, created_at, status)
- `conversations` (id, site_id, contact_id, channel, state `agent|waiting_owner|human|closed`, last_inbound_at, last_message_at)
- `messages` (id, conversation_id, role `customer|agent|owner`, provider_message_id, content, attachments, tools_used, created_at), con índice único (`channel`, `provider_message_id`)
- `escalations` (id, conversation_id, reason, summary, suggested_reply, status, notified_at, resolved_at)
- `knowledge_items` (id, site_id, kind, content, embedding vector(N), embedding_model, source, status)
- `lessons` (id, site_id, trigger_message_id, proposed_text, status `proposed|approved|rejected`, approved_by, approved_at)
- `outbound_log` (id, site_id, conversation_id, channel, sent_at, allowed_by_rule) — registro de cada envío de la puerta de solo respuesta

### 7.5 Catálogo de diseño

`design_product_types`, `design_styles`, `design_palettes`, `design_font_pairings`, `design_landing_patterns`, `design_ux_rules` y `design_antipatterns`. Cada fila lleva `source`, `license`, `verified_at` y `status` (`active|supplemental|deprecated`). Sin RLS (datos globales), escritura solo por el rol de migración o por el panel de operador.

La biblioteca de estilos de 7.7 añade las tablas de catálogo y trazabilidad de fuentes.

### 7.6 Retención

Retención configurable por tipo de dato: mensajes y conversaciones, contactos inactivos, leads, `audit_log`, `agent_runs`. Un trabajo de `maintenance` aplica la retención y el borrado por contacto. Los sitios borrados se conservan 30 días (estado `deleted`) y luego se eliminan disco, versiones y datos asociados.

## 8. Agent SDK y orquestación

### 8.1 Contrato común

```ts
interface AgentDefinition {
  id: string;
  description: string;
  model: string;
  systemPrompt: string;
  skills: SkillRef[];
  tools: ToolDef[];
  budget: { maxTokens: number; maxToolCalls: number; maxCostUsd: number; timeoutMs: number };
}

interface ToolDef<I, O> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  scopes: string[];
  mutates: boolean;
  handler(ctx: RunContext, input: I): Promise<O>;
}

interface RunContext {
  runId: string;
  userId: string;
  siteId?: string;
  token: string;
  locale: string;
}
```

### 8.2 Reglas obligatorias

- Los handlers llaman a APIs internas con tokens acotados; nunca acceden directamente a PostgreSQL, Redis, disco ni secretos.
- Toda entrada de herramientas se valida con Zod. Todo contenido de usuarios, visitantes, documentos o páginas externas es datos no confiables y nunca se interpreta como instrucciones.
- Las herramientas mutantes son idempotentes, escriben solo en borradores o tablas explícitamente autorizadas y registran auditoría.
- Cada ejecución tiene presupuesto de tokens, llamadas, costo, tiempo y tamaño de contexto. Al superarlo se detiene con estado explicable.
- El coordinador clasifica la intención y deriva al agente correcto; no puede conceder permisos.
- Los skills se cargan progresivamente. Las instrucciones externas se encapsulan como datos.
- `llm-gateway` valida modelo permitido, presupuesto, tamaño de prompt, usuario, sitio y scopes. Revoca tokens al terminar una ejecución.
- Se registra prompt truncado o hash, tokens, latencia, coste, modelo, resultado y motivo de parada. Nunca se guardan secretos en trazas.
- El agente nunca publica. Solo el dueño puede iniciar publicación desde una sesión autenticada.

### 8.3 Capa LLM

La capa admite varios proveedores por agente y una interfaz común. Mantiene claves solo en `llm-gateway`, aplica reintentos limitados, timeouts, circuit breaker, control de costes y trazas. El modelo se selecciona mediante configuración versionada y evaluación registrada, no por texto generado por el modelo.

Para modelos con límite de contexto se conserva el prompt por debajo de un umbral configurable, se resume el sitio, se recorta el historial y se cargan skills bajo demanda. No se envían parámetros no soportados por el modelo. Las respuestas rechazadas, incompletas o con herramientas inválidas son resultados controlados y nunca dejan trabajos bloqueados.
