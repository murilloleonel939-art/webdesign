import { useEffect, useRef, useState } from "react";
import { QUESTIONS, buildPayload, isSendKey, undoMessage, resumeFrom, pollDecision, pollDelay, shouldAutoStart } from "./design-chat-flow";
import type { BriefKey, LatestRun, Question } from "./design-chat-flow";

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

/** Pasos que se leen mientras el agente escribe. No son un log tecnico. */
const STEPS = ["Leyendo tu idea", "Eligiendo la estructura", "Escribiendo las secciones", "Revisando el estilo"] as const;

/** A partir de aqui se avisa que se puede cerrar la ventana sin perder el diseño. */
const LONG_WAIT_MS = 45000;

type Phase = "asking" | "running" | "stalled" | "done";

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
  /** Boton secundario "¿Tienes logo?" tras un diseño ok con initialPrompt. Por
   * ahora abre la biblioteca de imagenes; no hay extraccion de paleta aun. */
  onAskLogo?: () => void;
}

/** El estado de la burbuja de deshacer, ya traducido a texto. Sin codigos crudos. */
type UndoState = { kind: "ok" | "confirm" | "gone" | "retry"; text: string };

export function DesignChat({ siteId, initialPrompt, collapsed = false, onDraftChanged, onRunningChange, pending, onShowResult, onAskLogo }: DesignChatProps) {
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
  // Se esta mirando si habia una ejecucion previa (punto D): mientras tanto,
  // no se pregunta nada, para no interrogar de nuevo a quien ya respondio.
  const [resuming, setResuming] = useState(true);
  // El dueno ya conto su idea al crear el sitio: no se le pregunta nada, se
  // diseña ya. Este ref evita relanzar el diseño en un segundo render del
  // mismo montaje (p.ej. StrictMode o un cambio de otra prop).
  const autoStarted = useRef(false);

  // El sondeo se para al cerrar o al desmontar: sin esto, salir del editor
  // dejaria una peticion cada 1,5 s hasta el final de la ejecucion.
  const stopped = useRef(false);
  useEffect(() => () => { stopped.current = true; }, []);

  // Al montar, se mira si ya hubo una ejecucion para este sitio (punto D): un
  // dueno que cerro el navegador y vuelve no debe ver las preguntas de cero.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let latest: LatestRun | null = null;
      try {
        const r = await api(`/api/sites/${siteId}/design-runs/latest`);
        if (r.ok) latest = await r.json() as LatestRun;
      } catch {
        latest = null;
      }
      if (cancelled) return;
      const resumed = resumeFrom(latest, Date.now());
      if (resumed.phase === "running") {
        setRunId(resumed.runId);
        setPhase("running");
        setStartedAt(resumed.startedAt);
        void waitFor(resumed.runId, resumed.startedAt);
      } else if (resumed.phase === "done") {
        setRunId(resumed.runId);
        setRunOk(resumed.ok);
        setPhase("done");
        setElapsed(resumed.elapsed);
        setMessage(phaseText({ status: resumed.status, stopReason: resumed.stopReason }));
        onDraftChanged();
      }
      // Regla del producto: si el dueno ya conto su idea (initialPrompt) y
      // nunca se ha diseñado antes (sin ejecucion previa), se diseña ya, sin
      // tarjetas de preguntas. `autoStarted` asegura una sola vez por montaje.
      if (!cancelled && shouldAutoStart(initialPrompt ?? "", latest !== null) && !autoStarted.current) {
        autoStarted.current = true;
        void design();
      }
      setResuming(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

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
  useEffect(() => { onRunningChange?.(phase === "running" || phase === "stalled"); }, [phase, onRunningChange]);

  /**
   * Sondea el run hasta que el servidor diga algo distinto de 'running'
   * (fallo A). Nunca se inventa un 'done': si pasan 10 min sigue 'running' de
   * verdad, se pasa a 'stalled' y se sigue comprobando en segundo plano.
   */
  async function waitFor(runId: string, startedAtMs: number): Promise<void> {
    while (true) {
      const elapsedMs = Date.now() - startedAtMs;
      await new Promise((r) => setTimeout(r, pollDelay(elapsedMs)));
      if (stopped.current) return;
      const polled = await pollOnce(runId, startedAtMs);
      if (polled === "stop") return;
    }
  }

  /** Una sola comprobacion del run: usada por el sondeo y por "Comprobar ahora". */
  async function pollOnce(runId: string, startedAtMs: number): Promise<"stop" | "continue"> {
    let status: string | undefined;
    let run: RunStatus = {};
    try {
      const r = await api(`/api/sites/${siteId}/design-runs/${runId}`);
      // Una ejecucion que ya no se ve (sesion cerrada, sitio borrado) no se
      // reintenta: se deja de preguntar y se dice lo unico cierto.
      if (!r.ok) {
        setPhase("done");
        setRunOk(false);
        setMessage("El diseño no pudo completarse. Tu borrador sigue como estaba.");
        return "stop";
      }
      run = await r.json() as RunStatus;
      status = run.status;
    } catch {
      // Un corte de red no cancela el trabajo del agente: se sigue mirando.
      status = undefined;
    }
    const elapsedMs = Date.now() - startedAtMs;
    const decision = pollDecision(status, elapsedMs);
    if (decision === "done") {
      setPhase("done");
      setRunOk(run.status === "ok");
      setMessage(phaseText(run));
      setElapsed(Math.round(elapsedMs / 1000));
      // Ya hay documento nuevo en el servidor: se recarga para que el dueño
      // lo vea sin salir del editor.
      onDraftChanged();
      return "stop";
    }
    if (decision === "stalled") {
      setPhase("stalled");
      return "stop";
    }
    setPhase("running");
    setMessage("Escribiendo el diseño…");
    return "continue";
  }

  /** Boton "Comprobar ahora" en 'stalled': una sola comprobacion manual. */
  async function checkNow(): Promise<void> {
    if (!runId || startedAt === null) return;
    const result = await pollOnce(runId, startedAt);
    if (result === "continue") void waitFor(runId, startedAt);
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
    const startedAtMs = Date.now();
    setStartedAt(startedAtMs);
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
    await waitFor(body.runId, startedAtMs);
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

  /**
   * Vuelve a las preguntas por eleccion del dueño (boton "Diseñar de nuevo").
   * Esto es distinto de preguntar solo al reabrir: aqui lo pide el, no la UI.
   */
  function resetToAsking(): void {
    setAnswers({});
    setIndex(0);
    setRunId(null);
    setUndoState(null);
    setRunOk(false);
    setError("");
    setPhase("asking");
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
    : phase === "stalled"
    ? "Esto está tardando más de lo que debería. Lo sigo mirando en segundo plano."
    : phase === "done" ? message : null;

  // Lo mismo que mira el boton: una sola condicion para el boton y el teclado.
  const sendDisabled = phase === "running" || phase === "stalled" || (!filled && !composerText.trim() && !(initialPrompt ?? "").trim());

  return <section className={collapsed ? "builder-chat builder-fade is-collapsed" : "builder-chat builder-fade"} aria-label="Chat del constructor">
    <header className="builder-chat-head">
      <div>
        <h1>Construir conversando</h1>
        <p className="builder-chat-sub">Cuéntamelo con tus palabras. Con eso empiezo.</p>
      </div>
    </header>

    <div className="builder-chat-log" role="log" aria-live="polite" aria-relevant="additions text">
      {(initialPrompt ?? "").trim() && <div className="builder-msg builder-msg--user"><p>{initialPrompt}</p></div>}
      <div className="builder-msg builder-msg--assistant">
        <p>{(initialPrompt ?? "").trim()
          ? "Entendido. Diseño tu web con lo que me contaste. Cuando la veas, dime qué quieres cambiar."
          : "Cuéntame tu proyecto y lo voy montando. Te hago unas preguntas cortas primero."}</p>
      </div>
      {resuming && <div className="builder-msg builder-msg--assistant">
        <p>Recuperando la conversación…</p>
      </div>}
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
        {elapsed * 1000 >= LONG_WAIT_MS && <p className="muted small">Sigue trabajando; puedes cerrar esta ventana, al volver lo verás aquí.</p>}
      </div>}

      {phase === "stalled" && <div className="builder-msg builder-msg--assistant">
        <div className="builder-run-actions">
          <button type="button" className="builder-opt" onClick={() => void checkNow()}>Comprobar ahora</button>
        </div>
      </div>}

      {phase === "done" && <div className="builder-done" role="status">
        <span>{runOk ? `Completado en ${elapsed}s` : "No se pudo terminar"}</span>
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
          <button type="button" className="builder-opt" onClick={resetToAsking}>Diseñar de nuevo</button>
          {(initialPrompt ?? "").trim() && onAskLogo && <button type="button" className="builder-opt" onClick={onAskLogo}>¿Tienes logo?</button>}
        </div>}
        {!runOk && <div className="builder-run-actions">
          <button
            type="button"
            className="builder-opt"
            onClick={() => { if (filled || (initialPrompt ?? "").trim() || composerText.trim()) void design(); else resetToAsking(); }}
          >Reintentar</button>
          <button type="button" className="builder-opt" onClick={resetToAsking}>Diseñar de nuevo</button>
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

    {!resuming && phase === "asking" && current && <div className="builder-ask" role="group" aria-labelledby="builder-ask-title">
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
        ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg></button>
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
        {!current.options.length && <form
          className="builder-fields"
          onSubmit={(e) => { e.preventDefault(); if (!sendDisabled) void design(); }}
        >
          <label>
            <span>Nombre del negocio</span>
            <input
              type="text"
              autoFocus
              autoComplete="organization"
              value={answers.name ?? ""}
              maxLength={current.max}
              placeholder={current.placeholder}
              onChange={(e) => setAnswers((a) => ({ ...a, name: e.target.value }))}
            />
          </label>
          <label>
            <span>Cómo te contactan</span>
            <input
              autoComplete="email"
              value={answers.contact ?? ""}
              maxLength={CONTACT_MAX}
              placeholder={CONTACT_PLACEHOLDER}
              onChange={(e) => setAnswers((a) => ({ ...a, contact: e.target.value }))}
            />
          </label>
          <button type="submit" className="builder-send" disabled={sendDisabled}>
            Empezar a diseñar
          </button>
        </form>}

        <div className="builder-ask-actions">
          <span className="muted small">{index === QUESTIONS.length - 1 ? "Último paso" : `Paso ${index + 1} de ${QUESTIONS.length}`}</span>
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
          {phase === "running" || phase === "stalled" ? "Diseñando…" : "Diseñar"}
        </button>
      </form>
    </div>
  </section>;
}
