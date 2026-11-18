import { useState } from "react";

// Inicio del constructor (etapa C).
//
// Cuando el dueño todavia no tiene sitios (o entra a crear uno nuevo) no se le
// enseña un panel vacio ni un formulario de campos: se le pide su proyecto en
// una sola frase, como se lo contaria a una persona. Lo que escribe se convierte
// en el `prompt` del primer diseño, y el editor abre con el chat ya arrancado.

/** Ejemplos que sirven de arranque: se pueden pulsar para rellenar la frase. */
const SAMPLES = [
  "Una cafetería de especialidad en Valencia con tueste propio",
  "Un taller de bicicletas con reparación a domicilio",
  "Una gestoría para autónomos, con cita previa",
];

export interface BuilderHomeProps {
  /** Crea el sitio y abre el editor con este prompt. Debe poder fallar. */
  onStart: (prompt: string) => Promise<void>;
  /** Un sitio existente al que volver, si lo hay. */
  onOpen?: (siteId: string) => void;
  back?: { label: string; onClick: () => void };
}

export function BuilderHome({ onStart, onOpen, back }: BuilderHomeProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const text = prompt.trim();
    if (!text) { setError("Escribe en una frase qué quieres montar."); return; }
    setError("");
    setBusy(true);
    try {
      await onStart(text);
    } catch {
      // El fallo se cuenta aqui: el dueno no se queda mirando un boton muerto.
      setError("No se pudo crear el sitio. Inténtalo de nuevo.");
      setBusy(false);
    }
  }

  return <div className="builder-home">
    <div className="builder-home-inner builder-fade">
      {back && <button type="button" className="text-link" onClick={back.onClick}>{back.label}</button>}

      <p className="eyebrow">CONSTRUIR CONVERSANDO</p>
      <h1>Cuéntame tu negocio<br/>y te hago la web <em>hablando</em>.</h1>
      <p className="builder-home-sub">
        Escribe una frase. Yo pregunto lo que me falte, monto el sitio a la vista
        y tú decides qué se queda. Nada se publica sin que lo pidas.
      </p>

      <form className="builder-home-form" onSubmit={(e) => void start(e)}>
        <input
          value={prompt}
          maxLength={500}
          placeholder="Una cafetería de especialidad en Valencia…"
          aria-label="Cuéntame tu proyecto"
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button className="primary" disabled={busy || prompt.trim().length === 0}>
          {busy ? "Creando…" : "Empezar"}
        </button>
      </form>

      {error && <div className="alert" role="alert">{error}</div>}

      <div className="builder-home-samples">
        {SAMPLES.map((s) => (
          <button key={s} type="button" className="builder-chip" disabled={busy} onClick={() => setPrompt(s)}>
            {s}
          </button>
        ))}
      </div>

      {onOpen && <button type="button" className="text-link" onClick={() => onOpen("")}>
        O entra en un sitio que ya tengas
      </button>}
    </div>
  </div>;
}
