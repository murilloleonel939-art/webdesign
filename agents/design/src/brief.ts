import { z } from "zod";

// Brief del modo rápido (spec 9.1, Fase 4).
//
// El dueño da cinco campos mínimos: tipo de negocio, nombre, ciudad, un servicio
// y un contacto. Todo lo que no llega NO se rellena con una suposición: se deja
// con el marcador literal y se anota en `pending`, para que el panel se lo pida.
// La regla que manda es la de 9.1: el agente no inventa clientes, cifras,
// testimonios, precios, citas ni certificaciones.

/** Marcador visible que el dueño ve en el borrador y en el panel. */
export const PENDING_MARKER = "pendiente de confirmar";

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
  /** Campos que faltaban y quedaron con el marcador. Nunca vacío por suposición. */
  pending: BriefField[];
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
  for (const field of BRIEF_FIELDS) {
    const value = raw[field]?.trim();
    if (!value || value.toLowerCase() === PENDING_MARKER) {
      out.pending.push(field);
      continue;
    }
    out[field] = value;
  }
  return out;
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
