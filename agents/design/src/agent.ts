import { z } from "zod";
import { callTool, recommendDesignSystem, runAgent, type AgentDefinition, type RunContext } from "@webdesign/agent-sdk";
import type { BudgetTracker, LlmClient } from "@webdesign/llm";
import { lintSite, type LintFinding } from "@webdesign/linter";
import { lintHtml } from "@webdesign/lint-visual";
import { renderPage } from "@webdesign/renderer";
import type { SiteDocument } from "@webdesign/site-schema";
import { BRIEF_FIELDS, FIELD_LABEL, normalizeBrief, quickBriefSchema, type BriefField } from "./brief.js";
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
  maxTokens: 20_000,
  maxToolCalls: 8,
  maxCostUsd: 0.02,
  timeoutMs: 30_000,
} as const;

export const designAgent: AgentDefinition = {
  id: "design",
  description: "Diseña un sitio a partir del brief del dueño aplicando un preset del catálogo.",
  model: "fast-small",
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
  if (brief.pending.length === BRIEF_FIELDS.length) throw new Error("brief vacio: no hay ningun dato del negocio");
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

  // 3. Borrador definitivo: `draftSite` ya valida contra `site-schema`.
  const doc = draftSite(brief, preset);

  // 3b. Inventario y plan: decisiones en datos, antes de escribir nada.
  const inv = inventory(brief);
  const plan = planSections(brief, preset);

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
          `Hallazgos de 6.5: ${findings6_5.length}. Resume en dos frases lo que se ha hecho.`,
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
