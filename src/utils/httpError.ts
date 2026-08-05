// File: httpError.ts
// Path: src/utils/httpError.ts

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
    Error.captureStackTrace?.(this, HttpError);
  }
}

export const ApiError = (statusCode: number, message: string) =>
  new HttpError(statusCode, message);
