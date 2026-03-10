// src/utils/logger.ts
import winston from "winston";
import chalk from "chalk";

// Custom format for console output with colors
const colorFormat = winston.format.printf(
  ({ level, message, timestamp, ...meta }) => {
    const colors = {
      error: chalk.red.bold,
      warn: chalk.yellow.bold,
      info: chalk.blue.bold,
      http: chalk.green.bold,
      debug: chalk.magenta.bold,
    };

    const colorize = colors[level as keyof typeof colors] || chalk.white;
    const levelColored = colorize(level.toUpperCase());
    const timestampColored = chalk.gray(timestamp);

    let logMessage = `${timestampColored} [${levelColored}] ${message}`;

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      logMessage += chalk.cyan(`\n${JSON.stringify(meta, null, 2)}`);
    }

    return logMessage;
  }
);

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    colorFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: false }), // We handle colors ourselves
        colorFormat
      ),
    }),
  ],
});

// Custom methods for different log types
export const loggers = {
  // API related logs
  api: {
    request: (method: string, url: string, ip: string) => {
      logger.http(
        `${chalk.green("→")} ${method} ${url} from ${chalk.cyan(ip)}`
      );
    },
    response: (
      method: string,
      url: string,
      statusCode: number,
      responseTime: string
    ) => {
      const statusColor =
        statusCode >= 400
          ? chalk.red
          : statusCode >= 300
          ? chalk.yellow
          : chalk.green;
      logger.http(
        `${chalk.blue("←")} ${method} ${url} ${statusColor(
          statusCode
        )} ${chalk.gray(responseTime)}`
      );
    },
    error: (method: string, url: string, error: Error, statusCode?: number) => {
      logger.error(`${chalk.red("✗")} ${method} ${url} ${statusCode || 500}`, {
        error: error.message,
        stack: error.stack,
      });
    },
  },

  // Server events
  server: {
    start: (port: number | string) => {
      logger.info(
        `${chalk.green("🚀")} Server running on port ${chalk.bold(port)}`
      );
    },
    shutdown: () => {
      logger.info(`${chalk.yellow("⏹️")} Server shutting down...`);
    },
    error: (error: Error) => {
      logger.error(`${chalk.red("💥")} Server error`, {
        error: error.message,
        stack: error.stack,
      });
    },
  },

  // Database logs
  db: {
    connect: (dbName?: string) => {
      logger.info(
        `${chalk.green("🗄️")} Database connected${
          dbName ? ` to ${dbName}` : ""
        }`
      );
    },
    error: (error: Error, operation?: string) => {
      logger.error(
        `${chalk.red("🗄️")} Database error${
          operation ? ` in ${operation}` : ""
        }`,
        {
          error: error.message,
          stack: error.stack,
        }
      );
    },
    query: (query: string, duration?: number) => {
      logger.debug(
        `${chalk.blue("🔍")} DB Query: ${query}${
          duration ? ` (${duration}ms)` : ""
        }`
      );
    },
  },

  // Auth logs
  auth: {
    login: (userId: string, ip: string) => {
      logger.info(`${chalk.green("🔑")} User login: ${userId} from ${ip}`);
    },
    logout: (userId: string) => {
      logger.info(`${chalk.blue("🔓")} User logout: ${userId}`);
    },
    failed: (email: string, ip: string, reason: string) => {
      logger.warn(
        `${chalk.yellow("🚫")} Login failed: ${email} from ${ip} - ${reason}`
      );
    },
  },

  // General purpose logs
  info: (message: string, meta?: any) => {
    logger.info(`${chalk.blue("ℹ️")} ${message}`, meta);
  },
  warn: (message: string, meta?: any) => {
    logger.warn(`${chalk.yellow("⚠️")} ${message}`, meta);
  },
  error: (message: string, error?: Error | any) => {
    if (error instanceof Error) {
      logger.error(`${chalk.red("❌")} ${message}`, {
        error: error.message,
        stack: error.stack,
      });
    } else {
      logger.error(`${chalk.red("❌")} ${message}`, error);
    }
  },
  debug: (message: string, meta?: any) => {
    logger.debug(`${chalk.magenta("🐛")} ${message}`, meta);
  },
};

export default logger;
