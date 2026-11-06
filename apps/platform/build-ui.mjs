import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

// Construye el panel del editor en un unico bundle servido por la plataforma.
// React y Puck van dentro: el panel no carga nada de terceros (CSP del panel).
await mkdir("ui-dist", { recursive: true });
await build({
  entryPoints: ["ui/panel.tsx"],
  bundle: true,
  outfile: "ui-dist/panel.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  loader: { ".css": "css" },
  logLevel: "warning",
});
await copyFile("ui/panel.html", "ui-dist/panel.html");
// Puck importa una fuente remota (rsms.me). El panel no carga terceros: se quita.
const { readFile, writeFile } = await import("node:fs/promises");
const css = await readFile("ui-dist/panel.css", "utf8");
await writeFile("ui-dist/panel.css", css.replace(/@import"https:\/\/rsms\.me[^;]*;/g, ""));
console.log("css sin terceros");
console.log("panel construido");
