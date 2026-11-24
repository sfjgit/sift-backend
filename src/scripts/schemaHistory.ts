// File: schemaHistory.ts
// Path: src/scripts/schemaHistory.ts
//
// The schema's history for Admin › Data map: every version of prisma/schema.prisma in git (+ the working
// copy when it differs), what changed each time. Writes docs/schema/history.json and current.json.
// Run with `npm run docs:schema` (also part of `npm run docs:api`). Free: git + text parsing only.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { diffSchema, parseSchema, type SchemaGraph } from "@/docs/schemaGraph";

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "docs/schema");
const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const commits = git("log", "--reverse", "--format=%H|%h|%aI|%an|%s", "--", "prisma/schema.prisma")
  .trim().split("\n").filter(Boolean)
  .map((l) => { const [hash, short, at, author, ...msg] = l.split("|"); return { hash: hash!, short: short!, at: at!, author: author!, message: msg.join("|") }; });

const versions: { ref: string; at: string; author: string; message: string; text: string }[] = commits.map((c) => ({
  ref: c.short, at: c.at, author: c.author, message: c.message, text: git("show", `${c.hash}:prisma/schema.prisma`),
}));
const working = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
if (!versions.length || versions[versions.length - 1]!.text !== working) {
  // not committed yet: dated by the newest migration folder
  const migs = fs.readdirSync(path.join(ROOT, "prisma/migrations")).filter((d) => /^\d{14}_/.test(d)).sort();
  versions.push({ ref: "working copy", at: new Date().toISOString(), author: "uncommitted", message: `not committed yet — latest migration ${migs[migs.length - 1] ?? "?"}`, text: working });
}

let prev: SchemaGraph | null = null;
const history = [];
for (const v of versions) {
  const g = parseSchema(v.text);
  const d = diffSchema(prev, g);
  const changed = d.addedModels.length + d.removedModels.length + d.fieldChanges.length + d.enumChanges.length;
  if (changed) {
    history.push({
      ref: v.ref, at: v.at, author: v.author, message: v.message,
      hash: crypto.createHash("sha1").update(v.text).digest("hex").slice(0, 10),
      tables: g.models.length, ...d,
    });
  }
  prev = g;
}
history.reverse(); // newest first
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "history.json"), JSON.stringify(history, null, 1));
fs.writeFileSync(path.join(OUT, "current.json"), JSON.stringify(parseSchema(working), null, 1));
console.log(`docs/schema: ${history.length} changes over ${versions.length} versions → history.json + current.json`);
