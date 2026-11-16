// File: recentErrors.ts
// Path: src/utils/recentErrors.ts
//
// The last few hundred server errors, kept in memory (16 Nov 2026). Every
// response carries X-Request-Id; when a user reports a bug, the failed calls
// their browser saw are matched here by that id, so the ticket shows the
// server's own error and stack — no log digging.

import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export interface ServerError {
  requestId: string;
  at: string;
  method: string;
  path: string;
  status: number;
  message: string;
  code?: string | undefined;
  stack?: string | undefined;
  userId?: string | undefined;
}

const MAX = 300;
const ring: ServerError[] = [];

export const requestId = (req: Request, res: Response, next: NextFunction) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};

/** called by the error middleware for every error response */
export const rememberError = (req: Request, res: Response, status: number, err: unknown) => {
  const e = err as { message?: string; code?: string; stack?: string };
  ring.push({
    requestId: String(res.locals.requestId ?? ""),
    at: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl.split("?")[0]!.slice(0, 200),
    status,
    message: String(e?.message ?? err).slice(0, 500),
    code: e?.code,
    // only real crashes keep a stack; expected 4xx don't need one
    stack: status >= 500 ? e?.stack?.split("\n").slice(0, 12).join("\n") : undefined,
    userId: req.user?.id,
  });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
};

export const errorsFor = (requestIds: string[]) => {
  const want = new Set(requestIds.filter(Boolean));
  return ring.filter((e) => want.has(e.requestId));
};

/** this user's server errors in a time window (calls the browser didn't catch) */
export const errorsOfUser = (userId: string, since: Date) =>
  ring.filter((e) => e.userId === userId && new Date(e.at) >= since);
