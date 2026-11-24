// File: openapi.ts
// Path: src/docs/openapi.ts
//
// The API docs, generated from the running router — never written by hand, so
// they cannot drift from the code. For every route: method + full path, the
// summary (the // comment above it in src/routes), sign-in / permission /
// super-admin / AI-mode guards, path · query · body fields from its zod
// validator (types, required, enums, limits) and whether it takes a file.
//
//   buildSpec()      → OpenAPI 3.1 object        (GET /api/docs/openapi.json)
//   toMarkdown(spec) → one readable page         (GET /api/docs/endpoints.md)
//   npm run docs:api → writes both to docs/api/  (for the repo / any AI assistant)

import fs from "node:fs";
import path from "node:path";
import { z, type ZodType } from "zod";
import { metaOf, type DocMeta } from "./meta";

type Layer = {
  name: string;
  handle: unknown & { stack?: Layer[] };
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: Layer[] };
  match?: (p: string) => boolean;
};

type JsonSchema = Record<string, unknown> & { properties?: Record<string, JsonSchema>; required?: string[] };

export interface DocRoute {
  method: string;
  path: string;
  module: string;
  summary: string;
  auth: boolean;
  perm?: string;
  superAdmin?: boolean;
  ai?: string;
  platform?: boolean;
  service?: boolean;
  upload?: boolean;
  params?: JsonSchema | undefined;
  query?: JsonSchema | undefined;
  body?: JsonSchema | undefined;
}

// the project's src/ (route files: mount table + summaries). Works from src/docs (tsx)
// and from the bundled dist/index.js (npm run dev / start), which sits one level lower.
const SRC =
  [path.resolve(__dirname, ".."), path.resolve(__dirname, "../src"), path.resolve(__dirname, "../../src"), path.resolve(process.cwd(), "src")].find((d) =>
    fs.existsSync(path.join(d, "routes/index.ts"))
  ) ?? null;

/** the "/clients" → "./client.routes" table, read from src/routes/index.ts */
function mounts(): { mount: string; file?: string }[] {
  if (!SRC) return [];
  const idx = fs.readFileSync(path.join(SRC, "routes/index.ts"), "utf8");
  const imports = new Map<string, string>();
  for (const m of idx.matchAll(/import\s+(\w+)\s+from\s+["']\.\/([\w.-]+)["']/g)) imports.set(m[1]!, m[2]!);
  const out: { mount: string; file?: string }[] = [];
  for (const m of idx.matchAll(/router\.use\(\s*["']([^"']+)["']\s*,\s*([\w]+)/g)) {
    const f = imports.get(m[2]!);
    out.push({ mount: m[1]!, ...(f && { file: `routes/${f}.ts` }) });
  }
  return out;
}

/** "// comment" lines right above router.<method>("path" … in a routes file */
function summaries(file: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!SRC || !file || !fs.existsSync(path.join(SRC, file))) return out;
  const lines = fs.readFileSync(path.join(SRC, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = /router\.(get|post|put|patch|delete)\(\s*(?:["']([^"']*)["'])?/.exec(line);
    if (!m) return;
    const p = m[2] ?? /^\s*["']([^"']*)["']/.exec(lines[i + 1] ?? "")?.[1];
    if (p === undefined) return;
    const notes: string[] = [];
    for (let j = i - 1; j >= 0 && /^\s*\/\//.test(lines[j]!); j--) notes.unshift(lines[j]!.replace(/^\s*\/\/\s?/, "").trim());
    out.set(`${m[1]!.toUpperCase()} ${p}`, notes.join(" ").replace(/^─+\s*/, "").replace(/\s*─+$/, ""));
  });
  return out;
}

const schema = (t: ZodType | undefined): JsonSchema | undefined => {
  if (!t) return undefined;
  try {
    const s = z.toJSONSchema(t, {
      io: "input",
      unrepresentable: "any",
      // dates arrive as ISO strings ("2026-11-21" or full date-time)
      override: (ctx) => {
        const def = (ctx.zodSchema as unknown as { _zod?: { def?: { type?: string } } })._zod?.def;
        if (def?.type === "date") Object.assign(ctx.jsonSchema, { type: "string", format: "date-time" });
      },
    }) as JsonSchema;
    delete s.$schema;
    return s;
  } catch {
    return { description: "(shape not representable — see the validator in the code)" };
  }
};

const merge = (into: DocMeta, m: DocMeta | undefined) => (m ? Object.assign(into, m, { schemas: { ...into.schemas, ...m.schemas } }) : into);

function walk(stack: Layer[], base: string, module: string, notes: Map<string, string>, inherited: DocMeta, out: DocRoute[]) {
  const ctx: DocMeta = { ...inherited, schemas: {} };
  for (const layer of stack) {
    if (layer.route) {
      const m: DocMeta = { ...ctx, schemas: {} };
      for (const s of layer.route.stack) merge(m, metaOf(s.handle));
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      // no comment above the route: the handler's name ("listClientTasks" → "List client tasks")
      const handler = layer.route.stack[layer.route.stack.length - 1]?.handle as { name?: string } | undefined;
      const fromName = (handler?.name ?? "").replace(/^bound /, "");
      const named = fromName && fromName !== "anonymous" ? fromName.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/^\w/, (ch) => ch.toUpperCase()) : "";
      for (const rp of paths)
        for (const method of Object.keys(layer.route.methods).filter((k) => layer.route!.methods[k] && k !== "_all")) {
          const full = (base + (rp === "/" ? "" : rp)).replace(/\/+/g, "/") || "/";
          out.push({
            method: method.toUpperCase(),
            path: full,
            module,
            summary: notes.get(`${method.toUpperCase()} ${rp}`) || named,
            auth: !!m.auth,
            ...(m.perm && { perm: m.perm }),
            ...(m.superAdmin && { superAdmin: true }),
            ...(m.ai && { ai: m.ai }),
            ...(m.platform && { platform: true }),
            ...(m.service && { service: true }),
            ...(m.upload && { upload: true }),
            ...(m.schemas?.params && { params: schema(m.schemas.params) }),
            ...(m.schemas?.query && { query: schema(m.schemas.query) }),
            ...(m.schemas?.body && { body: schema(m.schemas.body) }),
          });
        }
    } else if (layer.handle?.stack) {
      walk(layer.handle.stack, base, module, notes, ctx, out); // nested router without its own path
    } else {
      merge(ctx, metaOf(layer.handle)); // router.use(authenticateUser) etc. apply to the routes after it
    }
  }
}

/** every route of the /api router, in mount order */
export function collectRoutes(apiRouter: { stack: Layer[] }): DocRoute[] {
  const table = mounts();
  const out: DocRoute[] = [];
  const used = new Set<number>();
  for (const layer of apiRouter.stack) {
    if (!layer.handle?.stack) continue;
    const i = table.findIndex((t, k) => !used.has(k) && layer.match?.(t.mount));
    const t = i >= 0 ? table[i]! : { mount: "" };
    if (i >= 0) used.add(i);
    walk(layer.handle.stack, `/api${t.mount}`, t.mount.replace(/^\//, "") || "root", summaries(t.file), {}, out);
  }
  return out;
}

const toParams = (s: JsonSchema | undefined, where: "path" | "query") =>
  Object.entries(s?.properties ?? {}).map(([name, sch]) => ({
    name,
    in: where,
    required: where === "path" || (s?.required ?? []).includes(name),
    schema: sch,
  }));

export function buildSpec(apiRouter: { stack: Layer[] }) {
  const routes = collectRoutes(apiRouter);
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const p = r.path.replace(/:(\w+)/g, "{$1}");
    const guard = [
      r.service ? "Engines only (X-Service-Key) — not for the frontend." : r.platform ? "Enterprise console sign-in (platform admin)." : r.superAdmin ? "Super admin only." : r.perm ? `Needs permission \`${r.perm}\`.` : r.auth ? "Signed-in user." : "No sign-in.",
      r.ai ? `AI mode ${r.ai} must be on for the user.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    (paths[p] ??= {})[r.method.toLowerCase()] = {
      tags: [r.module],
      summary: r.summary || `${r.method} ${r.path}`,
      description: guard,
      ...(r.auth && { security: [{ bearer: [] }, { cookie: [] }] }),
      ...(r.perm && { "x-permission": r.perm }),
      parameters: [...toParams(r.params, "path"), ...toParams(r.query, "query")],
      ...((r.body || r.upload) && {
        requestBody: {
          required: true,
          content: r.upload
            ? { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" }, ...(r.body?.properties ?? {}) }, required: ["file", ...(r.body?.required ?? [])] } } }
            : { "application/json": { schema: r.body } },
        },
      }),
      responses: {
        "200": { description: "`{ success: true, data, meta? }` — see docs/api/CONVENTIONS.md" },
        "400": { description: "Validation failed: `{ success: false, message, errors: [{ field, message }] }`" },
        ...(r.auth && { "401": { description: "Not signed in / session expired" } }),
        ...((r.perm || r.superAdmin) && { "403": { description: "Missing permission" } }),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "SFJBS CRM API",
      version: new Date().toISOString().slice(0, 10),
      description: "Generated from the running crm-core-service router. Conventions (auth, envelope, errors, paging): docs/api/CONVENTIONS.md. Changes: docs/api/CHANGELOG.md.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "Phone app / scripts: Authorization: Bearer <accessToken> (X-Client: mobile on login)" },
        cookie: { type: "apiKey", in: "cookie", name: "accessToken", description: "Web: httpOnly cookie set by POST /api/auth/login" },
      },
    },
    paths,
    "x-route-count": routes.length,
  };
}

const typeOf = (s: JsonSchema | undefined): string => {
  if (!s) return "any";
  if (Array.isArray(s.enum)) return (s.enum as unknown[]).map((v) => JSON.stringify(v)).join(" \\| ");
  if (Array.isArray(s.anyOf)) return (s.anyOf as JsonSchema[]).map(typeOf).join(" \\| ");
  if (s.type === "array") return `${typeOf(s.items as JsonSchema)}[]`;
  const t = Array.isArray(s.type) ? (s.type as string[]).join("\\|") : (s.type as string | undefined);
  const extra = [s.format && `(${s.format})`, s.maxLength && `≤${s.maxLength}`, s.maximum !== undefined && `≤${s.maximum}`].filter(Boolean).join(" ");
  return `${t ?? "object"}${extra ? ` ${extra}` : ""}`;
};

const fieldRows = (label: string, s: JsonSchema | undefined) =>
  Object.entries(s?.properties ?? {}).map(
    ([k, v]) => `| ${label} | \`${k}\` | ${typeOf(v)} | ${(s?.required ?? []).includes(k) ? "yes" : ""} | ${String(v.description ?? (v.default !== undefined ? `default ${JSON.stringify(v.default)}` : "")).replace(/\|/g, "\\|")} |`
  );

/** one Markdown page: every endpoint, grouped by module */
export function toMarkdown(spec: ReturnType<typeof buildSpec>): string {
  const byTag = new Map<string, string[]>();
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [method, raw] of Object.entries(ops)) {
      const op = raw as { tags: string[]; summary: string; description: string; parameters: { in: string; name: string; required: boolean; schema: JsonSchema }[]; requestBody?: { content: Record<string, { schema: JsonSchema }> } };
      const bodyCt = op.requestBody ? Object.keys(op.requestBody.content)[0]! : null;
      const body = bodyCt ? op.requestBody!.content[bodyCt]!.schema : undefined;
      const pathS: JsonSchema = { properties: Object.fromEntries(op.parameters.filter((x) => x.in === "path").map((x) => [x.name, x.schema])), required: op.parameters.filter((x) => x.in === "path").map((x) => x.name) };
      const queryS: JsonSchema = { properties: Object.fromEntries(op.parameters.filter((x) => x.in === "query").map((x) => [x.name, x.schema])), required: op.parameters.filter((x) => x.in === "query" && x.required).map((x) => x.name) };
      const rows = [...fieldRows("path", pathS), ...fieldRows("query", queryS), ...fieldRows(bodyCt === "multipart/form-data" ? "form" : "body", body)];
      const block = [
        `### \`${method.toUpperCase()} ${p}\``,
        op.summary && !op.summary.startsWith(method.toUpperCase()) ? op.summary : "",
        `*${op.description}*${bodyCt === "multipart/form-data" ? " · multipart upload (field `file`)" : ""}`,
        rows.length ? ["", "| in | field | type | required | notes |", "|---|---|---|---|---|", ...rows].join("\n") : "",
        "",
      ]
        .filter((x) => x !== "")
        .join("\n");
      const t = op.tags[0] ?? "other";
      byTag.set(t, [...(byTag.get(t) ?? []), block]);
    }
  }
  const toc = [...byTag.keys()].map((t) => `- [${t}](#${t.replace(/[^a-z0-9-]/gi, "").toLowerCase()}) — ${byTag.get(t)!.length}`).join("\n");
  return [
    `# SFJBS CRM API — endpoints`,
    ``,
    `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from the code (\`npm run docs:api\`). **Do not edit by hand.** ${spec["x-route-count"]} endpoints.`,
    `Read first: [CONVENTIONS.md](./CONVENTIONS.md) (sign-in, response envelope, errors, paging). What changed: [CHANGELOG.md](./CHANGELOG.md).`,
    ``,
    toc,
    ``,
    ...[...byTag.entries()].map(([t, blocks]) => `## ${t}\n\n${blocks.join("\n\n")}`),
  ].join("\n");
}
