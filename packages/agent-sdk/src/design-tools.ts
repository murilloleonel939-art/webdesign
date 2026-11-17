// Herramientas de diseño de solo lectura (spec 9.1).
//
// Las cuatro son de LECTURA: no mutan estado, no piden checkpoint y no pueden
// publicar. Por eso no necesitan `RunContext` ni red: reciben los datos que
// miran como argumento. Esa es la razon de que se puedan probar sin base de
// datos real, y de que el agente pueda consultarlas sin gastar presupuesto en
// razonar el diseño: el diseño sale de DATOS, no de la imaginacion del modelo.

import { z } from "zod";
import type { ToolDef } from "./index.js";

// --- recommend_design_system ------------------------------------------------
//
// Devuelve 2-3 presets con su motivo, elegidos por lo que el dueño dijo de su
// negocio. El modelo no elige el diseño: elige entre lo que esta herramienta
// devuelve, y solo puede aplicar lo que ha recibido.

const RecommendInput = z.object({
  /** Tipo de negocio tal como lo dijo el dueno ("cafeteria", "clinica dental"). */
  businessType: z.string().min(2).max(200),
  /** Lo que el dueno pidio, si lo dijo ("mas serio", "alegre"). */
  tone: z.string().max(200).optional(),
  /** Presets candidatos. Los pasa el llamador: esta herramienta no lee la base. */
  candidates: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        summary: z.string().default(""),
        keywords: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(50),
});

const RecommendOutput = z.object({
  recommendations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      /** Por que encaja, con las palabras que se solaparon. */
      reason: z.string(),
      score: z.number(),
    }),
  ),
  /** Cierto si ningun candidato se parece: el llamador debe saberlo. */
  noConfidentMatch: z.boolean(),
});

export type RecommendOutput = z.infer<typeof RecommendOutput>;

// Palabras vacias del español y del ingles: no dicen nada del negocio y darian
// puntos falsos ("de", "la", "the").
const STOP = new Set([
  "de", "la", "el", "los", "las", "un", "una", "y", "o", "para", "con", "por", "que",
  "mi", "mis", "su", "sus", "del", "al", "en", "es", "somos", "quiero", "necesito",
  "the", "a", "an", "and", "or", "for", "with", "my", "our", "is", "we", "want",
]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

const recommendDesignSystem: ToolDef<z.infer<typeof RecommendInput>, RecommendOutput> = {
  name: "recommend_design_system",
  description:
    "Elige 2-3 presets del catalogo para el tipo de negocio del dueno y devuelve el motivo. " +
    "Solo se pueden aplicar presets devueltos por esta herramienta.",
  inputSchema: RecommendInput,
  scopes: ["design:read"],
  mutates: false,
  async handler(_ctx, input) {
    const wanted = new Set(tokens(`${input.businessType} ${input.tone ?? ""}`));
    const scored = input.candidates.map((c) => {
      const own = tokens(`${c.name} ${c.summary} ${c.keywords.join(" ")}`);
      const hits = [...new Set(own.filter((t) => wanted.has(t)))];
      return { c, hits, score: hits.length };
    });
    scored.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
    const best = scored.filter((s) => s.score > 0).slice(0, 3);
    const recommendations = best.map((s) => ({
      id: s.c.id,
      name: s.c.name,
      reason: `coincide en: ${s.hits.slice(0, 5).join(", ")}`,
      score: s.score,
    }));
    return { recommendations, noConfidentMatch: recommendations.length === 0 };
  },
};

// --- run_lint / run_visual_lint ---------------------------------------------
//
// Envoltorios finos: la logica vive en `@webdesign/linter` y `@webdesign/lint-visual`.
// Aqui solo se valida la entrada y se recorta la salida para no gastar presupuesto
// en 40 hallazgos repetidos.

const MAX_FINDINGS = 20;

export interface FindingLike {
  code: string;
  severity: string;
  message: string;
  sectionId?: string;
}

const LintOutput = z.object({
  findings: z.array(
    z.object({
      code: z.string(),
      severity: z.string(),
      message: z.string(),
      sectionId: z.string().optional(),
    }),
  ),
  truncated: z.number(),
  // Spec 6.5: un `error` no bloquea una publicacion pedida por el dueno; exige
  // confirmacion. El agente necesita saberlo para no pedir algo imposible.
  needsOwnerConfirmation: z.boolean(),
});

export type LintOutput = z.infer<typeof LintOutput>;

// Cuenta primero por severidad: si hay un `error`, es lo que el modelo debe leer.
function trimFindings(findings: FindingLike[]): LintOutput {
  const rank: Record<string, number> = { error: 0, warning: 1, info: 2 };
  const sorted = [...findings].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
  const kept = sorted.slice(0, MAX_FINDINGS).map((f) => ({
    code: f.code,
    severity: f.severity,
    message: f.message,
    ...(f.sectionId !== undefined ? { sectionId: f.sectionId } : {}),
  }));
  return {
    findings: kept,
    truncated: Math.max(0, findings.length - kept.length),
    needsOwnerConfirmation: findings.some((f) => f.severity === "error"),
  };
}

const LintInput = z.object({
  html: z.string().min(1).max(2_000_000),
  pageId: z.string().max(100).optional(),
});

type LintTool = ToolDef<z.infer<typeof LintInput>, LintOutput>;
type Linter = (html: string, pageId?: string) => FindingLike[];

function lintTool(name: string, description: string, run: Linter): LintTool {
  return {
    name,
    description,
    inputSchema: LintInput,
    scopes: ["site:read"],
    mutates: false,
    async handler(_ctx, input) {
      return trimFindings(run(input.html, input.pageId));
    },
  };
}

export function makeLintTools(deps: { lintHtml: Linter; lintVisual: Linter }): [LintTool, LintTool] {
  return [
    lintTool(
      "run_lint",
      "Reglas de contenido de 6.4 sobre el HTML de una pagina. Devuelve como mucho 20 hallazgos, los de mayor severidad primero.",
      deps.lintHtml,
    ),
    lintTool(
      "run_visual_lint",
      "Reglas de calidad visual de 6.5 sobre el HTML ya renderizado. No bloquea: un error pide confirmacion al dueno.",
      deps.lintVisual,
    ),
  ];
}

// --- critique_draft ---------------------------------------------------------
//
// Spec 9.1: maximo 3 problemas, determinista sobre tokens y estructura. El
// modelo escribe SOLO la prosa que acompana; los problemas los elige esta
// funcion. Si los eligiera el modelo, cada pasada daria tres problemas nuevos y
// el dueno no podria saber si el borrador mejoro.

const CritiqueOutput = z.object({
  problems: z
    .array(
      z.object({
        code: z.string(),
        severity: z.string(),
        /** Que esta mal, en una frase. */
        problem: z.string(),
      }),
    )
    .max(3),
});

export type CritiqueOutput = z.infer<typeof CritiqueOutput>;

// Prioridad fija: primero lo que rompe el sitio, luego lo que lo afea. Un
// defecto de este orden no depende del modelo ni del momento.
const PRIORITY = [
  "SLOP_LOW_CONTRAST_TEXT_ON_COLOR",
  "SLOP_HEADING_SKIP",
  "SLOP_NO_VISUAL_HIERARCHY",
  "A11Y_NO_VISIBLE_FOCUS",
  "SLOP_FIXED_WIDTH_OVERFLOW",
  "SLOP_UNRESPONSIVE_GRID",
  "MOTION_NO_REDUCED_MOTION",
  "SLOP_PLACEHOLDER_TEXT",
  "SLOP_TOUCH_TARGET_SMALL",
  "SLOP_PADDING_CRAMPED",
  "SLOP_FONT_MONOCULTURE",
  "SLOP_NESTED_CARDS",
  "SLOP_SHADOW_ON_EVERYTHING",
  "SLOP_GENERIC_GRADIENT",
  "SLOP_CENTERED_EVERYTHING",
  "SLOP_SAME_CARD_RADIUS",
  "SLOP_ICON_TILE_ABOVE_EVERY_HEADING",
  "MOTION_LAYOUT_ANIMATION",
  "MOTION_DURATION_OUT_OF_RANGE",
];

// Un codigo que no este en PRIORITY (regla nueva que alguien olvido anadir aqui)
// NO se pierde: va detras de los conocidos, ordenado por severidad. Perderlo en
// silencio seria peor que ordenarlo mal.
export function critique(findings: FindingLike[]): CritiqueOutput {
  const rank: Record<string, number> = { error: 0, warning: 1, info: 2 };
  const pos = (code: string) => {
    const i = PRIORITY.indexOf(code);
    return i === -1 ? PRIORITY.length : i;
  };
  // Se ordena TODO antes de deduplicar, con el mensaje como ultimo desempate: si
  // un codigo aparece dos veces con mensajes distintos, el elegido no puede
  // depender del orden en que el linter recorrio el DOM.
  const sorted = [...findings].sort(
    (a, b) =>
      pos(a.code) - pos(b.code) ||
      (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );
  const seen = new Set<string>();
  const unique = sorted.filter((f) => (seen.has(f.code) ? false : (seen.add(f.code), true)));
  return {
    problems: unique.slice(0, 3).map((f) => ({ code: f.code, severity: f.severity, problem: f.message })),
  };
}

const CritiqueInput = z.object({
  html: z.string().min(1).max(2_000_000),
  pageId: z.string().max(100).optional(),
});

export function makeCritiqueTool(deps: { lintVisual: (html: string, pageId?: string) => FindingLike[] }): ToolDef<
  z.infer<typeof CritiqueInput>,
  CritiqueOutput
> {
  return {
    name: "critique_draft",
    description:
      "Los 3 problemas mas graves del borrador, elegidos de forma determinista. Usa la prosa para " +
      "explicarlos al dueno, no para anadir problemas que no esten en la lista.",
    inputSchema: CritiqueInput,
    scopes: ["site:read"],
    mutates: false,
    async handler(_ctx, input) {
      return critique(deps.lintVisual(input.html, input.pageId));
    },
  };
}

export { recommendDesignSystem, trimFindings, MAX_FINDINGS, PRIORITY };
