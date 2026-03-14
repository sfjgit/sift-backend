
import dotenv from "dotenv";
import app from "./server";
import prisma from "./utils/prisma/client";

dotenv.config();

const PORT = process.env.PORT || 3001;


// Health check before starting server
async function startServer() {
  try {
    await prisma.$connect();
    console.log("✅ Connected to PostgreSQL via Prisma==============");

    app.listen(PORT, () => {
      console.log(`🚀 Auth service running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to connect to DB:", error);
    process.exit(1); // Exit with failure
  }
}

startServer();
