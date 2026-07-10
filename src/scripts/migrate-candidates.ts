// File: migrate-candidates.ts
// Path: src/migration/migrate-candidates.ts
//
// Run AFTER migrate-requirements.ts --commit has completed. This depends on
// Requirement rows (matched by reqCode = Job ID) and User rows already
// existing — it does not create Users, Clients, or Requirements.
//
// Usage:
//   npx ts-node src/migration/migrate-candidates.ts ./Candidates_tagged_to_jobs.xlsx
//   npx ts-node src/migration/migrate-candidates.ts ./Candidates_tagged_to_jobs.xlsx --commit
//
// Decisions this script encodes (confirmed with Rahul):
//   - "Candidate ID" column IS the Candidate Service ID (candidates already
//     exist there via the resume ingestion pipeline) — no cross-service
//     lookup needed, used directly as candidateServiceId.
//   - Rows where Sourced By / Candidate Email / Job ID / Stage are ALL null
//     (6,532 of 97,832 in the real file) are skipped outright, not staged —
//     they're blank/orphaned rows, staging them individually is just noise.
//   - Stage/Substage -> CanonicalStage is a best-guess keyword mapping,
//     defined ONCE per distinct combination in stage-mapping.ts (not per
//     row) so you review ~40 lines instead of 97k.
//   - assignmentId is left null when no RequirementAssignment chain exists
//     for that (requirement, recruiter) pair — it's a nullable FK, this is
//     not a blocking condition, just noted in the summary.

import { PrismaClient, CanonicalStage } from "@prisma/client";
import * as XLSX from "xlsx";
import { extractSingleEmail } from "./parsers";
import { STAGE_MAPPING, stageKey } from "./stage-mapping";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");
const filePath = process.argv[2];
const CHUNK_SIZE = 50; // small concurrency batch, not fully sequential, not unbounded parallel

if (!filePath) {
  console.error(
    "Usage: ts-node migrate-candidates.ts <path-to-xlsx> [--commit]"
  );
  process.exit(1);
}

type Row = Record<string, any>;

async function main() {
  console.log(
    `Mode: ${COMMIT ? "COMMIT (writing to DB)" : "DRY RUN (no writes)"}`
  );

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

  // ── preload everything, once ────────────────────────────────────────
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

  const requirements = await prisma.requirement.findMany({
    select: { id: true, reqCode: true },
  });
  const requirementByReqCode = new Map(
    requirements.map((r) => [r.reqCode, r.id])
  );

  const stages = await prisma.pipelineStage.findMany({
    select: { id: true, canonicalStage: true, serviceLineId: true },
  });
  // Prefer the generic (serviceLineId null) stage row per canonical stage;
  // only 07A/07B are service-line-specific per your schema comment.
  const stageIdByCanonical = new Map<CanonicalStage, string>();
  for (const s of stages) {
    if (!s.canonicalStage) continue;
    if (s.serviceLineId === null || !stageIdByCanonical.has(s.canonicalStage)) {
      stageIdByCanonical.set(s.canonicalStage, s.id);
    }
  }

  const assignments = await prisma.requirementAssignment.findMany({
    select: { id: true, requirementId: true, assignedToId: true },
  });
  const assignmentByReqAndUser = new Map(
    assignments.map((a) => [`${a.requirementId}:${a.assignedToId}`, a.id])
  );

  const stagingRows: Array<{
    type: string;
    reason: string;
    payload: any;
    sourceRow: number;
  }> = [];

  const summary = {
    totalRows: rows.length,
    skippedBlankRow: 0,
    skippedRequirementNotFound: 0,
    skippedRecruiterNotFound: 0,
    skippedStageNotMapped: 0,
    snapshotsCreated: 0,
    pipelinesCreated: 0,
    pipelinesSkippedDuplicate: 0,
    assignmentIdMissing: 0,
  };

  // pre-fetch existing snapshots to avoid re-creating on re-run
  const existingSnapshots = new Set(
    (
      await prisma.candidateSnapshot.findMany({
        select: { candidateServiceId: true, requirementId: true },
      })
    ).map((s) => `${s.candidateServiceId}:${s.requirementId}`)
  );

  async function processRow(row: Row, sourceRow: number) {
    const candidateServiceId = String(row["Candidate ID"] ?? "").trim();
    const email = row["Candidate Email"]
      ? String(row["Candidate Email"]).trim()
      : null;
    const jobId = row["Job ID"] ? String(row["Job ID"]).trim() : null;
    const stageRaw = row["Candidate Current Stage"] ?? row["Stage"];
    const substageRaw = row["Candidate Current Substage"] ?? row["Substage"];

    if (!candidateServiceId && !email && !jobId && !stageRaw) {
      summary.skippedBlankRow++;
      return;
    }

    if (!jobId || !requirementByReqCode.has(jobId)) {
      summary.skippedRequirementNotFound++;
      stagingRows.push({
        type: "UNMAPPED_REQUIREMENT",
        reason: `Job ID ${
          jobId ?? "(none)"
        } has no matching Requirement (it may itself be staged from the requirements migration)`,
        payload: { candidateServiceId, jobId },
        sourceRow,
      });
      return;
    }
    const requirementId = requirementByReqCode.get(jobId)!;

    const recruiterEmail = extractSingleEmail(row["Sourced By"]);
    const recruiterId = recruiterEmail
      ? userByEmail.get(recruiterEmail)
      : undefined;
    if (!recruiterId) {
      summary.skippedRecruiterNotFound++;
      stagingRows.push({
        type: "UNMAPPED_RECRUITER",
        reason: `"Sourced By" email ${
          recruiterEmail ?? "(none found)"
        } has no matching User — pipeline row needs a recruiterId, skipped`,
        payload: {
          candidateServiceId,
          requirementId,
          sourcedByRaw: row["Sourced By"],
        },
        sourceRow,
      });
      return;
    }

    const mapping = STAGE_MAPPING[stageKey(stageRaw, substageRaw)];
    if (!mapping) {
      summary.skippedStageNotMapped++;
      stagingRows.push({
        type: "UNMAPPED_STAGE",
        reason: `No entry in stage-mapping.ts for Stage="${stageRaw}" Substage="${substageRaw}" — add it and re-run`,
        payload: {
          candidateServiceId,
          requirementId,
          stage: stageRaw,
          substage: substageRaw,
        },
        sourceRow,
      });
      return;
    }

    const currentStageId = stageIdByCanonical.get(mapping.canonicalStage);
    if (!currentStageId) {
      stagingRows.push({
        type: "PIPELINE_STAGE_NOT_SEEDED",
        reason: `CanonicalStage ${mapping.canonicalStage} has no matching PipelineStage row in your DB — seed it first`,
        payload: {
          candidateServiceId,
          requirementId,
          canonicalStage: mapping.canonicalStage,
        },
        sourceRow,
      });
      return;
    }

    const changedByEmail = extractSingleEmail(row["Changed By"]);
    const stageUpdatedById =
      (changedByEmail && userByEmail.get(changedByEmail)) || recruiterId;

    const assignmentId =
      assignmentByReqAndUser.get(`${requirementId}:${recruiterId}`) ?? null;
    if (!assignmentId) summary.assignmentIdMissing++;

    const snapKey = `${candidateServiceId}:${requirementId}`;
    if (existingSnapshots.has(snapKey)) {
      summary.pipelinesSkippedDuplicate++;
      return;
    }

    if (COMMIT) {
      const snapshot = await prisma.candidateSnapshot.create({
        data: {
          candidateServiceId,
          requirementId,
          fullName: String(row["Candidate Name"] ?? "Unknown"),
          email: email ?? "",
          phone: row["Candidate Mobile"]
            ? String(row["Candidate Mobile"])
            : null,
          currentTitle: row["Current Designation"]
            ? String(row["Current Designation"])
            : null,
          currentCompany: row["Current Organization"]
            ? String(row["Current Organization"])
            : null,
          topSkills: [],
          rawSnapshot: row as any,
          sourced: row["Primary Source"] ? String(row["Primary Source"]) : null,
          createdById: recruiterId,
        },
      });

      await prisma.requirementCandidatePipeline.create({
        data: {
          snapshotId: snapshot.id,
          requirementId,
          assignmentId,
          recruiterId,
          currentStageId,
          stageUpdatedById,
          disposition: mapping.disposition,
          dropReason: mapping.dropReason ?? null,
          isRejected: mapping.isRejected ?? false,
          isOnHold: mapping.isOnHold ?? false,
          isWithdrawn: mapping.isWithdrawn ?? false,
        },
      });
    }
    existingSnapshots.add(snapKey); // prevents dupes within this same run too
    summary.snapshotsCreated++;
    summary.pipelinesCreated++;
  }

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map((row, j) => processRow(row, i + j + 2)));
    if (i % 5000 === 0) console.log(`...processed ${i}/${rows.length}`);
  }

  if (COMMIT && stagingRows.length > 0) {
    await prisma.migrationStaging.createMany({
      data: stagingRows.map((s) => ({
        type: s.type as any,
        reason: s.reason,
        payload: s.payload,
        sourceRow: s.sourceRow,
      })),
    });
  }

  console.log("\n── Summary ──────────────────────────");
  console.log(summary);
  console.log(
    `Staging rows ${COMMIT ? "written" : "that WOULD be written"}: ${
      stagingRows.length
    }`
  );
  if (!COMMIT)
    console.log(
      "\nDry run — nothing was written. Re-run with --commit once this looks right."
    );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
