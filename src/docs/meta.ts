// File: meta.ts
// Path: src/docs/meta.ts
//
// Labels on route middleware so the API docs can be generated from the router
// itself (src/docs/openapi.ts): which permission a route needs, what it
// validates, whether it takes a file. Labelling never changes behaviour.

import type { ZodType } from "zod";

export interface DocMeta {
  /** authenticateUser */
  auth?: boolean;
  /** authorize("clients.read") */
  perm?: string;
  superAdmin?: boolean;
  /** validateRequest({ body, query, params }) */
  schemas?: { body?: ZodType; query?: ZodType; params?: ZodType };
  /** singleFile: multipart field "file" */
  upload?: boolean;
  /** aiAccess("CANVAS") */
  ai?: string;
  /** enterprise console sign-in (authenticatePlatform), not the CRM's */
  platform?: boolean;
  /** engines only: X-Service-Key (authenticateService) */
  service?: boolean;
}

export const DOC = "__doc";

export const tag = <F extends object>(fn: F, meta: DocMeta): F => {
  const prev = (fn as Record<string, unknown>)[DOC] as DocMeta | undefined;
  Object.defineProperty(fn, DOC, { value: { ...prev, ...meta }, enumerable: false, configurable: true });
  return fn;
};

export const metaOf = (fn: unknown): DocMeta | undefined =>
  fn && (typeof fn === "function" || typeof fn === "object") ? ((fn as Record<string, unknown>)[DOC] as DocMeta | undefined) : undefined;
