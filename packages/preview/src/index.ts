import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Vista previa aislada (spec 5.5). Dos variantes del mismo mecanismo:
//   desarrollo: <token>.preview.localhost:<puerto>
//   produccion: <token>.vistaprevia.com
// El aislamiento no depende de Cloudflare: es subdominio propio + token de un solo
// uso + cookie acotada a ese subdominio + CSP + X-Robots-Tag.

export interface PreviewConfig {
  // Dominio base de la vista previa ("preview.localhost" o "vistaprevia.com").
  baseDomain: string;
  // Secreto para firmar enlaces; nunca se guarda en el repositorio.
  secret: string;
  // Validez del enlace en minutos (14.1: 15 por defecto).
  ttlMinutes: number;
  // `Secure` se relaja solo en desarrollo servido por HTTP.
  secure: boolean;
}

export const DEFAULT_TTL_MINUTES = 15;

export function newPreviewToken(): string {
  // Aleatorio y sin significado: no codifica el sitio ni el usuario.
  return randomBytes(16).toString("base64url");
}

interface Claims {
  siteId: string;
  pageId: string;
  exp: number; // epoch ms
  jti: string; // identifica el enlace para que sea de un solo uso
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signPreviewLink(cfg: PreviewConfig, siteId: string, pageId: string, nowMs: number = Date.now()): { token: string; url: string; jti: string; exp: number } {
  const claims: Claims = { siteId, pageId, exp: nowMs + cfg.ttlMinutes * 60_000, jti: newPreviewToken() };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const token = `${payload}.${sign(payload, cfg.secret)}`;
  return { token, url: `http://${newPreviewToken()}.${cfg.baseDomain}/${token}`, jti: claims.jti, exp: claims.exp };
}

export type VerifyResult = { ok: true; claims: Claims } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyPreviewToken(cfg: PreviewConfig, token: string, nowMs: number = Date.now()): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [payload, sig] = parts as [string, string];
  const expected = sign(payload, cfg.secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof claims.exp !== "number" || claims.exp < nowMs) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

// Cookie propia del subdominio de vista previa: nunca la del panel.
export function previewCookie(name: string, value: string, cfg: PreviewConfig): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  if (cfg.secure) parts.push("Secure");
  return parts.join("; ");
}

// Cabeceras de toda respuesta de vista previa.
export function previewHeaders(csp: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-security-policy": csp,
    "x-robots-tag": "noindex",
    // El iframe nunca comparte origen con la aplicacion.
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "no-referrer",
    ...extra,
  };
}

// El host de la peticion debe ser exactamente un subdominio de la vista previa.
export function previewHostMatches(host: string, cfg: PreviewConfig): boolean {
  const h = host.split(":")[0] ?? "";
  const suffix = `.${cfg.baseDomain}`;
  if (!h.endsWith(suffix)) return false;
  const label = h.slice(0, -suffix.length);
  return label.length > 0 && !label.includes(".");
}

// Consumo de un solo uso: el que llama decide donde guarda los jti usados.
export interface UsedLinkStore {
  has(jti: string): Promise<boolean>;
  mark(jti: string): Promise<void>;
}

export async function consumeLink(store: UsedLinkStore, jti: string): Promise<boolean> {
  if (await store.has(jti)) return false;
  await store.mark(jti);
  return true;
}

// --- URL de asset firmadas (T-021) -----------------------------------------
// El iframe de la vista previa va con `sandbox` y sin `allow-same-origin`: su
// origen es opaco, asi que el navegador NO manda la cookie de sesion en lo que
// pide desde dentro (comprobado en Chromium). Por eso `/assets/<sitio>/...` no
// puede pasar alli el control del dueno y la vista previa incrustaba cada foto
// en base64: 960 KB de HTML para cuatro fotos.
//
// La salida es la misma firma HMAC de los enlaces de vista previa, atada al
// sitio, a la ruta exacta del asset y a una caducidad corta. No hay mecanismo
// criptografico nuevo: es el mismo `sign()` con otro juego de claims.

export interface AssetSigningKey {
  secret: string;
  ttlMinutes: number;
}

interface AssetClaims {
  // Discrimina el proposito: una firma de asset nunca vale como enlace de
  // vista previa, y al reves tampoco.
  kind: "asset";
  siteId: string;
  assetPath: string;
  exp: number; // epoch ms
}

// Clave efimera para procesos sin `PREVIEW_SECRET`. La vista previa se
// regenera en cada edicion, asi que la firma solo tiene que durar lo que dure
// el proceso; no hay nada que persistir.
export function newAssetSigningKey(ttlMinutes: number = DEFAULT_TTL_MINUTES): AssetSigningKey {
  return { secret: randomBytes(32).toString("base64url"), ttlMinutes };
}

export function signAssetUrl(key: AssetSigningKey, siteId: string, assetPath: string, nowMs: number = Date.now()): string {
  const claims: AssetClaims = { kind: "asset", siteId, assetPath, exp: nowMs + key.ttlMinutes * 60_000 };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, key.secret)}`;
}

/**
 * Comprueba una firma de asset contra el sitio y la ruta que se estan pidiendo.
 *
 * Devuelve `false` ante cualquier discrepancia: firma, caducidad, sitio o ruta.
 * El que llama no debe distinguir el motivo: la respuesta es siempre 404, para
 * no revelar si el asset existe.
 */
export function verifyAssetUrl(key: AssetSigningKey, token: string, siteId: string, assetPath: string, nowMs: number = Date.now()): boolean {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [payload, sig] = parts as [string, string];
  const expected = sign(payload, key.secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  let claims: AssetClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AssetClaims;
  } catch {
    return false;
  }
  if (claims?.kind !== "asset") return false;
  if (typeof claims.exp !== "number" || claims.exp < nowMs) return false;
  if (claims.siteId !== siteId) return false;
  if (claims.assetPath !== assetPath) return false;
  return true;
}
