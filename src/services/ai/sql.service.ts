// File: sql.service.ts
// Path: src/services/ai/sql.service.ts
//
// FREE HAND — super admin only (14 Nov 2026). When the report catalog can't
// answer, the AI may write ONE read-only SQL query. Walls, in order:
//   1. only a super admin (checked again on every run, also for saved canvases)
//   2. only while there is a single tenant (a free query can't be held to one)
//   3. the model sees table / column names only — never a row; names it was
//      told are {placeholders}, swapped for $n parameters here (never pasted in)
//   4. the text must be a single SELECT / WITH; write words and the sensitive
//      tables are refused before it runs
//   5. it runs on the ai_readonly database user (no write grants, no secret
//      tables), in a READ ONLY transaction, with a statement timeout and a row cap
// There is no fallback to the main connection: no read-only user, no free hand.

import { Prisma, PrismaClient } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import type { Extraction } from "@/services/ai/entities.service";

export const FREE_ROW_CAP = 500;
const TIMEOUT_MS = 8_000;

// tables the free query may not touch (the DB role also revokes most of them)
const BLOCKED_TABLES = [
  "RefreshToken", "AuthLogs", "ImpersonationLog", "ExternalService", "Tenant", "_prisma_migrations", "ChangeLog",
  "AiAuditLog", "AiModeSetting", "AiQuotaPolicy", "AiUserQuotaOverride", "AiUserPreference", "AiModelPricing",
  "CommandTemplate", "ReportTemplate", "AiThread", "AiTurn", "AiAnswerMemory", "Notification",
  "Ticket", "TicketAttachment", "TicketEvent",
];
// columns of User the read-only role may read
const USER_COLUMNS = new Set(["id", "tenantId", "firstName", "lastName", "middleName", "displayName", "employeeId", "isActive", "roleId", "departmentId", "designationId", "reportingToId", "teamLeadId", "createdAt", "updatedAt"]);

const WRITE_WORDS =
  /\b(insert|update|delete|merge|upsert|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|prepare|deallocate|set|reset|lock|vacuum|analyze|cluster|reindex|refresh|listen|notify|unlisten|comment|security|into|returning)\b|pg_sleep|pg_read|pg_ls|pg_stat|lo_import|lo_export|dblink|current_setting|set_config/i;

export class FreeSqlError extends Error {}

/** the database as the model sees it: tables, columns, links — no data */
let schemaCache: string | null = null;
export const schemaForModel = () => {
  if (schemaCache) return schemaCache;
  const lines: string[] = [];
  for (const m of Prisma.dmmf.datamodel.models) {
    if (BLOCKED_TABLES.includes(m.name)) continue;
    const cols = m.fields
      .filter((f) => (f.kind === "scalar" || f.kind === "enum") && (m.name !== "User" || USER_COLUMNS.has(f.name)))
      .map(
        (f) =>
          `${f.name} ${f.kind === "enum" ? `enum(${Prisma.dmmf.datamodel.enums.find((e) => e.name === f.type)?.values.map((v) => v.name).join("|")})` : f.type}${f.isList ? "[]" : ""}`,
      );
    const links = m.fields.filter((f) => f.kind === "object" && f.relationFromFields?.length).map((f) => `${f.relationFromFields!.join(",")}→${f.type}.id`);
    lines.push(`"${m.name}"(${cols.join(", ")})${links.length ? ` links: ${links.join(", ")}` : ""}`);
  }
  schemaCache = lines.join("\n");
  return schemaCache;
};

/** check the text before it goes anywhere near the database */
export const checkSql = (raw: string) => {
  const sql = raw
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .replace(/;\s*$/, "");
  if (!sql) throw new FreeSqlError("empty query");
  if (sql.includes(";")) throw new FreeSqlError("only one statement is allowed");
  if (!/^(select|with)\b/i.test(sql)) throw new FreeSqlError("only SELECT queries are allowed");
  const w = WRITE_WORDS.exec(sql.replace(/'(?:[^']|'')*'/g, "''"));
  if (w) throw new FreeSqlError(`"${w[0]}" is not allowed in a read-only query`);
  for (const t of BLOCKED_TABLES) if (new RegExp(`"?\\b${t}\\b"?`, "i").test(sql)) throw new FreeSqlError(`the ${t} table is off limits`);
  if (/"User"/.test(sql) && /\b(password|reset|token|email|phone|dob|birth)/i.test(sql)) throw new FreeSqlError("those User columns are off limits");
  return sql;
};

/** {user_1} → $1 with the real id — values are never pasted into the text */
export const bindPlaceholders = (sql: string, ex: Extraction | null) => {
  const args: unknown[] = [];
  const out = sql.replace(/'?\{([a-z_]+_\d+)\}'?/g, (_m, inner: string) => {
    const e = ex?.entities.find((x) => x.ph === `{${inner}}`);
    if (!e) throw new FreeSqlError(`unknown placeholder {${inner}}`);
    if (e.kind === "date_range") {
      args.push(e.from, e.to);
      return `$${args.length - 1}::date AND $${args.length}::date`;
    }
    args.push(e.value ?? e.label);
    return `$${args.length}`;
  });
  return { sql: out, args };
};

let client: PrismaClient | null = null;
const readOnlyClient = () => {
  const url = process.env.DATABASE_URL_AI_READONLY;
  if (!url) throw new FreeSqlError("Free queries need the read-only database user (DATABASE_URL_AI_READONLY).");
  return (client ??= new PrismaClient({ datasourceUrl: url }));
};

const toPlain = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "toNumber" in (v as object)) return (v as { toNumber: () => number }).toNumber();
  return JSON.stringify(v).slice(0, 200);
};

/** run it: super admin, single tenant, read-only user, read-only transaction, timeout, row cap */
export const runFreeSql = async (user: { isSuperAdmin?: boolean | null }, sql: string, args: unknown[]) => {
  if (!user.isSuperAdmin) throw new FreeSqlError("Only a super admin can run a custom query.");
  if ((await prisma.tenant.count()) > 1) throw new FreeSqlError("Custom queries are off while there is more than one company in the system.");
  const safe = checkSql(sql);
  const db = readOnlyClient();
  const rows = (await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
    return tx.$queryRawUnsafe(`SELECT * FROM (${safe}) AS q LIMIT ${FREE_ROW_CAP + 1}`, ...args);
  })) as Record<string, unknown>[];
  return {
    rows: rows.slice(0, FREE_ROW_CAP).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toPlain(v)]))),
    capped: rows.length > FREE_ROW_CAP,
  };
};
