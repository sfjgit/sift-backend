// File: httpError.ts
// Path: src/utils/httpError.ts
//
// Throw from any handler — the error middleware in server.ts turns it into
// { success: false, message, code? } with the given status.

export class HttpError extends Error {
  statusCode: number;
  code: string | undefined;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "HttpError";
    Error.captureStackTrace?.(this, HttpError);
  }
}

export const ApiError = (statusCode: number, message: string, code?: string) =>
  new HttpError(statusCode, message, code);

export const notFound = (what: string) =>
  new HttpError(404, `${what} not found`, "NOT_FOUND");
