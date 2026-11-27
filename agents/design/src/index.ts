// Agente de diseño en modo rápido (spec 9.1, Fase 4).
//
// Punto de entrada del paquete: brief, borrador, herramientas y ejecución.

export {
  BRIEF_FIELDS,
  FIELD_LABEL,
  PENDING_MARKER,
  briefSentence,
  normalizeBrief,
  quickBriefSchema,
  siteName,
  type BriefField,
  type QuickBrief,
  type QuickBriefInput,
} from "./brief.js";

export { describeFromText, type Described } from "./describe.js";

export { draftSite, heroHeadline, type PhotoRef, type Preset, type SitePhotos } from "./draft.js";

export { copyPrompt, guardCopy, readCopy, retryLine, siteCopySchema, type SiteCopy } from "./copy.js";

export { genericCopy } from "./generic-copy.js";

export {
  completeCopy,
  inventory,
  planSections,
  plannedTypes,
  type CompletedCopy,
  type Inventory,
  type Known,
  type Missing,
  type Plan,
  type PlanAction,
  type PlannedPage,
  type PlannedSection,
} from "./plan.js";

export { classifyShape, type SiteShape } from "./classify.js";

export { SECTORS, sectorForBrief, type Sector } from "./sector.js";

export { productForBrief } from "./product.js";

export { themeForProduct, themeTrace, themeSummary, type SiteTheme, type ThemeTrace } from "./theme.js";

export {
  createStore,
  saveCheckpoint,
  applyMutation,
  findPage,
  nextId,
  type Checkpoint,
  type DesignStore,
  type MutationResult,
} from "./store.js";

export { makeDesignTools } from "./tools.js";

export {
  CopyUnavailableError,
  FAST_BUDGET,
  designAgent,
  runFastDesign,
  type FastDesignDeps,
  type FastDesignResult,
} from "./agent.js";
