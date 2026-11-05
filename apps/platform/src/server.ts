import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import pg from "pg";
import { migrate } from "@webdesign/db";
import {
  verifyPreviewToken,
  previewCookie,
  previewHeaders,
  previewHostMatches,
  consumeLink,
  type PreviewConfig,
  type UsedLinkStore,
} from "@webdesign/preview";

// Punto de entrada de `platform`: healthcheck, panel y vista previa aislada.
// La vista previa vive en su propio subdominio, con su propia cookie (spec 5.5).

export interface AppOptions {
  preview?: PreviewConfig | undefined;
  // Renderiza el HTML de una pagina para la vista previa. Se inyecta para poder probar.
  renderPreview?: ((siteId: string, pageId: string) => Promise<string | undefined>) | undefined;
  usedLinks?: UsedLinkStore | undefined;
}

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

    json(res, 404, { error: "not_found" });
  });
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
