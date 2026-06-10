// File: backfill-pipeline-assignment-id.ts
// Path: src/scripts/backfill-pipeline-assignment-id.ts
//
// RUN: npx ts-node -r tsconfig-paths/register src/scripts/backfill-pipeline-assignment-id.ts
//
// WHAT IT DOES:
// For every RequirementCandidatePipeline row where assignmentId IS NULL:
//   1. Look up the recruiter's active (or most recent) RequirementAssignment
//      for that same requirementId.
//   2. If found → set assignmentId on the pipeline row.
//   3. If not found → leave as null (logged for review).
//
// SAFE TO RE-RUN: only touches rows where assignmentId IS NULL.
// ─────────────────────────────────────────────────────────────────────────────

import prisma from "@/utils/prisma/client";

async function main() {
  console.log("Starting pipeline → assignment backfill...\n");

  // ── 1. Fetch all pipeline rows with null assignmentId ─────────────────────
  const unlinked = await prisma.requirementCandidatePipeline.findMany({
    where: { assignmentId: null },
    select: {
      id: true,
      requirementId: true,
      recruiterId: true,
    },
  });

  console.log(`Found ${unlinked.length} pipeline rows with no assignmentId.\n`);

  if (unlinked.length === 0) {
    console.log("Nothing to backfill. All pipeline rows are already linked.");
    return;
  }

  let linked = 0;
  let skipped = 0;
  let notFound = 0;

  // ── 2. For each unlinked row, find the matching assignment ────────────────
  for (const pipeline of unlinked) {
    // First try: active assignment for this recruiter on this requirement
    let assignment = await prisma.requirementAssignment.findFirst({
      where: {
        requirementId: pipeline.requirementId,
        assignedToId: pipeline.recruiterId,
        status: "ACTIVE",
      },
      select: { id: true },
      orderBy: { assignedAt: "desc" }, // most recent if multiple
    });

    // Second try: any assignment (ACTIVE, FILLED, REMOVED) — pick most recent
    if (!assignment) {
      assignment = await prisma.requirementAssignment.findFirst({
        where: {
          requirementId: pipeline.requirementId,
          assignedToId: pipeline.recruiterId,
        },
        select: { id: true },
        orderBy: { assignedAt: "desc" },
      });
    }

    if (assignment) {
      await prisma.requirementCandidatePipeline.update({
        where: { id: pipeline.id },
        data: { assignmentId: assignment.id },
      });
      linked++;
      if (linked % 50 === 0) {
        console.log(`  Linked ${linked}/${unlinked.length}...`);
      }
    } else {
      // No assignment found for this recruiter+requirement combo
      // This means the recruiter pushed a candidate without being assigned
      // Log it — don't fail
      console.warn(
        `  [NO ASSIGNMENT] pipeline=${pipeline.id} ` +
          `req=${pipeline.requirementId} recruiter=${pipeline.recruiterId}`
      );
      notFound++;
    }
  }

  console.log("\n─── Backfill complete ───────────────────────────────────");
  console.log(`  Linked:    ${linked}`);
  console.log(
    `  Not found: ${notFound} (recruiter had no assignment — review manually)`
  );
  console.log(`  Skipped:   ${skipped}`);
  console.log("──────────────────────────────────────────────────────────\n");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
