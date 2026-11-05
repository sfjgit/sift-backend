import { Prisma, PrismaClient } from "@prisma/client";
import { scopeArgs } from "./tenant";

// Neon closes idle connections and suspends an idle database; the first query
// after that fails with "Server has closed the connection" (P1017) or can't
// reach the server while it wakes (P1001 / P1002 / P1008). Reads are retried a
// few times — writes are not, so nothing is ever saved twice.
const READS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const CONNECTION_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);
const WAITS_MS = [200, 800, 2000];

const isConnectionDrop = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && CONNECTION_CODES.has(e.code)) ||
  e instanceof Prisma.PrismaClientInitializationError ||
  /server has closed the connection|can't reach database server|connection (reset|terminated)/i.test(
    String((e as Error)?.message ?? ""),
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base = new PrismaClient();

// every query is scoped to the caller's tenant (see ./tenant.ts), then reads
// get the connection-drop retry
const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args: raw, query }) {
        const args = scopeArgs(model, operation, raw) as typeof raw;
        if (!READS.has(operation)) return query(args);
        for (let i = 0; ; i++) {
          try {
            return await query(args);
          } catch (e) {
            if (i >= WAITS_MS.length || !isConnectionDrop(e)) throw e;
            await sleep(WAITS_MS[i]!);
          }
        }
      },
    },
  },
}) as unknown as PrismaClient; // same API; keeps Prisma.TransactionClient typing everywhere

export default prisma;
