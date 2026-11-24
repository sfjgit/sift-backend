// File: schema.routes.ts
// Path: src/routes/schema.routes.ts
//
// Admin › Data map (super admins): the database structure as a picture —
//   GET /api/schema-map → { graph, domains, modelNotes, fieldNotes, history }
// graph = the live prisma/schema.prisma parsed (tables, fields, links); history = every change to it
// (docs/schema/history.json, built from git by `npm run docs:schema`). Read-only, no database queries.

import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { authenticateUser } from "@/middleware/auth";
import { requireSuperAdmin } from "@/middleware/authorize";
import { parseSchema } from "@/docs/schemaGraph";
import { DOMAINS, FIELD_NOTES, MODEL_NOTES } from "@/docs/schemaNotes";

const router = Router();
// src/routes or dist/ — the repo root is one or two levels up
const ROOT = [path.resolve(__dirname, "../.."), path.resolve(__dirname, ".."), process.cwd()].find((d) =>
  fs.existsSync(path.join(d, "prisma/schema.prisma")),
);
const read = (rel: string) => (ROOT && fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), "utf8") : null);

// the database structure as a picture, its explanations and its history (super admins)
router.get("/", authenticateUser, requireSuperAdmin, (_req: Request, res: Response) => {
  const text = read("prisma/schema.prisma");
  if (!text) return void res.status(404).json({ success: false, message: "schema.prisma not found on this server" });
  const history = JSON.parse(read("docs/schema/history.json") ?? "[]");
  res.json({ success: true, data: { graph: parseSchema(text), domains: DOMAINS, modelNotes: MODEL_NOTES, fieldNotes: FIELD_NOTES, history } });
});

export default router;
