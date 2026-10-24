// src/middleware/httpLogger.ts
import morgan from "morgan";
import type { Request } from "express";
import { loggers } from "../utils/logger";
import chalk from "chalk";

// Custom token for response time with color
morgan.token("response-time-colored", (req, res) => {
  const responseTime = parseFloat(
    (morgan as unknown as Record<string, morgan.TokenCallbackFn>)["response-time"]!(req, res) || "0",
  );
  if (responseTime > 1000) return chalk.red(`${responseTime}ms`);
  if (responseTime > 500) return chalk.yellow(`${responseTime}ms`);
  return chalk.green(`${responseTime}ms`);
});

// Custom token for status code with color
morgan.token("status-colored", (req, res) => {
  const status = res.statusCode;
  if (status >= 500) return chalk.red.bold(status);
  if (status >= 400) return chalk.red(status);
  if (status >= 300) return chalk.yellow(status);
  return chalk.green(status);
});

// Custom token for method with color
morgan.token("method-colored", (req) => {
  const method = req.method;
  const colors = {
    GET: chalk.green,
    POST: chalk.blue,
    PUT: chalk.yellow,
    DELETE: chalk.red,
    PATCH: chalk.magenta,
    OPTIONS: chalk.cyan,
  };
  return (colors[method as keyof typeof colors] || chalk.white)(method);
});

// Custom token for URL with truncation
morgan.token<Request>("url-truncated", (req) => {
  const url = req.originalUrl || req.url;
  return url.length > 60 ? `${url.substring(0, 57)}...` : url;
});

// Custom format string
const formatString =
  ":method-colored :url-truncated :status-colored :response-time-colored - :res[content-length] bytes";

// Create the HTTP logger middleware
export const httpLogger = morgan(formatString, {
  stream: {
    write: (message: string) => {
      // Remove the newline character that morgan adds
      const cleanMessage = message.trim();
      // Use our custom logger to output the HTTP log
      console.log(
        `${chalk.gray(
          new Date().toISOString().replace("T", " ").substring(0, 19)
        )} [${chalk.green.bold("HTTP")}] ${cleanMessage}`
      );
    },
  },
  skip: (req, res) => {
    // Skip logging for health check endpoints to reduce noise
    return req.url === "/health" || req.url === "/favicon.ico";
  },
});

// Error logging middleware
export const errorLogger = (err: any, req: any, res: any, next: any) => {
  loggers.api.error(
    req.method,
    req.originalUrl || req.url,
    err,
    res.statusCode
  );
  next(err);
};

// Request start time middleware (for custom timing)
export const requestTimer = (req: any, res: any, next: any) => {
  req.startTime = Date.now();

  // Log the incoming request
  loggers.api.request(req.method, req.originalUrl || req.url, req.ip);

  // Override res.end to log the response
  const originalEnd = res.end;
  res.end = function (...args: any[]) {
    const responseTime = Date.now() - req.startTime;
    loggers.api.response(
      req.method,
      req.originalUrl || req.url,
      res.statusCode,
      `${responseTime}ms`
    );
    originalEnd.apply(this, args);
  };

  next();
};
