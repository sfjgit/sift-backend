import dotenv from "dotenv";
import app from "./server";
import prisma from "./utils/prisma/client";
import { startBreachChecker } from "./cron/breachChecker";
import { startAssignmentDeadlineChecker } from "./cron/assignmentDeadlineChecker";

dotenv.config();

const PORT = process.env.PORT || 3001;

// kjjkjk
async function startServer() {
  try {
    await prisma.$connect();
    console.log("✅ Connected to PostgreSQL via Prisma==============");

    // start crons
    startBreachChecker();
    startAssignmentDeadlineChecker();

    app.listen(PORT, () => {
      console.log(
        `🚀 Auth service  ==================================== on http://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error("❌ Failed to connect to DB:", error);
    process.exit(1); // Exit with failure
  }
}

startServer();
