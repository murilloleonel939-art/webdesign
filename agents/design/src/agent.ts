import { z } from "zod";
import { callTool, recommendDesignSystem, runAgent, type AgentDefinition, type RunContext } from "@webdesign/agent-sdk";
import type { BudgetTracker, LlmClient } from "@webdesign/llm";
import { lintSite, type LintFinding } from "@webdesign/linter";
import { lintHtml } from "@webdesign/lint-visual";
import { renderPage } from "@webdesign/renderer";
import type { SiteDocument } from "@webdesign/site-schema";
import { FIELD_LABEL, PENDING_MARKER, briefDescriptionContext, hasBriefData, normalizeBrief, quickBriefSchema, type BriefField, type QuickBrief } from "./brief.js";
import { copyPrompt, guardCopy, readCopy, retryLine, type SiteCopy } from "./copy.js";
import { draftSite, type PhotoRef, type Preset, type SitePhotos } from "./draft.js";
import { inventory, planSections, type Inventory, type Plan } from "./plan.js";
import { createStore, saveCheckpoint } from "./store.js";
import { makeDesignTools } from "./tools.js";

// Agente de diseño en MODO RÁPIDO (spec 9.1, Fase 4; presupuesto en 14.1).
//
// Una sola ronda con los cinco campos mínimos. El diseño sale de DATOS (el
// preset del catálogo), no de la imaginación del modelo: el modelo solo escribe
// el resumen que el dueño lee. El agente no publica porque no existe ninguna
// herramienta de publicar en este paquete.

/** Presupuesto del modo rápido (14.1: 1 ronda y tope de tokens de la Fase 4). */
export const FAST_BUDGET = {
  // Antes 40 000 y 0,70: cabian DOS llamadas (copy y resumen) de 2 048 tokens de
  // salida. Ahora el copy puede ir dos veces (primer intento y reintento con
  // retryLine) a 4 096 tokens de salida cada una, asi que el tope sube en la
  // misma proporcion: 40 000 -> 60 000 tokens y 0,70 -> 1,05 USD, que es el 1,5
  // por tres llamadas frente a las dos de antes.
  maxTokens: 60_000,
  maxToolCalls: 8,
  maxCostUsd: 1.05,
  timeoutMs: 45_000,
} as const;

export const designAgent: AgentDefinition = {
  id: "design",
  description: "Diseña un sitio a partir del brief del dueño aplicando un preset del catálogo.",
  model: "design",
  systemPrompt: [
    "Eres el agente de diseño de la plataforma. Trabajas en modo rápido: una sola ronda.",
    "El diseño lo decide el catálogo de presets, no tú. No inventes clientes, cifras,",
    "testimonios, precios, citas ni certificaciones. Lo que no sepas queda como",
    "'pendiente de confirmar'. No publicas: no existe herramienta para ello.",
    "Responde en español, en dos o tres frases, diciendo qué preset has aplicado y",
    "qué datos faltan por confirmar.",
  ].join(" "),
  skills: [],
  tools: [
    "get_site",
    "apply_preset",
    "set_theme",
    "add_section",
    "update_section",
    "move_section",
    "remove_section",
    "create_checkpoint",
    "revert_to_checkpoint",
  ],
  budget: { ...FAST_BUDGET },
};

export interface FastDesignDeps {
  brief: unknown;
  presets: Preset[];
  client: LlmClient;
  tracker: BudgetTracker;
  ctx: RunContext;
  /** El dueño pidió el cambio a mano: un `error` de 6.5 se aplica y solo avisa. */
  ownerRequested?: boolean;
  /**
   * Busqueda de fotos, inyectada por el llamador: este paquete NO hace fetch ni
   * conoce ningun proveedor de imagenes. Sin ella, el sitio sale sin fotos.
   */
  fetchPhotos?: (req: { query: string; orientation: "landscape" | "square"; count: number }) => Promise<PhotoRef[]>;
}

/**
 * El copy no se pudo leer tras el reintento y el dueño SI habia escrito una
 * descripcion: sin textos no hay sitio que enseñar, asi que la ejecucion para.
 * `reason` es un motivo cerrado (`json_parse`, `truncated`, `schema:...`,
 * `empty_text`, `transport_<kind>`): nunca lleva texto del dueño.
 */
export class CopyUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`copy no disponible: ${reason}`);
    this.name = "CopyUnavailableError";
  }
}

export interface FastDesignResult {
  doc: SiteDocument;
  presetId: string;
  /** Lo que el dueño afirmó y lo que falta: el panel lo enseña tal cual. */
  inventory: Inventory;
  /** Qué se escribió, qué se degradó y qué se omitió, con el motivo. */
  plan: Plan;
  pending: BriefField[];
  findings6_4: LintFinding[];
  findings6_5: LintFinding[];
  warnings: string[];
  checkpointId: string;
}

const hasError = (findings: LintFinding[]) => findings.some((f) => f.severity === "error");

/**
 * Ejecuta el modo rápido completo: brief → recomendación → checkpoint →
 * borrador → 6.4 → 6.5 → resumen del modelo.
 *
 * Un `error` de 6.4 es un fallo de la ejecución y no toca el sitio. Un `error`
 * de 6.5 solo se aplica cuando lo pidió el dueño; entonces se registra como
 * aviso y NO se revierte (6.5 no bloquea la publicación, pide confirmación).
 */
export async function runFastDesign(deps: FastDesignDeps): Promise<FastDesignResult> {
  const { presets, client, tracker, ctx, ownerRequested = false } = deps;

  // 1. Brief: se valida la forma y lo que falta queda como marcador visible.
  const parsed = quickBriefSchema.safeParse(deps.brief);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`brief invalido: ${first?.path.join(".") ?? ""} ${first?.message ?? ""}`.trim());
  }
  const brief = normalizeBrief(parsed.data);
  // Un brief con solo `description` cuenta como "al menos un dato": el dueño
  // escribió algo. Lo que se rechaza es un brief sin nada, que no da ni para
  // rellenar un titular sin inventar.
  if (!hasBriefData(brief)) throw new Error("brief vacio: no hay ningun dato del negocio");
  if (presets.length === 0) throw new Error("no hay presets en el catalogo");

  const warnings: string[] = [];

  // 2. Textos del sitio (9.1, `generate_copy`): el modelo los redacta ANTES de la
  // recomendacion, porque el tipo de negocio que deduce el copy sirve para
  // recomendar el preset. La guardia `guardCopy` es determinista: aunque el
  // modelo desobedezca, no se publica un dato inventado.
  const copyOutcome = await generateCopy(brief, client, warnings);
  // Con descripcion del dueño, quedarse sin textos es un fallo de la ejecucion:
  // el brief se comprometio a algo que no se puede escribir sin inventar.
  if ("reason" in copyOutcome) {
    if (brief.description !== undefined) throw new CopyUnavailableError(copyOutcome.reason);
    warnings.push(`copy_fallback: ${copyOutcome.reason}`);
  }
  const copy = "copy" in copyOutcome ? copyOutcome.copy : undefined;

  // 2b. Fotos del sitio: las pide el llamador con las busquedas del copy.
  const photos = await loadPhotos(copy, deps.fetchPhotos, warnings);

  // 2c. Recomendación: la elige la herramienta, no el modelo. El tipo de negocio
  // del dueño manda; si esta pendiente, vale el que dedujo el copy; si no hay ni
  // eso, "negocio", que es lo unico que se sabe sin inventar.
  const recommended = await callTool(recommendDesignSystem, ctx, {
    businessType: brief.businessType !== PENDING_MARKER ? brief.businessType : copy?.businessType ?? "negocio",
    candidates: presets.map((p) => ({ id: p.id, name: p.name, summary: p.summary, keywords: p.keywords ?? [] })),
  });
  const first = presets[0]!;
  let preset = first;
  if (recommended.ok) {
    const out = z
      .object({ recommendations: z.array(z.object({ id: z.string() })), noConfidentMatch: z.boolean() })
      .safeParse(recommended.data);
    if (out.success) {
      const match = out.data.noConfidentMatch ? undefined : presets.find((p) => p.id === out.data.recommendations[0]?.id);
      if (match) preset = match;
      else warnings.push("ningun preset encaja con el negocio: se aplica el mas cercano sin inventar una familia nueva");
    }
  }

  // 3. Borrador definitivo: `draftSite` ya valida contra `site-schema`.
  const doc = draftSite(brief, preset, copy, photos);

  // 3b. Inventario y plan: decisiones en datos, antes de escribir nada.
  const inv = inventory(brief);
  const plan = planSections(brief, preset, copy, photos);

  // 4. Checkpoint antes de tocar nada (spec 9.1, paso 5).
  const store = createStore(doc);
  const checkpoint = saveCheckpoint(store, "chk_fast");

  // 5. Linter de contenido (6.4). Un `error` bloquea: no se aplica nada.
  // Las fotos de `photos` ya vienen licenciadas por `fetchPhotos` (la API interna
  // solo devuelve activos con `license` registrado); sin esto, 6.4 marcaba
  // IMAGE_LICENSE_MISSING en todo sitio con foto, aunque la licencia constara.
  const licensedAssetIds = photos !== undefined
    ? [photos.hero?.assetId, ...photos.gallery.map((p) => p.assetId)].filter((id): id is string => id !== undefined)
    : [];
  const findings6_4 = lintSite(doc, { licensedAssetIds });
  if (hasError(findings6_4)) {
    throw new Error(`lint 6.4: ${findings6_4.filter((f) => f.severity === "error").map((f) => f.code).join(", ")}`);
  }

  // 6. Linter visual (6.5) sobre el HTML ya renderizado de la home.
  //
  // 6.5 NO bloquea nunca (9.1): "el agente nunca se bloquea a si mismo ni bloquea
  // al dueno por una regla de estilo". Un `error` de 6.5 se entrega igual, con el
  // aviso puesto, tanto si lo pidio el dueno como si salio del propio borrador; la
  // diferencia es solo lo que se le cuenta. Lanzar aqui dejaria al dueno sin sitio
  // por un defecto de estilo, que es justo lo que la spec prohibe.
  const pageId = doc.pages[0]!.id;
  const findings6_5 = lintHtml(renderPage(doc, pageId), pageId);
  const visualErrors = findings6_5.filter((f) => f.severity === "error");
  if (visualErrors.length > 0) {
    const codes = visualErrors.map((f) => f.code).join(", ");
    warnings.push(
      ownerRequested
        ? `6.5 aplicado a peticion del dueno: ${codes}`
        : `6.5 avisa en el borrador: ${codes}`,
    );
  }

  // 7. Una sola ronda: el modelo solo escribe el resumen que lee el dueño.
  const pendingText = brief.pending.map((f) => FIELD_LABEL[f]).join(", ");
  // El texto libre del dueño viaja solo aqui: es contexto para el resumen, no
  // una fuente de contenido. `undefined` deja el mensaje como estaba.
  const contextText = briefDescriptionContext(brief);
  const run = await runAgent({
    agent: designAgent,
    client,
    tracker,
    tools: makeDesignTools(store) as never,
    ctx,
    messages: [
      {
        role: "user",
        content:
          `Preset aplicado: ${preset.id} (${preset.name}). ` +
          `Datos que faltan por confirmar: ${pendingText || "ninguno"}. ` +
          `Hallazgos de 6.5: ${findings6_5.length}. ` +
          (contextText === undefined
            ? ""
            : `El dueno describio su negocio asi: ${contextText} `) +
          "Usa esa descripcion solo como contexto para el resumen: no la copies " +
          "al sitio, no la presentes como un dato confirmado y no inventes nada a partir de ella. " +
          "Resume en dos frases lo que se ha hecho.",
      },
    ],
    opts: {
      maxRounds: 1,
      // Checkpoint previo a cualquier mutación pedida por el modelo (9.1).
      beforeMutation: async () => {
        saveCheckpoint(store, "chk_pre");
      },
    },
  });
  if (!run.ok && run.stop.kind === "budget") {
    warnings.push(`presupuesto agotado en la ronda rapida: ${run.stop.limit}`);
  }

  return {
    doc: store.doc,
    presetId: preset.id,
    inventory: inv,
    plan,
    pending: brief.pending,
    findings6_4,
    findings6_5,
    warnings,
    checkpointId: checkpoint.id,
  };
}

/** Lo que devuelve `generateCopy`: el copy listo o el motivo cerrado del fallo. */
type CopyOutcome = { copy: SiteCopy } | { reason: string };

/**
 * Una llamada al modelo para los textos del sitio (9.1, `generate_copy`).
 *
 * Usa el mismo `client` que el resumen: el `LlmClient` ya lleva el `tracker`
 * dentro, asi que el gasto del copy entra en el presupuesto de la ejecucion y se
 * para por las mismas reglas (tokens, coste, tiempo y cortacircuitos).
 *
 * La lectura la hace `readCopy`, que devuelve el motivo cerrado del fallo. Si el
 * fallo es de lectura (json, truncado o esquema) se reintenta UNA vez con el
 * mismo prompt mas la linea que lo explica; un fallo de transporte no se
 * reintenta cuando el corte es de presupuesto, porque no queda saldo para otra
 * llamada. Los motivos nunca llevan texto del dueño.
 */
async function generateCopy(
  brief: QuickBrief,
  client: LlmClient,
  warnings: string[],
): Promise<CopyOutcome> {
  const prompt = copyPrompt(brief);
  const ask = (content: string) =>
    client.complete({
      model: designAgent.model,
      messages: [{ role: "user", content }],
      // El JSON completo del esquema ronda los 1 500 tokens; 4 096 deja sitio a
      // un copy detallado sin disparar el coste de una salida que no se usa.
      maxOutputTokens: 4_096,
      temperature: 0.4,
    });

  const read = (out: Awaited<ReturnType<typeof ask>>): CopyOutcome => {
    if (!out.ok) {
      // `stop.kind` es "done" o "budget": el sufijo dice cual, sin texto libre.
      return { reason: `transport_${out.stop.kind}` };
    }
    const result = readCopy(out.result.text, out.result.finishReason);
    return result.ok ? { copy: result.copy } : { reason: result.reason };
  };

  // Lectura + guardia en un solo paso: si el copy se lee, pasa por `finishCopy`
  // y su `reason` (p. ej. `empty_services`) cuenta igual que un motivo de
  // lectura. Asi la poda de la guardia entra en el reintento (ADR 0002).
  const settle = (out: Awaited<ReturnType<typeof ask>>): CopyOutcome => {
    const outcome = read(out);
    return "copy" in outcome ? finishCopy(outcome.copy, brief, warnings) : outcome;
  };

  const first = settle(await ask(prompt));
  if ("copy" in first) return first;

  // El reintento es solo para motivos de LECTURA (y de la guardia). Un fallo de
  // transporte se devuelve tal cual: si el corte es de presupuesto
  // (`transport_budget`) no queda saldo, y reintentar seria pedir una llamada
  // que ya se sabe que no se puede pagar.
  if (first.reason.startsWith("transport_")) return first;

  // Segundo y ultimo intento: lo que salga (copy, motivo de lectura, motivo de
  // la guardia o de transporte) es el final; un `reason` acaba en
  // CopyUnavailableError en el llamador.
  return settle(await ask(`${prompt}\n\n${retryLine(first.reason)}`));
}

/** Guardia determinista + avisos: no se publica lo que parece inventado. */
function finishCopy(copy: SiteCopy, brief: QuickBrief, warnings: string[]): CopyOutcome {
  const guarded = guardCopy(copy, brief);
  // Lo podado viaja al panel: el dueno ve que texto se descarto y por que, sin
  // que se le haya publicado nada inventado.
  if (guarded.dropped.length > 0) warnings.push(`copy_guard: ${guarded.dropped.join(", ")}`);
  // Sin ningun servicio valido el copy no sirve: la seccion `features` se
  // omite y el sitio se quedaria sin lo que el dueno pidio. Se trata como copy
  // no disponible: entra en el reintento como motivo de lectura (`empty_services`
  // no empieza por `transport_`) y, si tampoco sale, acaba en CopyUnavailableError.
  if (guarded.copy.services.length === 0) return { reason: "empty_services" };
  return { copy: guarded.copy };
}

/**
 * Fotos del sitio (B1): las busca el llamador con las consultas del copy.
 *
 * Este paquete no hace fetch ni conoce ningun proveedor: `fetchPhotos` llega
 * inyectado. Un fallo o una lista vacia NO rompe el diseño: se avisa con
 * `photos_unavailable` y el sitio sale sin fotos, que es lo que habia antes.
 */
async function loadPhotos(
  copy: SiteCopy | undefined,
  fetchPhotos: FastDesignDeps["fetchPhotos"],
  warnings: string[],
): Promise<SitePhotos | undefined> {
  const queries = copy?.photoQueries;
  if (queries === undefined || fetchPhotos === undefined) return undefined;
  try {
    const [hero, gallery] = await Promise.all([
      fetchPhotos({ query: queries.hero, orientation: "landscape", count: 1 }),
      fetchPhotos({ query: queries.gallery, orientation: "square", count: 4 }),
    ]);
    const heroPhoto = hero[0];
    if (heroPhoto === undefined || gallery.length === 0) {
      warnings.push("photos_unavailable");
      return undefined;
    }
    return { hero: heroPhoto, gallery };
  } catch {
    warnings.push("photos_unavailable");
    return undefined;
  }
}
