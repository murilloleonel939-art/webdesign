import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
import { parseCookies, resolveSession, login, createUser, createSite, listSites, saveDraft, loadDraft, publish, rollbackTo, activeAssets, SESSION_COOKIE } from "./api.js";
import { renderPage } from "@webdesign/renderer";
import { registerAsset, type AssetKind } from "@webdesign/assets";

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

const PREVIEW_CSP = "default-src 'self'; img-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'none'";

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
        const body = await readFile(join(UI_DIR, file));
        res.writeHead(200, { "content-type": type, "content-security-policy": PANEL_CSP, "x-robots-tag": "noindex" });
        res.end(body);
      } catch {
        json(res, 404, { error: "not_found" });
      }
      return;
    }

    // --- Ciclo del editor (Fase 1): crear, editar, publicar, revertir ---
    if (opts.pool && url.pathname.startsWith("/api/")) {
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

  if (req.method === "GET" && url.pathname === "/api/sites") {
    if (!session) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    json(res, 200, { sites: await listSites(pool, session.userId) });
    return true;
  }

  // Subida de asset: cuerpo binario crudo; el tipo real se detecta del contenido.
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
    if (req.method === "GET") {
      const rows = await withUser(pool, session.userId, async (tx) =>
        (await tx.query("SELECT id, kind, bytes, takedown_status FROM assets WHERE site_id = $1 ORDER BY created_at", [siteId])).rows,
      );
      json(res, 200, { assets: rows });
      return true;
    }
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
        const path = assets.resolveAssetPath(id);
        return path ? { src: path, alt: "" } : undefined;
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
    const body = (await readJson(req)) as { confirmWarnings?: boolean } | undefined;
    const assets = await activeAssets(pool, session.userId, siteId, sitesRoot);
    const r = await publish(pool, {
      sitesRoot, userId: session.userId, siteId, doc: draft.doc,
      resolveAssetPath: assets.resolveAssetPath, assetFiles: assets.assetFiles,
      ...(body?.confirmWarnings ? { confirmWarnings: true } : {}),
    });
    if (r.ok) json(res, 200, { version: r.version, findings: r.findings });
    else json(res, 409, { error: "blocked", findings: r.findings });
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
    const version = await rollbackTo(pool, { sitesRoot, userId: session.userId, siteId },
      body?.version === undefined ? undefined : Number(body.version));
    json(res, 200, { version });
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
    const preview: PreviewConfig | undefined = process.env.PREVIEW_SECRET
      ? {
          baseDomain: process.env.PREVIEW_BASE_DOMAIN ?? "preview.localhost",
          secret: process.env.PREVIEW_SECRET,
          ttlMinutes: Number(process.env.PREVIEW_TTL_MINUTES ?? 15),
          secure: process.env.PREVIEW_SECURE === "1",
        }
      : undefined;
    createApp({ preview }).listen(port, () => console.log(`platform on :${port}`));
  };
  start().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
