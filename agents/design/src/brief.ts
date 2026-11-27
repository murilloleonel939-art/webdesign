import { z } from "zod";

import { describeFromText } from "./describe.js";

// Brief del modo rápido (spec 9.1, Fase 4).
//
// El dueño da cinco campos mínimos: tipo de negocio, nombre, ciudad, un servicio
// y un contacto. Todo lo que no llega NO se rellena con una suposición: se deja
// con el marcador literal y se anota en `pending`, para que el panel se lo pida.
// La regla que manda es la de 9.1: el agente no inventa clientes, cifras,
// testimonios, precios, citas ni certificaciones.

/** Marcador visible que el dueño ve en el borrador y en el panel. */
export const PENDING_MARKER = "pendiente de confirmar";

/**
 * ¿El texto contiene el marcador? Por subcadena y sin distinguir mayúsculas.
 *
 * Vive aquí, junto al marcador, porque lo necesitan `brief`, `copy` y `draft`:
 * el marcador no se publica en ninguna capa, aunque venga dentro de una frase
 * más larga.
 */
export function containsMarker(value: string): boolean {
  return value.toLowerCase().includes(PENDING_MARKER.toLowerCase());
}

/**
 * Nombres de relleno: lo que pone el panel cuando el dueño no ha escrito nada.
 *
 * POR QUÉ ES UN DATO Y NO UN DETALLE: «Mi sitio» es el nombre por defecto que
 * crea la plataforma, y acababa publicado como titular del hero y como
 * `seo.title`. No es un nombre: es un hueco. Se compara sin mayúsculas ni
 * espacios de sobra, porque el dueño puede dejarlo tal cual o reescribirlo.
 */
const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
  "mi sitio",
  "mi web",
  "mi pagina",
  "mi página",
  "sitio web",
  "sitio",
  "web",
  "mi negocio",
  "nuevo sitio",
]);

/** ¿Es un nombre de relleno y no un nombre de verdad? */
export function isPlaceholderName(value: string): boolean {
  return PLACEHOLDER_NAMES.has(value.trim().toLowerCase().replace(/\s+/g, " "));
}

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * Brief tal como puede llegar: todos los campos son opcionales porque el modo
 * rápido acepta lo que el dueño escriba en una sola frase. `z.object` con
 * `.strip()` implícito evita que un campo inventado por el modelo pase adelante.
 */
export const quickBriefSchema = z.object({
  businessType: text(120).optional(),
  name: text(80).optional(),
  city: text(80).optional(),
  service: text(200).optional(),
  /** Contacto en lenguaje natural: correo, teléfono o "WhatsApp 600 000 000". */
  contact: text(200).optional(),
  /**
   * Texto libre del dueño (el `prompt` del panel, máximo 500 según 6.1).
   *
   * NO es un sexto dato del negocio y no entra en `BRIEF_FIELDS`: es contexto
   * para el resumen que el agente le devuelve al dueño. Ninguna sección se
   * rellena con esto, porque de aquí no sale ningún hecho comprobable; la regla
   * de 9.1 sigue mandando (no se inventan clientes, cifras ni testimonios).
   */
  description: text(500).optional(),
  /**
   * Prueba social y precios que APORTA EL DUEÑO (T-025). Opcionales y fuera de
   * `BRIEF_FIELDS`: no se piden en el modo rápido ni cuentan como pendientes.
   * Es la única fuente de las secciones `testimonials`, `pricing` y `metrics`:
   * sin esto, el agente las omite. Nunca se rellenan con una suposición.
   */
  testimonials: z.array(z.object({ quote: text(600), name: text(80), role: text(80).optional() })).max(6).optional(),
  plans: z.array(z.object({ name: text(40), price: text(20), features: z.array(text(120)).max(12), highlighted: z.boolean().optional() })).max(3).optional(),
  metrics: z.array(z.object({ value: text(20), label: text(80) })).max(4).optional(),
});

export type QuickBriefInput = z.infer<typeof quickBriefSchema>;

/** Los cinco campos mínimos del modo rápido, en el orden en que se preguntan. */
export const BRIEF_FIELDS = ["businessType", "name", "city", "service", "contact"] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];

export interface QuickBrief {
  businessType: string;
  name: string;
  city: string;
  service: string;
  contact: string;
  /**
   * Texto libre del dueño, ya recortado, o `undefined` si no lo escribió.
   *
   * Con `exactOptionalPropertyTypes` la clave se omite en vez de valer
   * `undefined`: es lo mismo que hace `Preset.dials` en `pg-store`.
   */
  description?: string;
  /** Campos que faltaban y quedaron con el marcador. Nunca vacío por suposición. */
  pending: BriefField[];
  /**
   * Datos del dueño para prueba social y precios (T-025), ya sin marcador.
   * Se omite la clave si no dio ninguno: así se distingue «no lo dio» de «vacío».
   */
  proof?: OwnerProof;
}

export interface OwnerTestimonial { quote: string; name: string; role?: string }
export interface OwnerPlan { name: string; price: string; features: string[]; highlighted?: boolean }
export interface OwnerMetric { value: string; label: string }

/** Lo único de lo que pueden salir testimonios, precios y cifras. */
export interface OwnerProof {
  testimonials?: OwnerTestimonial[];
  plans?: OwnerPlan[];
  metrics?: OwnerMetric[];
}

/**
 * Copia los datos de prueba del dueño, descartando cualquier elemento con el
 * marcador (B1). Devuelve `undefined` si no queda nada.
 */
function ownerProof(data: QuickBriefInput): OwnerProof | undefined {
  const clean = (v: unknown) => !containsMarker(JSON.stringify(v));
  const out: OwnerProof = {};
  const testimonials = (data.testimonials ?? []).filter(clean).map((t) => (t.role ? { quote: t.quote, name: t.name, role: t.role } : { quote: t.quote, name: t.name }));
  const plans = (data.plans ?? []).filter(clean).map((p) => (p.highlighted === true ? { name: p.name, price: p.price, features: p.features, highlighted: true } : { name: p.name, price: p.price, features: p.features }));
  const metrics = (data.metrics ?? []).filter(clean).map((m) => ({ value: m.value, label: m.label }));
  if (testimonials.length > 0) out.testimonials = testimonials;
  if (plans.length > 0) out.plans = plans;
  if (metrics.length > 0) out.metrics = metrics;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Etiqueta en español de cada campo, para el mensaje de vuelta al dueño. */
export const FIELD_LABEL: Record<BriefField, string> = {
  businessType: "Tipo de negocio",
  name: "Nombre",
  city: "Ciudad",
  service: "Servicio principal",
  contact: "Contacto",
};

/**
 * Completa el brief con marcadores en vez de inventar.
 *
 * Un campo vacío, con espacios o con una cadena que ya es el propio marcador
 * cuenta como no informado: decirlo dos veces no aporta y confundiría al panel.
 */
export function normalizeBrief(input: unknown): QuickBrief {
  const parsed = quickBriefSchema.safeParse(input);
  const raw: Partial<Record<BriefField, string | undefined>> = parsed.success ? parsed.data : {};
  const out: QuickBrief = {
    businessType: PENDING_MARKER,
    name: PENDING_MARKER,
    city: PENDING_MARKER,
    service: PENDING_MARKER,
    contact: PENDING_MARKER,
    pending: [],
  };
  // Lo que el dueño dio por separado. Se guarda aparte de `out` porque primero
  // hay que decidir qué falta: solo los huecos se pueden rellenar con la frase.
  const given: Partial<Record<BriefField, string>> = {};
  for (const field of BRIEF_FIELDS) {
    const value = raw[field]?.trim();
    if (!value || value.toLowerCase() === PENDING_MARKER) continue;
    // Un nombre de relleno no es un nombre: se trata como hueco y se le pide al
    // dueño. Si pasara, el titular del hero y el `seo.title` publicarían «Mi
    // sitio», que es lo que pone la plataforma cuando no hay nombre.
    if (field === "name" && isPlaceholderName(value)) continue;
    given[field] = value;
  }
  // El texto libre no es un sexto dato: no entra en `pending` ni cambia ningún
  // campo por sí mismo. Solo viaja al resumen, y vacío se omite igual que los
  // demás.
  //
  // Si CONTIENE el marcador no se da por aportado (T-002.4, Fix A): "Horario
  // pendiente de confirmar" no es una descripción del negocio, es el propio
  // marcador colado en el texto. Antes bastaba con que no fuera igual para que
  // pasara, y acababa en el documento entregado.
  const description = parsed.success ? parsed.data.description?.trim() : undefined;
  if (description && !containsMarker(description)) out.description = description;
  // T-011: de la frase se sacan tipo de negocio y ciudad, lo poco que una frase
  // dice sin ambigüedad. Solo se rellena el hueco: lo que el dueño dio por
  // separado manda siempre, porque lo escribió a propósito en su campo.
  if (out.description !== undefined) {
    const described = describeFromText(out.description);
    if (given.businessType === undefined && described.businessType !== undefined) {
      given.businessType = described.businessType;
    }
    if (given.city === undefined && described.city !== undefined) {
      given.city = described.city;
    }
  }
  const proof = parsed.success ? ownerProof(parsed.data) : undefined;
  if (proof !== undefined) out.proof = proof;
  // `pending` se construye al final, con los campos ya rellenados: lo que salió
  // de la frase no se le vuelve a pedir al dueño en el panel.
  for (const field of BRIEF_FIELDS) {
    const value = given[field];
    if (value === undefined) {
      out.pending.push(field);
      continue;
    }
    out[field] = value;
  }
  return out;
}

/**
 * ¿El dueño dio al menos un dato?
 *
 * Un brief con solo `description` cuenta como uno: hay algo escrito por él,
 * aunque falten los cinco campos y todos queden con el marcador. Lo que NO
 * cuenta es un brief sin nada, que es el que se rechaza antes de gastar.
 */
export function hasBriefData(brief: QuickBrief): boolean {
  return brief.description !== undefined || brief.pending.length < BRIEF_FIELDS.length;
}

/**
 * Contexto para el resumen del modelo: el texto libre del dueño, tal cual.
 *
 * Se devuelve sin adornos para que el modelo sepa qué le preocupa al dueño, y
 * `undefined` cuando no escribió nada. Sirve solo para hablar del trabajo hecho:
 * de aquí no se copia contenido al sitio, porque no es un dato verificado.
 */
export function briefDescriptionContext(brief: QuickBrief): string | undefined {
  return brief.description;
}

/** Nombre del sitio para `meta.name`: el del negocio o el marcador. */
export function siteName(brief: QuickBrief): string {
  return brief.name;
}

/** Frase de brief que se guarda en `design.brief` (máximo 500 según 6.1). */
export function briefSentence(brief: QuickBrief): string {
  const parts = [
    `${brief.businessType} en ${brief.city}`,
    `servicio: ${brief.service}`,
    `contacto: ${brief.contact}`,
  ];
  return parts.join("; ").slice(0, 500);
}
