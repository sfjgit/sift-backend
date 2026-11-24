// File: apiDocs.ts
// Path: src/scripts/apiDocs.ts
//
// Writes the generated API docs into the repo (docs/api/), for anyone — or any
// AI assistant — working from the code without a running server.
//   npm run docs:api
// Run after every API change, together with a docs/api/CHANGELOG.md entry.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import router from "@/routes/index";
import { buildSpec, toMarkdown } from "@/docs/openapi";

const out = path.resolve(__dirname, "../../docs/api");
fs.mkdirSync(out, { recursive: true });
const spec = buildSpec(router as unknown as Parameters<typeof buildSpec>[0]);
// the docs pages themselves aren't part of the API
for (const p of Object.keys(spec.paths)) if (p.startsWith("/api/docs")) delete spec.paths[p];
fs.writeFileSync(path.join(out, "openapi.json"), JSON.stringify(spec, null, 2) + "\n");
fs.writeFileSync(path.join(out, "ENDPOINTS.md"), toMarkdown(spec) + "\n");
console.log(`docs/api: ${Object.keys(spec.paths).length} paths, ${spec["x-route-count"]} endpoints → openapi.json + ENDPOINTS.md`);
process.exit(0);
