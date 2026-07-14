// File: migrate-requirements.ts
// Path: src/scripts/migrate-requirements.ts
//
// One-time backfill: legacy "All_active_Requirements.xlsx" export -> TalentOS
// Client / ClientSpoc / Requirement / RequirementAssignment tables.
//
// SAFE BY DEFAULT: dry run unless --commit.
//
// Usage:
//   npx tsx src/scripts/migrate-requirements.ts src/scripts/data/All_active_Requirements.xlsx
//   npx tsx src/scripts/migrate-requirements.ts src/scripts/data/All_active_Requirements.xlsx --commit
//
// Decisions this script encodes (confirmed with Rahul):
//   - createdById <- "Created By" column email
//   - MISSING USERS ARE AUTO-CREATED (per Rahul's original instruction:
//     "if the chain doesn't exist create that user with that mail and map
//     them, later flag them as not mapped"). Creator or recruiter email not
//     found in User table -> create the User with:
//       * email + name parsed from the "CODE|Team|Name (email)" cell
//       * password = pass@123 (bcrypt-hashed) — users can log in, tell them to change it
//       * role = "MIGRATED" (found or created; isSystem=false)
//       * flagged in MigrationStaging as USER_AUTO_CREATED for later review
//   - Client.name <- "Client/Department" minus trailing _ServiceLine_Year
//   - ClientSpoc  <- regex-parsed from "Client Contact", flagged for review;
//     BU = "B2B" (found or created)
//   - Assignment chain strategies, in order:
//       1. hierarchy walk  2. direct UserAssignableTo edge
//       3. assignable edge to recruiter's ancestor  4. flat fallback
//          (creator -> recruiter depth-0 + auto UserAssignableTo edge)
//   - Every auto-action is logged to MigrationStaging so nothing is silent.

import { PrismaClient, RequirementType, RemoteType } from "@prisma/client";
import * as bcrypt from "bcryptjs"; // if your project uses "bcrypt" instead, change this import — API is identical
import * as XLSX from "xlsx";
import {
  extractSingleEmail,
  extractMultipleEmails,
  extractNameEmailPairs,
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
type UserLite = {
  id: string;
  email: string;
  reportingToId: string | null;
  teamLeadId: string | null;
};

async function main() {
  console.log(
    `Mode: ${COMMIT ? "COMMIT (writing to DB)" : "DRY RUN (no writes)"}`
  );

  // default login password for all auto-created users (confirmed with Rahul):
  // pass@123 — hashed once, reused for every migrated user. Tell these users
  // to change it after first login.
  const defaultPasswordHash = await bcrypt.hash("pass@123", 10);

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

  // ── preload ─────────────────────────────────────────────────────────
  const users: UserLite[] = await prisma.user.findMany({
    select: { id: true, email: true, reportingToId: true, teamLeadId: true },
  });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const assignableEdges = await prisma.userAssignableTo.findMany({
    select: { userId: true, targetId: true },
  });
  const assignableByUser = new Map<string, Set<string>>();
  for (const e of assignableEdges) {
    if (!assignableByUser.has(e.userId))
      assignableByUser.set(e.userId, new Set());
    assignableByUser.get(e.userId)!.add(e.targetId);
  }

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

  // ── default BU "B2B" — find or create ───────────────────────────────
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

  // ── role for auto-created users — find or create "MIGRATED" ─────────
  let migratedRole = await prisma.role.findFirst({
    where: { name: { equals: "MIGRATED", mode: "insensitive" } },
    select: { id: true },
  });
  if (!migratedRole) {
    if (COMMIT) {
      migratedRole = await prisma.role.create({
        data: {
          name: "MIGRATED",
          description:
            "Auto-created during legacy data migration. Users with this role were referenced in the legacy export but did not exist in the system. Review and reassign proper roles.",
          isSystem: false,
        },
        select: { id: true },
      });
      console.log('[setup] Role "MIGRATED" did not exist — created it.');
    } else {
      migratedRole = { id: "DRY-RUN-ROLE:MIGRATED" };
      console.log(
        '[setup] Role "MIGRATED" does not exist — WILL BE CREATED on --commit.'
      );
    }
  }

  const stagingRows: Array<{
    type:
      | "UNMAPPED_CREATOR"
      | "UNMAPPED_RECRUITER"
      | "CLIENT_SPOC_NEEDS_REVIEW"
      | "DUPLICATE_REQ_CODE"
      | "FLAT_FALLBACK_ASSIGNMENT"
      | "USER_AUTO_CREATED";
    reason: string;
    payload: any;
    sourceRow: number;
  }> = [];

  const summary = {
    totalRows: rows.length,
    requirementsCreated: 0,
    requirementsSkippedDuplicate: 0,
    clientsCreated: 0,
    clientSpocsCreated: 0,
    usersAutoCreated: 0,
    assignmentsCreated: 0,
    chainsViaHierarchy: 0,
    chainsViaAssignableDirect: 0,
    chainsViaAssignableSubtree: 0,
    chainsViaFlatFallback: 0,
    assignableEdgesAutoCreated: 0,
    rowsSkippedNoEmailParseable: 0,
  };

  const newClientCache = new Map<string, string>();
  let dryRunUserSeq = 0;

  /**
   * Finds a User by email, or AUTO-CREATES one (confirmed rule) with the
   * name parsed from the raw legacy cell. Auto-created users:
   *   - password pass@123 (bcrypt-hashed, confirmed default)
   *   - role "MIGRATED", isActive true
   *   - flagged in staging as USER_AUTO_CREATED
   * Keeps the in-memory maps in sync so later rows reuse the same user.
   */
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
      const u = await prisma.user.create({
        data: {
          email,
          passwordHash: defaultPasswordHash,
          firstName,
          lastName,
          displayName: name.trim() || undefined,
          roleId: migratedRole!.id,
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          reportingToId: true,
          teamLeadId: true,
        },
      });
      created = u;
    } else {
      created = {
        id: `DRY-RUN-USER:${++dryRunUserSeq}:${email}`,
        email,
        reportingToId: null,
        teamLeadId: null,
      };
    }

    userByEmail.set(email, created);
    userById.set(created.id, created);
    summary.usersAutoCreated++;
    stagingRows.push({
      type: "USER_AUTO_CREATED",
      reason: `User ${email} (${name}) did not exist — auto-created during migration (${context}). Role=MIGRATED, password pass@123. Review: set proper role, reporting line, BU.`,
      payload: { email, name, userId: created.id, context },
      sourceRow,
    });
    return created;
  }

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

    const recruiterAncestry = ancestryOf(recruiterId);
    const creatorIdx = recruiterAncestry.indexOf(creatorId);
    if (creatorIdx !== -1) {
      return {
        path: recruiterAncestry.slice(0, creatorIdx + 1).reverse(),
        via: "hierarchy",
      };
    }

    const creatorAssignables = assignableByUser.get(creatorId);
    if (creatorAssignables?.has(recruiterId)) {
      return { path: [creatorId, recruiterId], via: "assignable-direct" };
    }

    if (creatorAssignables && creatorAssignables.size > 0) {
      for (let i = 1; i < recruiterAncestry.length; i++) {
        if (creatorAssignables.has(recruiterAncestry[i])) {
          const downChain = recruiterAncestry.slice(0, i + 1).reverse();
          return {
            path: [creatorId, ...downChain],
            via: "assignable-subtree",
          };
        }
      }
    }

    return { path: [creatorId, recruiterId], via: "flat-fallback" };
  }

  const startTime = Date.now();

  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % 25 === 0) {
      const elapsedSec = (Date.now() - startTime) / 1000;
      const etaSec = Math.round(((rows.length - i) * elapsedSec) / i);
      console.log(
        `[progress] row ${i}/${rows.length} | ${elapsedSec.toFixed(
          0
        )}s elapsed | ~${etaSec}s remaining | assignments: ${
          summary.assignmentsCreated
        } | users auto-created: ${summary.usersAutoCreated}`
      );
    }

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

    // ── creator: find or AUTO-CREATE ────────────────────────────────────
    const creatorPairs = extractNameEmailPairs(row["Created By"]);
    if (creatorPairs.length === 0) {
      summary.rowsSkippedNoEmailParseable++;
      stagingRows.push({
        type: "UNMAPPED_CREATOR",
        reason: `Could not parse any email from "Created By" cell — requirement not created (nothing to auto-create a user from)`,
        payload: { reqCode, createdByRaw: row["Created By"] },
        sourceRow,
      });
      continue;
    }
    const creator = await findOrCreateUser(
      creatorPairs[0].email,
      creatorPairs[0].name,
      sourceRow,
      `creator of requirement ${reqCode}`
    );

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

    // ── client spoc ─────────────────────────────────────────────────────
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
            handlerId: creator.id,
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

    // ── assignment chain: recruiters find-or-created too ─────────────────
    const recruiterPairs = extractNameEmailPairs(row["Recruiters"]);
    for (const pair of recruiterPairs) {
      const recruiter = await findOrCreateUser(
        pair.email,
        pair.name,
        sourceRow,
        `recruiter on requirement ${reqCode}`
      );

      const { path, via } = resolveChainPath(creator.id, recruiter.id);

      if (via === "hierarchy") summary.chainsViaHierarchy++;
      else if (via === "assignable-direct") summary.chainsViaAssignableDirect++;
      else if (via === "assignable-subtree")
        summary.chainsViaAssignableSubtree++;
      else if (via === "flat-fallback") {
        summary.chainsViaFlatFallback++;

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
                addedById: creator.id,
              },
            });
          }
          if (!assignableByUser.has(creator.id))
            assignableByUser.set(creator.id, new Set());
          assignableByUser.get(creator.id)!.add(recruiter.id);
          summary.assignableEdgesAutoCreated++;
        }

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
