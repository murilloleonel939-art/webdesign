import { useEffect, useRef, useState } from "react";
import { QUESTIONS, buildPayload, isSendKey, undoMessage } from "./design-chat-flow";
import type { BriefKey, Question } from "./design-chat-flow";

// El constructor conversacional (etapa C).
//
// Construir es conversar: el asistente pregunta, el dueño responde y el sitio
// aparece en el lienzo de al lado. Las preguntas NO son un formulario: son una
// tarjeta flotante sobre la entrada del chat, con opciones numeradas que
// tambien se eligen con las teclas 1-4, una fila "Otro..." de texto libre y un
// boton para saltar. Todo se puede plegar con el chevron.
//
// El agente no trabaja dentro de esta peticion: la plataforma encola el diseño
// y responde 202 con su id. Aqui se mira como va y se avisa al panel para que
// recargue el borrador. Nada se publica desde aqui.

const api = (path: string, init?: RequestInit) => fetch(path, { credentials: "same-origin", ...init });

const CONTACT_MAX = 200;
const CONTACT_PLACEHOLDER = "hola@cafeaurora.es o 600 123 123";

/** Cada cuanto se pregunta por la ejecucion, y cuando se deja de preguntar. */
const POLL_MS = 1500;
const POLL_MAX = 60;

/** Pasos que se leen mientras el agente escribe. No son un log tecnico. */
const STEPS = ["Leyendo tu idea", "Eligiendo la estructura", "Escribiendo las secciones", "Revisando el estilo"] as const;

type Phase = "asking" | "running" | "done";

interface RunStatus {
  status?: string;
  stopReason?: string | null;
}

/** Texto para el dueño a partir del estado: nunca el codigo crudo. */
function phaseText(run: RunStatus): string {
  const reason = (run.stopReason ?? "").trim();
  if (run.status === "ok") {
    return reason || "Ya tienes un primer diseño. Revisa las secciones que dicen «pendiente de confirmar».";
  }
  if (run.status === "budget_exhausted") {
    return reason || "Se acabó el tiempo del diseño. Lo que dio tiempo a escribir está en tu borrador.";
  }
  return reason || "No se pudo completar el diseño. Tu borrador sigue como estaba.";
}

export interface DesignChatProps {
  siteId: string;
  /** Lo que el dueño escribió al crear el sitio: ya es la primera peticion. */
  initialPrompt?: string;
  /** El panel pliega el chat para dar el ancho entero al lienzo. */
  collapsed?: boolean;
  /** Recarga el borrador: lo que el agente guardo ya esta en el servidor. */
  onDraftChanged: () => void;
  /** Avisa al panel para ensenar el esqueleto del sitio mientras se diseña. */
  onRunningChange?: (running: boolean) => void;
  /** Datos que el diseño dejo como "pendiente de confirmar" (spec 6.5). */
  pending?: string[];
  /** El panel decide que hacer al ver el resultado (por ejemplo, ir al lienzo). */
  onShowResult?: () => void;
}

/** El estado de la burbuja de deshacer, ya traducido a texto. Sin codigos crudos. */
type UndoState = { kind: "ok" | "confirm" | "gone" | "retry"; text: string };

export function DesignChat({ siteId, initialPrompt, collapsed = false, onDraftChanged, onRunningChange, pending, onShowResult }: DesignChatProps) {
  const [answers, setAnswers] = useState<Partial<Record<BriefKey, string>>>({});
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("asking");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // El runId de la ejecucion en curso: hace falta para poder deshacerla.
  const [runId, setRunId] = useState<string | null>(null);
  // Si la ejecucion termino con status 'ok': solo entonces hay algo que ver o deshacer.
  const [runOk, setRunOk] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  // El ultimo `force` con el que se intento deshacer, para que "Reintentar" repita lo mismo.
  const lastUndoForce = useRef(false);
  // El plegado es del dueño: la tarjeta recuerda si la dejo abierta o cerrada.
  const [open, setOpen] = useState(true);
  // "Otro..." (dentro de la tarjeta) y el compositor (la entrada del chat,
  // siempre visible abajo) son dos campos distintos: compartir estado haria
  // que escribir en uno borrase lo que habia en el otro.
  const [other, setOther] = useState("");
  const [composerText, setComposerText] = useState("");
  const [step, setStep] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  // El sondeo se para al cerrar o al desmontar: sin esto, salir del editor
  // dejaria una peticion cada 1,5 s hasta el final de la ejecucion.
  const stopped = useRef(false);
  useEffect(() => () => { stopped.current = true; }, []);

  const current = QUESTIONS[index];
  const filled = Object.values(answers).some((v) => (v ?? "").trim().length > 0);

  // Los pasos del diseño avanzan con el tiempo, no con datos inventados: son
  // una lectura del trabajo en curso, y se quedan en el ultimo si tarda.
  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2600);
    return () => clearInterval(t);
  }, [phase]);

  // Cuenta los segundos del diseño para poder decir "Completado en Ns".
  useEffect(() => {
    if (phase !== "running" || startedAt === null) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase, startedAt]);
  useEffect(() => { onRunningChange?.(phase === "running"); }, [phase, onRunningChange]);

  async function waitFor(runId: string): Promise<void> {
    for (let i = 0; i < POLL_MAX; i += 1) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (stopped.current) return;
      let run: RunStatus;
      try {
        const r = await api(`/api/sites/${siteId}/design-runs/${runId}`);
        // Una ejecucion que ya no se ve (sesion cerrada, sitio borrado) no se
        // reintenta: se deja de preguntar y se dice lo unico cierto.
        if (!r.ok) {
          setPhase("done");
          setMessage("El diseño no pudo completarse. Tu borrador sigue como estaba.");
          return;
        }
        run = await r.json() as RunStatus;
      } catch {
        // Un corte de red no cancela el trabajo del agente: se sigue mirando.
        continue;
      }
      if (run.status && run.status !== "running") {
        setPhase("done");
        setRunOk(run.status === "ok");
        setMessage(phaseText(run));
        if (startedAt !== null) setElapsed(Math.round((Date.now() - startedAt) / 1000));
        // Ya hay documento nuevo en el servidor: se recarga para que el dueño
        // lo vea sin salir del editor.
        onDraftChanged();
        return;
      }
      setMessage("Escribiendo el diseño…");
    }
    // Se acabo la espera, no la ejecucion. Se dice tal cual, sin inventar.
    setPhase("done");
    setMessage("El diseño está tardando más de lo normal. Vuelve a entrar en un rato y estará.");
  }

  /**
   * Lanza el diseño con lo que haya respondido.
   *
   * La primera vez viaja tambien el `prompt`: lo que el dueño escribio al crear
   * el sitio y lo que escriba en el compositor. El servidor lo mete en el brief
   * como `description` (contexto para el resumen, recortado a 500), asi que la
   * conversacion empieza donde el dueño la dejo.
   */
  async function design(extra?: BriefKey, value?: string): Promise<void> {
    const all: Partial<Record<BriefKey, string>> = extra ? { ...answers, [extra]: value } : answers;
    const payload = buildPayload(all, initialPrompt, composerText);
    if (!payload) {
      setError("Cuéntame algo de tu negocio —o escríbelo abajo— y empiezo cuando quieras.");
      return;
    }
    setError("");
    setPhase("running");
    setStep(0);
    setElapsed(0);
    setStartedAt(Date.now());
    setMessage("Preparando el diseño…");
    let res: Response;
    try {
      res = await api(`/api/sites/${siteId}/design-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload.prompt ? { ...payload.brief, prompt: payload.prompt } : payload.brief),
      });
    } catch {
      setPhase("asking");
      setError("No se pudo contactar con el servicio. Comprueba tu conexión.");
      return;
    }
    if (res.status === 503) {
      setPhase("asking");
      setError("El asistente no está disponible ahora mismo. Tu sitio no ha cambiado.");
      return;
    }
    if (res.status === 400) {
      setPhase("asking");
      setError("Revisa lo que escribiste: algo es demasiado largo o no vale.");
      return;
    }
    if (!res.ok) {
      setPhase("asking");
      setError("No se pudo empezar el diseño. Inténtalo de nuevo.");
      return;
    }
    const body = await res.json().catch(() => ({})) as { runId?: string };
    if (!body.runId) {
      setPhase("asking");
      setError("No se pudo empezar el diseño. Inténtalo de nuevo.");
      return;
    }
    setRunId(body.runId);
    setRunOk(false);
    setUndoState(null);
    await waitFor(body.runId);
  }

  /** Deshace la ejecucion actual. `force` salta el aviso de "editado despues". */
  async function undo(force = false): Promise<void> {
    if (!runId) return;
    lastUndoForce.current = force;
    let res: Response;
    try {
      res = await api(`/api/sites/${siteId}/design-runs/${runId}/undo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(force ? { force: true } : {}),
      });
    } catch {
      setUndoState({ kind: "retry", text: "No se pudo deshacer ahora. Inténtalo de nuevo." });
      return;
    }
    const body = await res.json().catch(() => ({})) as { error?: string };
    const result = undoMessage(res.status, body);
    setUndoState(result);
    if (result.kind === "ok") {
      onDraftChanged();
      setRunOk(false);
    } else if (result.kind === "gone") {
      setRunOk(false);
    }
  }

  /** Responde la pregunta actual y avanza. La ultima respuesta lanza el diseño. */
  function answer(q: Question, value: string): void {
    const text = value.trim().slice(0, q.max);
    if (!text) return;
    setAnswers((a) => ({ ...a, [q.key]: text }));
    setOther("");
    if (index < QUESTIONS.length - 1) {
      setIndex(index + 1);
      return;
    }
    void design(q.key, text);
  }

  // Teclas 1-4 para las opciones numeradas. Se ignoran mientras el dueño
  // escribe en un campo: un "2" dentro de "Calle 2" no es una respuesta.
  useEffect(() => {
    if (phase !== "asking" || !open || !current) return;
    function onKey(e: KeyboardEvent): void {
      const el = e.target as HTMLElement | null;
      const typing = el !== null && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      const option = current && Number.isInteger(n) && n >= 1 && n <= 4 ? current.options[n - 1] : undefined;
      if (!option) return;
      e.preventDefault();
      answer(current!, option);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, open, current, index, answers]);

  // El turno del asistente: mientras pregunta, es la pregunta; al terminar, el
  // resumen. El del dueño se pinta aparte con lo que escribio al crear el sitio.
  const assistantTurn = phase === "running"
    ? "Voy a montarlo. Te aviso aquí en cuanto esté."
    : phase === "done" ? message : null;

  // Lo mismo que mira el boton: una sola condicion para el boton y el teclado.
  const sendDisabled = phase === "running" || (!filled && !composerText.trim() && !(initialPrompt ?? "").trim());

  return <section className={collapsed ? "builder-chat builder-fade is-collapsed" : "builder-chat builder-fade"} aria-label="Chat del constructor">
    <header className="builder-chat-head">
      <div>
        <h1>Construir conversando</h1>
        <p className="builder-chat-sub">Responde lo que sepas. Lo demás queda por confirmar.</p>
      </div>
    </header>

    <div className="builder-chat-log" role="log" aria-live="polite" aria-relevant="additions text">
      {(initialPrompt ?? "").trim() && <div className="builder-msg builder-msg--user"><p>{initialPrompt}</p></div>}
      <div className="builder-msg builder-msg--assistant">
        <p>Cuéntame tu proyecto y lo voy montando. Te hago unas preguntas cortas primero.</p>
      </div>
      {assistantTurn && <div className="builder-msg builder-msg--assistant"><p>{assistantTurn}</p></div>}

      {phase === "running" && <div className="builder-msg builder-msg--assistant">
        <p>Diseñando…</p>
        <ul className="builder-steps">
          {STEPS.map((label, i) => (
            <li key={label} className={`builder-step${i < step ? " is-done" : i === step ? " is-active" : ""}`}>
              <span className="builder-dot" aria-hidden="true"/>{label}
            </li>
          ))}
        </ul>
      </div>}

      {phase === "done" && <div className="builder-done" role="status">
        <span>Completado en {elapsed}s</span>
        <button
          type="button"
          className="builder-copy"
          onClick={() => { void navigator.clipboard?.writeText(message).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => setCopied(false)); }}
        >{copied ? "Copiado" : "Copiar resumen"}</button>
        {runOk && <div className="builder-run-actions">
          <button
            type="button"
            className="builder-opt"
            onClick={() => { onDraftChanged(); onShowResult?.(); }}
          >Ver resultado</button>
          <button type="button" className="builder-opt" onClick={() => void undo(false)}>Deshacer</button>
        </div>}
      </div>}

      {phase === "done" && runOk && pending && pending.length > 0 && <div className="builder-msg builder-msg--assistant">
        <p>Listo. He marcado {pending.length} dato(s) como «pendiente de confirmar»; dime cuáles cambio o edítalos a mano.</p>
        <ul className="builder-chips">
          {pending.map((p) => <li key={p} className="builder-chip">{p}</li>)}
        </ul>
      </div>}

      {undoState && <div className="builder-msg builder-msg--assistant">
        <p>{undoState.text}</p>
        {undoState.kind === "confirm" && <div className="builder-run-actions">
          <button type="button" className="builder-opt" onClick={() => void undo(true)}>Deshacer igualmente</button>
          <button type="button" className="builder-opt" onClick={() => setUndoState(null)}>Cancelar</button>
        </div>}
        {undoState.kind === "retry" && <div className="builder-run-actions">
          <button type="button" className="builder-opt" onClick={() => void undo(lastUndoForce.current)}>Reintentar</button>
        </div>}
      </div>}
    </div>

    {phase === "asking" && current && <div className="builder-ask" role="group" aria-labelledby="builder-ask-title">
      <div className="builder-ask-head">
        <div>
          <h2 id="builder-ask-title">{current.title}</h2>
          {open && <p className="builder-ask-hint">{current.hint}</p>}
        </div>
        <button
          type="button"
          className="builder-chevron"
          aria-expanded={open}
          aria-controls="builder-ask-body"
          aria-label={open ? "Plegar la pregunta" : "Desplegar la pregunta"}
          onClick={() => setOpen((v) => !v)}
        >▾</button>
      </div>

      {open && <div id="builder-ask-body">
        {current.options.length > 0 && <ol className="builder-ask-list">
          {current.options.map((option, i) => (
            <li key={option}>
              <button type="button" className="builder-opt" onClick={() => answer(current, option)}>
                <span className="builder-key" aria-hidden="true">{i + 1}</span>
                {option}
              </button>
            </li>
          ))}
        </ol>}

        {/* "Otro..." es un campo, no una quinta opcion: lo que se escribe no
            cabe en una lista. Enter responde sin salir del teclado. */}
        {current.options.length > 0 && <form
          className="builder-other"
          onSubmit={(e) => { e.preventDefault(); answer(current, other); }}
        >
          <input
            value={other}
            maxLength={current.max}
            placeholder={current.options.length ? "Otro…" : current.placeholder}
            aria-label={current.options.length ? "Otra respuesta" : current.title}
            onChange={(e) => setOther(e.target.value)}
          />
        </form>}

        {/* La segunda tarjeta pide los dos datos a la vez: nombre y contacto.
            No hay tercera pregunta: con esto se empieza a construir. */}
        {!current.options.length && <div className="builder-fields">
          <label>
            <span className="muted small">Nombre del negocio</span>
            <input
              value={answers.name ?? ""}
              maxLength={current.max}
              placeholder={current.placeholder}
              onChange={(e) => setAnswers((a) => ({ ...a, name: e.target.value }))}
            />
          </label>
          <label>
            <span className="muted small">Cómo te contactan</span>
            <input
              value={answers.contact ?? ""}
              maxLength={CONTACT_MAX}
              placeholder={CONTACT_PLACEHOLDER}
              onChange={(e) => setAnswers((a) => ({ ...a, contact: e.target.value }))}
            />
          </label>
          <button type="button" className="builder-send" disabled={sendDisabled} onClick={() => void design()}>
            Empezar a diseñar
          </button>
        </div>}

        <div className="builder-ask-actions">
          <span className="muted small">{QUESTIONS.length - index} pregunta{QUESTIONS.length - index === 1 ? "" : "s"} por delante</span>
          <button
            type="button"
            className="builder-skip"
            onClick={() => {
              setOther("");
              // Saltar la ultima pregunta lanza con lo que ya haya: no se
              // descarta lo respondido por saltarse el final.
              if (index < QUESTIONS.length - 1) { setIndex(index + 1); return; }
              void design();
            }}
          >Saltar</button>
        </div>
      </div>}
    </div>}

    <div className="builder-chat-foot">
      {error && <div className="alert" role="alert">{error}</div>}
      <form
        className="builder-composer"
        onSubmit={(e) => { e.preventDefault(); void design(); }}
      >
        <textarea
          rows={1}
          placeholder="Pide un cambio o responde aquí…"
          aria-label="Mensaje para el constructor"
          value={composerText}
          onChange={(e) => {
            setComposerText(e.target.value);
            // Crece con el texto hasta 160px: mas alto tapa el lienzo.
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
          }}
          onKeyDown={(e) => {
            if (!isSendKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) return;
            e.preventDefault();
            if (!sendDisabled) void design();
          }}
        />
        <button
          className="builder-send"
          disabled={sendDisabled}
        >
          {phase === "running" ? "Diseñando…" : "Diseñar"}
        </button>
      </form>
    </div>
  </section>;
}
