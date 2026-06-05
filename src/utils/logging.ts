// =============================================================================
// logger.ts
// Structured logger — same signature everywhere, better terminal output.
// Usage: import { log } from '@/utils/logger';
// =============================================================================

import { config } from "dotenv";

// import { env } from '@/config/env';

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  // levels
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red

  // meta keys
  key: "\x1b[90m", // grey
  str: "\x1b[32m", // green
  num: "\x1b[35m", // magenta
  bool: "\x1b[34m", // blue
  nil: "\x1b[90m", // grey
};

config();

const isProd = process.env.NODE_ENV === "production";

// ── Pretty-print a value (recursive) ─────────────────────────────────────────

function colorValue(val: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  const padIn = "  ".repeat(indent + 1);

  if (val === null || val === undefined) {
    return `${COLORS.nil}${val}${COLORS.reset}`;
  }

  if (typeof val === "string") {
    return `${COLORS.str}"${val}"${COLORS.reset}`;
  }

  if (typeof val === "number") {
    return `${COLORS.num}${val}${COLORS.reset}`;
  }

  if (typeof val === "boolean") {
    return `${COLORS.bool}${val}${COLORS.reset}`;
  }

  if (Array.isArray(val)) {
    if (val.length === 0) return `${COLORS.dim}[]${COLORS.reset}`;
    const items = val
      .map((v) => `${padIn}${colorValue(v, indent + 1)}`)
      .join(",\n");
    return `[\n${items}\n${pad}]`;
  }

  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return `${COLORS.dim}{}${COLORS.reset}`;
    const lines = entries.map(
      ([k, v]) =>
        `${padIn}${COLORS.key}${k}${COLORS.reset}: ${colorValue(v, indent + 1)}`
    );
    return `{\n${lines.join(",\n")}\n${pad}}`;
  }

  return String(val);
}

// ── Core log function ─────────────────────────────────────────────────────────

export const log = (
  level: "info" | "warn" | "error",
  msg: string,
  meta?: object,
  svc = "app"
): void => {
  // ── PRODUCTION: structured JSON (for Cloud Logging / Datadog / etc.) ───────
  if (isProd) {
    const entry = {
      ts: new Date().toISOString(),
      svc,
      level,
      msg,
      ...(meta ?? {}),
    };
    level === "error"
      ? console.error(JSON.stringify(entry))
      : console.log(JSON.stringify(entry));
    return;
  }

  // ── DEV: pretty terminal output ────────────────────────────────────────────
  const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
  const levelColor = COLORS[level];
  const levelTag = `${levelColor}${COLORS.bold}[${level
    .toUpperCase()
    .padEnd(5)}]${COLORS.reset}`;
  const svcTag = `${COLORS.dim}[${svc}]${COLORS.reset}`;
  const tsTag = `${COLORS.dim}${ts}${COLORS.reset}`;
  const msgStr = `${COLORS.bold}${msg}${COLORS.reset}`;

  const header = `${tsTag} ${levelTag} ${svcTag} ${msgStr}`;

  if (!meta || Object.keys(meta).length === 0) {
    console[level === "error" ? "error" : "log"](header);
    return;
  }

  const metaStr = colorValue(meta, 0);
  console[level === "error" ? "error" : "log"](`${header}\n${metaStr}\n`);
};

// ── Service-scoped factory — replaces the inline log() in each file ───────────
// Usage:
//   import { createLogger } from '@/utils/logger';
//   const log = createLogger('resume-parser');
//   log('info', 'AI parse started', { email });

export const createLogger =
  (svc: string) =>
  (level: "info" | "warn" | "error", msg: string, meta?: object) =>
    log(level, msg, meta, svc);
