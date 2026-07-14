// File: migrate-candidates.ts
// Path: src/scripts/migrate-candidates.ts
//
// Run AFTER migrate-requirements.ts --commit. Reads the legacy candidate
// export and creates CandidateSnapshot + RequirementCandidatePipeline rows.
//
// SAFE BY DEFAULT: dry run unless --commit.
//
// Usage:
//   npx tsx src/scripts/migrate-candidates.ts src/scripts/data/Candidates_tagged_to_jobs.xlsx
//   npx tsx src/scripts/migrate-candidates.ts src/scripts/data/Candidates_tagged_to_jobs.xlsx --commit
//
// PERFORMANCE: instead of 90k+ sequential create() calls (hours on a remote
// DB), this runs in phases:
//   Phase 1 (prepare): one sequential in-memory pass over all rows. Resolves
//     requirement, recruiter (auto-creating the handful of missing users),
//     assignment (auto-creating flat fallbacks — only ~400 writes), stage
//     mapping. Produces a clean list of records to insert. All the auto-
//     create writes here are few and deduped.
//   Phase 2 (bulk snapshots): createMany in chunks of 1000, skipDuplicates
//     (safe re-runs via @@unique([candidateServiceId, requirementId])).
//   Phase 3 (map ids): one query to fetch snapshot ids back.
//   Phase 4 (bulk pipelines): createMany in chunks of 1000. Existing
//     pipelines (snapshotId is @unique) are excluded beforehand.
// Total DB round-trips: ~200 instead of ~180,000. Minutes, not hours.
//
// Decisions encoded (confirmed with Rahul):
//   - "Candidate ID" column IS the Candidate Service ID.
//   - Fully-blank rows skipped outright.
//   - Stage/Substage -> CanonicalStage via stage-mapping.ts.
//   - Missing "Sourced By" user -> auto-created (pass@123, role MIGRATED,
//     flagged USER_AUTO_CREATED).
//   - Missing assignment -> flat depth-0 from requirement creator to
//     recruiter + UserAssignableTo edge, flagged FLAT_FALLBACK_ASSIGNMENT
//     (approximation: real assigner chain unknown in legacy data).

import { PrismaClient, CanonicalStage, Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs"; // change to "bcrypt" if that's what your project uses
import * as XLSX from "xlsx";
import { extractSingleEmail, extractNameEmailPairs } from "./parsers";
import { STAGE_MAPPING, stageKey } from "./stage-mapping";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");
const filePath = process.argv[2];
const CHUNK = 1000;

if (!filePath) {
  console.error("Usage: tsx migrate-candidates.ts <path-to-xlsx> [--commit]");
  process.exit(1);
}

type Row = Record<string, any>;
type UserLite = { id: string; email: string };

async function main() {
  console.log(
    `Mode: ${COMMIT ? "COMMIT (writing to DB)" : "DRY RUN (no writes)"}`
  );

  const defaultPasswordHash = await bcrypt.hash("pass@123", 10);

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

  // ── preload ──────────────────────────────────────────────────────────
  const users: UserLite[] = await prisma.user.findMany({
    select: { id: true, email: true },
  });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  const requirements = await prisma.requirement.findMany({
    select: { id: true, reqCode: true, createdById: true },
  });
  const requirementByReqCode = new Map(requirements.map((r) => [r.reqCode, r]));

  const stages = await prisma.pipelineStage.findMany({
    select: { id: true, canonicalStage: true, serviceLineId: true },
  });
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

  const assignableEdges = await prisma.userAssignableTo.findMany({
    select: { userId: true, targetId: true },
  });
  const assignableByUser = new Map<string, Set<string>>();
  for (const e of assignableEdges) {
    if (!assignableByUser.has(e.userId))
      assignableByUser.set(e.userId, new Set());
    assignableByUser.get(e.userId)!.add(e.targetId);
  }

  let migratedRole = await prisma.role.findFirst({
    where: { name: { equals: "MIGRATED", mode: "insensitive" } },
    select: { id: true },
  });
  if (!migratedRole) {
    if (COMMIT) {
      migratedRole = await prisma.role.create({
        data: {
          name: "MIGRATED",
          description: "Auto-created during legacy data migration.",
          isSystem: false,
        },
        select: { id: true },
      });
      console.log('[setup] Role "MIGRATED" created.');
    } else {
      migratedRole = { id: "DRY-RUN-ROLE:MIGRATED" };
    }
  }

  const existingSnapshotKeys = new Set(
    (
      await prisma.candidateSnapshot.findMany({
        select: { candidateServiceId: true, requirementId: true },
      })
    ).map((s) => `${s.candidateServiceId}:${s.requirementId}`)
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
    skippedStageNotMapped: 0,
    skippedNoParseableRecruiter: 0,
    skippedStageNotSeeded: 0,
    usersAutoCreated: 0,
    assignmentsAutoCreated: 0,
    assignableEdgesAutoCreated: 0,
    snapshotsCreated: 0,
    pipelinesCreated: 0,
    pipelinesSkippedDuplicate: 0,
  };

  let dryRunSeq = 0;

  async function findOrCreateUser(
    email: string,
    name: string,
    sourceRow: number,
    context: string
  ): Promise<UserLite> {
    const existing = userByEmail.get(email);
    if (existing) return existing;

    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || email.split("@")[0];
    const lastName = nameParts.slice(1).join(" ") || "-";

    let created: UserLite;
    if (COMMIT) {
      created = await prisma.user.create({
        data: {
          email,
          passwordHash: defaultPasswordHash,
          firstName,
          lastName,
          displayName: name.trim() || undefined,
          roleId: migratedRole!.id,
          isActive: true,
        },
        select: { id: true, email: true },
      });
    } else {
      created = { id: `DRY-RUN-USER:${++dryRunSeq}:${email}`, email };
    }

    userByEmail.set(email, created);
    summary.usersAutoCreated++;
    stagingRows.push({
      type: "USER_AUTO_CREATED",
      reason: `User ${email} (${name}) did not exist — auto-created during candidate migration (${context}). Role=MIGRATED, password pass@123. Review: set proper role, reporting line, BU.`,
      payload: { email, name, userId: created.id, context },
      sourceRow,
    });
    return created;
  }

  async function findOrCreateAssignment(
    requirementId: string,
    requirementCreatorId: string,
    recruiterId: string,
    reqCode: string,
    recruiterEmail: string,
    sourceRow: number
  ): Promise<string> {
    const key = `${requirementId}:${recruiterId}`;
    const existing = assignmentByReqAndUser.get(key);
    if (existing) return existing;

    let assignmentId: string;
    if (COMMIT) {
      const created = await prisma.requirementAssignment.create({
        data: {
          requirementId,
          assignedToId: recruiterId,
          assignedById: requirementCreatorId,
          depth: 0,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      assignmentId = created.id;

      const already = assignableByUser
        .get(requirementCreatorId)
        ?.has(recruiterId);
      if (!already && requirementCreatorId !== recruiterId) {
        await prisma.userAssignableTo.upsert({
          where: {
            userId_targetId: {
              userId: requirementCreatorId,
              targetId: recruiterId,
            },
          },
          update: {},
          create: {
            userId: requirementCreatorId,
            targetId: recruiterId,
            addedById: requirementCreatorId,
          },
        });
        if (!assignableByUser.has(requirementCreatorId))
          assignableByUser.set(requirementCreatorId, new Set());
        assignableByUser.get(requirementCreatorId)!.add(recruiterId);
        summary.assignableEdgesAutoCreated++;
      }
    } else {
      assignmentId = `DRY-RUN-ASSIGNMENT:${++dryRunSeq}`;
      const already = assignableByUser
        .get(requirementCreatorId)
        ?.has(recruiterId);
      if (!already && requirementCreatorId !== recruiterId) {
        if (!assignableByUser.has(requirementCreatorId))
          assignableByUser.set(requirementCreatorId, new Set());
        assignableByUser.get(requirementCreatorId)!.add(recruiterId);
        summary.assignableEdgesAutoCreated++;
      }
    }

    assignmentByReqAndUser.set(key, assignmentId);
    summary.assignmentsAutoCreated++;
    stagingRows.push({
      type: "FLAT_FALLBACK_ASSIGNMENT",
      reason: `Recruiter ${recruiterEmail} sourced candidates on ${reqCode} but had no assignment — flat depth-0 assignment created from requirement creator (approximation: real assigner chain unknown in legacy data)`,
      payload: {
        reqCode,
        requirementId,
        recruiterId,
        recruiterEmail,
        assignedById: requirementCreatorId,
        assignmentId,
      },
      sourceRow,
    });
    return assignmentId;
  }

  // ════════════════════════════════════════════════════════════════════
  // PHASE 1 — PREPARE (in-memory; only auto-create writes hit the DB)
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[phase 1/4] preparing rows (in-memory resolution)...");
  const startTime = Date.now();

  type PreparedRecord = {
    snapshot: Prisma.CandidateSnapshotCreateManyInput;
    pipeline: Omit<
      Prisma.RequirementCandidatePipelineCreateManyInput,
      "snapshotId"
    >;
    snapKey: string;
  };
  const prepared: PreparedRecord[] = [];
  const seenSnapKeysThisRun = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % 10000 === 0) {
      console.log(`[phase 1/4] resolved ${i}/${rows.length}...`);
    }

    const row = rows[i];
    const sourceRow = i + 2;

    const candidateServiceId = String(row["Candidate ID"] ?? "").trim();
    const email = row["Candidate Email"]
      ? String(row["Candidate Email"]).trim()
      : null;
    const jobId = row["Job ID"] ? String(row["Job ID"]).trim() : null;
    const stageRaw = row["Candidate Current Stage"] ?? row["Stage"];
    const substageRaw = row["Candidate Current Substage"] ?? row["Substage"];

    if (!candidateServiceId && !email && !jobId && !stageRaw) {
      summary.skippedBlankRow++;
      continue;
    }

    const requirement = jobId ? requirementByReqCode.get(jobId) : undefined;
    if (!requirement) {
      summary.skippedRequirementNotFound++;
      stagingRows.push({
        type: "UNMAPPED_REQUIREMENT",
        reason: `Job ID ${jobId ?? "(none)"} has no matching Requirement`,
        payload: { candidateServiceId, jobId },
        sourceRow,
      });
      continue;
    }

    const recruiterPairs = extractNameEmailPairs(row["Sourced By"]);
    if (recruiterPairs.length === 0) {
      summary.skippedNoParseableRecruiter++;
      stagingRows.push({
        type: "UNMAPPED_RECRUITER",
        reason: `Could not parse any email from "Sourced By" cell — pipeline needs a recruiterId, skipped`,
        payload: {
          candidateServiceId,
          requirementId: requirement.id,
          sourcedByRaw: row["Sourced By"],
        },
        sourceRow,
      });
      continue;
    }
    const recruiter = await findOrCreateUser(
      recruiterPairs[0].email,
      recruiterPairs[0].name,
      sourceRow,
      `sourced candidate ${candidateServiceId} on ${jobId}`
    );

    const mapping = STAGE_MAPPING[stageKey(stageRaw, substageRaw)];
    if (!mapping) {
      summary.skippedStageNotMapped++;
      stagingRows.push({
        type: "UNMAPPED_STAGE",
        reason: `No entry in stage-mapping.ts for Stage="${stageRaw}" Substage="${substageRaw}" — add it and re-run`,
        payload: {
          candidateServiceId,
          requirementId: requirement.id,
          stage: stageRaw,
          substage: substageRaw,
        },
        sourceRow,
      });
      continue;
    }

    const currentStageId = stageIdByCanonical.get(mapping.canonicalStage);
    if (!currentStageId) {
      summary.skippedStageNotSeeded++;
      stagingRows.push({
        type: "PIPELINE_STAGE_NOT_SEEDED",
        reason: `CanonicalStage ${mapping.canonicalStage} has no matching PipelineStage row — seed it first`,
        payload: {
          candidateServiceId,
          requirementId: requirement.id,
          canonicalStage: mapping.canonicalStage,
        },
        sourceRow,
      });
      continue;
    }

    const changedByEmail = extractSingleEmail(row["Changed By"]);
    const changedByUser = changedByEmail
      ? userByEmail.get(changedByEmail)
      : undefined;
    const stageUpdatedById = changedByUser?.id ?? recruiter.id;

    const assignmentId = await findOrCreateAssignment(
      requirement.id,
      requirement.createdById,
      recruiter.id,
      requirement.reqCode,
      recruiter.email,
      sourceRow
    );

    const snapKey = `${candidateServiceId}:${requirement.id}`;
    if (existingSnapshotKeys.has(snapKey) || seenSnapKeysThisRun.has(snapKey)) {
      summary.pipelinesSkippedDuplicate++;
      continue;
    }
    seenSnapKeysThisRun.add(snapKey);

    prepared.push({
      snapKey,
      snapshot: {
        candidateServiceId,
        requirementId: requirement.id,
        fullName: String(row["Candidate Name"] ?? "Unknown"),
        email: email ?? "",
        phone: row["Candidate Mobile"] ? String(row["Candidate Mobile"]) : null,
        currentTitle: row["Current Designation"]
          ? String(row["Current Designation"])
          : null,
        currentCompany: row["Current Organization"]
          ? String(row["Current Organization"])
          : null,
        topSkills: [],
        rawSnapshot: row as any,
        sourced: row["Primary Source"] ? String(row["Primary Source"]) : null,
        createdById: recruiter.id,
      },
      pipeline: {
        requirementId: requirement.id,
        assignmentId,
        recruiterId: recruiter.id,
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

  console.log(
    `[phase 1/4] done in ${((Date.now() - startTime) / 1000).toFixed(0)}s — ${
      prepared.length
    } records ready to insert`
  );

  if (!COMMIT) {
    summary.snapshotsCreated = prepared.length;
    summary.pipelinesCreated = prepared.length;
    console.log("\n── Summary ──────────────────────────");
    console.log(summary);
    console.log(`Staging rows that WOULD be written: ${stagingRows.length}`);
    console.log(
      "\nDry run — nothing was written. Re-run with --commit once this looks right."
    );
    return;
  }

  // ════════════════════════════════════════════════════════════════════
  // PHASE 2 — BULK INSERT SNAPSHOTS
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n[phase 2/4] bulk-inserting ${prepared.length} snapshots...`);
  const p2Start = Date.now();
  for (let i = 0; i < prepared.length; i += CHUNK) {
    await prisma.candidateSnapshot.createMany({
      data: prepared.slice(i, i + CHUNK).map((p) => p.snapshot),
      skipDuplicates: true,
    });
    if ((i / CHUNK) % 10 === 0) {
      console.log(
        `[phase 2/4] ${Math.min(i + CHUNK, prepared.length)}/${
          prepared.length
        } snapshots inserted`
      );
    }
  }
  summary.snapshotsCreated = prepared.length;
  console.log(
    `[phase 2/4] done in ${((Date.now() - p2Start) / 1000).toFixed(0)}s`
  );

  // ════════════════════════════════════════════════════════════════════
  // PHASE 3 — FETCH SNAPSHOT IDS BACK
  // ════════════════════════════════════════════════════════════════════
  console.log("\n[phase 3/4] mapping snapshot ids...");
  const allSnapshots = await prisma.candidateSnapshot.findMany({
    select: { id: true, candidateServiceId: true, requirementId: true },
  });
  const snapshotIdByKey = new Map(
    allSnapshots.map((s) => [
      `${s.candidateServiceId}:${s.requirementId}`,
      s.id,
    ])
  );

  // exclude snapshots that already have a pipeline (safe re-run)
  const existingPipelineSnapshotIds = new Set(
    (
      await prisma.requirementCandidatePipeline.findMany({
        select: { snapshotId: true },
      })
    ).map((p) => p.snapshotId)
  );

  // ════════════════════════════════════════════════════════════════════
  // PHASE 4 — BULK INSERT PIPELINES
  // ════════════════════════════════════════════════════════════════════
  const pipelineData: Prisma.RequirementCandidatePipelineCreateManyInput[] = [];
  for (const p of prepared) {
    const snapshotId = snapshotIdByKey.get(p.snapKey);
    if (!snapshotId) continue; // shouldn't happen — snapshot just inserted
    if (existingPipelineSnapshotIds.has(snapshotId)) {
      summary.pipelinesSkippedDuplicate++;
      continue;
    }
    pipelineData.push({ ...p.pipeline, snapshotId });
  }

  console.log(
    `\n[phase 4/4] bulk-inserting ${pipelineData.length} pipelines...`
  );
  const p4Start = Date.now();
  for (let i = 0; i < pipelineData.length; i += CHUNK) {
    await prisma.requirementCandidatePipeline.createMany({
      data: pipelineData.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
    if ((i / CHUNK) % 10 === 0) {
      console.log(
        `[phase 4/4] ${Math.min(i + CHUNK, pipelineData.length)}/${
          pipelineData.length
        } pipelines inserted`
      );
    }
  }
  summary.pipelinesCreated = pipelineData.length;
  console.log(
    `[phase 4/4] done in ${((Date.now() - p4Start) / 1000).toFixed(0)}s`
  );

  // ── staging rows ──────────────────────────────────────────────────────
  if (stagingRows.length > 0) {
    for (let i = 0; i < stagingRows.length; i += CHUNK) {
      await prisma.migrationStaging.createMany({
        data: stagingRows.slice(i, i + CHUNK).map((s) => ({
          type: s.type as any,
          reason: s.reason,
          payload: s.payload,
          sourceRow: s.sourceRow,
        })),
      });
    }
  }

  console.log("\n── Summary ──────────────────────────");
  console.log(summary);
  console.log(`Staging rows written: ${stagingRows.length}`);
  console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(0)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
