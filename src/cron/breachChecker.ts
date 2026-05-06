// cron/breachChecker.ts
import cron from "node-cron";
import prisma from "@/utils/prisma/client";

// runs every day at midnight
export function startBreachChecker() {
  cron.schedule("0 0 * * *", async () => {
    console.log("[CRON] Running breach checker...");
    const now = new Date();

    try {
      // ── respondBy breach ──────────────────────────────────────────────────
      await prisma.requirement.updateMany({
        where: {
          deletedAt: null,
          status: { in: ["DRAFT", "PENDING_APPROVAL", "ACTIVE"] },
          respondBy: { lt: now },
          isRespondByBreached: false,
        },
        data: { isRespondByBreached: true },
      });

      // ── turnaround breach ─────────────────────────────────────────────────
      // turnaroundDays from createdAt
      const activeReqs = await prisma.requirement.findMany({
        where: {
          deletedAt: null,
          status: { in: ["DRAFT", "PENDING_APPROVAL", "ACTIVE"] },
          isTurnaroundBreached: false,
          turnaroundDays: { not: null },
        },
        select: {
          id: true,
          createdAt: true,
          turnaroundDays: true,
        },
      });

      const breachedTurnaroundIds = activeReqs
        .filter((r) => {
          const deadline = new Date(r.createdAt);
          deadline.setDate(deadline.getDate() + r.turnaroundDays!);
          return deadline < now;
        })
        .map((r) => r.id);

      if (breachedTurnaroundIds.length > 0) {
        await prisma.requirement.updateMany({
          where: { id: { in: breachedTurnaroundIds } },
          data: { isTurnaroundBreached: true },
        });
      }

      console.log(
        `[CRON] Breach check done. respondBy + turnaround flags updated.`
      );
    } catch (err) {
      console.error("[CRON] Breach checker error:", err);
    }
  });
}
