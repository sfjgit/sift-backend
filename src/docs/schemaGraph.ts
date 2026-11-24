// File: schemaGraph.ts
// Path: src/docs/schemaGraph.ts
//
// prisma/schema.prisma (any version — the live file or one from git) → a graph the schema page draws:
// tables, their fields, and the links between them. Plain text parsing: no database, no Prisma engine.

export interface SchemaField {
  name: string;
  type: string;
  list: boolean;
  optional: boolean;
  id: boolean;
  unique: boolean;
  /** a link to another table (this side holds the key when `fields` is set) */
  relation?: { to: string; name?: string; fields?: string[]; onDelete?: string };
  default?: string;
  /** the // comment on the line */
  comment?: string;
}
export interface SchemaModel {
  name: string;
  fields: SchemaField[];
  /** @@unique / @@index lines, as written */
  constraints: string[];
  /** the /// or // comment lines just above the model */
  doc?: string;
}
export interface SchemaEnum {
  name: string;
  values: string[];
}
export interface SchemaGraph {
  models: SchemaModel[];
  enums: SchemaEnum[];
  /** one per foreign key: from (holds the key) → to */
  links: { from: string; to: string; field: string; optional: boolean; list: boolean }[];
}

const SCALARS = new Set(["String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json", "Bytes"]);

export function parseSchema(text: string): SchemaGraph {
  const lines = text.split("\n");
  const models: SchemaModel[] = [];
  const enums: SchemaEnum[] = [];
  let docBuf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    const block = line.match(/^(model|enum)\s+(\w+)\s*\{/);
    if (!block) {
      if (line.startsWith("//")) docBuf.push(line.replace(/^\/\/\/?\s?/, ""));
      else if (line) docBuf = [];
      continue;
    }
    const [, kind, name] = block;
    const body: string[] = [];
    for (i++; i < lines.length && lines[i]!.trim() !== "}"; i++) body.push(lines[i]!);
    if (kind === "enum") {
      enums.push({ name: name!, values: body.map((b) => b.trim().split(/\s|\/\//)[0]!).filter((v) => v && /^\w+$/.test(v)) });
    } else {
      const fields: SchemaField[] = [];
      const constraints: string[] = [];
      let fieldDoc: string[] = [];
      for (const b of body) {
        const t = b.trim();
        if (!t) continue;
        if (t.startsWith("//")) { fieldDoc.push(t.replace(/^\/\/\/?\s?/, "")); continue; }
        if (t.startsWith("@@")) { constraints.push(t); continue; }
        const m = t.match(/^(\w+)\s+([\w.]+)(\[\])?(\?)?\s*(.*)$/);
        if (!m) continue;
        const [, fname, ftype, list, opt, rest = ""] = m;
        const [attrs, comment] = splitComment(rest);
        const rel = attrs.match(/@relation\(([^)]*)\)/);
        const f: SchemaField = {
          name: fname!,
          type: ftype!,
          list: !!list,
          optional: !!opt,
          id: /@id\b/.test(attrs),
          unique: /@unique\b/.test(attrs),
          ...(attrs.match(/@default\(([^)]*\)?)\)/) && { default: attrs.match(/@default\(([^)]*\)?)\)/)![1] }),
          ...((comment || fieldDoc.length) && { comment: [...fieldDoc, comment].filter(Boolean).join(" ") }),
        };
        if (!SCALARS.has(ftype!) && !enums.some((e) => e.name === ftype) && /^[A-Z]/.test(ftype!)) {
          const relName = rel?.[1]?.match(/"([^"]+)"/)?.[1];
          const keyFields = rel?.[1]?.match(/fields:\s*\[([^\]]*)\]/)?.[1]?.split(",").map((x) => x.trim()).filter(Boolean);
          const onDelete = rel?.[1]?.match(/onDelete:\s*(\w+)/)?.[1];
          f.relation = { to: ftype!, ...(relName && { name: relName }), ...(keyFields?.length && { fields: keyFields }), ...(onDelete && { onDelete }) };
        }
        fields.push(f);
        fieldDoc = [];
      }
      models.push({ name: name!, fields, constraints, ...(docBuf.length && { doc: docBuf.join(" ") }) });
    }
    docBuf = [];
  }
  // enums declared after a model that uses them: those fields aren't relations
  const enumNames = new Set(enums.map((e) => e.name));
  for (const m of models) for (const f of m.fields) if (f.relation && enumNames.has(f.type)) delete f.relation;
  const links = models.flatMap((m) =>
    m.fields
      .filter((f) => f.relation?.fields?.length)
      .map((f) => ({ from: m.name, to: f.relation!.to, field: f.relation!.fields!.join(","), optional: f.optional, list: false })),
  );
  return { models, enums, links };
}

function splitComment(rest: string): [string, string] {
  // a // outside quotes starts the comment
  let q = false;
  for (let i = 0; i < rest.length - 1; i++) {
    if (rest[i] === '"') q = !q;
    if (!q && rest[i] === "/" && rest[i + 1] === "/") return [rest.slice(0, i), rest.slice(i).replace(/^\/\/\/?\s?/, "").trim()];
  }
  return [rest, ""];
}

/** what changed between two versions — tables and fields added / removed / changed */
export function diffSchema(a: SchemaGraph | null, b: SchemaGraph) {
  const am = new Map((a?.models ?? []).map((m) => [m.name, m]));
  const bm = new Map(b.models.map((m) => [m.name, m]));
  const addedModels = [...bm.keys()].filter((k) => !am.has(k));
  const removedModels = [...am.keys()].filter((k) => !bm.has(k));
  const fieldChanges: { model: string; added: string[]; removed: string[]; changed: string[] }[] = [];
  for (const [name, m] of bm) {
    const old = am.get(name);
    if (!old) continue;
    const of = new Map(old.fields.map((f) => [f.name, f]));
    const nf = new Map(m.fields.map((f) => [f.name, f]));
    const sig = (f: SchemaField) => `${f.type}${f.list ? "[]" : ""}${f.optional ? "?" : ""}${f.unique ? "!u" : ""}`;
    const added = [...nf.keys()].filter((k) => !of.has(k));
    const removed = [...of.keys()].filter((k) => !nf.has(k));
    const changed = [...nf.keys()].filter((k) => of.has(k) && sig(of.get(k)!) !== sig(nf.get(k)!));
    const cons = JSON.stringify(old.constraints) !== JSON.stringify(m.constraints) ? ["(indexes / unique rules)"] : [];
    if (added.length || removed.length || changed.length || cons.length) fieldChanges.push({ model: name, added, removed, changed: [...changed, ...cons] });
  }
  const ae = new Map((a?.enums ?? []).map((e) => [e.name, e.values.join(",")]));
  const enumChanges = b.enums.filter((e) => ae.get(e.name) !== e.values.join(",")).map((e) => e.name);
  return { addedModels, removedModels, fieldChanges, enumChanges };
}
