// File: migrate-requirements.ts
// Path: src/scripts/migrate-requirements.ts
//
// One-time backfill: legacy "All_active_Requirements.xlsx" export -> TalentOS
// Client / ClientSpoc / Requirement / RequirementAssignment tables.
//
// SAFE BY DEFAULT: runs as a dry run unless you pass --commit. Dry run does
// every lookup and prints exactly what it WOULD write, with counts, and
// nothing touches the DB except reads.
//
// Usage:
//   npx tsx src/scripts/migrate-requirements.ts src/scripts/data/All_active_Requirements.xlsx
//   npx tsx src/scripts/migrate-requirements.ts src/scripts/data/All_active_Requirements.xlsx --commit
//
// Requires: npm install xlsx
//
// Decisions this script encodes (confirmed with Rahul):
//   - createdById <- "Created By" column email (literal audit fact)
//   - Client.name <- "Client/Department" with trailing _ServiceLine_Year stripped
//   - ClientSpoc  <- regex-parsed from "Client Contact", flagged for review
//   - Assignment chain resolution (in priority order):
//       1. HIERARCHY WALK: climb recruiter's reportingToId/teamLeadId ancestry
//          up to the creator. Full multi-hop chain written if found.
//       2. ASSIGNABLE-TO EDGE: direct UserAssignableTo edge creator -> recruiter
//          -> single depth-0 assignment.
//       3. ASSIGNABLE-TO + SUB-HIERARCHY: creator has an assignable edge to an
//          ANCESTOR of the recruiter -> bridged multi-depth chain.
//       4. FLAT FALLBACK (confirmed with Rahul after dry runs showed real org
//          data has creators and recruiters in different branches with no
//          stored relationship): the xlsx itself is proof this recruiter
//          worked this requirement, so create a direct depth-0 assignment
//          creator -> recruiter AND auto-create the missing UserAssignableTo
//          edge so the relationship is legit in the system going forward.
//          These are tallied separately (chainsViaFlatFallback) and each one
//          is also logged to MigrationStaging as FLAT_FALLBACK_ASSIGNMENT for
//          later audit — created live, but traceable.
//   - Anything unmapped (missing creator/recruiter user, duplicate reqCode)
//     -> MigrationStaging row, live tables untouched for that item.

import { PrismaClient, RequirementType, RemoteType } from "@prisma/client";
import * as XLSX from "xlsx";
import {
  extractSingleEmail,
  extractMultipleEmails,
  parseClientDepartment,
  parseClientSpoc,
} from "./parsers";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");
const filePath = process.argv[2];
const MAX_HIERARCHY_DEPTH = 6;

if (!filePath) {
  console.error("Usage: tsx migrate-requirements.ts <path-to-xlsx> [--commit]");
  process.exit(1);
}

const JOB_TYPE_MAP: Record<string, RequirementType> = {
  permanent: "PERMANENT",
  contract: "CONTRACT",
  "contract to hire": "CONTRACT_TO_HIRE",
  freelance: "FREELANCE",
};
const DEFAULT_JOB_TYPE: RequirementType = "CONTRACT";
const DEFAULT_REMOTE_TYPE: RemoteType = "ONSITE";

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
    select: { id: true, email: true, reportingToId: true, teamLeadId: true },
  });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const userById = new Map(users.map((u) => [u.id, u]));

  // UserAssignableTo edges: userId (assigner) -> set of targetIds they can assign to
  const assignableEdges = await prisma.userAssignableTo.findMany({
    select: { userId: true, targetId: true },
  });
  const assignableByUser = new Map<string, Set<string>>();
  for (const e of assignableEdges) {
    if (!assignableByUser.has(e.userId))
      assignableByUser.set(e.userId, new Set());
    assignableByUser.get(e.userId)!.add(e.targetId);
  }

  // ── DIAGNOSTICS ─────────────────────────────────────────────────────
  const usersWithManager = users.filter(
    (u) => u.reportingToId || u.teamLeadId
  ).length;
  console.log(
    `\n[diagnostic] Users total: ${users.length} | with reportingToId/teamLeadId: ${usersWithManager} | UserAssignableTo edges: ${assignableEdges.length}`
  );

  const clients = await prisma.client.findMany({
    select: { id: true, name: true },
  });
  const clientByName = new Map(
    clients.map((c) => [c.name.toLowerCase(), c.id])
  );

  const serviceLines = await prisma.serviceLine.findMany({
    select: { id: true, name: true, code: true },
  });
  const serviceLineByCode = new Map(
    serviceLines.map((s) => [(s.code ?? s.name).toLowerCase(), s.id])
  );

  const existingReqCodes = new Set(
    (await prisma.requirement.findMany({ select: { reqCode: true } })).map(
      (r) => r.reqCode
    )
  );

  // default BU for migrated spocs — B2B (confirmed with Rahul).
  // Auto-created if missing: in dry run we use a placeholder id (no writes),
  // in commit we create the real row.
  let defaultBU = await prisma.businessUnit.findFirst({
    where: { name: { equals: "B2B", mode: "insensitive" } },
    select: { id: true },
  });
  if (!defaultBU) {
    if (COMMIT) {
      const createdBU = await prisma.businessUnit.create({
        data: { name: "B2B", ancestorIds: [] },
        select: { id: true },
      });
      // ancestorIds must include self per schema convention — set it now
      await prisma.businessUnit.update({
        where: { id: createdBU.id },
        data: { ancestorIds: [createdBU.id] },
      });
      defaultBU = createdBU;
      console.log('[setup] BusinessUnit "B2B" did not exist — created it.');
    } else {
      defaultBU = { id: "DRY-RUN-BU:B2B" };
      console.log(
        '[setup] BusinessUnit "B2B" does not exist — WILL BE CREATED on --commit.'
      );
    }
  }

  const stagingRows: Array<{
    type:
      | "UNMAPPED_CREATOR"
      | "UNMAPPED_RECRUITER"
      | "UNRESOLVED_CHAIN"
      | "CLIENT_SPOC_NEEDS_REVIEW"
      | "DUPLICATE_REQ_CODE"
      | "FLAT_FALLBACK_ASSIGNMENT";
    reason: string;
    payload: any;
    sourceRow: number;
  }> = [];

  const summary = {
    totalRows: rows.length,
    requirementsCreated: 0,
    requirementsSkippedDuplicate: 0,
    requirementsSkippedNoCreator: 0,
    clientsCreated: 0,
    clientSpocsCreated: 0,
    assignmentsCreated: 0,
    chainsViaHierarchy: 0,
    chainsViaAssignableDirect: 0,
    chainsViaAssignableSubtree: 0,
    chainsViaFlatFallback: 0,
    assignableEdgesAutoCreated: 0,
    recruitersUnmapped: 0,
  };

  const newClientCache = new Map<string, string>();

  /**
   * Ancestry chain of a user walking UP via reportingToId/teamLeadId:
   * [user, manager, manager's manager, ...]. Stops at maxDepth or when no
   * parent is set.
   */
  function ancestryOf(
    userId: string,
    maxDepth = MAX_HIERARCHY_DEPTH
  ): string[] {
    const chain: string[] = [userId];
    let currentId = userId;
    for (let i = 0; i < maxDepth; i++) {
      const current = userById.get(currentId);
      if (!current) break;
      const nextId = current.reportingToId ?? current.teamLeadId;
      if (!nextId) break;
      chain.push(nextId);
      currentId = nextId;
    }
    return chain;
  }

  /**
   * Resolves the assignment path from creator down to recruiter using,
   * in order: hierarchy, direct assignable edge, assignable edge to an
   * ancestor of the recruiter, then FLAT FALLBACK (always succeeds when
   * both users exist — confirmed decision). Returns { path, via }.
   * via === "flat-fallback" signals the caller to also create the
   * UserAssignableTo edge.
   */
  function resolveChainPath(
    creatorId: string,
    recruiterId: string
  ): {
    path: string[];
    via:
      | "hierarchy"
      | "assignable-direct"
      | "assignable-subtree"
      | "flat-fallback";
  } {
    if (creatorId === recruiterId) {
      return { path: [creatorId], via: "hierarchy" };
    }

    // ── strategy 1: hierarchy walk ────────────────────────────────────
    const recruiterAncestry = ancestryOf(recruiterId);
    const creatorIdxInAncestry = recruiterAncestry.indexOf(creatorId);
    if (creatorIdxInAncestry !== -1) {
      const path = recruiterAncestry
        .slice(0, creatorIdxInAncestry + 1)
        .reverse();
      return { path, via: "hierarchy" };
    }

    // ── strategy 2: direct assignable edge ────────────────────────────
    const creatorAssignables = assignableByUser.get(creatorId);
    if (creatorAssignables?.has(recruiterId)) {
      return { path: [creatorId, recruiterId], via: "assignable-direct" };
    }

    // ── strategy 3: assignable edge to an ancestor of the recruiter ───
    if (creatorAssignables && creatorAssignables.size > 0) {
      for (let i = 1; i < recruiterAncestry.length; i++) {
        if (creatorAssignables.has(recruiterAncestry[i])) {
          const downChain = recruiterAncestry.slice(0, i + 1).reverse(); // ancestor ... recruiter
          return {
            path: [creatorId, ...downChain],
            via: "assignable-subtree",
          };
        }
      }
    }

    // ── strategy 4: flat fallback — xlsx is the proof of relationship ──
    return { path: [creatorId, recruiterId], via: "flat-fallback" };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sourceRow = i + 2;
    const reqCode = String(row["Job ID"] ?? row["Reference ID"] ?? "").trim();

    if (!reqCode) {
      stagingRows.push({
        type: "DUPLICATE_REQ_CODE",
        reason: "No Job ID or Reference ID present to use as reqCode",
        payload: row,
        sourceRow,
      });
      continue;
    }

    if (existingReqCodes.has(reqCode)) {
      summary.requirementsSkippedDuplicate++;
      continue;
    }

    // ── creator ────────────────────────────────────────────────────────
    const creatorEmail = extractSingleEmail(row["Created By"]);
    const creator = creatorEmail ? userByEmail.get(creatorEmail) : undefined;
    if (!creator) {
      summary.requirementsSkippedNoCreator++;
      stagingRows.push({
        type: "UNMAPPED_CREATOR",
        reason: `"Created By" email ${
          creatorEmail ?? "(none found)"
        } has no matching User — requirement not created`,
        payload: { reqCode, createdByRaw: row["Created By"] },
        sourceRow,
      });
      continue;
    }

    // ── client ─────────────────────────────────────────────────────────
    const { clientName, serviceLineCode } = parseClientDepartment(
      row["Client/Department"]
    );
    let clientId =
      clientByName.get(clientName.toLowerCase()) ??
      newClientCache.get(clientName.toLowerCase());
    if (!clientId) {
      if (COMMIT) {
        const created = await prisma.client.create({
          data: { name: clientName, createdById: creator.id, status: "ACTIVE" },
        });
        clientId = created.id;
      } else {
        clientId = `DRY-RUN-CLIENT:${clientName}`;
      }
      newClientCache.set(clientName.toLowerCase(), clientId);
      summary.clientsCreated++;
    }

    const serviceLineId = serviceLineCode
      ? serviceLineByCode.get(serviceLineCode.toLowerCase()) ?? null
      : null;

    // ── client spoc (best-effort, always flagged for review) ────────────
    const spocParsed = parseClientSpoc(row["Client Contact"]);
    let clientSpocId: string | null = null;
    if (spocParsed && serviceLineId) {
      if (COMMIT) {
        const spoc = await prisma.clientSpoc.upsert({
          where: {
            clientId_email_serviceLineId: {
              clientId: clientId!,
              email: spocParsed.email,
              serviceLineId,
            },
          },
          update: {},
          create: {
            clientId: clientId!,
            firstName: spocParsed.name.split(" ")[0] ?? spocParsed.name,
            lastName: spocParsed.name.split(" ").slice(1).join(" ") || "-",
            email: spocParsed.email,
            handlerId: creator.id, // assumption: requirement creator handles this spoc
            serviceLineId,
            businessUnitId: defaultBU.id,
            addedById: creator.id,
          },
        });
        clientSpocId = spoc.id;
      }
      stagingRows.push({
        type: "CLIENT_SPOC_NEEDS_REVIEW",
        reason: `Regex-extracted from "Client Contact" — verify name/email split is correct`,
        payload: {
          reqCode,
          raw: row["Client Contact"],
          parsed: spocParsed,
          clientSpocId,
        },
        sourceRow,
      });
      summary.clientSpocsCreated++;
    }

    // ── requirement ──────────────────────────────────────────────────────
    const jobTypeRaw = String(row["Job Type"] ?? "")
      .toLowerCase()
      .trim();
    const jobType = JOB_TYPE_MAP[jobTypeRaw] ?? DEFAULT_JOB_TYPE;
    if (!JOB_TYPE_MAP[jobTypeRaw]) {
      console.warn(
        `[row ${sourceRow}] Unrecognized Job Type "${row["Job Type"]}" -> defaulted to ${DEFAULT_JOB_TYPE}`
      );
    }

    let requirementId: string;
    if (COMMIT) {
      const created = await prisma.requirement.create({
        data: {
          reqCode,
          title: String(row["Job Title"] ?? "Untitled"),
          jobType,
          remoteType: DEFAULT_REMOTE_TYPE,
          primarySkills: String(row["Primary Skills"] ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          keySkills: String(row["Key Skills"] ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          clientId: clientId!,
          serviceLineId,
          totalOpenings: Number(row["Positions"] ?? 1),
          createdById: creator.id,
          status:
            String(row["Job Status"] ?? "").toUpperCase() === "ACTIVE"
              ? "ACTIVE"
              : "DRAFT",
        },
      });
      requirementId = created.id;
    } else {
      requirementId = `DRY-RUN-REQ:${reqCode}`;
    }
    summary.requirementsCreated++;

    // ── assignment chain ─────────────────────────────────────────────────
    const recruiterEmails = extractMultipleEmails(row["Recruiters"]);
    for (const email of recruiterEmails) {
      const recruiter = userByEmail.get(email);
      if (!recruiter) {
        summary.recruitersUnmapped++;
        stagingRows.push({
          type: "UNMAPPED_RECRUITER",
          reason: `Recruiter email ${email} (from "Recruiters" column) has no matching User`,
          payload: { reqCode, requirementId, email },
          sourceRow,
        });
        continue;
      }

      const { path, via } = resolveChainPath(creator.id, recruiter.id);

      // tally which strategy resolved it
      if (via === "hierarchy") summary.chainsViaHierarchy++;
      else if (via === "assignable-direct") summary.chainsViaAssignableDirect++;
      else if (via === "assignable-subtree")
        summary.chainsViaAssignableSubtree++;
      else if (via === "flat-fallback") {
        summary.chainsViaFlatFallback++;

        // auto-create the missing UserAssignableTo edge so this direct
        // assignment is legit within the system's own rules going forward
        const already = assignableByUser.get(creator.id)?.has(recruiter.id);
        if (!already) {
          if (COMMIT) {
            await prisma.userAssignableTo.upsert({
              where: {
                userId_targetId: {
                  userId: creator.id,
                  targetId: recruiter.id,
                },
              },
              update: {},
              create: {
                userId: creator.id,
                targetId: recruiter.id,
                addedById: creator.id, // migration acts on the creator's behalf
              },
            });
          }
          // keep the in-memory map in sync so we don't upsert the same edge
          // repeatedly across rows
          if (!assignableByUser.has(creator.id))
            assignableByUser.set(creator.id, new Set());
          assignableByUser.get(creator.id)!.add(recruiter.id);
          summary.assignableEdgesAutoCreated++;
        }

        // audit trail — created live, but every fallback is traceable
        stagingRows.push({
          type: "FLAT_FALLBACK_ASSIGNMENT",
          reason: `No hierarchy/assignable path between creator (${creator.email}) and recruiter (${recruiter.email}) — created flat depth-0 assignment + UserAssignableTo edge per confirmed migration rule`,
          payload: {
            reqCode,
            requirementId,
            creatorId: creator.id,
            creatorEmail: creator.email,
            recruiterId: recruiter.id,
            recruiterEmail: recruiter.email,
          },
          sourceRow,
        });
      }

      if (COMMIT) {
        let parentAssignmentId: string | null = null;
        for (let depth = 0; depth < path.length - 1; depth++) {
          const assignedById = path[depth];
          const assignedToId = path[depth + 1];
          const existing = await prisma.requirementAssignment.findFirst({
            where: { requirementId, assignedToId, assignedById, depth },
          });
          const assignment =
            existing ??
            (await prisma.requirementAssignment.create({
              data: {
                requirementId,
                assignedToId,
                assignedById,
                depth,
                parentAssignmentId,
                status: "ACTIVE",
              },
            }));
          parentAssignmentId = assignment.id;
        }
      }
      summary.assignmentsCreated += path.length - 1;
    }
  }

  // ── write staging rows ────────────────────────────────────────────────
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
  if (!COMMIT) {
    console.log(
      "\nThis was a dry run — nothing was written. Re-run with --commit once this looks right."
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
