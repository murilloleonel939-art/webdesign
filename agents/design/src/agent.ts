import { z } from "zod";
import { callTool, recommendDesignSystem, runAgent, type AgentDefinition, type RunContext } from "@webdesign/agent-sdk";
import type { BudgetTracker, LlmClient } from "@webdesign/llm";
import { lintSite, type LintFinding } from "@webdesign/linter";
import { lintHtml } from "@webdesign/lint-visual";
import { renderPage } from "@webdesign/renderer";
import type { SiteDocument } from "@webdesign/site-schema";
import { FIELD_LABEL, briefDescriptionContext, hasBriefData, normalizeBrief, quickBriefSchema, type BriefField, type QuickBrief } from "./brief.js";
import { copyPrompt, guardCopy, siteCopySchema, type SiteCopy } from "./copy.js";
import { draftSite, type Preset } from "./draft.js";
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
  // Antes 20 000 y 0,35: cabia UNA llamada (el resumen). Ahora el modo rapido
  // hace dos (los textos del sitio y el resumen), asi que ambos topes se doblan
  // en lo justo: 20 000 -> 40 000 tokens y 0,35 -> 0,70 USD. Al precio del
  // modelo `design` (0,000003 USD entrada / 0,000015 salida) dos llamadas de
  // 2 048 tokens de salida son ~0,07 USD; el margen cubre el prompt del copy.
  maxTokens: 40_000,
  maxToolCalls: 8,
  maxCostUsd: 0.7,
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

  // 2. Recomendación: la elige la herramienta, no el modelo.
  const recommended = await callTool(recommendDesignSystem, ctx, {
    businessType: brief.businessType === "pendiente de confirmar" ? "negocio" : brief.businessType,
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

  // 2b. Textos del sitio (9.1, `generate_copy`): el modelo los redacta ANTES del
  // borrador, porque el borrador ya los necesita. La guardia `guardCopy` es
  // determinista: aunque el modelo desobedezca, no se publica un dato inventado.
  const copy = await generateCopy(brief, client, warnings);

  // 3. Borrador definitivo: `draftSite` ya valida contra `site-schema`.
  const doc = draftSite(brief, preset, copy);

  // 3b. Inventario y plan: decisiones en datos, antes de escribir nada.
  const inv = inventory(brief);
  const plan = planSections(brief, preset, copy);

  // 4. Checkpoint antes de tocar nada (spec 9.1, paso 5).
  const store = createStore(doc);
  const checkpoint = saveCheckpoint(store, "chk_fast");

  // 5. Linter de contenido (6.4). Un `error` bloquea: no se aplica nada.
  const findings6_4 = lintSite(doc);
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

/**
 * Extrae el objeto JSON de la respuesta del modelo.
 *
 * Los modelos envuelven el JSON en ```json con harta frecuencia, y a veces
 * saludan antes. Se busca el primer `{` y el último `}`: lo que haya fuera no es
 * del contrato y se descarta sin intentar interpretarlo.
 */
function parseJsonBlock(text: string): unknown {
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Una llamada al modelo para los textos del sitio (9.1, `generate_copy`).
 *
 * Usa el mismo `client` que el resumen: el `LlmClient` ya lleva el `tracker`
 * dentro, asi que el gasto del copy entra en el presupuesto de la ejecucion y se
 * para por las mismas reglas (tokens, coste, tiempo y cortacircuitos).
 * Un fallo NO rompe el diseno: el agente sigue con el borrador de marcadores, que
 * es el comportamiento de antes. Se avisa con `copy_fallback` y se explica por que.
 */
async function generateCopy(
  brief: QuickBrief,
  client: LlmClient,
  warnings: string[],
): Promise<SiteCopy | undefined> {
  const out = await client.complete({
    model: designAgent.model,
    messages: [{ role: "user", content: copyPrompt(brief) }],
    // El JSON completo del esquema ronda los 1 500 tokens: 2 048 llega y no
    // dispara el coste de una salida larga que no se va a usar.
    maxOutputTokens: 2_048,
    temperature: 0.4,
  });
  if (!out.ok) {
    warnings.push("copy_fallback");
    return undefined;
  }
  const raw = parseJsonBlock(out.result.text);
  const parsed = siteCopySchema.safeParse(raw);
  if (!parsed.success) {
    warnings.push("copy_fallback");
    return undefined;
  }
  const guarded = guardCopy(parsed.data, brief);
  // Lo podado viaja al panel: el dueno ve que texto se descarto y por que, sin
  // que se le haya publicado nada inventado.
  if (guarded.dropped.length > 0) warnings.push(`copy_guard: ${guarded.dropped.join(", ")}`);
  return guarded.copy;
}
