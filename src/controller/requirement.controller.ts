import { reqScopeWhere } from "@/middleware/scopeFilter.middleware";
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
// import { reqScopeWhere } from "@/middleware/scope";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function generateReqCode(buName: string): string {
  const prefix =
    buName
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3) || "SFJ";
  const year = new Date().getFullYear().toString().slice(2);
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `${prefix}-R-${year}${rand}`;
}

/** Log to RequirementActivity */
async function logActivity(
  tx: any,
  requirementId: string,
  actorId: string,
  type: string,
  summary: string,
  meta?: any
) {
  await tx.requirementActivity.create({
    data: { requirementId, actorId, type, summary, meta: meta ?? undefined },
  });
}

// Full select used by detail + list
const REQ_DETAIL_SELECT = {
  id: true,
  reqCode: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  jobType: true,
  remoteType: true,
  totalOpenings: true,
  filledOpenings: true,
  activeApplications: true,
  interviewsScheduled: true,
  offersRolledOut: true,
  location: true,
  country: true,
  salaryMin: true,
  salaryMax: true,
  salaryType: true,
  experienceMin: true,
  experienceMax: true,
  startDate: true,
  endDate: true,
  respondBy: true,
  turnaroundDays: true,
  closedAt: true,
  isRespondByBreached: true,
  isTurnaroundBreached: true,
  createdAt: true,
  updatedAt: true,
  businessUnit: { select: { id: true, name: true } },
  client: {
    select: {
      id: true,
      name: true,
      vmsName: true,
      status: true,
      industry: true,
    },
  },
  clientContact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      designation: true,
      email: true,
    },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  closedBy: { select: { id: true, firstName: true, lastName: true } },
  skills: {
    select: {
      isMandatory: true,
      experience: true,
      skill: { select: { id: true, canonicalName: true } },
    },
  },
  jd: {
    where: { isLatest: true },
    select: {
      id: true,
      fileName: true,
      fileKey: true,
      fileType: true,
      fileSizeBytes: true,
      version: true,
      uploadedAt: true,
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    take: 1,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements
// Scope-aware list with pagination + filters
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirements = async (req: Request, res: Response) => {
  try {
    const {
      status,
      priority,
      clientId,
      buId,
      jobType,
      remoteType,
      assignedToMe,
      breached,
      search,
      page = "1",
      limit = "25",
      sortBy = "createdAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Base scope where (from middleware)
    const scopeWhere = reqScopeWhere(req.scopeFilter);

    // Additional filters layered on top
    const extraWhere: any = {};
    if (status) extraWhere.status = status;
    if (priority) extraWhere.priority = priority;
    if (clientId) extraWhere.clientId = clientId;
    if (buId) extraWhere.businessUnitId = buId;
    if (jobType) extraWhere.jobType = jobType;
    if (remoteType) extraWhere.remoteType = remoteType;
    if (breached === "true") extraWhere.isRespondByBreached = true;
    if (search)
      extraWhere.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { reqCode: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
      ];

    // assignedToMe — recruiter filtering to only their assignments
    if (assignedToMe === "true" && req.user?.id) {
      extraWhere.assignments = {
        some: { recruiterId: req.user.id, status: "ACTIVE" },
      };
    }

    const where = { ...scopeWhere, ...extraWhere };

    const [total, requirements] = await Promise.all([
      prisma.requirement.count({ where }),
      prisma.requirement.findMany({
        where,
        select: {
          id: true,
          reqCode: true,
          title: true,
          status: true,
          priority: true,
          jobType: true,
          remoteType: true,
          totalOpenings: true,
          filledOpenings: true,
          salaryMin: true,
          salaryMax: true,
          salaryType: true,
          respondBy: true,
          turnaroundDays: true,
          isRespondByBreached: true,
          isTurnaroundBreached: true,
          createdAt: true,
          updatedAt: true,
          businessUnit: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          skills: {
            where: { isMandatory: true },
            select: { skill: { select: { canonicalName: true } } },
            take: 5,
          },
          // Active assignment chain summary
          assignments: {
            where: { status: "ACTIVE" },
            select: {
              id: true,
              assignmentType: true,
              allocatedOpenings: true,
              filledOpenings: true,
              recruiterId: true,
              teamId: true,
              recruiter: {
                select: { id: true, firstName: true, lastName: true },
              },
              team: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { [sortBy]: sortDir as "asc" | "desc" },
        skip,
        take,
      }),
    ]);

    res.json({
      success: true,
      data: requirements,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
      // Permission flags for UI
      permissions: {
        canAdd: req.modulePermission.canAdd,
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getRequirements:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirements" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id
// Full detail + full assignment chain + notes + activity + status history
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const req_ = await prisma.requirement.findFirst({
      where: { id, ...reqScopeWhere(req.scopeFilter) },
      select: {
        ...REQ_DETAIL_SELECT,
        // Full assignment chain — nested parent→team→individual
        assignments: {
          where: { status: "ACTIVE", parentAssignmentId: null }, // top-level MANAGER assignments
          select: {
            id: true,
            assignmentType: true,
            allocatedOpenings: true,
            filledOpenings: true,
            submissionsCount: true,
            interviewsCount: true,
            assignedAt: true,
            deadline: true,
            breachedAt: true,
            isAutoRouted: true,
            recruiter: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeId: true,
              },
            },
            team: { select: { id: true, name: true, nodeType: true } },
            assignedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
            // Level 2 — TEAM assignments
            childAssignments: {
              where: { status: "ACTIVE" },
              select: {
                id: true,
                assignmentType: true,
                allocatedOpenings: true,
                filledOpenings: true,
                submissionsCount: true,
                interviewsCount: true,
                assignedAt: true,
                deadline: true,
                breachedAt: true,
                recruiter: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    employeeId: true,
                  },
                },
                team: { select: { id: true, name: true, nodeType: true } },
                assignedBy: {
                  select: { id: true, firstName: true, lastName: true },
                },
                // Level 3 — INDIVIDUAL assignments
                childAssignments: {
                  where: { status: "ACTIVE" },
                  select: {
                    id: true,
                    assignmentType: true,
                    allocatedOpenings: true,
                    filledOpenings: true,
                    submissionsCount: true,
                    interviewsCount: true,
                    assignedAt: true,
                    deadline: true,
                    breachedAt: true,
                    recruiter: {
                      select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        employeeId: true,
                      },
                    },
                    assignedBy: {
                      select: { id: true, firstName: true, lastName: true },
                    },
                  },
                },
              },
            },
          },
        },
        notes: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            updatedAt: true,
            author: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        statusHistory: {
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            reason: true,
            changedAt: true,
            changedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: { changedAt: "desc" },
        },
        activities: {
          select: {
            id: true,
            type: true,
            summary: true,
            meta: true,
            createdAt: true,
            actor: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
        documents: {
          select: {
            id: true,
            type: true,
            fileName: true,
            fileKey: true,
            content: true,
            isIssue: true,
            issueResolved: true,
            createdAt: true,
            raisedBy: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!req_) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    res.json({
      success: true,
      data: req_,
      permissions: {
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getRequirementById:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirement" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /requirements
// Sales creates a requirement. Status starts as DRAFT.
// ─────────────────────────────────────────────────────────────────────────────

export const createRequirement = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canAdd) {
      res.status(403).json({
        success: false,
        message: "No permission to create requirements",
      });
      return;
    }

    const {
      title,
      description,
      clientId,
      clientContactId,
      businessUnitId,
      jobType,
      remoteType,
      priority,
      totalOpenings,
      location,
      country,
      salaryMin,
      salaryMax,
      salaryType,
      experienceMin,
      experienceMax,
      startDate,
      endDate,
      respondBy,
      turnaroundDays,
      skillIds, // [{ skillId, isMandatory, experience }]
    } = req.body;

    const actorId = req.user!.id;
    const buId = businessUnitId ?? req.user!.businessUnitId;

    // Generate unique reqCode
    const bu = buId
      ? await prisma.businessUnit.findUnique({
          where: { id: buId },
          select: { name: true },
        })
      : null;
    let reqCode = generateReqCode(bu?.name ?? "SFJ");
    // Ensure uniqueness
    let attempts = 0;
    while (await prisma.requirement.findUnique({ where: { reqCode } })) {
      reqCode = generateReqCode(bu?.name ?? "SFJ");
      if (++attempts > 10) throw new Error("Could not generate unique reqCode");
    }

    const requirement = await prisma.$transaction(async (tx) => {
      const created = await tx.requirement.create({
        data: {
          reqCode,
          title,
          description: description ?? null,
          clientId,
          clientContactId: clientContactId ?? null,
          businessUnitId: buId ?? null,
          jobType,
          remoteType,
          priority: priority ?? "MEDIUM",
          totalOpenings: totalOpenings ?? 1,
          location: location ?? null,
          country: country ?? null,
          salaryMin: salaryMin ?? null,
          salaryMax: salaryMax ?? null,
          salaryType: salaryType ?? null,
          experienceMin: experienceMin ?? null,
          experienceMax: experienceMax ?? null,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          respondBy: respondBy ? new Date(respondBy) : null,
          turnaroundDays: turnaroundDays ?? null,
          status: "DRAFT",
          createdById: actorId,
        },
        select: {
          id: true,
          reqCode: true,
          title: true,
          status: true,
          businessUnitId: true,
        },
      });

      // Link skills
      if (skillIds?.length) {
        await tx.requirementSkill.createMany({
          data: skillIds.map((s: any) => ({
            requirementId: created.id,
            skillId: s.skillId,
            isMandatory: s.isMandatory ?? true,
            experience: s.experience ?? null,
          })),
          skipDuplicates: true,
        });
      }

      // Status history
      await tx.requirementStatusHistory.create({
        data: {
          requirementId: created.id,
          fromStatus: "DRAFT",
          toStatus: "DRAFT",
          changedById: actorId,
          reason: "Created",
        },
      });

      await logActivity(
        tx,
        created.id,
        actorId,
        "REQUIREMENT_CREATED",
        `Requirement ${created.reqCode} created`
      );

      return created;
    });

    res.status(201).json({
      success: true,
      message: "Requirement created",
      data: requirement,
    });
  } catch (err) {
    console.error("createRequirement:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create requirement" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /requirements/:id
// Edit core fields. Status NOT changed here — use PATCH /status.
// ─────────────────────────────────────────────────────────────────────────────

export const updateRequirement = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({
        success: false,
        message: "No permission to edit requirements",
      });
      return;
    }

    const { id } = req.params;
    const actorId = req.user!.id;

    const existing = await prisma.requirement.findFirst({
      where: { id, ...reqScopeWhere(req.scopeFilter) },
      select: { id: true, status: true },
    });
    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    // Only DRAFT and PENDING_APPROVAL can be freely edited
    if (
      !["DRAFT", "PENDING_APPROVAL"].includes(existing.status) &&
      !req.user?.isSuperAdmin
    ) {
      res.status(409).json({
        success: false,
        message: "Only DRAFT or PENDING_APPROVAL requirements can be edited",
      });
      return;
    }

    const {
      title,
      description,
      clientId,
      clientContactId,
      jobType,
      remoteType,
      priority,
      totalOpenings,
      location,
      country,
      salaryMin,
      salaryMax,
      salaryType,
      experienceMin,
      experienceMax,
      startDate,
      endDate,
      respondBy,
      turnaroundDays,
      skillIds,
    } = req.body;

    const updated = await prisma.$transaction(async (tx) => {
      const req_ = await tx.requirement.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(clientId !== undefined && { clientId }),
          ...(clientContactId !== undefined && { clientContactId }),
          ...(jobType !== undefined && { jobType }),
          ...(remoteType !== undefined && { remoteType }),
          ...(priority !== undefined && { priority }),
          ...(totalOpenings !== undefined && { totalOpenings }),
          ...(location !== undefined && { location }),
          ...(country !== undefined && { country }),
          ...(salaryMin !== undefined && { salaryMin }),
          ...(salaryMax !== undefined && { salaryMax }),
          ...(salaryType !== undefined && { salaryType }),
          ...(experienceMin !== undefined && { experienceMin }),
          ...(experienceMax !== undefined && { experienceMax }),
          ...(startDate !== undefined && {
            startDate: startDate ? new Date(startDate) : null,
          }),
          ...(endDate !== undefined && {
            endDate: endDate ? new Date(endDate) : null,
          }),
          ...(respondBy !== undefined && {
            respondBy: respondBy ? new Date(respondBy) : null,
          }),
          ...(turnaroundDays !== undefined && { turnaroundDays }),
        },
        select: { id: true, reqCode: true, title: true, status: true },
      });

      // Replace skills if provided
      if (skillIds !== undefined) {
        await tx.requirementSkill.deleteMany({ where: { requirementId: id } });
        if (skillIds.length) {
          await tx.requirementSkill.createMany({
            data: skillIds.map((s: any) => ({
              requirementId: id,
              skillId: s.skillId,
              isMandatory: s.isMandatory ?? true,
              experience: s.experience ?? null,
            })),
          });
        }
      }

      await logActivity(
        tx,
        id,
        actorId,
        "STATUS_CHANGED",
        `Requirement ${req_.reqCode} updated`
      );
      return req_;
    });

    res.json({ success: true, message: "Requirement updated", data: updated });
  } catch (err) {
    console.error("updateRequirement:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update requirement" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/status
// Status machine:
//   DRAFT → PENDING_APPROVAL (sales submits)
//   PENDING_APPROVAL → ACTIVE (admin approves)
//   PENDING_APPROVAL → DRAFT (admin rejects / sales pulls back)
//   ACTIVE → ON_HOLD | CLOSED | CANCELLED
//   ON_HOLD → ACTIVE | CANCELLED
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["ACTIVE", "DRAFT"],
  ACTIVE: ["ON_HOLD", "CLOSED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

export const updateRequirementStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { toStatus, reason } = req.body;
    const actorId = req.user!.id;

    if (!toStatus) {
      res.status(400).json({ success: false, message: "toStatus is required" });
      return;
    }

    const existing = await prisma.requirement.findFirst({
      where: { id, ...reqScopeWhere(req.scopeFilter) },
      select: { id: true, status: true, reqCode: true, totalOpenings: true },
    });
    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    const allowed = VALID_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(toStatus)) {
      res.status(409).json({
        success: false,
        message: `Cannot transition from ${
          existing.status
        } → ${toStatus}. Allowed: ${allowed.join(", ") || "none"}`,
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const data: any = { status: toStatus };
      if (toStatus === "ACTIVE") {
        data.approvedById = actorId;
        data.approvedAt = new Date();
      }
      if (toStatus === "CLOSED") {
        data.closedById = actorId;
        data.closedAt = new Date();
      }
      if (toStatus === "CANCELLED") {
        data.closedById = actorId;
        data.closedAt = new Date();
      }

      const req_ = await tx.requirement.update({
        where: { id },
        data,
        select: { id: true, reqCode: true, status: true },
      });

      await tx.requirementStatusHistory.create({
        data: {
          requirementId: id,
          fromStatus: existing.status as any,
          toStatus: toStatus as any,
          changedById: actorId,
          reason: reason ?? null,
        },
      });

      const actType =
        toStatus === "ACTIVE"
          ? "REQUIREMENT_APPROVED"
          : toStatus === "CLOSED"
          ? "REQUIREMENT_CLOSED"
          : "STATUS_CHANGED";
      await logActivity(
        tx,
        id,
        actorId,
        actType,
        `Status changed: ${existing.status} → ${toStatus}${
          reason ? ` (${reason})` : ""
        }`,
        { from: existing.status, to: toStatus }
      );

      return req_;
    });

    res.json({
      success: true,
      message: `Status updated to ${toStatus}`,
      data: updated,
    });
  } catch (err) {
    console.error("updateRequirementStatus:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update status" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /requirements/:id/assign
// Create an assignment. Handles all 3 levels.
//
// Level 1 — MANAGER:  { type: "MANAGER", recruiterId, allocatedOpenings? }
// Level 2 — TEAM:     { type: "TEAM",    teamId, parentAssignmentId, allocatedOpenings? }
// Level 3 — INDIVIDUAL: { type: "INDIVIDUAL", recruiterId, teamMemberId?, parentAssignmentId, allocatedOpenings? }
//
// Rules enforced:
//   - MANAGER assignment must not already exist (one DM per req)
//   - TEAM assignment requires a parent MANAGER assignment
//   - INDIVIDUAL requires a parent TEAM assignment (or direct from MANAGER if DM bypasses)
//   - Requirement must be ACTIVE
// ─────────────────────────────────────────────────────────────────────────────

export const createAssignment = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({
        success: false,
        message: "No permission to assign requirements",
      });
      return;
    }

    const { id: requirementId } = req.params;
    const {
      type,
      recruiterId,
      teamId,
      teamMemberId,
      parentAssignmentId,
      allocatedOpenings,
      deadline,
    } = req.body;
    const actorId = req.user!.id;

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, ...reqScopeWhere(req.scopeFilter) },
      select: { id: true, reqCode: true, status: true, totalOpenings: true },
    });
    if (!requirement) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }
    if (requirement.status !== "ACTIVE") {
      res.status(409).json({
        success: false,
        message: "Can only assign ACTIVE requirements",
      });
      return;
    }

    // Validate parent chain
    if (type === "MANAGER") {
      const existing = await prisma.requirementAssignment.findFirst({
        where: { requirementId, assignmentType: "MANAGER", status: "ACTIVE" },
      });
      if (existing) {
        res.status(409).json({
          success: false,
          message:
            "A manager assignment already exists. Remove it first or update allocatedOpenings.",
        });
        return;
      }
    }

    if ((type === "TEAM" || type === "INDIVIDUAL") && !parentAssignmentId) {
      res.status(400).json({
        success: false,
        message:
          "parentAssignmentId is required for TEAM and INDIVIDUAL assignments",
      });
      return;
    }

    const assignment = await prisma.$transaction(async (tx) => {
      const created = await tx.requirementAssignment.create({
        data: {
          requirementId,
          assignmentType: type,
          status: "ACTIVE",
          recruiterId: recruiterId ?? null,
          teamId: teamId ?? null,
          teamMemberId: teamMemberId ?? null,
          parentAssignmentId: parentAssignmentId ?? null,
          allocatedOpenings: allocatedOpenings ?? requirement.totalOpenings,
          assignedById: actorId,
          deadline: deadline ? new Date(deadline) : null,
        },
        select: {
          id: true,
          assignmentType: true,
          allocatedOpenings: true,
          assignedAt: true,
          recruiter: { select: { id: true, firstName: true, lastName: true } },
          team: { select: { id: true, name: true } },
        },
      });

      const who =
        type === "TEAM"
          ? `Team: ${
              (
                await tx.team.findUnique({
                  where: { id: teamId },
                  select: { name: true },
                })
              )?.name
            }`
          : `${
              (
                await tx.user.findUnique({
                  where: { id: recruiterId },
                  select: { firstName: true, lastName: true },
                })
              )?.firstName ?? "unknown"
            }`;

      await logActivity(
        tx,
        requirementId,
        actorId,
        type === "MANAGER"
          ? "MANAGER_ASSIGNED"
          : type === "TEAM"
          ? "TEAM_ASSIGNED"
          : "RECRUITER_ASSIGNED",
        `${type} assigned to ${who} · ${
          allocatedOpenings ?? requirement.totalOpenings
        } openings`,
        { type, teamId, recruiterId }
      );

      return created;
    });

    res
      .status(201)
      .json({ success: true, message: "Assignment created", data: assignment });
  } catch (err) {
    console.error("createAssignment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create assignment" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /requirements/:id/assignments/:assignmentId
// Remove an assignment (also removes all child assignments)
// ─────────────────────────────────────────────────────────────────────────────

export const removeAssignment = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id: requirementId, assignmentId } = req.params;
    const { reason } = req.body;
    const actorId = req.user!.id;

    const assignment = await prisma.requirementAssignment.findFirst({
      where: { id: assignmentId, requirementId, status: "ACTIVE" },
      select: { id: true, assignmentType: true },
    });
    if (!assignment) {
      res.status(404).json({ success: false, message: "Assignment not found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Mark this + all children as REMOVED
      const markRemoved = async (parentId: string) => {
        await tx.requirementAssignment.update({
          where: { id: parentId },
          data: {
            status: "REMOVED",
            removedAt: new Date(),
            removedReason: reason ?? null,
          },
        });
        const children = await tx.requirementAssignment.findMany({
          where: { parentAssignmentId: parentId, status: "ACTIVE" },
          select: { id: true },
        });
        for (const child of children) await markRemoved(child.id);
      };
      await markRemoved(assignmentId);

      await logActivity(
        tx,
        requirementId,
        actorId,
        "ASSIGNMENT_REMOVED",
        `${assignment.assignmentType} assignment removed${
          reason ? `: ${reason}` : ""
        }`,
        { assignmentId, reason }
      );
    });

    res.json({ success: true, message: "Assignment removed" });
  } catch (err) {
    console.error("removeAssignment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to remove assignment" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/assignments/:assignmentId
// Update allocatedOpenings or deadline on an existing assignment
// ─────────────────────────────────────────────────────────────────────────────

export const updateAssignment = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, assignmentId } = req.params;
    const { allocatedOpenings, deadline } = req.body;

    const assignment = await prisma.requirementAssignment.findFirst({
      where: { id: assignmentId, requirementId, status: "ACTIVE" },
    });
    if (!assignment) {
      res.status(404).json({ success: false, message: "Assignment not found" });
      return;
    }

    const updated = await prisma.requirementAssignment.update({
      where: { id: assignmentId },
      data: {
        ...(allocatedOpenings !== undefined && { allocatedOpenings }),
        ...(deadline !== undefined && {
          deadline: deadline ? new Date(deadline) : null,
        }),
      },
      select: {
        id: true,
        assignmentType: true,
        allocatedOpenings: true,
        deadline: true,
      },
    });

    res.json({ success: true, message: "Assignment updated", data: updated });
  } catch (err) {
    console.error("updateAssignment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update assignment" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /requirements/:id/notes
// ─────────────────────────────────────────────────────────────────────────────

export const addNote = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const actorId = req.user!.id;

    if (!content?.trim()) {
      res.status(400).json({ success: false, message: "Content is required" });
      return;
    }

    const existing = await prisma.requirement.findFirst({
      where: { id, ...reqScopeWhere(req.scopeFilter) },
      select: { id: true },
    });
    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    const note = await prisma.$transaction(async (tx) => {
      const n = await tx.requirementNote.create({
        data: { requirementId: id, authorId: actorId, content: content.trim() },
        select: {
          id: true,
          content: true,
          createdAt: true,
          author: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      await logActivity(tx, id, actorId, "NOTE_ADDED", "Note added");
      return n;
    });

    res.status(201).json({ success: true, data: note });
  } catch (err) {
    console.error("addNote:", err);
    res.status(500).json({ success: false, message: "Failed to add note" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /requirements/:id/notes/:noteId
// ─────────────────────────────────────────────────────────────────────────────

export const deleteNote = async (req: Request, res: Response) => {
  try {
    const { id, noteId } = req.params;
    const actorId = req.user!.id;

    const note = await prisma.requirementNote.findFirst({
      where: { id: noteId, requirementId: id, authorId: actorId },
    });
    if (!note) {
      res
        .status(404)
        .json({ success: false, message: "Note not found or not yours" });
      return;
    }

    await prisma.requirementNote.delete({ where: { id: noteId } });
    res.json({ success: true, message: "Note deleted" });
  } catch (err) {
    console.error("deleteNote:", err);
    res.status(500).json({ success: false, message: "Failed to delete note" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/assignments/:assignmentId/progress
// Recruiter updates their own submission/interview/fill counts.
// When filledOpenings reaches allocatedOpenings, checks if all openings
// across all individual assignments are filled and suggests auto-close.
// ─────────────────────────────────────────────────────────────────────────────

export const updateProgress = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, assignmentId } = req.params;
    const { submissionsCount, interviewsCount, filledOpenings } = req.body;
    const actorId = req.user!.id;

    const assignment = await prisma.requirementAssignment.findFirst({
      where: {
        id: assignmentId,
        requirementId,
        status: "ACTIVE",
        assignmentType: "INDIVIDUAL",
        recruiterId: actorId, // only the assigned recruiter
      },
      select: { id: true, allocatedOpenings: true, filledOpenings: true },
    });

    if (!assignment) {
      res
        .status(404)
        .json({ success: false, message: "Assignment not found or not yours" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.requirementAssignment.update({
        where: { id: assignmentId },
        data: {
          ...(submissionsCount !== undefined && { submissionsCount }),
          ...(interviewsCount !== undefined && { interviewsCount }),
          ...(filledOpenings !== undefined && { filledOpenings }),
        },
        select: {
          id: true,
          submissionsCount: true,
          interviewsCount: true,
          filledOpenings: true,
          allocatedOpenings: true,
        },
      });

      await logActivity(
        tx,
        requirementId,
        actorId,
        "STATS_UPDATED",
        `Progress updated: ${result.submissionsCount} submissions, ${result.interviewsCount} interviews, ${result.filledOpenings} filled`
      );

      // Sync filledOpenings up to the parent TEAM assignment
      const parentTeamAssignment = await tx.requirementAssignment.findFirst({
        where: {
          requirementId,
          assignmentType: "TEAM",
          status: "ACTIVE",
          childAssignments: { some: { id: assignmentId } },
        },
        select: { id: true },
      });

      if (parentTeamAssignment) {
        const siblingFilled = await tx.requirementAssignment.aggregate({
          where: {
            parentAssignmentId: parentTeamAssignment.id,
            status: "ACTIVE",
          },
          _sum: { filledOpenings: true },
        });
        await tx.requirementAssignment.update({
          where: { id: parentTeamAssignment.id },
          data: { filledOpenings: siblingFilled._sum.filledOpenings ?? 0 },
        });
      }

      // Sync total filledOpenings up to the requirement itself
      const allIndividualFilled = await tx.requirementAssignment.aggregate({
        where: {
          requirementId,
          assignmentType: "INDIVIDUAL",
          status: "ACTIVE",
        },
        _sum: { filledOpenings: true },
      });
      const totalFilled = allIndividualFilled._sum.filledOpenings ?? 0;
      await tx.requirement.update({
        where: { id: requirementId },
        data: { filledOpenings: totalFilled },
      });

      return result;
    });

    // Check if fully filled — tell UI to suggest closing
    const req_ = await prisma.requirement.findUnique({
      where: { id: requirementId },
      select: { totalOpenings: true, filledOpenings: true },
    });
    const fullyFilled = req_
      ? req_.filledOpenings >= req_.totalOpenings
      : false;

    res.json({
      success: true,
      message: "Progress updated",
      data: updated,
      ...(fullyFilled && {
        hint: "All openings filled — consider closing this requirement",
      }),
    });
  } catch (err) {
    console.error("updateProgress:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update progress" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/my-queue
// What the logged-in user sees in their work queue
// Recruiters see their direct assignments
// TLs see team assignments for their teams
// DMs see manager assignments for their node
// ─────────────────────────────────────────────────────────────────────────────

export const getMyQueue = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const scope = req.scopeFilter;

    const assignments = await prisma.requirementAssignment.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { recruiterId: userId },
          ...(scope.teamIds?.length ? [{ teamId: { in: scope.teamIds } }] : []),
        ],
      },
      select: {
        id: true,
        assignmentType: true,
        allocatedOpenings: true,
        filledOpenings: true,
        submissionsCount: true,
        interviewsCount: true,
        deadline: true,
        breachedAt: true,
        assignedAt: true,
        team: { select: { id: true, name: true } },
        requirement: {
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            priority: true,
            totalOpenings: true,
            filledOpenings: true,
            respondBy: true,
            isRespondByBreached: true,
            salaryMin: true,
            salaryMax: true,
            salaryType: true,
            client: { select: { id: true, name: true } },
            skills: {
              where: { isMandatory: true },
              select: { skill: { select: { canonicalName: true } } },
              take: 4,
            },
          },
        },
      },
      orderBy: [{ requirement: { priority: "desc" } }, { assignedAt: "asc" }],
    });

    // Summary stats
    const stats = {
      total: assignments.length,
      breached: assignments.filter((a) => a.breachedAt).length,
      highPri: assignments.filter((a) => a.requirement.priority === "HIGH")
        .length,
    };

    res.json({ success: true, data: assignments, stats });
  } catch (err) {
    console.error("getMyQueue:", err);
    res.status(500).json({ success: false, message: "Failed to fetch queue" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/calendar
// Returns requirements with respondBy dates for calendar view
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementsCalendar = async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const scopeWhere = reqScopeWhere(req.scopeFilter);

    const where: any = {
      ...scopeWhere,
      status: { in: ["ACTIVE", "PENDING_APPROVAL"] },
      respondBy: {
        not: null,
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      },
    };

    const requirements = await prisma.requirement.findMany({
      where,
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        priority: true,
        respondBy: true,
        turnaroundDays: true,
        isRespondByBreached: true,
        totalOpenings: true,
        filledOpenings: true,
        client: { select: { id: true, name: true } },
        assignments: {
          where: { status: "ACTIVE", assignmentType: "INDIVIDUAL" },
          select: {
            recruiter: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { respondBy: "asc" },
    });

    res.json({ success: true, data: requirements });
  } catch (err) {
    console.error("getRequirementsCalendar:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch calendar" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/stats
// Dashboard stats — scoped to current user
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementStats = async (req: Request, res: Response) => {
  try {
    const scopeWhere = reqScopeWhere(req.scopeFilter);

    const [byStatus, byPriority, breached, recentlyActive] = await Promise.all([
      // Count by status
      prisma.requirement.groupBy({
        by: ["status"],
        where: scopeWhere,
        _count: { _all: true },
      }),
      // Count by priority (active only)
      prisma.requirement.groupBy({
        by: ["priority"],
        where: { ...scopeWhere, status: "ACTIVE" },
        _count: { _all: true },
      }),
      // Breached count
      prisma.requirement.count({
        where: { ...scopeWhere, isRespondByBreached: true, status: "ACTIVE" },
      }),
      // Last 7 days created
      prisma.requirement.count({
        where: {
          ...scopeWhere,
          createdAt: { gte: new Date(Date.now() - 7 * 86400_000) },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        byStatus: Object.fromEntries(
          byStatus.map((s) => [s.status, s._count._all])
        ),
        byPriority: Object.fromEntries(
          byPriority.map((p) => [p.priority, p._count._all])
        ),
        breached,
        recentlyCreated: recentlyActive,
      },
    });
  } catch (err) {
    console.error("getRequirementStats:", err);
    res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};
