// File: meter.ts
// Path: src/utils/prisma/meter.ts
//
// Counts the database queries of each request (dev aid, 16 Nov 2026). The DB
// is ~45 ms away, so the NUMBER of queries decides how fast a screen is.
// Every response carries `Server-Timing: db;desc="N queries";dur=ms`, and a
// request that is slow or chatty is logged as [slow].

import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

type Meter = { count: number; ms: number };
const store = new AsyncLocalStorage<Meter>();

/** called by the Prisma extension around every query */
export const metered = async <T>(run: () => Promise<T>): Promise<T> => {
  const m = store.getStore();
  if (!m) return run();
  const t = performance.now();
  try {
    return await run();
  } finally {
    m.count++;
    m.ms += performance.now() - t;
  }
};

const SLOW_MS = Number(process.env.SLOW_REQUEST_MS ?? 1000);
const CHATTY = Number(process.env.CHATTY_QUERIES ?? 15);

export const dbMeter = (req: Request, res: Response, next: NextFunction) => {
  const m: Meter = { count: 0, ms: 0 };
  const started = performance.now();
  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => Response;
  res.writeHead = ((...args: unknown[]) => {
    if (!res.headersSent)
      res.setHeader("Server-Timing", `db;desc="${m.count} queries";dur=${m.ms.toFixed(0)}, total;dur=${(performance.now() - started).toFixed(0)}`);
    return writeHead(...args);
  }) as Response["writeHead"];
  res.on("finish", () => {
    const total = performance.now() - started;
    if (total > SLOW_MS || m.count > CHATTY)
      console.warn(`[slow] ${req.method} ${req.originalUrl.slice(0, 120)} ${total.toFixed(0)}ms · ${m.count} queries (${m.ms.toFixed(0)}ms db)`);
  });
  store.run(m, next);
};
