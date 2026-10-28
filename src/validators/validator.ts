import { Request, Response, NextFunction } from "express";
import { z, ZodSchema, ZodError } from "zod";


interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export const validateRequest = (schemas: ValidationSchemas) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.validatedBody = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.validatedQuery = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.validatedParams = schemas.params.parse(req.params);
      }
      return next();
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        const formatted = (error as ZodError<any>).issues.map((issue) => ({
          field: issue.path?.[0]?.toString() || "unknown",
          message: issue.message,
          code: issue.code,
        }));

        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: formatted,
          timestamp: new Date().toISOString(),
        });
      }
      console.error("Validation middleware error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error during validation",
        timestamp: new Date().toISOString(),
      });
    }
  };
};

export const validateBody = (schema: ZodSchema) =>
  validateRequest({ body: schema });
export const validateQuery = (schema: ZodSchema) =>
  validateRequest({ query: schema });
export const validateParams = (schema: ZodSchema) =>
  validateRequest({ params: schema });

export const validate = {
    body: validateBody,
    params: validateParams,
    query: validateQuery,
    request: validateRequest
}

// ── shared schemas ───────────────────────────────────────────────────────────

export const idParams = z.object({ id: z.string().uuid("Invalid id") });

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

// "" → null so clearing a form field clears the column
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const optionalId = z.string().uuid().nullable().optional();

// "a,b,c" (or a repeated param) → string[] — multi-select list filters
export const csv = <T extends z.ZodTypeAny>(item: T) =>
  z
    .preprocess(
      (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",").filter(Boolean) : v),
      z.array(item).max(100),
    )
    .optional();
export const csvIds = csv(z.string().trim().uuid());
