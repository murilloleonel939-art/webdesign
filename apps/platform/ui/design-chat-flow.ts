// La parte pura del constructor conversacional: datos, teclas y mensajes.
// Nada de React aqui, para poder probarlo sin montar la tarjeta.

/** Los datos del brief, en el orden en que se preguntan. */
export type BriefKey = "businessType" | "name" | "contact";

export interface Question {
  key: BriefKey;
  /** Titulo de la tarjeta: una pregunta de verdad, no una etiqueta de campo. */
  title: string;
  /** Opciones numeradas (1..4). Vacio = se responde escribiendo en "Otro...". */
  options: readonly string[];
  /** Pista corta bajo el titulo: para que sirve el dato. */
  hint: string;
  /** Texto de ejemplo en el campo libre. */
  placeholder: string;
  /** Tope del servidor para este campo (brief.ts). */
  max: number;
}

/**
 * Solo dos pasos: con el tipo de negocio y una segunda tarjeta que pide nombre
 * y contacto a la vez, ya hay con que empezar a construir. El dueño no es
 * interrogado: lo que falte queda por confirmar en el borrador.
 */
export const QUESTIONS: readonly Question[] = [
  {
    key: "businessType",
    title: "¿Qué tipo de negocio es?",
    options: ["Restaurante o bar", "Tienda o comercio", "Servicios profesionales", "Salud y bienestar"],
    hint: "Con esto elijo el tono y la estructura de las secciones.",
    placeholder: "por ejemplo, academia de música",
    max: 120,
  },
  {
    key: "name",
    title: "Nombre y cómo te contactan",
    options: [],
    hint: "La portada y el pie se escriben con estos dos datos.",
    placeholder: "Café Aurora",
    max: 80,
  },
];

/**
 * Lo que viaja al servidor. Devuelve null si no hay ni un dato ni un prompt:
 * sin nada, el diseño no tiene de donde partir.
 *
 * `prompt` une lo que el dueño escribio al crear el sitio con lo que escriba
 * en el compositor; el servidor lo guarda recortado a 500.
 */
export function buildPayload(
  answers: Partial<Record<BriefKey, string>>,
  initialPrompt: string | undefined,
  composerText: string,
): { brief: Partial<Record<BriefKey, string>>; prompt: string } | null {
  const brief: Partial<Record<BriefKey, string>> = {};
  // Solo se envian los campos escritos: un campo vacio no es un dato.
  for (const q of QUESTIONS) {
    const v = (answers[q.key] ?? "").trim();
    if (v) brief[q.key] = v;
  }
  const prompt = [initialPrompt ?? "", composerText]
    .filter((s) => s.trim().length > 0)
    .join(". ")
    .slice(0, 500)
    .trim();
  if (!Object.keys(brief).length && !prompt) return null;
  return { brief, prompt };
}

/** Enter envia; Mayusculas hace salto de linea; el teclado chino no envia nada. */
export function isSendKey(e: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}

/** Lo que devuelve GET /design-runs/latest, o null si no hubo ninguna ejecucion. */
export interface LatestRun {
  runId: string;
  status: string;
  stopReason?: string | null;
  startedAt?: string;
  endedAt?: string | null;
}

/**
 * Decide con que fase retomar el chat al volver a abrirlo (punto D).
 *
 * Sin ejecucion previa se pregunta como siempre. Si quedo una en curso, se
 * reanuda el sondeo donde iba. Si ya termino, se cuenta lo que paso sin
 * volver a preguntar: el dueno no deberia repetir el brief solo por haber
 * cerrado el navegador.
 */
export function resumeFrom(
  latest: LatestRun | null,
  now: number,
): { phase: "asking" } | { phase: "running"; runId: string; startedAt: number } | { phase: "done"; runId: string; ok: boolean; status: string; stopReason: string | null; elapsed: number } {
  if (!latest) return { phase: "asking" };
  if (latest.status === "running") {
    const startedAt = latest.startedAt ? Date.parse(latest.startedAt) : now;
    return { phase: "running", runId: latest.runId, startedAt: Number.isNaN(startedAt) ? now : startedAt };
  }
  const started = latest.startedAt ? Date.parse(latest.startedAt) : NaN;
  const ended = latest.endedAt ? Date.parse(latest.endedAt) : NaN;
  const elapsed = Number.isNaN(started) || Number.isNaN(ended) ? 0 : Math.round((ended - started) / 1000);
  return {
    phase: "done",
    runId: latest.runId,
    ok: latest.status === "ok",
    status: latest.status,
    stopReason: latest.stopReason ?? null,
    elapsed,
  };
}

/**
 * Decide que hacer con el sondeo en curso (fallo A: nunca "done" mientras el
 * servidor diga 'running', por muy largo que tarde).
 *
 * - 'running' y menos de 10 min: seguir sondeando ('keep').
 * - 'running' y 10 min o mas: 'stalled' (se deja de sondear solo; el dueno
 *   puede pulsar "Comprobar ahora").
 * - cualquier otro estado definido: 'done', el run ya terminó de verdad.
 * - sin estado todavia (undefined, p.ej. un corte de red): 'keep'.
 */
export function pollDecision(status: string | undefined, elapsedMs: number): "keep" | "stalled" | "done" {
  if (status === undefined) return "keep";
  if (status === "running") return elapsedMs >= 600000 ? "stalled" : "keep";
  return "done";
}

/** Cada cuanto se vuelve a preguntar: cada 2 s hasta los 90 s, luego cada 4 s. */
export function pollDelay(elapsedMs: number): number {
  return elapsedMs < 90000 ? 2000 : 4000;
}

/**
 * Decide si el chat debe lanzar el diseño solo, sin preguntar nada, al
 * terminar de comprobar si hubo una ejecucion previa (punto D).
 *
 * Regla del producto: si el dueno ya conto su idea al crear el sitio, no se
 * le pregunta nada. Solo se autoarranca cuando hay un `initialPrompt` no
 * vacio Y nunca se ha diseñado antes para este sitio (sin ejecucion previa).
 * Si ya hubo una, el chat retoma esa (resumeFrom se encarga) en vez de lanzar
 * otra.
 */
export function shouldAutoStart(initialPrompt: string, latestFound: boolean): boolean {
  return initialPrompt.trim().length > 0 && !latestFound;
}

/** El resultado de deshacer un diseño, ya traducido a algo que se lee. */
export function undoMessage(status: number, body: { error?: string }): { kind: "ok" | "confirm" | "gone" | "retry"; text: string } {
  if (status === 200) {
    return { kind: "ok", text: "Hecho: tu sitio vuelve a como estaba antes del diseño." };
  }
  if (status === 409 && body.error === "edited_after") {
    return { kind: "confirm", text: "Has editado el sitio después del diseño. Si deshaces, esos cambios se pierden." };
  }
  if (status === 401 || status === 404) {
    return { kind: "gone", text: "Ya no se puede deshacer este diseño." };
  }
  return { kind: "retry", text: "No se pudo deshacer ahora. Inténtalo de nuevo." };
}
