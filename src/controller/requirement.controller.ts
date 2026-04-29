import { reqScopeWhere } from "@/middleware/scopeFilter.middleware";
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

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

// ─────────────────────────────────────────────────────────────────────────────
// Select shapes
// ─────────────────────────────────────────────────────────────────────────────

const REQ_LIST_SELECT = {
  id: true,
  reqCode: true,
  title: true,
  status: true,
  priority: true,
  jobType: true,
  remoteType: true,
  totalOpenings: true,
  filledOpenings: true,
  activeApplications: true,
  salaryMin: true,
  salaryMax: true,
  salaryType: true,
  respondBy: true,
  turnaroundDays: true,
  isRespondByBreached: true,
  isTurnaroundBreached: true,
  startDate: true,
  endDate: true,
  location: true,
  country: true,
  createdAt: true,
  updatedAt: true,
  businessUnit: { select: { id: true, name: true } },
  client: { select: { id: true, name: true, industry: true } },
  clientContact: {
    select: { id: true, firstName: true, lastName: true, designation: true },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  skills: {
    where: { isMandatory: true },
    select: { skill: { select: { id: true, canonicalName: true } } },
    take: 5,
  },
  assignments: {
    where: { status: "ACTIVE" },
    select: {
      id: true,
      assignmentType: true,
      allocatedOpenings: true,
      filledOpenings: true,
      deadline: true,
      breachedAt: true,
      recruiter: { select: { id: true, firstName: true, lastName: true } },
      team: { select: { id: true, name: true } },
    },
  },
} as const;

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
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirements = async (req: Request, res: Response) => {
  try {
    const {
      // text
      search,
      // exact filters
      status,
      priority,
      jobType,
      remoteType,
      // relation filters
      clientId,
      buId,
      createdById,
      assignedTeamId,
      // boolean toggles
      assignedToMe,
      breached,
      // date range filters
      respondByFrom,
      respondByTo,
      startDateFrom,
      startDateTo,
      createdFrom,
      createdTo,
      // pagination
      page = "1",
      limit = "25",
      sortBy = "createdAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100); // cap at 100

    const scopeWhere = reqScopeWhere(req.scopeFilter);

    const where: any = { ...scopeWhere, deletedAt: null };

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (jobType) where.jobType = jobType;
    if (remoteType) where.remoteType = remoteType;
    if (clientId) where.clientId = clientId;
    if (buId) where.businessUnitId = buId;
    if (createdById) where.createdById = createdById;

    if (breached === "true") where.isRespondByBreached = true;

    // assignedToMe — only reqs where caller has an active INDIVIDUAL assignment
    if (assignedToMe === "true" && req.user?.id) {
      where.assignments = {
        some: { recruiterId: req.user.id, status: "ACTIVE" },
      };
    }

    // assignedTeamId — reqs assigned to a specific team
    if (assignedTeamId) {
      where.assignments = {
        some: { teamId: assignedTeamId, status: "ACTIVE" },
      };
    }

    // respondBy date range
    if (respondByFrom || respondByTo) {
      where.respondBy = {
        ...(respondByFrom && { gte: new Date(respondByFrom) }),
        ...(respondByTo && { lte: new Date(respondByTo) }),
      };
    }

    // startDate range
    if (startDateFrom || startDateTo) {
      where.startDate = {
        ...(startDateFrom && { gte: new Date(startDateFrom) }),
        ...(startDateTo && { lte: new Date(startDateTo) }),
      };
    }

    // createdAt range
    if (createdFrom || createdTo) {
      where.createdAt = {
        ...(createdFrom && { gte: new Date(createdFrom) }),
        ...(createdTo && { lte: new Date(createdTo) }),
      };
    }

    // search across title, reqCode, client name
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { reqCode: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    // sortBy whitelist
    const SORTABLE = [
      "createdAt",
      "updatedAt",
      "respondBy",
      "priority",
      "status",
      "startDate",
    ];
    const orderBy = SORTABLE.includes(sortBy)
      ? { [sortBy]: sortDir as "asc" | "desc" }
      : { createdAt: "desc" as const };

    const [total, requirements] = await Promise.all([
      prisma.requirement.count({ where }),
      prisma.requirement.findMany({
        where,
        select: REQ_LIST_SELECT,
        orderBy,
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
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const requirement = await prisma.requirement.findFirst({
      where: { id, deletedAt: null, ...reqScopeWhere(req.scopeFilter) },
      select: {
        ...REQ_DETAIL_SELECT,
        assignments: {
          where: { status: "ACTIVE", parentAssignmentId: null },
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

    if (!requirement) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    res.json({
      success: true,
      data: requirement,
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
      skillIds = [],
    } = req.body;

    const actorId = req.user!.id;
    const buId = businessUnitId ?? req.user!.businessUnitId;

    const bu = buId
      ? await prisma.businessUnit.findUnique({
          where: { id: buId },
          select: { name: true },
        })
      : null;

    // generate unique reqCode
    let reqCode = generateReqCode(bu?.name ?? "SFJ");
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

      if (skillIds.length) {
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
        `${created.reqCode} created`
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
      where: { id, deletedAt: null, ...reqScopeWhere(req.scopeFilter) },
      select: { id: true, status: true, reqCode: true },
    });

    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

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
      skillIds,
    } = req.body;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.requirement.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(clientContactId !== undefined && { clientContactId }),
          ...(businessUnitId !== undefined && { businessUnitId }),
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

      // replace skills if provided
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
        `${result.reqCode} updated`
      );
      return result;
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
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL", "ACTIVE", "CANCELLED"],
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

    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null, ...reqScopeWhere(req.scopeFilter) },
      select: { id: true, status: true, reqCode: true },
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
        message: `Cannot transition ${
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
      if (toStatus === "CLOSED" || toStatus === "CANCELLED") {
        data.closedById = actorId;
        data.closedAt = new Date();
      }

      const result = await tx.requirement.update({
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
        `Status: ${existing.status} → ${toStatus}${
          reason ? ` (${reason})` : ""
        }`,
        { from: existing.status, to: toStatus }
      );

      return result;
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
// ─────────────────────────────────────────────────────────────────────────────

export const createAssignment = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res
        .status(403)
        .json({ success: false, message: "No permission to assign" });
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
      where: {
        id: requirementId,
        deletedAt: null,
        ...reqScopeWhere(req.scopeFilter),
      },
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

    if (type === "MANAGER") {
      const existing = await prisma.requirementAssignment.findFirst({
        where: { requirementId, assignmentType: "MANAGER", status: "ACTIVE" },
      });
      if (existing) {
        res.status(409).json({
          success: false,
          message: "A manager assignment already exists",
        });
        return;
      }
    }

    // INDIVIDUAL always needs a parent
    // TEAM at top level (sales → DM) has no parent — that's valid
    if (type === "INDIVIDUAL" && !parentAssignmentId) {
      res.status(400).json({
        success: false,
        message: "parentAssignmentId required for INDIVIDUAL assignments",
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
          ? (
              await tx.team.findUnique({
                where: { id: teamId },
                select: { name: true },
              })
            )?.name ?? "Team"
          : (
              await tx.user.findUnique({
                where: { id: recruiterId },
                select: { firstName: true },
              })
            )?.firstName ?? "Unknown";

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
// ─────────────────────────────────────────────────────────────────────────────

export const removeAssignment = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id: requirementId, assignmentId } = req.params;
    // const { reason } = req.body;
    const reason = "Removed by admin";
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
      const markRemoved = async (parentId: string) => {
        await tx.requirementAssignment.update({
          where: { id: parentId },
          data: {
            status: "REMOVED",
            removedAt: new Date(),
            // removedReason: reason ?? null,
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

    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null, ...reqScopeWhere(req.scopeFilter) },
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
        recruiterId: actorId,
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
        `Progress: ${result.submissionsCount} submissions, ${result.interviewsCount} interviews, ${result.filledOpenings} filled`
      );

      // bubble up to parent TEAM assignment
      const parentTeam = await tx.requirementAssignment.findFirst({
        where: {
          requirementId,
          assignmentType: "TEAM",
          status: "ACTIVE",
          childAssignments: { some: { id: assignmentId } },
        },
        select: { id: true },
      });

      if (parentTeam) {
        const siblingFilled = await tx.requirementAssignment.aggregate({
          where: { parentAssignmentId: parentTeam.id, status: "ACTIVE" },
          _sum: { filledOpenings: true },
        });
        await tx.requirementAssignment.update({
          where: { id: parentTeam.id },
          data: { filledOpenings: siblingFilled._sum.filledOpenings ?? 0 },
        });
      }

      // bubble up to requirement
      const allFilled = await tx.requirementAssignment.aggregate({
        where: {
          requirementId,
          assignmentType: "INDIVIDUAL",
          status: "ACTIVE",
        },
        _sum: { filledOpenings: true },
      });
      await tx.requirement.update({
        where: { id: requirementId },
        data: { filledOpenings: allFilled._sum.filledOpenings ?? 0 },
      });

      return result;
    });

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

    res.json({
      success: true,
      data: assignments,
      stats: {
        total: assignments.length,
        breached: assignments.filter((a) => a.breachedAt).length,
        highPri: assignments.filter((a) => a.requirement.priority === "HIGH")
          .length,
      },
    });
  } catch (err) {
    console.error("getMyQueue:", err);
    res.status(500).json({ success: false, message: "Failed to fetch queue" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/calendar
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementsCalendar = async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const scopeWhere = reqScopeWhere(req.scopeFilter);

    const where: any = {
      ...scopeWhere,
      deletedAt: null,
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
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementStats = async (req: Request, res: Response) => {
  try {
    const scopeWhere = reqScopeWhere(req.scopeFilter);

    const [byStatus, byPriority, breached, recentlyActive] = await Promise.all([
      prisma.requirement.groupBy({
        by: ["status"],
        where: { ...scopeWhere, deletedAt: null },
        _count: { _all: true },
      }),
      prisma.requirement.groupBy({
        by: ["priority"],
        where: { ...scopeWhere, deletedAt: null, status: "ACTIVE" },
        _count: { _all: true },
      }),
      prisma.requirement.count({
        where: {
          ...scopeWhere,
          deletedAt: null,
          isRespondByBreached: true,
          status: "ACTIVE",
        },
      }),
      prisma.requirement.count({
        where: {
          ...scopeWhere,
          deletedAt: null,
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
