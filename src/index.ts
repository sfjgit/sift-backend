import dotenv from "dotenv";
import app from "./server";
import prisma from "./utils/prisma/client";
import { startReconciler } from "./services/pipeline/reconciler.service";

dotenv.config();

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    await prisma.$connect();
    console.log("✅ Connected to PostgreSQL via Prisma");

    app.listen(PORT, () => {
      console.log(
        `🚀 CRM core service on http://localhost:${PORT}`
      );
      startReconciler();
    });
  } catch (error) {
    console.error("❌ Failed to connect to DB:", error);
    process.exit(1); // Exit with failure
  }
}

startServer();
