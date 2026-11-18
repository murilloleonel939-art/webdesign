import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { hashPassword } from "@webdesign/auth";
import pg from "pg";
import { readFile, rm, unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import { migrate, withUser } from "@webdesign/db";
import {
  verifyPreviewToken,
  previewCookie,
  previewHeaders,
  previewHostMatches,
  consumeLink,
  type PreviewConfig,
  type UsedLinkStore,
} from "@webdesign/preview";
import { listStyles, getStyle, applyStyleToDocument, isStyleApplyMode } from "./catalog.js";
import { listLeads, countNewLeads, setLeadStatus, isLeadStatus } from "./inbox.js";
import { isOperator, listAllSites, summary } from "./operator.js";
import { handleLead, clientIp, parseLeadForm } from "./lead.js";
import { ensureHostname, linkHost, unlinkHost } from "./hosting.js";
import { parseCookies, resolveSession, login, createUser, createSite, deleteSite, listSites, saveDraft, loadDraft, publish, rollbackTo, unpublish, isAnotherSiteActive, activeAssets, SESSION_COOKIE } from "./api.js";
import { renderPage } from "@webdesign/renderer";
import { registerAsset, type AssetKind } from "@webdesign/assets";
import { quickBriefSchema, designAgent, FAST_BUDGET } from "@webdesign/agent-design";
import { diagnosticsEnabled, tokenMatches, runDiagnostics } from "./diagnose.js";

// Punto de entrada de `platform`: healthcheck, panel y vista previa aislada.
// La vista previa vive en su propio subdominio, con su propia cookie (spec 5.5).

export interface AppOptions {
  pool?: import("pg").Pool | undefined;
  sitesRoot?: string | undefined;
  preview?: PreviewConfig | undefined;
  // Renderiza el HTML de una pagina para la vista previa. Se inyecta para poder probar.
  renderPreview?: ((siteId: string, pageId: string) => Promise<string | undefined>) | undefined;
  usedLinks?: UsedLinkStore | undefined;
}

// El panel solo carga su propio bundle; ningun tercero entra (spec 5.3).
const PANEL_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'";
const UI_DIR = process.env.UI_DIR ?? new URL("../ui-dist/", import.meta.url).pathname;

// La vista previa incrusta cada imagen como data: URI para que se vea igual
// que al publicar sin depender del origen del panel. Sin `data:` en img-src el
// navegador las bloqueaba y la imagen no aparecia en la vista previa.
const PREVIEW_CSP = "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'none'";

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(body);
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

// Almacen de enlaces usados en memoria: suficiente para un proceso; en produccion
// el que llama pasa uno respaldado por Redis.
function memoryStore(): UsedLinkStore {
  const seen = new Set<string>();
  return { has: async (j) => seen.has(j), mark: async (j) => void seen.add(j) };
}

// Un sitio creado antes de este arreglo tiene el titulo SEO vacio y el linter
// lo bloquea como error, asi que quedaba impublicable para siempre. Al
// publicar se rellena con el nombre del sitio: no es un bypass, porque solo se
// toca el titulo vacio y el resto de hallazgos sigue bloqueando. El dueno
// puede escribir el suyo desde el panel del editor.
function withSeoFallback(doc: unknown): unknown {
  const d = doc as { meta?: { name?: string }; pages?: Array<{ seo?: { title?: string; description?: string } }> };
  const name = d.meta?.name?.trim();
  if (!name || !Array.isArray(d.pages)) return doc;
  return {
    ...d,
    pages: d.pages.map((p) => {
      const title = p.seo?.title?.trim();
      const description = p.seo?.description?.trim();
      if (title && description) return p;
      return {
        ...p,
        seo: {
          ...p.seo,
          title: title || name.slice(0, 70),
          description: description || name.slice(0, 160),
        },
      };
    }),
  };
}

// Subir una imagen no la anade a doc.assets: la seccion la referenciaba y el
// linter la daba por inexistente (SCHEMA_INVALID), bloqueando la publicacion
// de la seccion. Antes de validar se declaran los assets que las secciones
// usan y que el sitio tiene de verdad.
function declareAssets(doc: unknown, known: Map<string, { id: string }>): unknown {
  const d = doc as { assets?: Array<{ id: string }>; pages?: Array<{ sections?: Array<{ props?: Record<string, unknown> }> }> };
  if (!Array.isArray(d.pages)) return doc;
  const declared = new Set((d.assets ?? []).map((a) => a.id));
  const used = new Set<string>();
  for (const page of d.pages) for (const section of page.sections ?? []) {
    const p = section.props ?? {};
    if (typeof p["assetId"] === "string") used.add(p["assetId"]);
    if (Array.isArray(p["assetIds"])) for (const id of p["assetIds"]) if (typeof id === "string") used.add(id);
  }
  const missing = [...used].filter((id) => !declared.has(id) && known.has(id)).map((id) => ({ id }));
  if (missing.length === 0) return doc;
  return { ...d, assets: [...(d.assets ?? []), ...missing] };
}

export function createApp(opts: AppOptions = {}) {
  const usedLinks = opts.usedLinks ?? memoryStore();

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host ?? "";
    const url = new URL(req.url ?? "/", `http://${host}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, { status: "ok" });
      return;
    }

    // --- Vista previa aislada ---
    if (opts.preview && previewHostMatches(host, opts.preview)) {
      if (req.method !== "GET") {
        send(res, 405, "method not allowed", previewHeaders(PREVIEW_CSP));
        return;
      }
      const token = decodeURIComponent(url.pathname.replace(/^\//, ""));
      const verified = verifyPreviewToken(opts.preview, token);
      if (!verified.ok) {
        // Un enlace vencido o falsificado no revela nada.
        send(res, 403, "forbidden", previewHeaders(PREVIEW_CSP));
        return;
      }
      if (!(await consumeLink(usedLinks, verified.claims.jti))) {
        send(res, 403, "forbidden", previewHeaders(PREVIEW_CSP));
        return;
      }
      const html = opts.renderPreview
        ? await opts.renderPreview(verified.claims.siteId, verified.claims.pageId)
        : undefined;
      if (html === undefined) {
        send(res, 404, "not found", previewHeaders(PREVIEW_CSP));
        return;
      }
      // La cookie queda acotada a este subdominio y a este sitio.
      const cookie = previewCookie(`pv_${verified.claims.siteId}`, verified.claims.jti, opts.preview);
      send(res, 200, html, previewHeaders(PREVIEW_CSP, { "set-cookie": cookie }));
      return;
    }

    // --- Diagnostico de base de datos (solo lectura, opt-in por token) ---
    // Va ANTES del panel: si no, el comodin GET /app/* lo captura y devuelve 404.
    if (url.pathname === "/app/diagnose" && diagnosticsEnabled()) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { error: "method_not_allowed" });
        return;
      }
      const presented = req.headers["x-diagnostic-token"];
      if (!tokenMatches(typeof presented === "string" ? presented : null)) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      if (!opts.pool) {
        json(res, 503, { error: "database_not_configured" });
        return;
      }
      const report = await runDiagnostics(opts.pool, opts.sitesRoot ?? "/data/sites");
      res.writeHead(report.ok ? 200 : 503, {
        "content-type": "application/json; charset=utf-8",
        // Nunca indexable ni cacheable: lleva estados internos.
        "x-robots-tag": "noindex",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(report, null, 2));
      return;
    }

    // --- Panel del editor (Fase 1) ---
    // Se sirve en su propio origen con una CSP estricta: el panel maneja la sesion,
    // asi que no admite scripts ni estilos de terceros.
    if (req.method === "GET" && (url.pathname === "/app" || url.pathname === "/app/" || url.pathname.startsWith("/app/"))) {
      const file = url.pathname === "/app" || url.pathname === "/app/" ? "panel.html" : url.pathname.slice("/app/".length);
      if (!/^[a-z0-9.-]+\.(html|js|css)$/.test(file)) {
        json(res, 404, { error: "not_found" });
        return;
      }
      const type = file.endsWith(".js") ? "text/javascript; charset=utf-8"
        : file.endsWith(".css") ? "text/css; charset=utf-8"
        : "text/html; charset=utf-8";
      try {
        const raw = await readFile(join(UI_DIR, file));
        // El HTML referencia el JS y el CSS con un hash de su contenido. Sirve
        // para dos cosas: el navegador nunca mezcla el HTML nuevo con el bundle
        // viejo, y la CDN que haya delante no puede servir uno antiguo aunque
        // imponga su propio TTL sobre `.js` (Cloudflare lo hace: devolvia
        // max-age=14400 ignorando nuestro no-cache, y el editor seguia
        // mostrando el codigo anterior tras desplegar).
        let body = raw;
        if (file.endsWith(".html")) {
          const stamp = async (name: string): Promise<string> => {
            try {
              return createHash("sha256").update(await readFile(join(UI_DIR, name))).digest("base64url").slice(0, 8);
            } catch {
              return "0";
            }
          };
          const [js, css] = await Promise.all([stamp("panel.js"), stamp("panel.css")]);
          body = Buffer.from(
            raw.toString()
              .replace('/app/panel.js"', `/app/panel.js?v=${js}"`)
              .replace('/app/panel.css"', `/app/panel.css?v=${css}"`),
          );
        }
        // Sin cabecera de cache el navegador aplica cache heuristica y puede
        // seguir mostrando el bundle viejo tras un despliegue. El HTML nunca se
        // cachea; el JS y el CSS se revalidan con ETag, que es barato y correcto.
        const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
        const headers = {
          "content-type": type,
          "content-security-policy": PANEL_CSP,
          "x-robots-tag": "noindex",
          etag,
          "cache-control": file.endsWith(".html") ? "no-store" : "no-cache",
        };
        if (req.headers["if-none-match"] === etag) {
          res.writeHead(304, headers);
          res.end();
          return;
        }
        res.writeHead(200, headers);
        res.end(body);
      } catch {
        json(res, 404, { error: "not_found" });
      }
      return;
    }

    // --- Ciclo del editor (Fase 1) y formularios publicos (Fase 2) ---
    // `/_f/` falta aqui y el formulario nunca llegaba a handleApi: respondia
    // 404 antes de entrar. Va en la misma condicion que /api/.
    if (opts.pool && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/_f/"))) {
      const handled = await handleApi(opts.pool, opts.sitesRoot ?? "/data/sites", req, res, url);
      if (handled) return;
    }

    json(res, 404, { error: "not_found" });
  });
}

// Lee el cuerpo crudo con limite duro. Devuelve undefined si excede el limite.
async function readBinary(req: IncomingMessage, limit: number): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return undefined;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Limite duro: un documento de sitio no se acerca a esto.
    if (size > 2_000_000) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleApi(pool: import("pg").Pool, sitesRoot: string, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  // --- Formularios publicos (Fase 2) ---
  // El sitio se resuelve por `Host`, nunca por un parametro del cliente.
  // Caddy reenvia /_f/* aqui conservando el Host (spec linea 403).
  if (url.pathname === "/_f/lead") {
    if (req.method !== "POST") {
      send(res, 405, "method not allowed");
      return true;
    }
    let raw: Record<string, unknown>;
    try {
      raw = await parseLeadForm(req);
    } catch {
      send(res, 400, "bad request");
      return true;
    }
    const result = await handleLead(pool, raw, {
      host: req.headers.host ?? "",
      ip: clientIp(req.headers, req.socket.remoteAddress),
      userAgent: String(req.headers["user-agent"] ?? ""),
      consentVersion: "v1",
    });
    // `invalid` se decide antes de mirar el host, asi que responder 400 no
    // revela si el sitio existe. Host desconocido y limite superado comparten
    // la misma respuesta que un envio correcto (spec linea 404).
    if (!result.ok && result.reason === "invalid") {
      send(res, 400, "invalid");
      return true;
    }
    send(res, 200, "ok");
    return true;
  }

  const session = await resolveSession(pool, parseCookies(req.headers.cookie)[SESSION_COOKIE]);

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = (await readJson(req)) as { email?: string; password?: string };
    const r = await login(pool, body.email ?? "", body.password ?? "");
    if (!r) {
      json(res, 401, { error: "invalid_credentials" });
      return true;
    }
    res.setHeader("set-cookie", `${SESSION_COOKIE}=${r.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/sites") {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const body = (await readJson(req)) as { name?: string };
    const id = await createSite(pool, session.userId, body.name ?? "Mi sitio");
    json(res, 201, { id });
    return true;
  }

  const deleteSiteMatch = /^\/api\/sites\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (req.method === "DELETE" && deleteSiteMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const siteId = deleteSiteMatch[1]!;
    const deleted = await deleteSite(pool, session.userId, siteId);
    // Las filas ya no existen: se borra tambien la carpeta del sitio y sus assets.
    if (deleted) await rm(join(sitesRoot, siteId), { recursive: true, force: true });
    json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "not_found" });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/sites") {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    json(res, 200, { sites: await listSites(pool, session.userId) });
    return true;
  }

  // Assets publicos. La ruta llega del navegador, asi que antes de leer el
  // disco se comprueba quien la pide: el duenno ve sus propios assets aunque el
  // sitio siga en borrador; cualquier otro solo ve los de un sitio publicado y
  // sin retirar. Sin esta comprobacion, saber el uuid de un sitio bastaba para
  // descargar los assets de un borrador ajeno.
  const publicAssetMatch = /^\/assets\/([0-9a-f-]{36})\/(image|video|poster)\/([a-zA-Z0-9._-]+)$/.exec(url.pathname);
  if (req.method === "GET" && publicAssetMatch) {
    const siteId = publicAssetMatch[1]!;
    const relative = `${publicAssetMatch[2]}/${publicAssetMatch[3]}`;

    let allowed = false;
    if (session) {
      // Se pregunta por la fila, no por el sitio: `withUser` pone `app.user_id`
      // y la politica de 0003 ya limita a los sitios del duenno. El JOIN con
      // `sites` y `owner_id` es la condicion explicita del permiso.
      const own = await withUser(pool, session.userId, async (tx) =>
        (await tx.query(
          "SELECT 1 FROM assets a JOIN sites s ON s.id = a.site_id WHERE a.site_id = $1 AND a.path = $2 AND s.owner_id = $3",
          [siteId, relative, session.userId],
        )).rows[0],
      );
      allowed = own !== undefined;
    }
    if (!allowed) {
      // SECURITY DEFINER (0019): el visitante anonimo no puede leer `assets` ni
      // `sites` con RLS forzado. La funcion responde solo si el sitio esta
      // activo y el asset existe sin retirada.
      const r = await pool.query<{ ok: boolean }>("SELECT app_public_asset_visible($1, $2) AS ok", [siteId, relative]);
      allowed = r.rows[0]?.ok === true;
    }
    if (!allowed) {
      json(res, 404, { error: "not_found" });
      return true;
    }

    const physical = join(sitesRoot, siteId, "assets", relative);
    try {
      const body = await readFile(physical);
      const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(physical).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": mime, "cache-control": "private, max-age=3600" });
      res.end(body);
    } catch { json(res, 404, { error: "not_found" }); }
    return true;
  }

  const assetsMatch = /^\/api\/sites\/([0-9a-f-]{36})\/assets$/.exec(url.pathname);
  if (assetsMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const siteId = assetsMatch[1] as string;
    if (req.method === "POST") {
      const kind = url.searchParams.get("kind");
      if (kind !== "image" && kind !== "video" && kind !== "poster") {
        json(res, 422, { error: "invalid_kind" });
        return true;
      }
      const content = await readBinary(req, 9 * 1024 * 1024);
      if (!content) {
        json(res, 413, { error: "too_large" });
        return true;
      }
      const r = await registerAsset(pool, {
        userId: session.userId, siteId, kind: kind as AssetKind, content,
        declaredMime: req.headers["content-type"], source: "own", sitesRoot,
      });
      if (r.ok) json(res, 201, { id: r.id, bytes: r.bytes });
      else json(res, 422, { error: r.reason });
      return true;
    }
    if (req.method === "DELETE") {
      const assetId = url.searchParams.get("id");
      if (!assetId) { json(res, 422, { error: "missing_id" }); return true; }
      // El RETURNING da la ruta relativa: sin ella el archivo quedaria huerfano en disco.
      const removed = await withUser(pool, session.userId, async (tx) =>
        (await tx.query<{ path: string }>(
          "DELETE FROM assets WHERE id = $1 AND site_id = $2 RETURNING path",
          [assetId, siteId],
        )).rows[0],
      );
      if (!removed) { json(res, 404, { error: "not_found" }); return true; }
      // La fila ya no existe: si falla el borrado del archivo se avisa, pero no se
      // deja el asset publicado. Las releases ya copiaron sus propios bytes.
      try {
        await unlink(join(sitesRoot, siteId, "assets", removed.path));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      json(res, 204, {});
      return true;
    }
    if (req.method === "GET") {
      const rows = await withUser(pool, session.userId, async (tx) =>
        (await tx.query("SELECT id, kind, bytes, mime, path, takedown_status FROM assets WHERE site_id = $1 ORDER BY created_at", [siteId])).rows,
      );
      json(res, 200, { assets: rows.map((a) => ({ ...a, publicUrl: `/assets/${siteId}/${a.path}` })) });
      return true;
    }
  }

  // Panel de operador (Fase 2). Solo lectura. Sin rol `operator` responde 403
  // y no 404: el dueno debe saber que existe, aunque no pueda entrar.
  if (url.pathname === "/api/operator/sites" && req.method === "GET") {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    if (!pool) {
      json(res, 503, { error: "database_not_configured" });
      return true;
    }
    if (!(await isOperator(pool, session.userId))) {
      json(res, 403, { error: "forbidden" });
      return true;
    }
    const [sites, totals] = await Promise.all([
      listAllSites(pool, session.userId),
      summary(pool, session.userId),
    ]);
    json(res, 200, { sites, summary: totals });
    return true;
  }

  // Bandeja de mensajes del dueno (Fase 2). La tabla tenia politica RLS desde
  // `0008` pero ninguna consulta la usaba: los mensajes del formulario se
  // guardaban y nadie podia leerlos.
  // Bandeja de mensajes del dueno (Fase 2). La tabla tenia politica RLS desde
  // `0008` pero ninguna consulta la usaba: los mensajes del formulario se
  // guardaban y nadie podia leerlos.
  const leadOneMatch = /^\/api\/sites\/([0-9a-f-]{36})\/leads\/([0-9a-f-]{36})$/.exec(url.pathname);
  const inboxMatch = leadOneMatch ? null : /^\/api\/sites\/([0-9a-f-]{36})\/leads$/.exec(url.pathname);
  if (inboxMatch ?? leadOneMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    if (!pool) {
      json(res, 503, { error: "database_not_configured" });
      return true;
    }
    if (leadOneMatch) {
      const siteId = leadOneMatch[1] as string;
      const leadId = leadOneMatch[2] as string;
      if (req.method !== "PATCH") {
        json(res, 405, { error: "method_not_allowed" });
        return true;
      }
      const body = (await readJson(req)) as { status?: unknown } | undefined;
      if (!isLeadStatus(body?.status)) {
        json(res, 400, { error: "unknown_status", status: body?.status });
        return true;
      }
      const changed = await setLeadStatus(pool, session.userId, siteId, leadId, body.status);
      // Un id de otra cuenta no existe para esta: mismo 404 que uno inventado.
      if (!changed) {
        json(res, 404, { error: "not_found" });
        return true;
      }
      json(res, 200, { ok: true, status: body.status });
      return true;
    }
    const siteId = inboxMatch![1] as string;
    if (req.method !== "GET") {
      json(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const [leads, newCount] = await Promise.all([
      listLeads(pool, session.userId, siteId),
      countNewLeads(pool, session.userId, siteId),
    ]);
    json(res, 200, { leads, newCount });
    return true;
  }

  // Catalogo de diseno (Fase 1b). Datos globales: la lista no exige sesion solo
  // se expone con sesion valida para no publicar el catalogo a cualquiera.
  if (url.pathname === "/api/design-styles" && req.method === "GET") {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    if (!pool) {
      json(res, 503, { error: "database_not_configured" });
      return true;
    }
    json(res, 200, { styles: await listStyles(pool) });
    return true;
  }

  // Aplicar un preset: transforma el borrador y lo guarda por la via normal,
  // con revision optimista y audit_log como cualquier otro cambio.
  const presetMatch = /^\/api\/sites\/([0-9a-f-]{36})\/apply-preset$/.exec(url.pathname);
  if (presetMatch && req.method === "POST") {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    if (!pool) {
      json(res, 503, { error: "database_not_configured" });
      return true;
    }
    const siteId = presetMatch[1] as string;
    const body = (await readJson(req)) as { presetId?: unknown; expectedRev?: unknown; mode?: unknown };
    const presetId = typeof body.presetId === "string" ? body.presetId : "";
    if (!presetId) {
      json(res, 400, { error: "preset_required" });
      return true;
    }
    // Sin modo explicito se conserva el contenido: destructivo nunca por defecto.
    if (body.mode !== undefined && !isStyleApplyMode(body.mode)) {
      json(res, 400, { error: "unknown_mode", mode: body.mode });
      return true;
    }
    const mode = isStyleApplyMode(body.mode) ? body.mode : "inherit";
    const style = await getStyle(pool, presetId);
    if (!style) {
      // Preset inexistente: 400, no 404. El cliente pidio algo invalido.
      json(res, 400, { error: "unknown_preset", presetId });
      return true;
    }
    const current = await loadDraft(pool, session.userId, siteId);
    if (!current) {
      json(res, 404, { error: "no_draft" });
      return true;
    }
    const applied = applyStyleToDocument(current.doc as Parameters<typeof applyStyleToDocument>[0], style, mode);
    const { doc } = applied;
    const saved = await saveDraft(pool, {
      userId: session.userId, siteId, doc,
      expectedRev: Number(body.expectedRev ?? current.rev), actorType: "user",
    });
    if (saved.ok) {
      json(res, 200, { rev: saved.rev, presetId, mode, sectionsChanged: applied.sectionsChanged, findings: saved.findings });
    } else if (saved.reason === "conflict") {
      json(res, 409, { error: "conflict", currentRev: saved.currentRev });
    } else {
      json(res, 422, { error: "invalid", findings: saved.findings, errors: saved.errors });
    }
    return true;
  }

  const draftMatch = /^\/api\/sites\/([0-9a-f-]{36})\/draft$/.exec(url.pathname);
  if (draftMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const siteId = draftMatch[1] as string;
    if (req.method === "GET") {
      const d = await loadDraft(pool, session.userId, siteId);
      if (!d) {
        json(res, 404, { error: "no_draft" });
        return true;
      }
      json(res, 200, d);
      return true;
    }
    if (req.method === "PUT") {
      const body = (await readJson(req)) as { doc?: unknown; expectedRev?: number };
      const r = await saveDraft(pool, {
        userId: session.userId, siteId, doc: body.doc,
        expectedRev: Number(body.expectedRev ?? 0), actorType: "user",
      });
      if (r.ok) {
        json(res, 200, { rev: r.rev, findings: r.findings });
      } else if (r.reason === "conflict") {
        // El editor debe recargar: no se pisa el trabajo de la otra pestana.
        json(res, 409, { error: "conflict", currentRev: r.currentRev });
      } else {
        json(res, 422, { error: "invalid", findings: r.findings, errors: r.errors });
      }
      return true;
    }
  }

  // Vista previa del borrador para el iframe del panel. Devuelve HTML con la CSP
  // del sitio y las cabeceras de vista previa: nunca indexable (spec 5.5).
  const previewDraftMatch = /^\/api\/sites\/([0-9a-f-]{36})\/preview$/.exec(url.pathname);
  if (req.method === "GET" && previewDraftMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const siteId = previewDraftMatch[1] as string;
    const d = await loadDraft(pool, session.userId, siteId);
    if (!d) {
      json(res, 404, { error: "no_draft" });
      return true;
    }
    const pageId = url.searchParams.get("page") ?? "p_home";
    const assets = await activeAssets(pool, session.userId, siteId, sitesRoot);
    try {
      const rendered = renderPage(d.doc, pageId, (id) => {
        // El iframe de vista previa corre aislado: una ruta relativa no resolveria.
        // Se incrusta la imagen como data URI para que se vea igual que al publicar.
        const path = assets.resolveAssetPath(id);
        if (!path) return undefined;
        const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(path).toLowerCase()] ?? "image/png";
        const found = assets.assetFilesById.get(id);
        return found
          ? { src: `data:${mime};base64,${found.toString("base64")}`, alt: "" }
          : { src: path, alt: "" };
      });
      send(res, 200, rendered, previewHeaders(PREVIEW_CSP));
    } catch {
      // Un borrador invalido no tumba el panel: se muestra el aviso.
      json(res, 422, { error: "invalid_draft" });
    }
    return true;
  }

  const publishMatch = /^\/api\/sites\/([0-9a-f-]{36})\/publish$/.exec(url.pathname);
  if (req.method === "POST" && publishMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const siteId = publishMatch[1] as string;
    const draft = await loadDraft(pool, session.userId, siteId);
    if (!draft) {
      json(res, 404, { error: "no_draft" });
      return true;
    }
    const body = (await readJson(req)) as { confirmWarnings?: boolean; confirmVisual?: boolean } | undefined;
    const assets = await activeAssets(pool, session.userId, siteId, sitesRoot);
    const r = await publish(pool, {
      sitesRoot, userId: session.userId, siteId, doc: withSeoFallback(declareAssets(draft.doc, assets.known)),
      resolveAssetPath: assets.resolveAssetPath, assetFiles: assets.assetFiles,
      licensedAssetIds: assets.licensedAssetIds,
      ...(body?.confirmWarnings ? { confirmWarnings: true } : {}),
      ...(body?.confirmVisual ? { confirmVisualFindings: true } : {}),
    });
    if (!r.ok) {
      // Spec 1.15: un solo sitio publicado por cuenta. El dueno ya tenia otro
      // `active`; antes esto lanzaba 23505 dentro de la transaccion, el throw
      // subia por el handler async y MATABA el proceso (502 en el proxy). Se
      // responde 409 con el nombre del sitio activo para que el panel pueda
      // ofrecer despublicarlo y reintentar.
      if (isAnotherSiteActive(r)) {
        json(res, 409, { error: "another_site_active", activeSiteName: r.activeSiteName, activeSiteId: r.activeSiteId });
        return true;
      }
      // Spec 6.5: un hallazgo visual no es un bloqueo de contenido. Se responde
      // 409 igual, pero con `blocked: false` y el aviso, para que el panel
      // ofrezca «Publicar igual» en vez de obligar a corregir.
      json(res, 409, { error: r.blocked ? "blocked" : "visual_confirm", findings: r.findings });
      return true;
    }
    // Publicar sin enlace en /data/hosts no sirve el sitio: Caddy no consulta
    // la base. Si el pool esta lleno la publicacion vale, pero se avisa para
    // que no parezca que el sitio ya esta en la red.
    let hostname: string | undefined;
    try {
      const site = await pool.query<{ name: string }>("SELECT name FROM sites WHERE id = $1", [siteId]);
      const assigned = await ensureHostname(pool, { siteId, userId: session.userId, siteName: site.rows[0]?.name ?? "sitio" });
      if (assigned) {
        linkHost(process.env.HOSTS_ROOT ?? "/data/hosts", assigned.hostname, sitesRoot, siteId);
        hostname = assigned.hostname;
      }
    } catch (e) {
      // El sitio ya esta publicado; un fallo de enlace no debe deshacerlo. Pero
      // se registra: este catch mudo oculto durante toda la fase un GRANT que
      // faltaba, y el sintoma era "no queda sitio en el pool" con el pool vacio.
      console.error("hostname_failed", { siteId, error: (e as Error).message });
    }
    json(res, 200, { version: r.version, findings: r.findings, ...(hostname ? { hostname } : {}) });
    // Lint visual en segundo plano (spec 2, fila `workers`): el release ya
    // existe, aqui solo se encola, y DESPUES de responder. Encolar antes dejaba
    // la respuesta a merced de Redis: si al conectar reventaba el proceso (error
    // de socket sin oyente), el panel recibia un 502 y el release aparecia como
    // fallido aunque estuviera publicado. Sin Redis no se encola y no pasa nada;
    // un fallo al encolar se registra y la publicacion vale igual, que es lo que
    // exige 6.5 (nunca bloquea, solo informa).
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      setImmediate(() => {
        void import("@webdesign/workers")
          .then((m) => m.enqueueReleaseLint({ url: redisUrl }, { siteId, version: r.version }))
          .catch((e: unknown) => {
            console.warn("lint_enqueue_failed", { siteId, version: r.version, error: String((e && (e as Error).message) || e) });
          });
      });
    }
    return true;
  }

  // Reanudar el chat (punto D, segunda mitad): el panel necesita saber cual fue
  // la ultima ejecucion para retomar la conversacion donde se quedo. Sin esto
  // el dueno cierra la pestana y pierde el hilo.
  const designLatestMatch = /^\/api\/sites\/([0-9a-f-]{36})\/design-runs\/latest$/.exec(url.pathname);
  if (designLatestMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    if (req.method !== "GET") {
      json(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const siteId = designLatestMatch[1] as string;
    // Sitio ajeno e inexistente comparten respuesta, como en el resto de rutas.
    const found = await withUser(pool, session.userId, async (tx) => {
      const owns = (await tx.query("SELECT 1 FROM sites WHERE id = $1", [siteId])).rows[0];
      if (!owns) return undefined;
      return (await tx.query<{
        id: string; status: string; stop_reason: string | null;
        started_at: Date; ended_at: Date | null;
      }>(
        `SELECT id, status, stop_reason, started_at, ended_at FROM agent_runs
         WHERE site_id = $1 AND user_id = $2
         ORDER BY started_at DESC LIMIT 1`,
        [siteId, session.userId],
      )).rows[0];
    });
    if (!found) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    json(res, 200, {
      runId: found.id,
      status: found.status,
      stopReason: found.stop_reason,
      startedAt: found.started_at,
      endedAt: found.ended_at,
    });
    return true;
  }

  // Deshacer un diseno con IA (spec 9.1): devuelve el borrador al checkpoint
  // que el job guardo antes de tocar nada. La comprobacion de "nadie edito
  // despues" es lo que impide que este boton pise trabajo del dueno.
  const designUndoMatch = /^\/api\/sites\/([0-9a-f-]{36})\/design-runs\/([0-9a-f-]{36})\/undo$/.exec(url.pathname);
  if (designUndoMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    if (req.method !== "POST") {
      json(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const siteId = designUndoMatch[1] as string;
    const runId = designUndoMatch[2] as string;
    const body = (await readJson(req)) as { force?: unknown } | undefined;
    // Solo un `true` literal salta el aviso: cualquier otra cosa no fuerza.
    const force = body?.force === true;

    const state = await withUser(pool, session.userId, async (tx) => {
      const owns = (await tx.query("SELECT 1 FROM sites WHERE id = $1", [siteId])).rows[0];
      if (!owns) return undefined;
      const run = (await tx.query<{ status: string }>(
        "SELECT status FROM agent_runs WHERE id = $1 AND site_id = $2 AND user_id = $3",
        [runId, siteId, session.userId],
      )).rows[0];
      if (!run) return { run: undefined } as const;
      // Ultimo checkpoint de ESTA ejecucion: el que se tomo antes de escribir.
      // Columnas reales (0014:75-83): label y doc; la revision vive en `label`
      // porque el esquema no tiene columna propia para ella.
      const checkpoint = (await tx.query<{ label: string; doc: unknown }>(
        `SELECT label, doc FROM draft_checkpoints
         WHERE run_id = $1 AND site_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [runId, siteId],
      )).rows[0];
      return { run, checkpoint };
    });

    if (!state) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    if (!state.run || !state.checkpoint) {
      json(res, 404, { error: "not_found" });
      return true;
    }

    // Revision que dejo escrita la ejecucion. El checkpoint guarda la rev ANTERIOR
    // (`… (rev N)`); el job escribe con `expectedRev N`, asi que si guardo, la rev
    // nueva es N+1. Un run cerrado como `error` no guardo nada: su rev es N.
    const checkpointRev = Number(/\(rev (\d+)\)$/.exec(state.checkpoint.label)?.[1] ?? "");
    const savedIt = state.run.status === "ok" || state.run.status === "budget_exhausted";
    // Si la etiqueta no se puede leer, se toma 0: casi cualquier borrador estara
    // por encima y hara falta `force`, que es el lado seguro.
    const runRev = Number.isFinite(checkpointRev) ? checkpointRev + (savedIt ? 1 : 0) : 0;

    const current = await loadDraft(pool, session.userId, siteId);
    if (!current) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    if (current.rev > runRev && !force) {
      // El dueno siguio editando: deshacer le borraria su trabajo. Se avisa y el
      // panel decide con `force: true`.
      json(res, 409, { error: "edited_after" });
      return true;
    }

    // Restauracion por la via normal: rev optimista, validacion y `draft.save`
    // en `audit_log`, igual que cualquier otro cambio del dueno.
    const saved = await saveDraft(pool, {
      userId: session.userId, siteId, doc: state.checkpoint.doc,
      expectedRev: current.rev, actorType: "user",
    });
    if (!saved.ok) {
      if (saved.reason === "conflict") {
        // Alguien guardo entre la lectura y la escritura: mismo aviso.
        json(res, 409, { error: "edited_after" });
      } else {
        // Un checkpoint que ya no valida no se aplica a la fuerza.
        json(res, 422, { error: "invalid", findings: saved.findings, errors: saved.errors });
      }
      return true;
    }

    // Traza propia del deshacer: quien mira la auditoria distingue una vuelta
    // atras de una edicion a mano, aunque las dos las firme el dueno.
    await withUser(pool, session.userId, async (tx) => {
      await tx.query(
        `INSERT INTO audit_log (id, actor_type, actor_id, site_id, action, target, meta)
         VALUES ($1, 'user', $2, $3, 'draft.undo', $4, $5)`,
        [
          randomUUID(), session.userId, siteId, `rev${saved.rev}`,
          JSON.stringify({ runId, fromRev: current.rev, rev: saved.rev, forced: force }),
        ],
      );
    });

    json(res, 200, { rev: saved.rev });
    return true;
  }

  // Agente de diseño con IA (punto D): el dueno pide un diseño rapido desde el
  // panel. El token NUNCA vuelve al navegador: lo ve el worker, no el dueno.
  const designRunsMatch = /^\/api\/sites\/([0-9a-f-]{36})\/design-runs$/.exec(url.pathname);
  const designRunOneMatch = designRunsMatch ? null : /^\/api\/sites\/([0-9a-f-]{36})\/design-runs\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (designRunsMatch ?? designRunOneMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const siteId = (designRunsMatch ?? designRunOneMatch)![1] as string;
    // El sitio debe ser del dueno. RLS ya limita `sites` a lo suyo (0001); si
    // la fila no aparece, da igual si no existe o es de otra cuenta: 404 en
    // ambos casos, igual que en `rollback` y `unpublish`.
    const owns = await withUser(pool, session.userId, async (tx) =>
      (await tx.query("SELECT 1 FROM sites WHERE id = $1", [siteId])).rows[0],
    );
    if (!owns) {
      json(res, 404, { error: "not_found" });
      return true;
    }

    if (designRunOneMatch) {
      if (req.method !== "GET") {
        json(res, 405, { error: "method_not_allowed" });
        return true;
      }
      const runId = designRunOneMatch[2] as string;
      const run = await withUser(pool, session.userId, async (tx) =>
        (await tx.query<{ status: string; stop_reason: string | null }>(
          "SELECT status, stop_reason FROM agent_runs WHERE id = $1 AND site_id = $2 AND user_id = $3",
          [runId, siteId, session.userId],
        )).rows[0],
      );
      if (!run) {
        json(res, 404, { error: "not_found" });
        return true;
      }
      json(res, 200, { status: run.status, stopReason: run.stop_reason });
      return true;
    }

    if (req.method !== "POST") {
      json(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const body = await readJson(req);
    // El panel manda un `prompt` de texto libre ademas de los cinco campos. Se
    // recorta a 500 (6.1) y viaja dentro del brief como `description`: es
    // contexto para el resumen, no un sexto dato del negocio.
    const rawPrompt = (body as { prompt?: unknown } | undefined)?.prompt;
    const promptText = typeof rawPrompt === "string" ? rawPrompt.trim().slice(0, 500) : "";
    const briefInput = {
      ...(body && typeof body === "object" ? body : {}),
      ...(promptText ? { description: promptText } : {}),
    };
    const parsedBrief = quickBriefSchema.safeParse(briefInput);
    // Los campos son opcionales por separado, pero el brief entero no: sin un
    // solo dato el agente no puede escribir nada y la ejecucion se gastaria
    // para acabar en error. Se corta aqui, antes de crear la fila. Un brief con
    // solo `description` SI cuenta: el dueno escribio algo.
    const hasData = parsedBrief.success
      && Object.values(parsedBrief.data).some((v) => typeof v === "string" && v.trim().length > 0);
    if (!parsedBrief.success || !hasData) {
      json(res, 400, { error: "invalid_brief" });
      return true;
    }

    const runId = randomUUID();
    const jti = randomUUID();
    // Presupuesto del modo rapido (14.1): el tope de tokens del run es el del
    // agente, no un numero inventado aqui.
    const maxTokens = FAST_BUDGET.maxTokens;
    await withUser(pool, session.userId, async (tx) => {
      await tx.query(
        `INSERT INTO agent_runs (id, agent_id, user_id, site_id, status, model, prompt_tokens_max)
         VALUES ($1, $2, $3, $4, 'running', $5, $6)`,
        // `agent_id` es el del agente de verdad: el catalogo de ejecuciones se
        // agrupa por el, y un alias suelto ('design-fast') quedaria huerfano.
        [runId, designAgent.id, session.userId, siteId, designAgent.model, maxTokens],
      );
      await tx.query(
        `INSERT INTO agent_tokens (jti, run_id, scopes, site_id, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '15 minutes')`,
        [jti, runId, ["llm:complete"], siteId],
      );
    });

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      // Sin cola no hay quien ejecute el diseño: se cierra la ejecucion ya
      // mismo, se revoca el token recien creado y se avisa al panel.
      await withUser(pool, session.userId, async (tx) => {
        await tx.query(
          "UPDATE agent_runs SET status = 'error', stop_reason = $2, ended_at = now() WHERE id = $1",
          [runId, "El servicio de diseño no está disponible ahora mismo"],
        );
        await tx.query("UPDATE agent_tokens SET revoked_at = now() WHERE jti = $1", [jti]);
      });
      json(res, 503, { error: "agent_unavailable" });
      return true;
    }

    try {
      const { enqueueDesignRun } = await import("@webdesign/workers");
      await enqueueDesignRun({ url: redisUrl }, { runId, siteId, userId: session.userId, brief: parsedBrief.data });
    } catch (e) {
      console.warn("design_enqueue_failed", { siteId, runId, error: String((e && (e as Error).message) || e) });
      await withUser(pool, session.userId, async (tx) => {
        await tx.query(
          "UPDATE agent_runs SET status = 'error', stop_reason = $2, ended_at = now() WHERE id = $1",
          [runId, "El servicio de diseño no está disponible ahora mismo"],
        );
        await tx.query("UPDATE agent_tokens SET revoked_at = now() WHERE jti = $1", [jti]);
      });
      json(res, 503, { error: "agent_unavailable" });
      return true;
    }

    json(res, 202, { runId });
    return true;
  }

  const rollbackMatch = /^\/api\/sites\/([0-9a-f-]{36})\/rollback$/.exec(url.pathname);
  if (req.method === "POST" && rollbackMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const siteId = rollbackMatch[1] as string;
    const body = (await readJson(req)) as { version?: number } | undefined;
    const r = await rollbackTo(pool, { sitesRoot, userId: session.userId, siteId },
      body?.version === undefined ? undefined : Number(body.version));
    if (!r.ok) {
      // Sitio ajeno e inexistente dan lo mismo: no se filtra quien tiene que.
      if (r.reason === "not_found") json(res, 404, { error: "not_found" });
      else json(res, 409, { error: r.reason });
      return true;
    }
    json(res, 200, { version: r.version });
    return true;
  }

  // Despublicar: pasar el sitio a `draft` sin borrar nada. Es la operacion que
  // la spec 1.15 exige para poder publicar otro sitio de la misma cuenta, y
  // hasta ahora no existia: el unico camino era fallar contra el indice.
  const unpublishMatch = /^\/api\/sites\/([0-9a-f-]{36})\/unpublish$/.exec(url.pathname);
  if (req.method === "POST" && unpublishMatch) {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const siteId = unpublishMatch[1] as string;
    const r = await unpublish(pool, { userId: session.userId, siteId });
    if (!r.ok) {
      // Sitio ajeno e inexistente dan lo mismo: no se filtra quien tiene que.
      json(res, 404, { error: "not_found" });
      return true;
    }
    // Caddy no consulta la base: sin quitar el enlace, el sitio seguiria
    // sirviendose por su hostname aunque la fila diga `draft`. El release en
    // disco y sus `site_versions` se conservan enteros (spec: no se borra nada).
    try {
      const hosts = await withUser(pool, session.userId, async (tx) =>
        (await tx.query<{ hostname: string }>("SELECT hostname FROM domains WHERE site_id = $1", [siteId])).rows);
      for (const h of hosts) unlinkHost(process.env.HOSTS_ROOT ?? "/data/hosts", h.hostname);
    } catch (e) {
      // Despublicado en la base es el hecho principal; si el enlace no se pudo
      // quitar se registra y no se convierte en un 500.
      console.error("host_unlink_failed", { siteId, error: (e as Error).message });
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const start = async () => {
    if (process.env.MIGRATE_ON_START === "1") {
      const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
      if (!url) throw new Error("MIGRATE_ON_START=1 requires MIGRATION_DATABASE_URL or DATABASE_URL");
      const pool = new pg.Pool({ connectionString: url });
      const applied = await migrate(pool);
      await pool.end();
      console.log(`migrations applied: ${applied.length ? applied.join(", ") : "none"}`);
    }
    if (process.env.BOOTSTRAP_OWNER_EMAIL || process.env.BOOTSTRAP_OWNER_PASSWORD) {
      const email = process.env.BOOTSTRAP_OWNER_EMAIL;
      const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
      const name = process.env.BOOTSTRAP_OWNER_NAME ?? "Propietario";
      if (!email || !password) throw new Error("BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD are required together");
      if (password.length < 12) throw new Error("BOOTSTRAP_OWNER_PASSWORD requires at least 12 characters");
      if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for owner bootstrap");
      const bootstrapPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      const bootstrapId = randomUUID();
      const passwordHash = await hashPassword(password);
      const client = await bootstrapPool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<{ id: string }>("SELECT id FROM auth_lookup_login($1)", [email]);
        const userId = found.rows[0]?.id ?? bootstrapId;
        await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
        if (found.rows[0]) {
          await client.query("UPDATE users SET name = $2, password_hash = $3 WHERE id = $1", [userId, name, passwordHash]);
          await client.query("COMMIT");
          console.log(`bootstrap owner password synchronized: ${email}`);
        } else {
          await client.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, lower($2), $3, $4)", [userId, email, name, passwordHash]);
          await client.query("COMMIT");
          console.log(`bootstrap owner created: ${email}`);
        }
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
        await bootstrapPool.end();
      }
    }
    const preview: PreviewConfig | undefined = process.env.PREVIEW_SECRET
      ? {
          baseDomain: process.env.PREVIEW_BASE_DOMAIN ?? "preview.localhost",
          secret: process.env.PREVIEW_SECRET,
          ttlMinutes: Number(process.env.PREVIEW_TTL_MINUTES ?? 15),
          secure: process.env.PREVIEW_SECURE === "1",
        }
      : undefined;
    const pool = process.env.DATABASE_URL
      ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
      : undefined;
    createApp({ preview, pool, sitesRoot: process.env.SITES_ROOT ?? "/data/sites" })
      .listen(port, () => console.log(`platform on :${port}`));
  };
  // Red de seguridad del proceso. El arreglo de verdad es el 409 de arriba:
  // esto solo evita que un fallo inesperado en un handler async tumbe el
  // servidor entero y el proxy devuelva 502 a todos los clientes. Node mata el
  // proceso cuando una promesa se rechaza sin `catch` o algo lanza fuera de un
  // try; aqui se registra y se sigue, que es lo que un servidor debe hacer.
  // `console.error("unhandled", {...})` es el formato que ya se busca en los
  // registros de produccion para separar lo previsto de lo imprevisto.
  process.on("unhandledRejection", (reason: unknown) => {
    console.error("unhandled", {
      kind: "unhandledRejection",
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  process.on("uncaughtException", (error: Error) => {
    console.error("unhandled", { kind: "uncaughtException", error: error.message, stack: error.stack });
  });

  start().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
