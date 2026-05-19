// src/server.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { loggers } from "./utils/logger";
import { httpLogger, errorLogger, requestTimer } from "./middleware/httpLogger";
import router from "./routes";

dotenv.config();

const app = express();

// Trust proxy for accurate IP addresses
app.set("trust proxy", 1);

// // Add request timing and logging
app.use(requestTimer);

// // CORS setup (restrict to allowed origins)
const allowedOrigins = [
  "http://localhost:3000",
  "https://34.31.219.197:8445",
  "http://10.199.101.187:3000",
  "http://10.199.101.187:3001",
  "http://10.199.101.187:3002",
  "http://10.199.101.187:3003",
  "http://10.199.101.187:3004",

  "http://10.199.100.100:3000",
  "http://10.199.100.100:3001",
  "http://10.199.100.100:3002",

  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "https://ats-alpha-olive.vercel.app",
  "https://ats-frontend-rose.vercel.app",
];

app.use(cookieParser());
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        typeof origin === "string" &&
        origin.startsWith("chrome-extension://")
      ) {
        return callback(null, true);
      }
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      loggers.warn(`CORS blocked request from origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// Helmet - sets various HTTP headers for security
// app.use(helmet());

// // Rate limiter middleware with logging
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 100000, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    loggers.warn(
      `Rate limit exceeded for IP: ${req.ip} on ${req.method} ${req.originalUrl}`
    );
    res.status(429).json({
      success: false,
      message: "Too many requests from this IP, please try again later.",
    });
  },
});
app.use(limiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  express.json({
    limit: "600mb",
    verify: (req, res, buf) => {
      const bodyStr = buf.toString().trim();
      if (!bodyStr) return; // ✅ skip empty body (no error)
      try {
        JSON.parse(bodyStr);
      } catch (err) {
        loggers.error("❌ Invalid JSON in request body", err);
        throw new Error("Invalid JSON");
      }
    },
  })
);

// HTTP request logging
app.use(httpLogger);

// Optional: hide Express info
app.disable("x-powered-by");

// Routes
app.use(
  "/api",
  (_req, res, next) => {
    loggers.info("Root route accessed");
    next();
  },
  router
);

app.get("/", (_req, res) => {
  console.log("Root route accessed=============================");
  loggers.info("Root route accessed");
  res.json({
    success: true,
    message: "Auth server is running=====================",
    timestamp: new Date().toISOString(),
  });
});

// Health check route
app.get("/health", (_req, res) => {
  loggers.info("Health check accessed");
  res.json({
    success: true,
    message: "Auth server is running",
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res) => {
  loggers.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

// Error handling middleware (should be last)
app.use(errorLogger);
app.use((err: any, req: any, res: any, next: any) => {
  loggers.error("Unhandled application error", err);

  res.status(err.status || 500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

// Graceful shutdown handling
const gracefulShutdown = () => {
  loggers.server.shutdown();
  process.exit(0);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Uncaught exception handler
process.on("uncaughtException", (err) => {
  loggers.server.error(err);
  process.exit(1);
});

// Unhandled promise rejection handler
process.on("unhandledRejection", (reason, promise) => {
  loggers.error("Unhandled Promise Rejection", new Error(String(reason)));
  process.exit(1);
});

export default app;
