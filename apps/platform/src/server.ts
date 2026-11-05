import { createServer } from "node:http";
import pg from "pg";
import { migrate } from "@webdesign/db";

// Punto de entrada mínimo de `platform`. Responde healthcheck para Coolify.
export function createApp() {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const start = async () => {
    if (process.env.MIGRATE_ON_START === "1") {
      const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
      if (!url) throw new Error("MIGRATE_ON_START=1 requires MIGRATION_DATABASE_URL or DATABASE_URL");
      const pool = new pg.Pool({ connectionString: url });
      const applied = await migrate(pool);
      await pool.end();
      console.log(`migrations applied: ${applied.length ? applied.join(", ") : "none"}`);
    }
    createApp().listen(port, () => console.log(`platform on :${port}`));
  };
  start().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
