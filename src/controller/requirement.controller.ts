// controller/requirement.controller.ts
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import {
  generateReqCode,
  getRequirementScopeWhere,
} from "@/services/requirementService";
import { getSubordinateIds } from "@/services/orgService";
// controller/requirement.controller.ts — add this

// GET /requirements/stats
export const getRequirementStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const [byStatusRaw, byPriorityRaw, breached, recentlyCreated] =
      await Promise.all([
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
            status: { in: ["ACTIVE", "PENDING_APPROVAL"] },
            OR: [{ isRespondByBreached: true }, { isTurnaroundBreached: true }],
          },
        }),
        prisma.requirement.count({
          where: {
            ...scopeWhere,
            deletedAt: null,
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

    const byStatus = Object.fromEntries(
      byStatusRaw.map((r) => [r.status, r._count._all])
    );
    const byPriority = Object.fromEntries(
      byPriorityRaw.map((r) => [r.priority, r._count._all])
    );

    res.json({
      success: true,
      data: { byStatus, byPriority, breached, recentlyCreated },
    });
  } catch (err) {
    console.error("getRequirementStats:", err);
    res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};
// ── GET /requirements
export const getRequirements = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      buId,
      serviceLineId,
      clientId,
      priority,
      page = "1",
      limit = "25",
      sortBy = "createdAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);
    const where: any = { ...scopeWhere };

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (clientId) where.clientId = clientId;
    if (serviceLineId) where.serviceLineId = serviceLineId;

    // BU filter — uses ancestorIds pattern
    if (buId) {
      where.businessUnit = {
        ancestorIds: { has: buId },
      };
    }

    if (search) {
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { reqCode: { contains: search, mode: "insensitive" } },
            { skills: { has: search } },
          ],
        },
      ];
    }

    const SORTABLE = [
      "createdAt",
      "updatedAt",
      "respondBy",
      "priority",
      "status",
    ];
    const orderBy = SORTABLE.includes(sortBy)
      ? { [sortBy]: sortDir as "asc" | "desc" }
      : { createdAt: "desc" as const };

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
          location: true,
          skills: true,
          totalOpenings: true,
          filledOpenings: true,
          activeApplications: true,
          interviewsScheduled: true,
          offersRolledOut: true,
          respondBy: true,
          isRespondByBreached: true,
          isTurnaroundBreached: true,
          createdAt: true,
          client: { select: { id: true, name: true } },
          businessUnit: { select: { id: true, name: true } },
          serviceLine: { select: { id: true, name: true } },
          clientSpoc: {
            select: {
              handler: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          // top level assignment only for list view
          assignments: {
            where: { status: "ACTIVE", depth: 0 },
            select: {
              id: true,
              depth: true,
              assignedTo: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
          _count: { select: { candidates: true, assignments: true } },
        },
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

// ── GET /requirements/:id  — full detail
export const getRequirementById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const requirement = await prisma.requirement.findFirst({
      where: { id, ...scopeWhere },
      select: {
        id: true,
        reqCode: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        jobType: true,
        remoteType: true,
        location: true,
        country: true,
        skills: true,
        experienceMin: true,
        experienceMax: true,
        salaryMin: true,
        salaryMax: true,
        salaryType: true,
        totalOpenings: true,
        filledOpenings: true,
        activeApplications: true,
        interviewsScheduled: true,
        offersRolledOut: true,
        startDate: true,
        endDate: true,
        respondBy: true,
        turnaroundDays: true,
        closedAt: true,
        isRespondByBreached: true,
        isTurnaroundBreached: true,
        jdFileKey: true,
        jdFileName: true,
        jdFileType: true,
        jdUploadedAt: true,
        createdAt: true,
        updatedAt: true,
        approvedAt: true,
        client: { select: { id: true, name: true, industry: true } },
        businessUnit: { select: { id: true, name: true } },
        serviceLine: { select: { id: true, name: true } },
        clientSpoc: {
          select: {
            id: true,
            isPrimary: true,
            handler: { select: { id: true, firstName: true, lastName: true } },
            serviceLine: { select: { id: true, name: true } },
          },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        closedBy: { select: { id: true, firstName: true, lastName: true } },
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
        notes: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            author: { select: { id: true, firstName: true, lastName: true } },
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

// ── GET /requirements/:id/tree  — full assignment tree with candidates
export const getRequirementTree = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    // verify access first
    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);
    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, ...scopeWhere },
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        totalOpenings: true,
        filledOpenings: true,
        activeApplications: true,
        interviewsScheduled: true,
        offersRolledOut: true,
      },
    });

    if (!requirement) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    // get subordinate ids to filter what this user can see in the tree
    const subordinateIds = isSuperAdmin
      ? null
      : [userId, ...(await getSubordinateIds(userId))];

    // fetch full assignment tree ordered by depth
    const assignments = await prisma.requirementAssignment.findMany({
      where: {
        requirementId,
        status: "ACTIVE",
        // if not superadmin — only show assignments visible to this user
        ...(subordinateIds && {
          assignedToId: { in: subordinateIds },
        }),
      },
      orderBy: { depth: "asc" },
      select: {
        id: true,
        depth: true,
        parentAssignmentId: true,
        status: true,
        allocatedOpenings: true,
        filledOpenings: true,
        submissionsCount: true,
        interviewsCount: true,
        deadline: true,
        deadlineMet: true,
        breachedAt: true,
        assignedAt: true,
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
            department: { select: { id: true, name: true } },
          },
        },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        assigneeBU: { select: { id: true, name: true } },
        candidates: {
          select: {
            id: true,
            candidateId: true,
            candidateName: true,
            candidateEmail: true,
            currentStage: true,
            stageUpdatedAt: true,
            rejectionReason: true,
            notes: true,
          },
          orderBy: { stageUpdatedAt: "desc" },
        },
      },
    });

    // build tree from flat list
    const assignmentMap = new Map<string, any>();
    const roots: any[] = [];

    assignments.forEach((a) => {
      assignmentMap.set(a.id, { ...a, children: [] });
    });

    assignments.forEach((a) => {
      if (a.parentAssignmentId && assignmentMap.has(a.parentAssignmentId)) {
        assignmentMap
          .get(a.parentAssignmentId)
          .children.push(assignmentMap.get(a.id));
      } else {
        roots.push(assignmentMap.get(a.id));
      }
    });

    res.json({
      success: true,
      data: {
        requirement,
        assignmentTree: roots,
      },
    });
  } catch (err) {
    console.error("getRequirementTree:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirement tree" });
  }
};

// ── POST /requirements
export const createRequirement = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const body = req.body;

    // fetch spoc to auto-populate clientId, buId, serviceLineId
    const spoc = await prisma.clientSpoc.findUnique({
      where: { id: body.clientSpocId },
      select: {
        clientId: true,
        businessUnitId: true,
        serviceLineId: true,
        isActive: true,
      },
    });

    if (!spoc || !spoc.isActive) {
      res
        .status(400)
        .json({ success: false, message: "Invalid or inactive SPOC" });
      return;
    }

    const reqCode = await generateReqCode();

    const requirement = await prisma.requirement.create({
      data: {
        reqCode,
        title: body.title,
        description: body.description ?? null,
        jobType: body.jobType,
        remoteType: body.remoteType,
        priority: body.priority ?? "MEDIUM",
        location: body.location ?? null,
        country: body.country ?? null,
        experienceMin: body.experienceMin ?? null,
        experienceMax: body.experienceMax ?? null,
        salaryMin: body.salaryMin ?? null,
        salaryMax: body.salaryMax ?? null,
        salaryType: body.salaryType ?? null,
        skills: body.skills ?? [],
        totalOpenings: body.totalOpenings ?? 1,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        respondBy: body.respondBy ? new Date(body.respondBy) : null,
        turnaroundDays: body.turnaroundDays ?? null,
        jdFileKey: body.jdFileKey ?? null,
        jdFileName: body.jdFileName ?? null,
        jdFileType: body.jdFileType ?? null,
        jdUploadedAt: body.jdFileKey ? new Date() : null,
        // auto-populated from spoc
        clientSpocId: body.clientSpocId,
        clientId: spoc.clientId,
        businessUnitId: spoc.businessUnitId,
        serviceLineId: spoc.serviceLineId,
        status: "DRAFT",
        createdById: actorId,
      },
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        createdAt: true,
      },
    });

    // log activity
    await prisma.requirementActivity.create({
      data: {
        requirementId: requirement.id,
        actorId,
        type: "REQUIREMENT_CREATED",
        summary: `Requirement ${reqCode} created`,
      },
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

// ── PUT /requirements/:id
export const updateRequirement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actorId = req.user!.id;
    const body = req.body;

    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    if (["CLOSED", "CANCELLED"].includes(existing.status)) {
      res.status(400).json({
        success: false,
        message: "Cannot edit a closed or cancelled requirement",
      });
      return;
    }

    const updated = await prisma.requirement.update({
      where: { id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && {
          description: body.description,
        }),
        ...(body.jobType !== undefined && { jobType: body.jobType }),
        ...(body.remoteType !== undefined && { remoteType: body.remoteType }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.location !== undefined && { location: body.location }),
        ...(body.country !== undefined && { country: body.country }),
        ...(body.experienceMin !== undefined && {
          experienceMin: body.experienceMin,
        }),
        ...(body.experienceMax !== undefined && {
          experienceMax: body.experienceMax,
        }),
        ...(body.salaryMin !== undefined && { salaryMin: body.salaryMin }),
        ...(body.salaryMax !== undefined && { salaryMax: body.salaryMax }),
        ...(body.salaryType !== undefined && { salaryType: body.salaryType }),
        ...(body.skills !== undefined && { skills: body.skills }),
        ...(body.totalOpenings !== undefined && {
          totalOpenings: body.totalOpenings,
        }),
        ...(body.startDate !== undefined && {
          startDate: body.startDate ? new Date(body.startDate) : null,
        }),
        ...(body.endDate !== undefined && {
          endDate: body.endDate ? new Date(body.endDate) : null,
        }),
        ...(body.respondBy !== undefined && {
          respondBy: body.respondBy ? new Date(body.respondBy) : null,
        }),
        ...(body.turnaroundDays !== undefined && {
          turnaroundDays: body.turnaroundDays,
        }),
        ...(body.jdFileKey !== undefined && {
          jdFileKey: body.jdFileKey,
          jdUploadedAt: new Date(),
        }),
        ...(body.jdFileName !== undefined && { jdFileName: body.jdFileName }),
        ...(body.jdFileType !== undefined && { jdFileType: body.jdFileType }),
      },
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        updatedAt: true,
      },
    });

    await prisma.requirementActivity.create({
      data: {
        requirementId: id,
        actorId,
        type: "STATUS_CHANGED",
        summary: `Requirement ${updated.reqCode} updated`,
      },
    });

    res.json({ success: true, message: "Requirement updated", data: updated });
  } catch (err) {
    console.error("updateRequirement:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update requirement" });
  }
};

// ── PATCH /requirements/:id/status
export const updateRequirementStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const actorId = req.user!.id;

    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, reqCode: true },
    });

    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    if (existing.status === status) {
      res
        .status(400)
        .json({ success: false, message: "Already in this status" });
      return;
    }

    const data: any = { status };
    if (status === "ACTIVE") {
      data.approvedById = actorId;
      data.approvedAt = new Date();
    }
    if (status === "CLOSED" || status === "CANCELLED") {
      data.closedById = actorId;
      data.closedAt = new Date();
    }

    const [updated] = await prisma.$transaction([
      prisma.requirement.update({
        where: { id },
        data,
        select: { id: true, reqCode: true, status: true },
      }),
      prisma.requirementStatusHistory.create({
        data: {
          requirementId: id,
          fromStatus: existing.status,
          toStatus: status,
          changedById: actorId,
          reason: reason ?? null,
        },
      }),
      prisma.requirementActivity.create({
        data: {
          requirementId: id,
          actorId,
          type: "STATUS_CHANGED",
          summary: `Status changed from ${existing.status} to ${status}`,
          meta: { reason },
        },
      }),
    ]);

    res.json({ success: true, message: "Status updated", data: updated });
  } catch (err) {
    console.error("updateRequirementStatus:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update status" });
  }
};

// ── DELETE /requirements/:id — soft delete
export const deleteRequirement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    if (existing.status === "ACTIVE") {
      res.status(400).json({
        success: false,
        message: "Cannot delete an active requirement. Close it first.",
      });
      return;
    }

    await prisma.requirement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.json({ success: true, message: "Requirement deleted" });
  } catch (err) {
    console.error("deleteRequirement:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete requirement" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /requirements/:id/assignments
// assignedBy must have the assignedTo user in their reporting subtree
export const createAssignment = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const { assignedToId, allocatedOpenings, deadline, parentAssignmentId } =
      req.body;
    const actorId = req.user!.id;

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true, status: true, clientId: true, reqCode: true },
    });

    if (!requirement) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    if (!["ACTIVE", "PENDING_APPROVAL"].includes(requirement.status)) {
      res.status(400).json({
        success: false,
        message: "Can only assign on active requirements",
      });
      return;
    }

    // verify assignedTo is in actor's subtree
    const subordinateIds = await getSubordinateIds(actorId);
    if (!subordinateIds.includes(assignedToId) && !req.user!.isSuperAdmin) {
      res.status(403).json({
        success: false,
        message: "You can only assign to people in your reporting tree",
      });
      return;
    }

    // check duplicate active assignment
    const duplicate = await prisma.requirementAssignment.findFirst({
      where: { requirementId, assignedToId, status: "ACTIVE" },
    });

    if (duplicate) {
      res.status(409).json({
        success: false,
        message: "Already actively assigned to this person",
      });
      return;
    }

    // resolve depth
    let depth = 0;
    if (parentAssignmentId) {
      const parent = await prisma.requirementAssignment.findUnique({
        where: { id: parentAssignmentId },
        select: { depth: true },
      });
      if (!parent) {
        res
          .status(404)
          .json({ success: false, message: "Parent assignment not found" });
        return;
      }
      depth = parent.depth + 1;
    }

    // fetch assignee context to snapshot
    const assignee = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { departmentId: true },
    });

    const assignment = await prisma.$transaction(async (tx) => {
      const a = await tx.requirementAssignment.create({
        data: {
          requirementId,
          assignedToId,
          assignedById: actorId,
          assigneeDepartmentId: assignee?.departmentId ?? null,
          clientId: requirement.clientId,
          depth,
          parentAssignmentId: parentAssignmentId ?? null,
          allocatedOpenings: allocatedOpenings ?? null,
          deadline: deadline ? new Date(deadline) : null,
          status: "ACTIVE",
        },
        select: {
          id: true,
          depth: true,
          status: true,
          allocatedOpenings: true,
          deadline: true,
          assignedAt: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          assignedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await tx.requirementActivity.create({
        data: {
          requirementId,
          actorId,
          type: "RECRUITER_ASSIGNED",
          summary: `Assigned to ${a.assignedTo.firstName} ${a.assignedTo.lastName}`,
        },
      });

      return a;
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

// ── DELETE /requirements/:id/assignments/:assignmentId
export const removeAssignment = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, assignmentId } = req.params;
    const { reason } = req.body;
    const actorId = req.user!.id;

    const assignment = await prisma.requirementAssignment.findFirst({
      where: { id: assignmentId, requirementId, status: "ACTIVE" },
      select: { id: true, assignedToId: true },
    });

    if (!assignment) {
      res.status(404).json({ success: false, message: "Assignment not found" });
      return;
    }

    await prisma.requirementAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "REMOVED",
        removedAt: new Date(),
        removedReason: reason ?? null,
      },
    });

    await prisma.requirementActivity.create({
      data: {
        requirementId,
        actorId,
        type: "ASSIGNMENT_REMOVED",
        summary: "Assignment removed",
        meta: { reason },
      },
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
// CANDIDATES
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /requirements/:id/candidates — push snapshot from candidate service
export const pushCandidate = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const { candidateId, candidateName, candidateEmail, assignmentId } =
      req.body;

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true },
    });

    if (!requirement) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    const existing = await prisma.requirementCandidate.findUnique({
      where: { requirementId_candidateId: { requirementId, candidateId } },
    });

    if (existing) {
      res.status(409).json({
        success: false,
        message: "Candidate already tagged to this requirement",
      });
      return;
    }

    const candidate = await prisma.requirementCandidate.create({
      data: {
        requirementId,
        candidateId,
        candidateName,
        candidateEmail: candidateEmail ?? null,
        assignmentId: assignmentId ?? null,
        currentStage: "SOURCED",
      },
      select: {
        id: true,
        candidateId: true,
        candidateName: true,
        currentStage: true,
        createdAt: true,
      },
    });

    // bump counter
    await prisma.requirement.update({
      where: { id: requirementId },
      data: { activeApplications: { increment: 1 } },
    });

    res
      .status(201)
      .json({ success: true, message: "Candidate tagged", data: candidate });
  } catch (err) {
    console.error("pushCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to tag candidate" });
  }
};

// ── PATCH /requirements/:id/candidates/:candidateId/stage
export const updateCandidateStage = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, candidateId } = req.params;
    const { currentStage, rejectionReason, notes } = req.body;

    const existing = await prisma.requirementCandidate.findUnique({
      where: { requirementId_candidateId: { requirementId, candidateId } },
      select: { id: true, currentStage: true },
    });

    if (!existing) {
      res.status(404).json({
        success: false,
        message: "Candidate not found on this requirement",
      });
      return;
    }

    const updated = await prisma.requirementCandidate.update({
      where: { requirementId_candidateId: { requirementId, candidateId } },
      data: {
        currentStage,
        rejectionReason: rejectionReason ?? null,
        notes: notes ?? null,
        stageUpdatedAt: new Date(),
      },
      select: {
        id: true,
        candidateId: true,
        candidateName: true,
        currentStage: true,
        stageUpdatedAt: true,
      },
    });

    // update counters based on stage
    const counterUpdate: any = {};
    if (currentStage === "INTERVIEW_SCHEDULED")
      counterUpdate.interviewsScheduled = { increment: 1 };
    if (currentStage === "OFFER_ROLLED")
      counterUpdate.offersRolledOut = { increment: 1 };
    if (currentStage === "JOINED")
      counterUpdate.filledOpenings = { increment: 1 };
    if (["REJECTED", "WITHDRAWN"].includes(currentStage)) {
      counterUpdate.activeApplications = { decrement: 1 };
    }

    if (Object.keys(counterUpdate).length > 0) {
      await prisma.requirement.update({
        where: { id: requirementId },
        data: counterUpdate,
      });
    }

    res.json({ success: true, message: "Stage updated", data: updated });
  } catch (err) {
    console.error("updateCandidateStage:", err);
    res.status(500).json({ success: false, message: "Failed to update stage" });
  }
};

// ── GET /requirements/:id/candidates
export const getCandidates = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const { stage, assignmentId } = req.query as Record<string, string>;

    const where: any = { requirementId };
    if (stage) where.currentStage = stage;
    if (assignmentId) where.assignmentId = assignmentId;

    const candidates = await prisma.requirementCandidate.findMany({
      where,
      select: {
        id: true,
        candidateId: true,
        candidateName: true,
        candidateEmail: true,
        currentStage: true,
        rejectionReason: true,
        notes: true,
        stageUpdatedAt: true,
        createdAt: true,
        assignment: {
          select: {
            id: true,
            assignedTo: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { stageUpdatedAt: "desc" },
    });

    res.json({ success: true, data: candidates });
  } catch (err) {
    console.error("getCandidates:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidates" });
  }
};
