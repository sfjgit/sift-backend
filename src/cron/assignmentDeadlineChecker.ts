// cron/assignmentDeadlineChecker.ts
import cron from "node-cron";
import prisma from "@/utils/prisma/client";

// runs every day at 8am
export function startAssignmentDeadlineChecker() {
  cron.schedule("0 8 * * *", async () => {
    console.log("[CRON] Running assignment deadline checker...");
    const now = new Date();

    // reminder threshold — 2 days before deadline
    const reminderThreshold = new Date();
    reminderThreshold.setDate(reminderThreshold.getDate() + 2);

    try {
      // ── breach — deadline passed, not yet flagged ─────────────────────────
      const breached = await prisma.requirementAssignment.findMany({
        where: {
          status: "ACTIVE",
          deadline: { lt: now },
          breachedAt: null,
        },
        select: {
          id: true,
          requirementId: true,
          assignedToId: true,
          deadline: true,
        },
      });

      for (const a of breached) {
        await prisma.$transaction([
          prisma.requirementAssignment.update({
            where: { id: a.id },
            data: { breachedAt: now, deadlineMet: false },
          }),
          prisma.notification.create({
            data: {
              userId: a.assignedToId,
              type: "DEADLINE_BREACHED",
              title: "Assignment deadline breached",
              body: `Your assignment deadline has passed`,
              referenceId: a.id,
              referenceType: "ASSIGNMENT",
            },
          }),
        ]);
      }

      // ── reminder — deadline approaching, reminder not sent yet ───────────
      const upcoming = await prisma.requirementAssignment.findMany({
        where: {
          status: "ACTIVE",
          deadline: { gte: now, lte: reminderThreshold },
          reminderSentAt: null,
          breachedAt: null,
        },
        select: {
          id: true,
          requirementId: true,
          assignedToId: true,
          deadline: true,
        },
      });

      for (const a of upcoming) {
        await prisma.$transaction([
          prisma.requirementAssignment.update({
            where: { id: a.id },
            data: { reminderSentAt: now },
          }),
          prisma.notification.create({
            data: {
              userId: a.assignedToId,
              type: "DEADLINE_REMINDER",
              title: "Assignment deadline approaching",
              body: `Your assignment deadline is on ${a.deadline?.toDateString()}`,
              referenceId: a.id,
              referenceType: "ASSIGNMENT",
            },
          }),
        ]);
      }

      console.log(
        `[CRON] Assignment deadline check done. Breached: ${breached.length}, Reminders: ${upcoming.length}`
      );
    } catch (err) {
      console.error("[CRON] Assignment deadline checker error:", err);
    }
  });
}
