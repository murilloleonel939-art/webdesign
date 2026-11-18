import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Puck } from "@measured/puck";
import "@measured/puck/puck.css";
import "./brand.css";
import { buildEditorConfig } from "@webdesign/editor/config";
import { documentToPuck, puckToDocument, mergeEditedPage } from "@webdesign/puck-adapter";
import { StyleStart } from "./StyleStart";
import { DesignWithAi } from "./DesignWithAi";
import { themeCss } from "@webdesign/renderer";

type Site = { id: string; name: string; status: string };
type Draft = { rev: number; doc: unknown };
type EditorAsset = { id: string; kind: string; bytes: number; mime?: string; path?: string; publicUrl?: string };
const api = (path: string, init?: RequestInit) => fetch(path, { credentials: "same-origin", ...init });
const go = (path: string) => { history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); };

// Un documento necesita estilo cuando la pagina de inicio no tiene contenido
// propio: o no hay secciones, o solo hay una con texto de relleno.
function needsStyle(doc: unknown): boolean {
  const pages = (doc as { pages?: Array<{ sections?: Array<{ type?: string; props?: unknown }> }> })?.pages ?? [];
  if (pages.length === 0) return true;
  const home = pages[0];
  const sections = home?.sections ?? [];
  if (sections.length === 0) return true;
  // El borrador inicial trae un unico hero con el titular por defecto.
  // Se compara con ese texto exacto, no con la longitud: un titular corto y
  // real ({"headline":"Panadería Luna"}) es contenido legitimo del dueno.
  const props = JSON.stringify(sections[0]?.props ?? {});
  const isPlaceholder = props === "{}" || /Tu titular aquí|Una línea que explica/.test(props);
  return sections.length === 1 && isPlaceholder;
}

function Brand() { return <div className="brand"><span className="brand-mark">Z</span><span>Zottaweb</span></div>; }

// El agente deja escrito "pendiente de confirmar" donde no tenia el dato: no
// inventa testimonios, precios ni textos. Aqui se recorre el borrador para
// decirle al dueno, en sus palabras, que le falta rellenar. Se mira el texto del
// documento, no una lista que el servidor tenga que mantener aparte.
const PENDING_TEXT = "pendiente de confirmar";
const PENDING_PARTS: Array<{ test: RegExp; label: string }> = [
  { test: /"plans"|"price"/, label: "Precios o tarifas" },
  { test: /"testimonial|"quote"|"author"/, label: "Testimonios de clientes" },
  { test: /"faq"|"questions"/, label: "Preguntas frecuentes" },
  { test: /"body"/, label: "Texto de las secciones" },
  { test: /"headline"/, label: "Titular de la portada" },
  { test: /"name"|"businessName"/, label: "Nombre del negocio" },
  { test: /"address"|"city"/, label: "Dirección o ciudad" },
  { test: /"phone"|"email"|"href"/, label: "Datos de contacto" },
];
function pendingFromDoc(doc: unknown): string[] {
  const pages = (doc as { pages?: Array<{ sections?: unknown[] }> })?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return [];
  const found = new Set<string>();
  for (const page of pages) {
    for (const section of page?.sections ?? []) {
      const json = JSON.stringify(section ?? {});
      if (!json.toLowerCase().includes(PENDING_TEXT)) continue;
      // Se etiqueta por el bloque que lo contiene: util y sin rutas internas.
      const part = PENDING_PARTS.find((p) => p.test.test(json));
      found.add(part ? part.label : "Contenido de una sección");
    }
  }
  return [...found];
}
function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(""); const r = await api("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); setBusy(false); if (!r.ok) { setError("El correo o la contraseña no son correctos."); return; } onDone(); }
  return <main className="auth-shell"><div className="auth-card"><Brand/><p className="eyebrow">TU PRESENCIA DIGITAL</p><h1>Haz que tu idea se vea increíble.</h1><p className="muted">Entra a tu espacio de trabajo y crea sitios que conectan con tus clientes.</p><form onSubmit={submit}><label>Correo electrónico<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="tu@empresa.com"/></label><label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••"/></label>{error && <div className="alert">{error}</div>}<button className="primary full" disabled={busy}>{busy ? "Entrando…" : "Entrar a mi cuenta"}</button></form><p className="fine">¿Aún no tienes cuenta? <span className="link">Solicita acceso</span></p></div><div className="auth-art"><div className="orb orb-one"/><div className="orb orb-two"/><p>Diseña. Publica.<br/><strong>Crece.</strong></p></div></main>;
}
function Dashboard({ sites, refresh }: { sites: Site[]; refresh: () => void }) {
  const [name, setName] = useState(""); const [creating, setCreating] = useState(false); const [error, setError] = useState("");
  // Solo se prueba una vez: si no es operador, el boton no aparece y no se
  // vuelve a preguntar.
  const [isOp, setIsOp] = useState(false); const [showOp, setShowOp] = useState(false);
  useEffect(() => { api("/api/operator/sites").then(r => setIsOp(r.ok)).catch(() => {}); }, []);
  async function remove(id: string) { if (!confirm("¿Eliminar este sitio? Esta acción no se puede deshacer.")) return; const r = await api(`/api/sites/${id}`, { method: "DELETE" }); if (r.ok) refresh(); else setError("No se pudo eliminar el sitio."); }
  async function create(e: React.FormEvent) { e.preventDefault(); if (!name.trim()) return; setCreating(true); const r = await api("/api/sites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }); setCreating(false); if (!r.ok) { setError("No se pudo crear el sitio."); return; } const d = await r.json() as { id: string }; go(`/app?site=${d.id}`); }
  return <div className="app-shell"><header className="topbar"><Brand/><div className="user-pill">{isOp && <button className="ghost op-link" onClick={() => setShowOp(true)}>Operador</button>}<span className="avatar">A</span><span>Mi espacio</span></div></header><main className="dashboard"><div className="hero"><div><p className="eyebrow">PANEL DE CONTROL</p><h1>Tu próxima gran web empieza aquí.</h1><p className="muted">Gestiona tus sitios y convierte tus ideas en experiencias memorables.</p></div><span className="spark">✦</span></div><section className="section-head"><div><h2>Mis sitios</h2><p className="muted">{sites.length ? "Tus proyectos, siempre a mano." : "Crea tu primer proyecto en unos segundos."}</p></div></section><div className="create-card"><div className="create-icon">＋</div><div><h3>Crear un nuevo sitio</h3><p className="muted">Empieza con una página pensada para tu marca.</p></div><form onSubmit={create}><input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del sitio" aria-label="Nombre del sitio"/><button className="primary" disabled={creating}>{creating ? "Creando…" : "Crear sitio"}</button></form></div>{error && <div className="alert">{error}</div>}{showOp && <Operator onClose={() => setShowOp(false)}/>}<div className="site-grid">{sites.map(site => <article className="site-card" key={site.id}><div className="site-preview"><span>ZW</span></div><div className="site-info"><div><h3>{site.name}</h3><p className="muted">{site.status === "active" ? "Publicado" : "Borrador"}</p></div><div className="site-actions"><button className="secondary" onClick={() => go(`/app?site=${site.id}`)}>Editar sitio <span>→</span></button><button className="text-danger" onClick={() => remove(site.id)}>Eliminar</button></div></div></article>)}</div></main></div>;
}

// Los hallazgos del linter son codigos. Un dueno no sabe que es
// MISSING_TITLE, asi que se le dice lo que tiene que cambiar.
function findingLabel(code: string): string {
  const map: Record<string, string> = {
    MISSING_TITLE: "Falta el titulo de la pagina",
    MISSING_META_DESCRIPTION: "Falta la descripcion de la pagina",
    UNSAFE_URL: "Un enlace no es seguro: usa #seccion o una direccion completa",
    EMPTY_PAGE: "La pagina no tiene ninguna seccion",
    TESTIMONIAL_UNVERIFIED: "Un testimonio no esta verificado",
    IMAGE_LICENSE_MISSING: "Una imagen no tiene licencia registrada",
    MISSING_ASSET: "El bloque Imagen apunta a una imagen que ya no existe: elige otra",
    THEME_CONTRAST: "El contraste del tema es bajo",
    FONT_NOT_HOSTED: "La tipografia no esta alojada en el sitio",
    SCHEMA_INVALID: "El contenido no tiene el formato esperado",
    RAW_HTML: "Hay HTML crudo en el contenido",
    MISSING_ALT: "Una imagen no tiene texto alternativo",
    CTA_MISSING: "La pagina no invita a hacer nada",
    BROKEN_INTERNAL_LINK: "Un enlace apunta a una pagina que no existe",
    LONG_TEXT: "Un texto es demasiado largo",
    DUPLICATE_SLUG: "Dos paginas usan la misma ruta",
    PAGE_TOO_HEAVY: "La pagina pesa demasiado",
    TOO_MANY_IMAGES: "Hay demasiadas imagenes en una seccion",
    // Linter visual (6.5). Se nombra el efecto que ve el visitante, nunca la
    // regla: el dueno no tiene por que saber que es un "slop" ni un a11y.
    SLOP_FONT_MONOCULTURE: "Todo el sitio usa la misma tipografia: los titulos deberian verse distintos",
    SLOP_GENERIC_GRADIENT: "Los degradados son de plantilla: usa los colores de tu marca",
    SLOP_NESTED_CARDS: "Hay tarjetas dentro de otras tarjetas: sobra un recuadro",
    SLOP_ICON_TILE_ABOVE_EVERY_HEADING: "Cada titulo lleva el mismo icono encima: no hace falta repetirlo",
    SLOP_LOW_CONTRAST_TEXT_ON_COLOR: "Un texto se lee mal sobre su color de fondo",
    SLOP_HEADING_SKIP: "Los titulos se saltan un nivel: no bajes de h1 a h3",
    SLOP_PADDING_CRAMPED: "Los bloques estan demasiado apretados: falta aire entre ellos",
    SLOP_CENTERED_EVERYTHING: "Todo esta centrado: alineado a la izquierda se lee mejor",
    SLOP_SAME_CARD_RADIUS: "Todas las tarjetas tienen el mismo redondeo: varia unas y otras",
    SLOP_SHADOW_ON_EVERYTHING: "Todo lleva sombra: dejala solo en lo que debe destacar",
    SLOP_NO_VISUAL_HIERARCHY: "Nada destaca sobre lo demas: el titulo deberia ser lo mas grande",
    SLOP_UNRESPONSIVE_GRID: "Una rejilla no se adapta al movil",
    SLOP_FIXED_WIDTH_OVERFLOW: "Algo es mas ancho que la pantalla: se sale por el lado",
    SLOP_TOUCH_TARGET_SMALL: "Algun boton es demasiado pequeno para el dedo",
    SLOP_PLACEHOLDER_TEXT: "Queda texto de relleno en la pagina",
    A11Y_NO_VISIBLE_FOCUS: "Al navegar con el teclado no se ve donde estas",
    MOTION_LAYOUT_ANIMATION: "Una animacion mueve el contenido y descoloca la pagina",
    MOTION_NO_REDUCED_MOTION: "Las animaciones no se apagan si el visitante lo pide",
    MOTION_DURATION_OUT_OF_RANGE: "Una animacion es tan lenta o tan rapida que molesta",
    A11Y_CONTROL_NO_ACCESSIBLE_NAME: "Un boton no dice que hace si no se ve la pantalla",
    A11Y_FIELD_UNLABELED: "Un campo del formulario no tiene etiqueta",
    A11Y_LINK_VAGUE_TEXT: "Un enlace dice solo «aqui»: mejor el nombre del destino",
    A11Y_LIST_NOT_SEMANTIC: "Una lista esta hecha a mano: el lector de pantalla no la anuncia",
    SLOP_Z_INDEX_ARBITRARY: "Hay capas colocadas a ojo: algo puede quedar tapado",
    SLOP_MULTIPLE_ACCENTS: "Hay varios colores de acento: deja uno solo",
  };
  // Ningun codigo nuevo llega crudo al dueno: lo que no este en el mapa se dice
  // como lo que es, algo a revisar, sin gritarle un SLOP_ALGO en ingles.
  return map[code] ?? "Hay algo que revisar en esta pagina: revisa los bloques antes de publicar";
}

// Puck monta el lienzo en un iframe, asi que hereda el CSS del panel pero no el
// del tema: el editor ensenaba el sitio sin diseno. Este componente mete la
// hoja del tema dentro del documento del iframe.
function FrameTheme({ frame, css, children }: { frame?: Document | undefined; css: string; children: any }) {
  useEffect(() => {
    if (!frame?.head || !css) return;
    const id = "sitio-theme";
    let el = frame.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = frame.createElement("style");
      el.id = id;
      frame.head.appendChild(el);
    }
    el.textContent = css;
  }, [frame, css]);
  return children;
}

// Panel de operador (Fase 2): clientes y estado de los sitios. Solo aparece si
// la cuenta tiene el rol; el servidor lo comprueba igualmente.
interface OpSite { id: string; name: string; ownerEmail: string; status: string; hostname: string|null; updatedAt: string; pages: number; }
interface OpSummary { accounts: number; sites: number; published: number; }

function Operator({ onClose }: { onClose: () => void }) {
  const [sites, setSites] = useState<OpSite[]|null>(null); const [totals, setTotals] = useState<OpSummary|null>(null); const [error, setError] = useState("");
  useEffect(() => { api("/api/operator/sites").then(async r => { if (!r.ok) { setError("No se pudo cargar."); return; } const d = await r.json() as { sites: OpSite[]; summary: OpSummary }; setSites(d.sites); setTotals(d.summary); }).catch(() => setError("No se pudo cargar.")); }, []);
  const estado = (s: string) => s === "active" ? "Publicado" : s === "dark" ? "Apagado" : s === "suspended" ? "Suspendido" : "Borrador";
  return <div className="modal-veil" onClick={onClose}>
    <div className="modal-card op-card" onClick={e => e.stopPropagation()} role="dialog" aria-label="Panel de operador">
      <div className="modal-head"><div><h2>Operador</h2><p className="muted">Clientes y estado de los sitios.</p></div><button className="ghost" onClick={onClose} aria-label="Cerrar">×</button></div>
      {error && <div className="alert">{error}</div>}
      {totals && <div className="op-totals"><div><strong>{totals.accounts}</strong><span className="muted small">cuentas</span></div><div><strong>{totals.sites}</strong><span className="muted small">sitios</span></div><div><strong>{totals.published}</strong><span className="muted small">publicados</span></div></div>}
      {sites === null && !error && <p className="muted">Cargando…</p>}
      {sites?.length === 0 && <p className="muted">Todavía no hay sitios.</p>}
      {sites && sites.length > 0 && <div className="op-scroll"><table className="op-table"><thead><tr><th>Sitio</th><th>Cliente</th><th>Estado</th><th>Dominio</th></tr></thead><tbody>
        {sites.map(s => <tr key={s.id}><td>{s.name}</td><td className="muted small">{s.ownerEmail}</td><td><span className={`badge ${s.status}`}>{estado(s.status)}</span></td><td className="muted small">{s.hostname ?? "—"}</td></tr>)}
      </tbody></table></div>}
    </div>
  </div>;
}

// Bandeja de mensajes (Fase 2). El formulario del sitio guardaba los mensajes
// en `leads` y no habia forma de leerlos: llegaban y se quedaban ahi.
interface Lead { id: string; name: string|null; email: string|null; phone: string|null; message: string|null; status: string; createdAt: string; }

function Inbox({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const [leads, setLeads] = useState<Lead[]|null>(null); const [error, setError] = useState("");
  async function load() { try { const r = await api(`/api/sites/${siteId}/leads`); if (!r.ok) throw new Error(); const d = await r.json() as { leads: Lead[] }; setLeads(d.leads); } catch { setError("No se pudieron cargar los mensajes."); } }
  useEffect(() => { void load(); }, [siteId]);
  async function mark(id: string, status: string) { const r = await api(`/api/sites/${siteId}/leads/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); if (r.ok) await load(); else setError("No se pudo actualizar el mensaje."); }
  const stamp = (iso: string) => new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
  return <div className="modal-veil" onClick={onClose}>
    <div className="modal-card inbox-card" onClick={e => e.stopPropagation()} role="dialog" aria-label="Mensajes recibidos">
      <div className="modal-head"><div><h2>Mensajes</h2><p className="muted">Lo que te escriben desde el formulario de tu web.</p></div><button className="ghost" onClick={onClose} aria-label="Cerrar">×</button></div>
      {error && <div className="alert">{error}</div>}
      {leads === null && <p className="muted">Cargando…</p>}
      {leads?.length === 0 && <div className="empty-inbox"><p className="muted">Todavía no has recibido mensajes.</p><p className="muted small">Cuando alguien rellene el formulario de tu sitio aparecerá aquí.</p></div>}
      <ul className="lead-list">{leads?.map(l => <li key={l.id} className={l.status === "new" ? "lead new" : "lead"}>
        <div className="lead-head"><strong>{l.name || "Sin nombre"}</strong><time className="muted small">{stamp(l.createdAt)}</time></div>
        {l.email && <a className="lead-contact" href={`mailto:${l.email}`}>{l.email}</a>}
        {l.phone && <a className="lead-contact" href={`tel:${l.phone}`}>{l.phone}</a>}
        {l.message && <p className="lead-msg">{l.message}</p>}
        <div className="lead-actions">
          {l.status !== "read" && l.status !== "replied" && <button className="ghost" onClick={() => mark(l.id, "read")}>Marcar leído</button>}
          {l.status !== "replied" && <button className="ghost" onClick={() => mark(l.id, "replied")}>Respondido</button>}
          {l.status !== "archived" && <button className="ghost" onClick={() => mark(l.id, "archived")}>Archivar</button>}
        </div>
      </li>)}</ul>
    </div>
  </div>;
}

function Editor({ siteId }: { siteId: string }) {
  const PAGE = new URLSearchParams(location.search).get("page") ?? "p_home"; const [doc, setDoc] = useState<any>(null); const [rev, setRev] = useState(0); const [status, setStatus] = useState("Cargando tu editor…"); const [assets, setAssets] = useState<EditorAsset[]>([]); const [uploading, setUploading] = useState(false); const lastData = useRef<any>(null); const [blockers, setBlockers] = useState<string[]>([]);
  // Avisos de estilo (6.5): informan, no bloquean. El dueno decide publicar.
  const [visualNotice, setVisualNotice] = useState<string[]>([]); const [publishedUrl, setPublishedUrl] = useState<string|null>(null);
  // Otro sitio de la misma cuenta ya esta publicado (spec 1.15: solo uno). Se
  // guarda id y nombre para ofrecer despublicarlo desde el mismo aviso, sin
  // `confirm()` del navegador.
  const [activeElsewhere, setActiveElsewhere] = useState<{ id: string; name: string }|null>(null);
  // Diseñar con IA (9.1): el agente escribe en el borrador, nunca publica. El
  // estado `showDesign` abre el formulario; `designPending` recuerda lo que el
  // agente dejo sin confirmar para pedirlo despues de recargar.
  const [showDesign, setShowDesign] = useState(false); const [designPending, setDesignPending] = useState<string[]>([]);
  async function refreshAssets() { try { const r = await api(`/api/sites/${siteId}/assets`); if (!r.ok) return; const body = await r.json() as { assets?: EditorAsset[] }; setAssets(Array.isArray(body.assets) ? body.assets : []); } catch { setAssets([]); } }
  async function removeAsset(id: string) { if (!confirm("¿Eliminar esta imagen?")) return; const r = await api(`/api/sites/${siteId}/assets?id=${encodeURIComponent(id)}`, { method: "DELETE" }); if (r.ok) { await refreshAssets(); setStatus("Imagen eliminada"); } }
  async function upload(file: File) { setUploading(true); const r = await api(`/api/sites/${siteId}/assets?kind=image`, { method: "POST", headers: { "content-type": file.type }, body: file }); setUploading(false); if (r.ok) { await refreshAssets(); setStatus("Imagen subida. Copia su ID en el bloque Imagen."); } else {
    // Decir "no se pudo" ante una cuota llena deja al dueno subiendo la misma
    // imagen una y otra vez sin entender por que.
    const d = await r.json().catch(() => ({})) as { error?: string };
    setStatus(d.error === "site_asset_count_exceeded" ? "Has llegado al límite de imágenes de este sitio. Borra alguna para subir otra."
      : d.error === "site_quota_exceeded" ? "Tu sitio ha alcanzado el espacio total disponible. Borra archivos para liberar espacio."
      : d.error === "too_large" ? "La imagen pesa demasiado. El máximo es 5 MB."
      : "No se pudo subir la imagen. Comprueba que es JPG, PNG o WebP.");
  } }
  useEffect(() => { void refreshAssets(); }, [siteId]);
  const saving = useRef(false); const pending = useRef<any>(null); const docRef = useRef<any>(null); const revRef = useRef(0); const [showPreview, setShowPreview] = useState(false); const [showAssets, setShowAssets] = useState(true); const [showStyles, setShowStyles] = useState(false); const [showInbox, setShowInbox] = useState(false); const [newLeads, setNewLeads] = useState(0);
  // Contador de mensajes sin leer: se refresca al entrar y al volver de la bandeja.
  // Va despues de las declaraciones: el array de dependencias se evalua al
  // renderizar, asi que leerlo antes de existir deja el editor en blanco.
  useEffect(() => { api(`/api/sites/${siteId}/leads`).then(async r => { if (!r.ok) return; const d = await r.json() as { newCount?: number }; setNewLeads(Number(d.newCount ?? 0)); }).catch(() => {}); }, [siteId, showInbox]);
  useEffect(() => { api(`/api/sites/${siteId}/draft`).then(async r => { if (r.status === 401) return go("/app"); if (!r.ok) throw new Error("No se pudo cargar"); const d = await r.json() as Draft; docRef.current = d.doc; revRef.current = d.rev; setDoc(d.doc); setRev(d.rev); setStatus("Listo para crear"); }).catch(() => setStatus("No se pudo cargar el editor")); }, [siteId]);
  if (!doc) return <div className="loading"><Brand/><p>{status}</p></div>;
  // Pantalla de inicio: solo si el sitio no tiene contenido propio todavia.
  // `start=0` la desactiva cuando el dueno elige empezar en blanco.
  async function reloadDraft() {
    const r = await api(`/api/sites/${siteId}/draft`);
    if (!r.ok) return;
    const d = await r.json() as Draft;
    docRef.current = d.doc; revRef.current = d.rev; setDoc(d.doc); setRev(d.rev);
  }
  if (needsStyle(doc) && new URLSearchParams(location.search).get("start") !== "0") {
    return <StyleStart
      siteId={siteId}
      expectedRev={rev}
      onApplied={() => { void reloadDraft(); }}
      onSkip={() => go(`/app?site=${siteId}&start=0`)}
    />;
  } const save = async (data: any) => { lastData.current = data; pending.current = data; if (saving.current) return; saving.current = true; while (pending.current) { const current = pending.current; pending.current = null; const next = mergeEditedPage(docRef.current ?? doc, puckToDocument({ content: current.content, root: current.root }, PAGE)); setStatus("Guardando…"); const r = await api(`/api/sites/${siteId}/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc: next, expectedRev: revRef.current }) }); if (r.status === 409) { setStatus("Otro cambio fue guardado. Recargando…"); const d = await (await api(`/api/sites/${siteId}/draft`)).json() as Draft; docRef.current = d.doc; revRef.current = d.rev; setDoc(d.doc); setRev(d.rev); continue; } if (!r.ok) { setStatus("No se pudo guardar"); continue; } const d = await r.json() as { rev: number }; docRef.current = next; revRef.current = d.rev; setDoc(next); setRev(d.rev); setStatus("Guardado"); } saving.current = false; };
  // Publicar devuelve el hostname asignado. Sin el, el dueno no sabe donde
  // esta su sitio: se le muestra en un aviso y queda en el estado.
  // Un unico boton: guarda y publica. Antes habia dos ("Publish" dentro del
  // editor y "Publicar sitio" arriba) y cada uno hacia algo distinto.
  //
  // Cuando la publicacion se bloquea se dice QUE falta. El aviso generico
  // "revisa el contenido" no daba al dueno forma de saber que corregir.
  async function publish(confirmVisual = false) {
    setStatus(confirmVisual ? "Publicando igual…" : "Publicando…");
    if (pending.current) await save(pending.current);
    const r = await api(`/api/sites/${siteId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(confirmVisual ? { confirmVisual: true } : {}),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({})) as {
        error?: string;
        findings?: { code: string; severity?: string }[];
        activeSiteId?: string;
        activeSiteName?: string;
      };
      // Spec 1.15: solo un sitio publicado por cuenta. Ya hay otro `active`, y
      // la base lo impide con un indice parcial. Antes esto reventaba el
      // proceso y el panel recibia un 502 sin explicacion; ahora se nombra el
      // sitio que ocupa el turno y se ofrece despublicarlo y reintentar.
      if (d.error === "another_site_active") {
        const name = (d.activeSiteName ?? "").trim() || "tu otro sitio";
        setActiveElsewhere({ id: String(d.activeSiteId ?? ""), name });
        setStatus("Ya tienes un sitio publicado");
        return;
      }
      // Spec 6.5: un aviso visual no impide publicar; solo se ensena y se pide
      // confirmacion. Un bloqueo de contenido (6.4) si obliga a corregir.
      if (d.error === "visual_confirm") {
        const visual = (d.findings ?? []).filter((f) => f.severity === "error").map((f) => f.code);
        setVisualNotice([...new Set(visual)].length ? [...new Set(visual)].map(findingLabel) : ["Hay avisos de estilo"]);
        setStatus("Puedes publicar igual");
        return;
      }
      // Solo los `error` bloquean la publicacion. Antes se listaban tambien
      // avisos e informativos (MISSING_ALT, CTA_MISSING), asi que el dueno veia
      // una lista de fallos que en realidad no le impedian publicar.
      const codes = [...new Set((d.findings ?? []).filter((f) => f.severity === "error").map((f) => f.code))];
      setBlockers(codes.length ? codes.map(findingLabel) : ["No se pudo publicar"]);
      setStatus("Falta algo para publicar");
      return;
    }
    setVisualNotice([]);
    const d = await r.json() as { version: number; hostname?: string };
    if (d.hostname) { setPublishedUrl(`https://${d.hostname}`); setStatus("Publicado correctamente"); }
    else setStatus("Publicado, pero sin direccion: no queda sitio en el pool de dominios");
  }
  // Despublica el sitio que ocupaba el turno y reintenta publicar este. Dos
  // pasos en un boton: el dueno ya ha dicho que quiere publicar este sitio.
  async function unpublishAndRetry(id: string) {
    setStatus("Despublicando el otro sitio…");
    const r = await api(`/api/sites/${id}/unpublish`, { method: "POST" });
    if (!r.ok) { setStatus("No se pudo despublicar el otro sitio"); return; }
    setActiveElsewhere(null);
    await publish();
  }
  if (showStyles) {
    return <StyleStart
      siteId={siteId}
      expectedRev={rev}
      // Aqui se llega desde el editor con un sitio ya escrito: cambiar de
      // estilo debe preguntar si conserva el contenido o empieza de cero.
      hasContent
      onApplied={() => { setShowStyles(false); void reloadDraft(); }}
      onSkip={() => setShowStyles(false)}
    />;
  }
  return <div className="editor-shell">
    {/* Capa, no pantalla: cerrarla no debe desmontar el editor ni perder lo
        que el dueno tenia sin guardar. */}
    {showInbox && <Inbox siteId={siteId} onClose={() => setShowInbox(false)}/>}
    {showDesign && <DesignWithAi
      siteId={siteId}
      onClose={() => setShowDesign(false)}
      onApplied={() => { void reloadDraft().then(() => setDesignPending(pendingFromDoc(docRef.current))); }}
    />}
    <header className="editorbar">
      <button className="back" onClick={() => go("/app")} aria-label="Volver al panel">←</button>
      <Brand/>
      <span className="divider"/>
      <span className="editor-status">{status}</span>
      {publishedUrl && <a className="published-url" href={publishedUrl} target="_blank" rel="noreferrer">Tu sitio: {publishedUrl.replace("https://", "")}</a>}
      {/* Un unico contenedor en columna: antes "blockers" y "notice" compartian
          la misma esquina absoluta y se pintaban encima uno de otro, tapando
          ademas la biblioteca de imagenes. Orden de lectura: primero lo que
          bloquea, luego lo que exige decision, al final el aviso de estilo
          (spec 6.5: este ultimo nunca bloquea la publicacion). */}
      {(blockers.length > 0 || activeElsewhere || visualNotice.length > 0 || designPending.length > 0) && <div className="publish-alerts">
        {designPending.length > 0 && <div className="design-pending" role="status">
          <strong>El diseño con IA dejó datos por confirmar:</strong>
          <ul>{designPending.map((p) => <li key={p}>{p}</li>)}</ul>
          <p className="muted small">Rellénalos editando las secciones que dicen «pendiente de confirmar».</p>
          <button className="ghost" onClick={() => setDesignPending([])} aria-label="Descartar aviso">×</button>
        </div>}
        {blockers.length > 0 && <div className="publish-blockers" role="alert">
          <strong>Para publicar falta:</strong>
          <ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <button className="ghost" onClick={() => setBlockers([])} aria-label="Cerrar">×</button>
        </div>}
        {activeElsewhere && <div className="publish-notice" role="status">
          <strong>Ya tienes un sitio publicado:</strong>
          <ul><li>«{activeElsewhere.name}» está publicado ahora mismo. Tu cuenta solo puede tener uno publicado a la vez.</li></ul>
          {activeElsewhere.id
            ? <button className="primary" onClick={() => void unpublishAndRetry(activeElsewhere.id)}>Despublicar «{activeElsewhere.name}» y publicar este</button>
            : <span className="muted small">Abre el otro sitio y despublícalo desde ahí.</span>}
          <button className="ghost" onClick={() => setActiveElsewhere(null)} aria-label="Descartar aviso">×</button>
        </div>}
        {visualNotice.length > 0 && <div className="publish-notice" role="status">
          <strong>Aviso de estilo (no impide publicar):</strong>
          <ul>{visualNotice.map((n) => <li key={n}>{n}</li>)}</ul>
          <button className="primary" onClick={() => void publish(true)}>Publicar igual</button>
          <button className="ghost" onClick={() => setVisualNotice([])} aria-label="Descartar aviso">×</button>
        </div>}
      </div>}
      <div className="editor-actions">
        <button className="asset-trigger" aria-expanded={showAssets} onClick={() => setShowAssets(v => !v)}>
          Imágenes {assets.length > 0 && <span className="asset-count">{assets.length}</span>}
        </button>
        <button className="ghost" onClick={() => setShowStyles(true)}>Estilos</button>
        <button className="ghost design-trigger" onClick={() => setShowDesign(true)}>Diseñar con IA</button>
        <button className="ghost" onClick={() => setShowInbox(true)}>Mensajes {newLeads > 0 && <span className="asset-count">{newLeads}</span>}</button>
        <button className="ghost" onClick={() => setShowPreview(true)}>Vista previa</button>
        <button className="primary publish" onClick={() => void publish()}>Publicar sitio</button>
      </div>
    </header>
    <div className="editor-body">
      <Puck
        // `publicUrl` es opcional en la respuesta: con exactOptionalPropertyTypes
        // no se puede pasar `path: undefined`, y un asset sin URL en el selector
        // solo daria una imagen rota. Se filtra.
        config={buildEditorConfig({ assets: assets.filter(a => a.publicUrl).map(a => ({ id: a.id, path: a.publicUrl as string })) })}
        data={documentToPuck(doc, PAGE)}
        onChange={save}
        overrides={{
          // El lienzo es un iframe: el CSS del panel no llega dentro, asi que
          // el editor mostraba las secciones desnudas. Se inyecta el tema del
          // documento para ver el sitio como quedara publicado.
          iframe: ({ children, document: frame }) => (
            <FrameTheme frame={frame} css={doc ? themeCss(doc.theme) : ""}>{children}</FrameTheme>
          ),
          // Sin acciones propias en la cabecera de Puck. Devolver `null` no es un
          // elemento valido para su tipo de render, aunque en pantalla no se note.
          "headerActions": () => <></>,
        }}
      />
      {showAssets && <aside className="asset-popover" aria-label="Biblioteca de imágenes">
        <header>
          <div><h3>Biblioteca de imágenes</h3><p>Arrastra una miniatura al campo Imagen.</p></div>
          <button className="close" onClick={() => setShowAssets(false)} aria-label="Cerrar biblioteca">✕</button>
        </header>
        <label className="upload-button">{uploading ? "Subiendo…" : "Subir imagen"}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = ""; }}/></label>
        <div className="asset-list">
          {assets.length ? assets.map(a => <button className="asset-item" key={a.id} draggable onDragStart={e => e.dataTransfer.setData("text/asset-id", a.id)} title="Arrastra al campo Imagen o haz clic para copiar el ID" onClick={() => { void navigator.clipboard?.writeText(a.id); setStatus("ID copiado al portapapeles"); }}>
            {a.publicUrl ? <img className="asset-thumb" src={a.publicUrl} alt="" onError={e => { e.currentTarget.style.visibility = "hidden"; }}/> : <span className="asset-thumb asset-thumb--empty">—</span>}
            <span className="asset-meta"><span>{a.id.slice(0, 8)}</span><small>{a.bytes ? `${Math.round(a.bytes / 1024)} KB` : "imagen"}</small></span>
            <b className="asset-remove" role="button" tabIndex={0} aria-label="Eliminar imagen" onClick={e => { e.stopPropagation(); void removeAsset(a.id); }}>✕</b>
          </button>) : <p className="asset-empty">Aún no has subido imágenes.</p>}
        </div>
      </aside>}
      {showPreview && <div role="dialog" aria-modal="true" aria-label="Vista previa del sitio" className="preview-overlay" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#0b1020", display: "flex", flexDirection: "column" }}>
        <header style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 20px", background: "#0b1020", borderBottom: "1px solid #1d2740" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Vista previa</span>
            <span style={{ fontSize: 12, color: "#8b97b3" }}>Así verán tu sitio los visitantes</span>
          </div>
          <button onClick={() => setShowPreview(false)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10, border: "1px solid #2b3757", background: "#131c33", color: "#fff", fontWeight: 650, fontSize: 13 }}>✕ Cerrar</button>
        </header>
        <iframe title="Vista previa" sandbox="allow-scripts" src={`/api/sites/${siteId}/preview?page=${PAGE}`} style={{ flex: 1, width: "100%", border: 0, background: "#fff" }}/>
      </div>}
    </div>
  </div>;
}
function App() {
  const [route, setRoute] = useState(location.href); const [sites, setSites] = useState<Site[]>([]);
  const [state, setState] = useState("loading");
  useEffect(() => { const f = () => setRoute(location.href); addEventListener("popstate", f); return () => removeEventListener("popstate", f); }, []);
  async function refresh() { setState("loading"); try { const r = await api("/api/sites"); if (r.status === 401) { setState("login"); return; } if (!r.ok) throw new Error(); setSites((await r.json() as { sites: Site[] }).sites); setState("ready"); } catch { setState("error"); } }
  useEffect(() => { void refresh(); }, [route]);
  if (state === "loading") return <div className="loading"><Brand/><p>Cargando tu espacio…</p></div>;
  if (state === "login") return <Login onDone={() => { void refresh(); }}/>;
  if (state === "error") return <div className="loading"><Brand/><p>No pudimos conectar con tu espacio.</p><button className="primary" onClick={refresh}>Reintentar</button></div>;
  const siteId = new URL(route).searchParams.get("site");
  return siteId ? <Editor key={siteId} siteId={siteId}/> : <Dashboard sites={sites} refresh={refresh}/>;
}
createRoot(document.getElementById("root")!).render(<App/>);
