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

// "0.3s" -> 300, "300ms" -> 300. Sin unidad no es una duracion valida.
export function toMs(value: string): number | null {
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "s" ? Math.round(n * 1000) : Math.round(n);
}
