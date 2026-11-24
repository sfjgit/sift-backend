// File: docs.routes.ts
// Path: src/docs/docs.routes.ts
//
// Live API docs, built from the running router on request (always current):
//   GET /api/docs                → interactive explorer (Swagger UI)
//   GET /api/docs/openapi.json   → OpenAPI 3.1 (for tools / AI assistants)
//   GET /api/docs/endpoints.md   → one readable page
//   GET /api/docs/README.md · CONVENTIONS.md · CHANGELOG.md → the hand-written docs (docs/api/)
// On when NODE_ENV isn't "production", or API_DOCS=on (off on the public deploy).

import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { buildSpec, toMarkdown } from "./openapi";

export const docsEnabled = () => process.env.API_DOCS === "on" || (process.env.API_DOCS !== "off" && process.env.NODE_ENV !== "production");

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SFJBS CRM API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
  <style>body{margin:0;font-family:system-ui,sans-serif} .topbar{display:none}
    .links{padding:12px 20px;background:#0f172a;color:#e2e8f0;font-size:14px;display:flex;gap:18px;flex-wrap:wrap}
    .links a{color:#93c5fd;text-decoration:none} .links b{color:#fff}</style>
</head>
<body>
  <div class="links"><b>SFJBS CRM API</b>
    <a href="./docs/README.md">How we work (README)</a>
    <a href="./docs/CONVENTIONS.md">Conventions</a>
    <a href="./docs/CHANGELOG.md">Changelog</a>
    <a href="./docs/endpoints.md">All endpoints (Markdown)</a>
    <a href="./docs/openapi.json">openapi.json</a></div>
  <div id="ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: "./docs/openapi.json", dom_id: "#ui", docExpansion: "none", filter: true, tryItOutEnabled: false });
  </script>
</body>
</html>`;

/** api = the /api router itself (passed in to avoid a circular import) */
export function docsRouter(api: Parameters<typeof buildSpec>[0]) {
  const r = Router();
  let cache: { at: number; spec: ReturnType<typeof buildSpec> } | null = null;
  const spec = () => {
    // rebuilt at most every 30 s (nodemon restarts the server on code changes anyway)
    if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), spec: buildSpec(api) };
    return cache.spec;
  };
  r.get("/", (_req: Request, res: Response) => {
    res.type("html").send(page);
  });
  r.get("/openapi.json", (_req: Request, res: Response) => {
    res.json(spec());
  });
  r.get("/endpoints.md", (_req: Request, res: Response) => {
    res.type("text/markdown; charset=utf-8").send(toMarkdown(spec()));
  });
  // the hand-written docs from docs/api/ (fixed list — no other file can be read)
  const DOCS_DIR = [path.resolve(__dirname, "../../docs/api"), path.resolve(__dirname, "../docs/api"), path.resolve(process.cwd(), "docs/api")].find((d) =>
    fs.existsSync(path.join(d, "README.md"))
  );
  for (const name of ["README.md", "CONVENTIONS.md", "CHANGELOG.md"]) {
    r.get(`/${name}`, (_req: Request, res: Response) => {
      const file = DOCS_DIR && path.join(DOCS_DIR, name);
      if (!file || !fs.existsSync(file)) return void res.status(404).json({ success: false, message: `${name} not found` });
      res.type("text/markdown; charset=utf-8").send(fs.readFileSync(file, "utf8"));
    });
  }
  return r;
}
