import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Puck } from "@measured/puck";
import "@measured/puck/puck.css";
import "./brand.css";
import { buildEditorConfig } from "@webdesign/editor/config";
import { documentToPuck, puckToDocument, mergeEditedPage } from "@webdesign/puck-adapter";
import { StyleStart } from "./StyleStart";

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
function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(""); const r = await api("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); setBusy(false); if (!r.ok) { setError("El correo o la contraseña no son correctos."); return; } onDone(); }
  return <main className="auth-shell"><div className="auth-card"><Brand/><p className="eyebrow">TU PRESENCIA DIGITAL</p><h1>Haz que tu idea se vea increíble.</h1><p className="muted">Entra a tu espacio de trabajo y crea sitios que conectan con tus clientes.</p><form onSubmit={submit}><label>Correo electrónico<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="tu@empresa.com"/></label><label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••"/></label>{error && <div className="alert">{error}</div>}<button className="primary full" disabled={busy}>{busy ? "Entrando…" : "Entrar a mi cuenta"}</button></form><p className="fine">¿Aún no tienes cuenta? <span className="link">Solicita acceso</span></p></div><div className="auth-art"><div className="orb orb-one"/><div className="orb orb-two"/><p>Diseña. Publica.<br/><strong>Crece.</strong></p></div></main>;
}
function Dashboard({ sites, refresh }: { sites: Site[]; refresh: () => void }) {
  const [name, setName] = useState(""); const [creating, setCreating] = useState(false); const [error, setError] = useState("");
  async function remove(id: string) { if (!confirm("¿Eliminar este sitio? Esta acción no se puede deshacer.")) return; const r = await api(`/api/sites/${id}`, { method: "DELETE" }); if (r.ok) refresh(); else setError("No se pudo eliminar el sitio."); }
  async function create(e: React.FormEvent) { e.preventDefault(); if (!name.trim()) return; setCreating(true); const r = await api("/api/sites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }); setCreating(false); if (!r.ok) { setError("No se pudo crear el sitio."); return; } const d = await r.json() as { id: string }; go(`/app?site=${d.id}`); }
  return <div className="app-shell"><header className="topbar"><Brand/><div className="user-pill"><span className="avatar">A</span><span>Mi espacio</span></div></header><main className="dashboard"><div className="hero"><div><p className="eyebrow">PANEL DE CONTROL</p><h1>Tu próxima gran web empieza aquí.</h1><p className="muted">Gestiona tus sitios y convierte tus ideas en experiencias memorables.</p></div><span className="spark">✦</span></div><section className="section-head"><div><h2>Mis sitios</h2><p className="muted">{sites.length ? "Tus proyectos, siempre a mano." : "Crea tu primer proyecto en unos segundos."}</p></div></section><div className="create-card"><div className="create-icon">＋</div><div><h3>Crear un nuevo sitio</h3><p className="muted">Empieza con una página pensada para tu marca.</p></div><form onSubmit={create}><input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del sitio" aria-label="Nombre del sitio"/><button className="primary" disabled={creating}>{creating ? "Creando…" : "Crear sitio"}</button></form></div>{error && <div className="alert">{error}</div>}<div className="site-grid">{sites.map(site => <article className="site-card" key={site.id}><div className="site-preview"><span>ZW</span></div><div className="site-info"><div><h3>{site.name}</h3><p className="muted">{site.status === "active" ? "Publicado" : "Borrador"}</p></div><div className="site-actions"><button className="secondary" onClick={() => go(`/app?site=${site.id}`)}>Editar sitio <span>→</span></button><button className="text-danger" onClick={() => remove(site.id)}>Eliminar</button></div></div></article>)}</div></main></div>;
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
    THEME_CONTRAST: "El contraste del tema es bajo",
    FONT_NOT_HOSTED: "La tipografia no esta alojada en el sitio",
    SCHEMA_INVALID: "El contenido no tiene el formato esperado",
    RAW_HTML: "Hay HTML crudo en el contenido",
  };
  return map[code] ?? code;
}

function Editor({ siteId }: { siteId: string }) {
  const PAGE = new URLSearchParams(location.search).get("page") ?? "p_home"; const [doc, setDoc] = useState<any>(null); const [rev, setRev] = useState(0); const [status, setStatus] = useState("Cargando tu editor…"); const [assets, setAssets] = useState<EditorAsset[]>([]); const [uploading, setUploading] = useState(false); const lastData = useRef<any>(null); const [blockers, setBlockers] = useState<string[]>([]); const [publishedUrl, setPublishedUrl] = useState<string|null>(null);
  async function refreshAssets() { try { const r = await api(`/api/sites/${siteId}/assets`); if (!r.ok) return; const body = await r.json() as { assets?: EditorAsset[] }; setAssets(Array.isArray(body.assets) ? body.assets : []); } catch { setAssets([]); } }
  async function removeAsset(id: string) { if (!confirm("¿Eliminar esta imagen?")) return; const r = await api(`/api/sites/${siteId}/assets?id=${encodeURIComponent(id)}`, { method: "DELETE" }); if (r.ok) { await refreshAssets(); setStatus("Imagen eliminada"); } }
  async function upload(file: File) { setUploading(true); const r = await api(`/api/sites/${siteId}/assets?kind=image`, { method: "POST", headers: { "content-type": file.type }, body: file }); setUploading(false); if (r.ok) { await refreshAssets(); setStatus("Imagen subida. Copia su ID en el bloque Imagen."); } else setStatus("No se pudo subir la imagen"); }
  useEffect(() => { void refreshAssets(); }, [siteId]);
  const saving = useRef(false); const pending = useRef<any>(null); const docRef = useRef<any>(null); const revRef = useRef(0); const [showPreview, setShowPreview] = useState(false); const [showAssets, setShowAssets] = useState(true); const [showStyles, setShowStyles] = useState(false);
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
  async function publish() {
    setStatus("Publicando…");
    if (pending.current) await save(pending.current);
    const r = await api(`/api/sites/${siteId}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({})) as { findings?: { code: string }[] };
      const codes = [...new Set((d.findings ?? []).map((f) => f.code))];
      setBlockers(codes.length ? codes.map(findingLabel) : ["No se pudo publicar"]);
      setStatus("Falta algo para publicar");
      return;
    }
    const d = await r.json() as { version: number; hostname?: string };
    if (d.hostname) { setPublishedUrl(`https://${d.hostname}`); setStatus("Publicado correctamente"); }
    else setStatus("Publicado, pero sin direccion: no queda sitio en el pool de dominios");
  }
  if (showStyles) {
    return <StyleStart
      siteId={siteId}
      expectedRev={rev}
      onApplied={() => { setShowStyles(false); void reloadDraft(); }}
      onSkip={() => setShowStyles(false)}
    />;
  }
  return <div className="editor-shell">
    <header className="editorbar">
      <button className="back" onClick={() => go("/app")} aria-label="Volver al panel">←</button>
      <Brand/>
      <span className="divider"/>
      <span className="editor-status">{status}</span>
      {publishedUrl && <a className="published-url" href={publishedUrl} target="_blank" rel="noreferrer">Tu sitio: {publishedUrl.replace("https://", "")}</a>}
      {blockers.length > 0 && <div className="publish-blockers" role="alert">
        <strong>Para publicar falta:</strong>
        <ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        <button className="ghost" onClick={() => setBlockers([])} aria-label="Cerrar">×</button>
      </div>}
      <div className="editor-actions">
        <button className="asset-trigger" aria-expanded={showAssets} onClick={() => setShowAssets(v => !v)}>
          Imágenes {assets.length > 0 && <span className="asset-count">{assets.length}</span>}
        </button>
        <button className="ghost" onClick={() => setShowStyles(true)}>Estilos</button>
        <button className="ghost" onClick={() => setShowPreview(true)}>Vista previa</button>
        <button className="primary publish" onClick={publish}>Publicar sitio</button>
      </div>
    </header>
    <div className="editor-body">
      <Puck config={buildEditorConfig({ assets: assets.map(a => ({ id: a.id, path: a.publicUrl })) })} data={documentToPuck(doc, PAGE)} onChange={save} overrides={{ "headerActions": () => null }}/>
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
