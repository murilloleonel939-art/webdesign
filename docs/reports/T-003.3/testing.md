# Reporte T-003.3 — testing (gpt-6.2-sol)

- Fecha: 2026-11-25
- Resultado: PASS
- 1. Clasificador: «restaurante» → `site`; «clínica dental» → `site`; «abogados en Madrid» → `site`; brief vacío → `landing`; «vendo un curso de inglés online» → `landing`.
- 2. Frontera de palabra: «somos de barrio» → `landing`; «recursos humanos» → `landing`; «precios baratos» → `landing`; «un bar en el centro» → `site`.
- 3. Landing: 1 página, slug `/`.
- 4. Sitio: 4 páginas, slugs `/`, `/servicios`, `/sobre-nosotros`, `/contacto`, en ese orden.
- 5. Validez: sí para el documento landing y sí para el documento sitio completo mediante `validateSiteDocument`.
- 6. Marcador y prohibidas: ninguna página contiene `pendiente de confirmar`; no aparecen secciones `pricing` ni `testimonial`.
- 7. Nav: `href=/` texto `Inicio`; `href=/servicios` texto `Servicios`; `href=/sobre-nosotros` texto `Sobre nosotros`; `href=/contacto` texto `Contacto` · aria-current en `Servicios` · una página: site-nav no (no aparece el elemento `<nav class="site-nav">`; la cadena puede aparecer en CSS).
- 8. Plan vs documento: coinciden sí, por identificador, en las cuatro páginas. Plan → `/`: `hero/hero`, `features/features`, `faq/faq`, `cta/cta`; documento → `hero/s_hero`, `features/s_features`, `faq/s_faq`, `cta/s_cta`. Plan → `/servicios`: `hero/hero`, `features/features`, `process/process`, `cta/cta`; documento → `hero/s_hero`, `features/s_features`, `features/s_process`, `cta/s_cta`. Plan → `/sobre-nosotros`: `hero/hero`, `text/text`, `faq/faq`; documento → `hero/s_hero`, `text/s_text`, `faq/s_faq`. Plan → `/contacto`: `hero/hero`, `contact/contact`; documento → `hero/s_hero`, `contact/s_contact`. Los ids generados coinciden uno a uno por intención y posición. En `/servicios`, el documento tiene `{id: "s_process", type: "features"}` y el plan tiene `{type: "process", as: "process", action: "write", reason: "preset", origin: "copy_generico"}`. El plan nombra la intención, el documento usa el tipo del esquema, y el id `s_process` los liga. La convención está documentada en `plan.ts`, líneas 168-169, que declara coherencia entre plan y `draftSite`, y líneas 193-195, que generan `process` al recorrer `features`.
- Fallos reproducibles: ninguno.
- No verificado: ningún punto pendiente.
- Entrego a: seguridad

REPORTE | T-003.3 | testing | PASS | docs/reports/T-003.3/testing.md
