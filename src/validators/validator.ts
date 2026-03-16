import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod"
import { ZodError } from "zod"


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