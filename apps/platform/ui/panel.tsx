import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Puck } from "@measured/puck";
// Estilos de Puck: sin ellos el panel sale sin maquetar.
import "@measured/puck/puck.css";
import { buildEditorConfig } from "@webdesign/editor/config";
import { documentToPuck, puckToDocument, mergeEditedPage } from "@webdesign/puck-adapter";

// Panel del editor (spec 6.3 y 4.3). Vive en su propio origen y nunca comparte
// cookie con los sitios publicados ni con la vista previa (spec 5.3).
// La vista previa va en un iframe con sandbox="allow-scripts" y SIN allow-same-origin:
// el contenido del sitio jamas alcanza la sesion del panel.

const siteId = new URLSearchParams(location.search).get("site") ?? "";
const PAGE = new URLSearchParams(location.search).get("page") ?? "p_home";

type Draft = { rev: number; doc: unknown };

async function load(): Promise<Draft> {
  const res = await fetch(`/api/sites/${siteId}/draft`, { credentials: "same-origin" });
  if (res.status === 401) throw new Error("sesion");
  if (!res.ok) throw new Error("no se pudo cargar el borrador");
  return (await res.json()) as Draft;
}

function Panel() {
  const [doc, setDoc] = useState<any>(null);
  const [rev, setRev] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    load().then((d) => { setDoc(d.doc); setRev(d.rev); }).catch((e) => setStatus(String(e.message)));
  }, []);

  if (!doc) return <p>{status || "Cargando"}</p>;

  const config = buildEditorConfig({});

  const save = async (data: any) => {
    const next = mergeEditedPage(doc, puckToDocument({ content: data.content, root: data.root }, PAGE));
    const res = await fetch(`/api/sites/${siteId}/draft`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc: next, expectedRev: rev }),
    });
    if (res.status === 409) {
      // Revision vieja: se recarga en vez de pisar lo que otro escribio.
      const current = (await res.json()) as { currentRev: number };
      const fresh = await load();
      setDoc(fresh.doc);
      setRev(fresh.rev);
      setStatus(`Otra sesion guardo antes (rev ${current.currentRev}). Recargado.`);
      return;
    }
    if (!res.ok) {
      const body = (await res.json()) as { findings?: unknown };
      setStatus(`No se guardo: ${JSON.stringify(body.findings ?? body)}`);
      return;
    }
    const ok = (await res.json()) as { rev: number };
    setDoc(next);
    setRev(ok.rev);
    setStatus(`Guardado (rev ${ok.rev})`);
  };

  return (
    <div>
      <div style={{ padding: 8, fontFamily: "system-ui", fontSize: 13 }}>
        <strong>Sitio</strong> {siteId} · <span role="status">{status}</span>
        <button onClick={() => { setStatus("Publicando"); fetch(`/api/sites/${siteId}/publish`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => setStatus(r.ok ? "Publicado" : "No publicado")); }}>Publicar</button>
      </div>
      <Puck config={config} data={documentToPuck(doc, PAGE)} onPublish={save} />
      <iframe
        title="Vista previa"
        sandbox="allow-scripts"
        src={`/api/sites/${siteId}/preview?page=${PAGE}`}
        style={{ width: "100%", height: 400, border: "1px solid #ccc", borderTop: 0 }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Panel />);
