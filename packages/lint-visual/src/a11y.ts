// Reglas de accesibilidad y movimiento (spec 6.5, ampliacion de Fase 4).
//
// Origen de las ideas, reimplementadas aqui sin dependencia ni runtime:
//   - vercel-labs/agent-skills, `web-design-guidelines` (MIT): foco visible,
//     enlaces y botones operables con teclado.
//   - emilkowalski/skills, `review-animations`/`STANDARDS.md` (MIT): animar solo
//     `transform` y `opacity`, respetar `prefers-reduced-motion`, duraciones en
//     rango.
// Ver NOTICE.
//
// Lo que NO se copia: sus reglas hablan de React, de Next y de estados de carga
// que la plataforma no tiene. Aqui solo entra lo que se puede decidir mirando el
// CSS emitido, que es lo unico que jsdom sabe leer sin layout.

import type { LintFinding } from "@webdesign/linter";
import { finding, sectionOf } from "./base.js";
import type { Ctx } from "./typography.js";

// Declaraciones de todos los elementos de un contexto, ya resueltas.
function decls(ctx: Ctx): Array<{ el: Element; s: Record<string, string> }> {
  const out: Array<{ el: Element; s: Record<string, string> }> = [];
  for (const [el, s] of ctx.styles) out.push({ el, s });
  return out;
}

/**
 * A11Y_NO_VISIBLE_FOCUS: un enlace o boton sin foco visible.
 *
 * Quien navega con teclado necesita saber donde esta. El navegador pinta un
 * anillo por defecto, pero casi cualquier `outline:none` o un `border:0` en un
 * boton lo borra sin que se note.
 *
 * Solo cuenta si hay al menos un enlace o boton: un sitio sin ellos no tiene
 * nada que enfocar y no debe generar ruido.
 */
export function noVisibleFocus(ctx: Ctx): LintFinding[] {
  const objetivos = Array.from(ctx.doc.querySelectorAll("a[href], button, [tabindex]")).filter(
    (el) => el.getAttribute("tabindex") !== "-1",
  );
  if (objetivos.length === 0) return [];

  // El anillo de foco es cosa del pseudo-selector `:focus-visible`, que no se
  // aplica a ningun elemento concreto: se busca en el CSS crudo. Basta con que
  // exista una regla de foco que pinte algo.
  const conFoco = /:focus(-visible)?\s*\{[^}]*outline\s*:\s*(?!none)/.test(ctx.rawCss);
  if (conFoco) return [];

  // Sin ninguna regla de foco, el riesgo real es que algo quite el anillo por
  // defecto del navegador. Si nadie lo quita, el navegador lo pinta y no hay
  // defecto que reportar.
  for (const el of objetivos) {
    const s = ctx.styles.get(el) ?? {};
    const borra = s["outline"] === "none" || s["outline-style"] === "none";
    if (borra) {
      const where = sectionOf(el);
      return [
        finding("A11Y_NO_VISIBLE_FOCUS", "focus_outline_removed", {
          fixHint: "add_focus_visible_outline",
          ...(where ? { sectionId: where } : {}),
        }),
      ];
    }
  }
  return [];
}

// Propiedades que el navegador puede animar sin repintar: solo estas dos.
const COMPOSITE_SAFE = /^(transform|opacity)$/;

/**
 * MOTION_LAYOUT_ANIMATION: se anima una propiedad que fuerza repintado o layout.
 *
 * Animar `width`, `height`, `top`, `left`, `margin` o `all` obliga al navegador a
 * recalcular la pagina en cada fotograma. `all` es el peor: arrastra cualquier
 * propiedad que alguien anada despues, sin que nadie lo revise.
 *
 * Se mide sobre las declaraciones `transition`/`animation` emitidas; jsdom no
 * ejecuta animaciones, pero si conserva lo declarado.
 */
export function motionLayoutAnimation(ctx: Ctx): LintFinding[] {
  let hallazgo = false;
  let where: string | undefined;
  for (const { el, s } of decls(ctx)) {
    for (const prop of ["transition", "transition-property", "animation", "animation-name"]) {
      const valor = s[prop];
      if (!valor || valor === "none") continue;
      // `animation`/`animation-name` con @keyframes no dice que se anima; el
      // detalle esta en el keyframes, que aqui no se resuelve. Se ignoran.
      if (prop.startsWith("animation")) continue;
      // Lista separada por comas: cada tramo tiene su propiedad.
      for (const tramo of valor.split(",")) {
        const primera = tramo.trim().split(/\s+/)[0] ?? "";
        if (primera === "" || primera === "none") continue;
        if (primera === "all" || !COMPOSITE_SAFE.test(primera)) {
          hallazgo = true;
          where = sectionOf(el);
          break;
        }
      }
      if (hallazgo) break;
    }
    if (hallazgo) break;
  }
  if (!hallazgo) return [];
  return [
    finding("MOTION_LAYOUT_ANIMATION", "animates_layout_property", {
      fixHint: "animate_transform_or_opacity",
      ...(where ? { sectionId: where } : {}),
    }),
  ];
}

/**
 * MOTION_NO_REDUCED_MOTION: hay animacion y no hay `prefers-reduced-motion`.
 *
 * Para quien sufre mareo por movimiento, una entrada con desplazamiento es un
 * problema de salud, no de gusto. La consulta de medios se declara una vez y
 * cubre todo el sitio.
 */
export function motionNoReducedMotion(ctx: Ctx): LintFinding[] {
  const tieneMovimiento = Array.from(ctx.styles.values()).some(
    (s) => (s["transition"] && s["transition"] !== "none") || (s["animation"] && s["animation"] !== "none"),
  );
  if (!tieneMovimiento) return [];
  // El CSS emitido se conserva entero: se busca la consulta literal.
  if (/prefers-reduced-motion/.test(ctx.rawCss)) return [];
  return [finding("MOTION_NO_REDUCED_MOTION", "motion_without_reduced_motion_query", { fixHint: "add_prefers_reduced_motion" })];
}

/**
 * MOTION_DURATION_OUT_OF_RANGE: duracion fuera de rango.
 *
 * Bajo 100ms el movimiento no se percibe (y el elemento "salta"); por encima de
 * 600ms una interaccion se siente lenta aunque el diseno sea bueno. Es el rango
 * que usa el estandar de `review-animations`.
 */
export function motionDurationOutOfRange(ctx: Ctx): LintFinding[] {
  const MIN = 100;
  const MAX = 600;
  for (const { el, s } of decls(ctx)) {
    // El motor de CSS de aqui no expande atajos, asi que `transition:opacity .2s`
    // no produce `transition-duration`. Se leen las dos formas: la larga si
    // existe y, si no, el tiempo que venga dentro del atajo.
    const larga = s["transition-duration"] ?? s["animation-duration"];
    const atajo = s["transition"] ?? s["animation"];
    const valores = larga
      ? larga.split(",")
      : (atajo && atajo !== "none" ? atajo.split(",") : [])
          // En `transition: opacity 0.2s ease`, el tiempo es el token con unidad.
          .map((tramo) => (tramo.match(/(\d*\.?\d+(?:ms|s))\b/) ?? [])[1])
          .filter((v): v is string => v !== undefined);
    for (const parte of valores) {
      const ms = toMs(parte.trim());
      if (ms === null) continue;
      if (ms < MIN || ms > MAX) {
        const where = sectionOf(el);
        return [
          finding("MOTION_DURATION_OUT_OF_RANGE", "duration_out_of_range", {
            fixHint: "use_duration_between_100ms_and_600ms",
            ...(where ? { sectionId: where } : {}),
          }),
        ];
      }
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Ampliacion ui-skills (ver NOTICE): nombres accesibles, etiquetas de campo y
// texto de enlace. Son reglas sobre el marcado ya renderizado, sin layout.
// ---------------------------------------------------------------------------

/**
 * Texto util de un subarbol: se saltan los nodos `aria-hidden`, y los `svg` que
 * no llevan `<title>` propio, que es como el renderer pinta los iconos.
 *
 * Un `svg` sin `title` no aporta nombre: es decoracion. Un `img` si aporta su
 * `alt`, porque es texto que alguien escribio para ser leido.
 */
function visibleText(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Element): void => {
    for (const child of Array.from(node.childNodes)) {
      // 1 = elemento, 3 = texto; el resto (comentarios) no se lee.
      if (child.nodeType === 3) {
        parts.push(child.textContent ?? "");
        continue;
      }
      if (child.nodeType !== 1) continue;
      const e = child as Element;
      if (e.getAttribute("aria-hidden") === "true") continue;
      const tag = e.tagName.toLowerCase();
      if (tag === "svg") {
        const t = e.querySelector("title")?.textContent?.trim();
        if (t) parts.push(t);
        continue;
      }
      if (tag === "img") {
        parts.push(e.getAttribute("alt") ?? "");
        continue;
      }
      walk(e);
    }
  };
  walk(el);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Un nodo `aria-hidden` no existe para quien usa lector de pantalla. */
function isHidden(el: Element): boolean {
  let node: Element | null = el;
  while (node) {
    if (node.getAttribute("aria-hidden") === "true") return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Nombre accesible por el orden que fija la spec: `aria-label`,
 * `aria-labelledby`, texto visible y, como ultimo recurso, `title`.
 */
function accessibleName(el: Element): string {
  const label = (el.getAttribute("aria-label") ?? "").trim();
  if (label) return label;
  const refs = (el.getAttribute("aria-labelledby") ?? "").trim();
  if (refs) {
    const doc = el.ownerDocument;
    const text = refs
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text;
  }
  const inner = visibleText(el);
  if (inner) return inner;
  return (el.getAttribute("title") ?? "").trim();
}

/**
 * A11Y_CONTROL_NO_ACCESSIBLE_NAME: boton o enlace sin nada que lo nombre.
 *
 * Un control solo decorado (tipicamente un icono) se anuncia como "boton" y
 * nada mas: quien no ve la pantalla no sabe que hace. Es `error` porque el
 * control queda inutilizable, no solo feo.
 */
export function controlNoAccessibleName(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(ctx.doc.querySelectorAll("button, a[href], [role=button]"))) {
    if (isHidden(el)) continue;
    if (accessibleName(el) !== "") continue;
    const section = sectionOf(el);
    const key = section ?? "page";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      finding("A11Y_CONTROL_NO_ACCESSIBLE_NAME", "control_without_accessible_name", {
        fixHint: "add_aria_label_to_control",
        ...(section ? { sectionId: section } : {}),
      }),
    );
  }
  return out;
}

/** `hidden`, `submit`, `button` y `reset` los pinta el navegador, no se etiquetan. */
const SKIP_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset"]);

function hasLabel(ctx: Ctx, el: Element): boolean {
  if ((el.getAttribute("aria-label") ?? "").trim()) return true;
  if ((el.getAttribute("aria-labelledby") ?? "").trim()) return true;
  // Etiqueta envolvente: <label>Texto <input></label>.
  if (el.closest("label")) return true;
  // Etiqueta asociada por `for`, que exige que el campo tenga id.
  const id = (el.getAttribute("id") ?? "").trim();
  if (!id) return false;
  const esc = id.replace(/["\\]/g, "\\$&");
  return ctx.doc.querySelector(`label[for="${esc}"]`) !== null;
}

/**
 * A11Y_FIELD_UNLABELED: campo de formulario sin etiqueta asociada.
 *
 * El placeholder no es una etiqueta: desaparece al escribir y no lo anuncia el
 * lector. Sin etiqueta el campo es un hueco en blanco.
 */
export function fieldUnlabeled(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(ctx.doc.querySelectorAll("input, select, textarea"))) {
    if (isHidden(el)) continue;
    if (el.tagName.toLowerCase() === "input") {
      const type = (el.getAttribute("type") ?? "text").trim().toLowerCase();
      if (SKIP_INPUT_TYPES.has(type)) continue;
    }
    if (hasLabel(ctx, el)) continue;
    const section = sectionOf(el);
    const key = section ?? "page";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      finding("A11Y_FIELD_UNLABELED", "field_without_label", {
        fixHint: "associate_label_with_field",
        ...(section ? { sectionId: section } : {}),
      }),
    );
  }
  return out;
}

/**
 * Textos de enlace que no dicen a donde llevan. Se comparan ya recortados y en
 * minusculas: la lista incluye las formas con y sin tilde porque el dueno
 * escribe las dos.
 */
const VAGUE_LINK_TEXT = new Set([
  "click here", "click", "here", "leer mas", "leer más", "ver mas", "ver más",
  "aqui", "aquí", "mas", "más", "more", "read more", "link",
]);

/**
 * A11Y_LINK_VAGUE_TEXT: el texto del enlace no describe su destino.
 *
 * Quien navega saltando de enlace en enlace (o quien usa un lector) solo oye el
 * texto: diez "leer más" son diez destinos indistinguibles. Un enlace que solo
 * envuelve una imagen con `alt` util no es vago: el `alt` es el texto.
 */
export function linkVagueText(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(ctx.doc.querySelectorAll("a[href]"))) {
    if (isHidden(el)) continue;
    const text = visibleText(el).toLowerCase();
    if (text && !VAGUE_LINK_TEXT.has(text)) continue;
    const section = sectionOf(el);
    const key = `${section ?? "page"}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      finding("A11Y_LINK_VAGUE_TEXT", "link_text_not_descriptive", {
        fixHint: "write_descriptive_link_text",
        ...(section ? { sectionId: section } : {}),
      }),
    );
  }
  return out;
}

/** Una lista pintada a mano: un guion o vineta al principio del texto. */
const BULLET = /^[-–—•·*]\s+/;

/**
 * A11Y_LIST_NOT_SEMANTIC: algo que se lee como lista sin serlo.
 *
 * Una lista real da a quien usa lector el numero de elementos y permite saltar
 * de uno a otro; un monton de `div` con guiones es un parrafo largo. Se admiten
 * `ul`, `ol` y `menu` como padres; `div[role=list]` tambien, porque el `role`
 * restituye la semantica.
 *
 * Solo se reporta la primera ocurrencia por seccion: el defecto es del bloque,
 * y repetirlo en cada linea convierte el aviso en ruido.
 */
export function listNotSemantic(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  const seen = new Set<string>();
  const report = (el: Element) => {
    const section = sectionOf(el);
    const key = section ?? "page";
    if (seen.has(key)) return;
    seen.add(key);
    out.push(
      finding("A11Y_LIST_NOT_SEMANTIC", "list_without_list_semantics", {
        fixHint: "use_ul_or_ol_for_lists",
        ...(section ? { sectionId: section } : {}),
      }),
    );
  };

  for (const el of Array.from(ctx.doc.querySelectorAll("li"))) {
    const parent = el.parentElement;
    const tag = parent?.tagName.toLowerCase();
    const role = parent?.getAttribute("role");
    if (tag === "ul" || tag === "ol" || tag === "menu" || role === "list") continue;
    report(el);
  }

  // El renderer no usa `li` fuera de lista, pero si un bloque de texto con
  // guiones: se reconoce por el texto, no por el tag.
  for (const el of Array.from(ctx.doc.querySelectorAll("div, p, section"))) {
    const lines = (el.textContent ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const bullets = lines.filter((l) => BULLET.test(l)).length;
    if (bullets < 2) continue;
    report(el);
  }
  return out;
}

// "0.3s" -> 300, "300ms" -> 300. Sin unidad no es una duracion valida.
export function toMs(value: string): number | null {
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "s" ? Math.round(n * 1000) : Math.round(n);
}
