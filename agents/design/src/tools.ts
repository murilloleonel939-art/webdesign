import { z } from "zod";
import type { Section } from "@webdesign/site-schema";
import type { ToolDef } from "@webdesign/agent-sdk";
import { applyMutation, findPage, saveCheckpoint, type DesignStore } from "./store.js";

export { createStore, type Checkpoint, type DesignStore } from "./store.js";

// Herramientas de edición del borrador (spec 9.1).
//
// Todas comparten el mismo contrato: `mutates:true`, y la mutación se aplica
// con `applyMutation`, que valida el documento completo antes de confirmar. Si
// no valida, la herramienta devuelve `{ok:false}` SIN lanzar: el modelo recibe
// el error como dato y el store no cambia. No hay herramienta de publicar.

/** Error como dato, no como excepción: lo que el modelo necesita para reintentar. */
const MUTATION_ERROR = "MUTATION_REJECTED";

// --- get_site ------------------------------------------------------------------

const GetSiteInput = z.object({});

function makeGetSiteTool(store: DesignStore): ToolDef<Record<string, never>, { doc: unknown }> {
  return {
    name: "get_site",
    description: "Devuelve el SiteDocument actual del borrador en edición.",
    inputSchema: GetSiteInput,
    scopes: ["site:read"],
    mutates: false,
    async handler() {
      return { doc: store.doc };
    },
  };
}

// --- apply_preset ----------------------------------------------------------------

const ApplyPresetInput = z.object({
  pageId: z.string().min(1),
  /** Preset ya elegido por `recommend_design_system`: aquí solo se aplica. */
  presetId: z.string().min(1).max(60),
  theme: z.object({
    colors: z.object({ ground: z.string(), ink: z.string(), accent: z.string() }),
    typography: z.object({ family: z.string().max(60), scale: z.string().max(40) }),
    spacing: z.object({ margin: z.number().int(), sectionGap: z.number().int() }),
    radius: z.enum(["square", "rounded", "pill"]),
  }),
});

type ApplyResult = { ok: true } | { ok: false; errorCode: string; message: string };

function makeApplyPresetTool(store: DesignStore): ToolDef<z.infer<typeof ApplyPresetInput>, ApplyResult> {
  return {
    name: "apply_preset",
    description: "Aplica el tema de un preset del catálogo al documento (colores, tipografía, espaciado, radio).",
    inputSchema: ApplyPresetInput,
    scopes: ["site:write"],
    mutates: true,
    async handler(_ctx, input) {
      const res = applyMutation(store, (draft) => {
        findPage(draft, input.pageId); // valida que la página exista antes de mutar
        draft.design.presetId = input.presetId;
        draft.theme = input.theme;
      });
      return res.ok ? { ok: true } : { ok: false, errorCode: MUTATION_ERROR, message: res.errors.join("; ") };
    },
  };
}

// --- set_theme -------------------------------------------------------------------

const SetThemeInput = z.object({
  colors: z.object({ ground: z.string(), ink: z.string(), accent: z.string() }).optional(),
  typography: z.object({ family: z.string().max(60), scale: z.string().max(40) }).optional(),
  spacing: z.object({ margin: z.number().int(), sectionGap: z.number().int() }).optional(),
  radius: z.enum(["square", "rounded", "pill"]).optional(),
});

function makeSetThemeTool(store: DesignStore): ToolDef<z.infer<typeof SetThemeInput>, ApplyResult> {
  return {
    name: "set_theme",
    description: "Cambia una o varias partes del tema sin tocar el contenido de las secciones.",
    inputSchema: SetThemeInput,
    scopes: ["site:write"],
    mutates: true,
    async handler(_ctx, input) {
      const res = applyMutation(store, (draft) => {
        if (input.colors) draft.theme.colors = input.colors;
        if (input.typography) draft.theme.typography = input.typography;
        if (input.spacing) draft.theme.spacing = input.spacing;
        if (input.radius) draft.theme.radius = input.radius;
      });
      return res.ok ? { ok: true } : { ok: false, errorCode: MUTATION_ERROR, message: res.errors.join("; ") };
    },
  };
}

// --- add_section / update_section / move_section / remove_section ---------------

const SectionInput = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  variant: z.string().max(40).optional(),
  props: z.record(z.string(), z.unknown()),
});

const AddSectionInput = z.object({
  pageId: z.string().min(1),
  section: SectionInput,
  /** Posición donde insertar; al final si se omite. */
  index: z.number().int().min(0).optional(),
});

function makeAddSectionTool(store: DesignStore): ToolDef<z.infer<typeof AddSectionInput>, ApplyResult> {
  return {
    name: "add_section",
    description: "Añade una sección a una página, en la posición indicada o al final.",
    inputSchema: AddSectionInput,
    scopes: ["site:write"],
    mutates: true,
    async handler(_ctx, input) {
      const res = applyMutation(store, (draft) => {
        const page = findPage(draft, input.pageId);
        if (page.sections.some((s) => s.id === input.section.id)) throw new Error(`sección duplicada: ${input.section.id}`);
        const at = input.index ?? page.sections.length;
        page.sections.splice(at, 0, input.section as Section);
      });
      return res.ok ? { ok: true } : { ok: false, errorCode: MUTATION_ERROR, message: res.errors.join("; ") };
    },
  };
}

const UpdateSectionInput = z.object({
  pageId: z.string().min(1),
  sectionId: z.string().min(1),
  variant: z.string().max(40).optional(),
  props: z.record(z.string(), z.unknown()),
});

function makeUpdateSectionTool(store: DesignStore): ToolDef<z.infer<typeof UpdateSectionInput>, ApplyResult> {
  return {
    name: "update_section",
    description: "Reemplaza las props (y opcionalmente la variante) de una sección existente.",
    inputSchema: UpdateSectionInput,
    scopes: ["site:write"],
    mutates: true,
    async handler(_ctx, input) {
      const res = applyMutation(store, (draft) => {
        const page = findPage(draft, input.pageId);
        const section = page.sections.find((s) => s.id === input.sectionId);
        if (!section) throw new Error(`sección no encontrada: ${input.sectionId}`);
        section.props = input.props;
        if (input.variant !== undefined) section.variant = input.variant;
      });
      return res.ok ? { ok: true } : { ok: false, errorCode: MUTATION_ERROR, message: res.errors.join("; ") };
    },
  };
}

const MoveSectionInput = z.object({
  pageId: z.string().min(1),
  sectionId: z.string().min(1),
  toIndex: z.number().int().min(0),
});

function makeMoveSectionTool(store: DesignStore): ToolDef<z.infer<typeof MoveSectionInput>, ApplyResult> {
  return {
    name: "move_section",
    description: "Mueve una sección a otra posición dentro de la misma página.",
    inputSchema: MoveSectionInput,
    scopes: ["site:write"],
    mutates: true,
    async handler(_ctx, input) {
      const res = applyMutation(store, (draft) => {
        const page = findPage(draft, input.pageId);
        const from = page.sections.findIndex((s) => s.id === input.sectionId);
        if (from === -1) throw new Error(`sección no encontrada: ${input.sectionId}`);
        const [section] = page.sections.splice(from, 1);
        const at = Math.min(input.toIndex, page.sections.length);
        page.sections.splice(at, 0, section!);
      });
      return res.ok ? { ok: true } : { ok: false, errorCode: MUTATION_ERROR, message: res.errors.join("; ") };
    },
  };
}

const RemoveSectionInput = z.object({ pageId: z.string().min(1), sectionId: z.string().min(1) });

function makeRemoveSectionTool(store: DesignStore): ToolDef<z.infer<typeof RemoveSectionInput>, ApplyResult> {
  return {
    name: "remove_section",
    description: "Elimina una sección de una página.",
    inputSchema: RemoveSectionInput,
    scopes: ["site:write"],
    mutates: true,
    async handler(_ctx, input) {
      const res = applyMutation(store, (draft) => {
        const page = findPage(draft, input.pageId);
        const idx = page.sections.findIndex((s) => s.id === input.sectionId);
        if (idx === -1) throw new Error(`sección no encontrada: ${input.sectionId}`);
        page.sections.splice(idx, 1);
      });
      return res.ok ? { ok: true } : { ok: false, errorCode: MUTATION_ERROR, message: res.errors.join("; ") };
    },
  };
}

// --- create_checkpoint / revert_to_checkpoint ------------------------------------

const CreateCheckpointInput = z.object({});

function makeCreateCheckpointTool(store: DesignStore): ToolDef<Record<string, never>, { checkpointId: string }> {
  return {
    name: "create_checkpoint",
    description: "Guarda el estado actual del documento como punto de restauración.",
    inputSchema: CreateCheckpointInput,
    scopes: ["site:write"],
    mutates: true,
    async handler() {
      return { checkpointId: saveCheckpoint(store).id };
    },
  };
}

const RevertToCheckpointInput = z.object({ checkpointId: z.string().min(1) });

function makeRevertToCheckpointTool(store: DesignStore): ToolDef<z.infer<typeof RevertToCheckpointInput>, ApplyResult> {
  return {
    name: "revert_to_checkpoint",
    description: "Restaura el documento al estado guardado en un checkpoint.",
    inputSchema: RevertToCheckpointInput,
    scopes: ["site:write"],
    mutates: true,
    async handler(_ctx, input) {
      const checkpoint = store.checkpoints.find((c) => c.id === input.checkpointId);
      if (!checkpoint) return { ok: false, errorCode: "CHECKPOINT_NOT_FOUND", message: `checkpoint no encontrado: ${input.checkpointId}` };
      // El checkpoint ya pasó por `siteDocumentSchema` al guardarse: no hace falta revalidar.
      store.doc = structuredClone(checkpoint.doc);
      return { ok: true };
    },
  };
}

/** Construye las nueve herramientas de edición sobre un store compartido. */
export function makeDesignTools(store: DesignStore): ToolDef<never, unknown>[] {
  return [
    makeGetSiteTool(store),
    makeApplyPresetTool(store),
    makeSetThemeTool(store),
    makeAddSectionTool(store),
    makeUpdateSectionTool(store),
    makeMoveSectionTool(store),
    makeRemoveSectionTool(store),
    makeCreateCheckpointTool(store),
    makeRevertToCheckpointTool(store),
  ] as unknown as ToolDef<never, unknown>[];
}
