// Selector de estilo inicial (Fase 1b).
// Se muestra cuando el sitio aun esta vacio: el dueno elige un punto de
// partida en lugar de enfrentarse a un lienzo en blanco.

import { useEffect, useState } from "react";

interface Style {
  id: string;
  name: string;
  summary: string;
  colors: { ground: string; ink: string; accent: string };
  radius: "square" | "rounded" | "pill";
  sections: Array<{ type: string }>;
}

interface Props {
  siteId: string;
  expectedRev: number;
  // Si el sitio ya tiene contenido propio, cambiar de estilo no puede borrarlo
  // sin permiso: se pregunta antes.
  hasContent?: boolean;
  onApplied: () => void;
  onSkip: () => void;
}

const SECTION_LABEL: Record<string, string> = {
  hero: "Portada",
  text: "Texto",
  features: "Ventajas",
  testimonial: "Opiniones",
  gallery: "Galería",
  pricing: "Precios",
  faq: "Preguntas",
  contact: "Contacto",
  cta: "Llamada",
  image: "Imagen",
};

function api(path: string, init?: RequestInit) {
  return fetch(path, { credentials: "same-origin", ...init });
}

type Mode = "inherit" | "reset";

export function StyleStart({ siteId, expectedRev, hasContent = false, onApplied, onSkip }: Props) {
  const [styles, setStyles] = useState<Style[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Con contenido previo hay que decidir antes de aplicar: heredar lo que ya
  // esta escrito o empezar de cero con la estructura del estilo.
  const [chosen, setChosen] = useState<Style | null>(null);
  const [mode, setMode] = useState<Mode>("inherit");

  useEffect(() => {
    api("/api/design-styles")
      .then(async (r) => {
        if (!r.ok) throw new Error("carga");
        const body = (await r.json()) as { styles?: Style[] };
        setStyles(Array.isArray(body.styles) ? body.styles : []);
      })
      .catch(() => setError("No se pudieron cargar los estilos."));
  }, []);

  async function apply(id: string, how: Mode = "inherit") {
    setBusy(id);
    setError("");
    const r = await api(`/api/sites/${siteId}/apply-preset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: id, expectedRev, mode: how }),
    });
    setBusy(null);
    if (r.ok) {
      onApplied();
      return;
    }
    setChosen(null);
    if (r.status === 400) setError("Ese estilo ya no está disponible.");
    else if (r.status === 409) setError("El sitio cambió mientras elegías. Recarga la página.");
    else setError("No se pudo aplicar el estilo.");
  }

  return (
    <div className="start-screen">
      <header className="start-head">
        <p className="eyebrow">PUNTO DE PARTIDA</p>
        <h1>Elige un estilo y empieza con algo hecho.</h1>
        <p className="muted">
          Aplicarás colores, tipografía y una estructura de secciones. Después puedes cambiar
          lo que quieras, bloque a bloque.
        </p>
      </header>

      {error && <div className="alert">{error}</div>}

      {!styles && !error && <p className="muted">Cargando estilos…</p>}

      <div className="style-grid">
        {styles?.map((s) => (
          <article className="style-card" key={s.id}>
            {/* La muestra usa los colores reales del preset: se ve lo que se elige. */}
            <div
              className={`style-swatch radius-${s.radius}`}
              style={{ background: s.colors.ground, color: s.colors.ink }}
              aria-hidden="true"
            >
              <span className="swatch-headline" style={{ background: s.colors.ink }} />
              <span className="swatch-line" style={{ background: s.colors.ink, opacity: 0.35 }} />
              <span className="swatch-line short" style={{ background: s.colors.ink, opacity: 0.35 }} />
              <span className="swatch-dot" style={{ background: s.colors.accent }} />
            </div>
            <div className="style-body">
              <h2>{s.name}</h2>
              <p className="muted">{s.summary}</p>
              <p className="style-sections">
                {s.sections.map((x) => SECTION_LABEL[x.type] ?? x.type).join(" · ")}
              </p>
              <button
                className="primary"
                disabled={busy !== null}
                onClick={() => (hasContent ? setChosen(s) : apply(s.id, "reset"))}
              >
                {busy === s.id ? "Aplicando…" : "Usar este estilo"}
              </button>
            </div>
          </article>
        ))}
      </div>

      <button className="text-link" onClick={onSkip}>
        Empezar en blanco
      </button>

      {chosen && (
        <div className="modal-veil" role="dialog" aria-modal="true" aria-labelledby="cambio-estilo">
          <div className="modal-card">
            <h2 id="cambio-estilo">Cambiar a «{chosen.name}»</h2>
            <p className="muted">
              Tu sitio ya tiene contenido. Elige qué pasa con él.
            </p>

            <label className={`mode-option${mode === "inherit" ? " is-on" : ""}`}>
              <input
                type="radio"
                name="modo"
                value="inherit"
                checked={mode === "inherit"}
                onChange={() => setMode("inherit")}
              />
              <span>
                <strong>Mantener mi contenido</strong>
                <em>Cambian los colores, la tipografía y el espaciado. Tus textos, imágenes y secciones se quedan como están.</em>
              </span>
            </label>

            <label className={`mode-option${mode === "reset" ? " is-on" : ""}`}>
              <input
                type="radio"
                name="modo"
                value="reset"
                checked={mode === "reset"}
                onChange={() => setMode("reset")}
              />
              <span>
                <strong>Empezar de cero</strong>
                <em>El contenido de la portada se sustituye por el que trae el estilo. Lo que hayas escrito se pierde.</em>
              </span>
            </label>

            <div className="modal-actions">
              <button className="text-link" onClick={() => setChosen(null)}>Cancelar</button>
              <button
                className="primary"
                disabled={busy !== null}
                onClick={() => apply(chosen.id, mode)}
              >
                {busy ? "Aplicando…" : mode === "reset" ? "Sí, empezar de cero" : "Aplicar estilo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
