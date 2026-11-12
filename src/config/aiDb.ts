// File: aiDb.ts
// Path: src/config/aiDb.ts
//
// L6 — the read-only database client for the AI layer (spec §4).
//
//   1. Prisma level: every operation except findMany / findFirst / findUnique /
//      count / aggregate / groupBy throws, and nothing starting with "$"
//      ($executeRaw, $queryRaw, $transaction, $connect …) is reachable.
//   2. Database level: it connects as the ai_readonly Postgres role
//      (prisma/sql/ai_readonly_role.sql) — SELECT only, read-only transactions,
//      10 s statement timeout, sensitive tables revoked. Even if every code layer
//      failed, Postgres itself refuses the write.
//
// Tenant isolation is applied exactly like the main client (utils/prisma/tenant).
// User has column grants only: always `select` User fields explicitly.

import { PrismaClient } from "@prisma/client";
import { scopeArgs } from "@/utils/prisma/tenant";
import { loggers } from "@/utils/logger";

export const AI_READ_OPERATIONS = [
  "findMany",
  "findFirst",
  "findUnique",
  "count",
  "aggregate",
  "groupBy",
] as const;
type ReadOp = (typeof AI_READ_OPERATIONS)[number];
const ALLOWED = new Set<string>(AI_READ_OPERATIONS);

export class AiWriteBlockedError extends Error {
  constructor(what: string) {
    super(`AI layer is read-only: "${what}" is not allowed`);
    this.name = "AiWriteBlockedError";
  }
}

type ModelKey = {
  [K in keyof PrismaClient]: K extends `$${string}` | symbol ? never : K;
}[keyof PrismaClient];

/** the only surface the AI layer gets: model delegates with read methods */
export type AiDb = { readonly [K in ModelKey]: Pick<PrismaClient[K], Extract<keyof PrismaClient[K], ReadOp>> };

/** wrap any PrismaClient so only reads get through (also used by the red-team tests) */
export const makeReadOnly = (client: PrismaClient): AiDb => {
  const extended = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!ALLOWED.has(operation)) throw new AiWriteBlockedError(`${model}.${operation}`);
          return query(scopeArgs(model, operation, args) as typeof args);
        },
      },
    },
  });
  return new Proxy(extended as object, {
    get(target, prop) {
      if (typeof prop === "string" && prop.startsWith("$")) throw new AiWriteBlockedError(prop);
      const delegate = Reflect.get(target, prop);
      if (!delegate || typeof delegate !== "object") return delegate;
      // the delegate itself: only the read methods
      return new Proxy(delegate, {
        get(d, op) {
          if (typeof op === "string" && !ALLOWED.has(op) && typeof Reflect.get(d, op) === "function") {
            throw new AiWriteBlockedError(`${String(prop)}.${op}`);
          }
          return Reflect.get(d, op);
        },
      });
    },
    set() {
      throw new AiWriteBlockedError("set");
    },
  }) as AiDb;
};

let instance: AiDb | null = null;

/** lazily connected — the CRM starts fine when the AI layer isn't configured */
export const aiDb = (): AiDb => {
  if (instance) return instance;
  const url = process.env.DATABASE_URL_AI_READONLY;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL_AI_READONLY is not set — the AI layer needs the ai_readonly role");
    }
    // local dev only: Prisma-level guard still holds, the DB-level wall does not
    loggers.warn(
      "[ai] DATABASE_URL_AI_READONLY not set — using DATABASE_URL (dev only, no DB-level read-only wall)",
    );
  }
  instance = makeReadOnly(new PrismaClient({ datasourceUrl: (url || process.env.DATABASE_URL)! }));
  return instance;
};

/** true when the DB-level wall (ai_readonly role) is in place */
export const aiDbHasReadOnlyRole = () => Boolean(process.env.DATABASE_URL_AI_READONLY);
