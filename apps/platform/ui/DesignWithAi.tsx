import { useEffect, useRef, useState } from "react";

// Diseñar con IA (spec 9.1, punto D del encargo).
//
// El agente NO trabaja dentro de esta peticion: la plataforma encola la
// ejecucion y responde 202 con su id. El panel, entonces, mira como va y
// recarga el borrador cuando termina. Todo lo que se lee esta en castellano y
// sin codigos: el dueno ve en que punto esta y que le falta por confirmar.

const api = (path: string, init?: RequestInit) => fetch(path, { credentials: "same-origin", ...init });

/** Los cinco datos que pide el brief. Todos opcionales, al menos uno. */
const FIELDS: Array<{ key: BriefKey; label: string; placeholder: string; max: number }> = [
  { key: "businessType", label: "Tipo de negocio", placeholder: "cafetería de especialidad", max: 120 },
  { key: "name", label: "Nombre", placeholder: "Café Aurora", max: 80 },
  { key: "city", label: "Ciudad", placeholder: "Valencia", max: 80 },
  { key: "service", label: "Qué ofreces", placeholder: "tueste propio y reparto a domicilio", max: 200 },
  { key: "contact", label: "Cómo te contactan", placeholder: "hola@cafeaurora.es", max: 200 },
];

type BriefKey = "businessType" | "name" | "city" | "service" | "contact";

/** Cada cuanto se pregunta por la ejecucion, y cuando se deja de preguntar. */
const POLL_MS = 1500;
const POLL_MAX = 60;

type Phase = "form" | "running" | "done";

interface RunStatus {
  status?: string;
  stopReason?: string | null;
}

/** Texto para el dueno a partir del estado: nunca el codigo crudo. */
function phaseText(run: RunStatus): string {
  const reason = (run.stopReason ?? "").trim();
  if (run.status === "ok") return reason || "Diseño aplicado. Revisa las secciones que dicen «pendiente de confirmar».";
  if (run.status === "budget_exhausted") {
    return reason || "Se agotó el tiempo del diseño. Lo que se alcanzó a escribir está en tu borrador.";
  }
  return reason || "No se pudo completar el diseño. Tu borrador sigue como estaba.";
}

export function DesignWithAi({ siteId, onClose, onApplied }: {
  siteId: string;
  onClose: () => void;
  /** Recarga el borrador y el editor: lo que el agente guardo ya esta en el. */
  onApplied: () => void;
}) {
  const [values, setValues] = useState<Record<BriefKey, string>>({
    businessType: "", name: "", city: "", service: "", contact: "",
  });
  const [phase, setPhase] = useState<Phase>("form");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // El sondeo se para al cerrar o al desmontar: sin esto, cerrar el dialogo
  // dejaria una peticion cada 1,5 s hasta el final de la ejecucion.
  const stopped = useRef(false);
  useEffect(() => () => { stopped.current = true; }, []);

  const filled = FIELDS.some((f) => (values[f.key] ?? "").trim().length > 0);

  async function waitFor(runId: string): Promise<void> {
    for (let i = 0; i < POLL_MAX; i += 1) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (stopped.current) return;
      let run: RunStatus;
      try {
        const r = await api(`/api/sites/${siteId}/design-runs/${runId}`);
        // Una ejecucion que ya no se ve (sesion cerrada, sitio borrado) no se
        // reintenta: se deja de preguntar y se dice lo unico cierto.
        if (!r.ok) { setPhase("done"); setMessage("El diseño no pudo completarse. Tu borrador sigue como estaba."); return; }
        run = await r.json() as RunStatus;
      } catch {
        // Un corte de red no cancela el trabajo del agente: se sigue mirando.
        continue;
      }
      if (run.status && run.status !== "running") {
        setPhase("done");
        setMessage(phaseText(run));
        // Ya hay documento nuevo en el servidor: se recarga para que el dueno
        // lo vea sin salir del editor.
        onApplied();
        return;
      }
      setMessage("Escribiendo el diseño…");
    }
    // Se acabo la espera, no la ejecucion. Se dice tal cual, sin inventar.
    setPhase("done");
    setMessage("El diseño esta tardando mas de lo normal. Cierra este aviso y vuelve a entrar en un rato.");
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    if (!filled) { setError("Escribe al menos un dato de tu negocio."); return; }
    setPhase("running");
    setMessage("Preparando el diseño…");
    // Solo se envian los campos escritos: un campo vacio no es un dato.
    const brief: Partial<Record<BriefKey, string>> = {};
    for (const f of FIELDS) {
      const v = (values[f.key] ?? "").trim();
      if (v) brief[f.key] = v;
    }
    let res: Response;
    try {
      res = await api(`/api/sites/${siteId}/design-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(brief),
      });
    } catch {
      setPhase("form");
      setError("No se pudo contactar con el servicio. Comprueba tu conexión.");
      return;
    }
    if (res.status === 503) {
      setPhase("form");
      setError("El diseño con IA no está disponible ahora mismo. Tu sitio sigue como estaba.");
      return;
    }
    if (res.status === 400) {
      setPhase("form");
      setError("Revisa los datos: alguno es demasiado largo o no vale.");
      return;
    }
    if (!res.ok) {
      setPhase("form");
      setError("No se pudo empezar el diseño. Inténtalo de nuevo.");
      return;
    }
    const body = await res.json().catch(() => ({})) as { runId?: string };
    if (!body.runId) {
      setPhase("form");
      setError("No se pudo empezar el diseño. Inténtalo de nuevo.");
      return;
    }
    await waitFor(body.runId);
  }

  return <div className="modal-veil" role="dialog" aria-modal="true" aria-label="Diseñar con IA">
    <div className="modal-card design-card">
      <h2>Diseñar con IA</h2>
      <p>
        Escribe lo que sepas de tu negocio. Lo que dejes en blanco se queda marcado como
        <strong> «pendiente de confirmar»</strong> en el sitio: no se inventa nada.
      </p>
      <form onSubmit={(e) => void submit(e)}>
        <div className="design-fields">
          {FIELDS.map((f) => (
            <label key={f.key}>
              <span>{f.label}</span>
              <input
                value={values[f.key]}
                maxLength={f.max}
                placeholder={f.placeholder}
                disabled={phase === "running"}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {error && <div className="alert" role="alert">{error}</div>}
        {phase !== "form" && <p className="design-progress" role="status">{message}</p>}
        <div className="modal-actions">
          <button type="button" className="text-link" onClick={onClose}>
            {phase === "done" ? "Cerrar" : "Cancelar"}
          </button>
          {phase !== "done" && <button type="submit" className="primary" disabled={phase === "running" || !filled}>
            {phase === "running" ? "Diseñando…" : "Diseñar mi sitio"}
          </button>}
          {phase === "done" && <button type="button" className="primary" onClick={onClose}>Ver mi sitio</button>}
        </div>
      </form>
    </div>
  </div>;
}
