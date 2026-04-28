import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
// import { prisma } from "../lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// GET /teams
// Query: buId?, category?, nodeType?, isActive?, search?
// Returns flat list + tree structure
// ─────────────────────────────────────────────────────────────────────────────

export const getTeams = async (req: Request, res: Response) => {
  try {
    const { buId, category, nodeType, isActive, search } = req.query as Record<
      string,
      string
    >;

    const where: any = {};

    if (buId) where.businessUnitId = buId;
    if (category) where.category = category;
    if (nodeType) where.nodeType = nodeType;
    if (isActive !== undefined) where.isActive = isActive === "true";
    if (search) where.name = { contains: search, mode: "insensitive" };

    const teams = await prisma.team.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        nodeType: true,
        category: true,
        parentTeamId: true,
        businessUnitId: true,
        createdAt: true,
        businessUnit: { select: { id: true, name: true } },
        _count: {
          select: { members: { where: { isActive: true } } },
        },
        members: {
          where: { isActive: true, teamRole: { in: ["LEAD", "CO_LEAD"] } },
          select: {
            id: true,
            teamRole: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeId: true,
              },
            },
          },
          orderBy: { teamRole: "asc" }, // LEAD before CO_LEAD
        },
      },
      orderBy: [{ businessUnitId: "asc" }, { name: "asc" }],
    });

    // Build tree client-side friendly — send flat + tree
    const teamMap = new Map(
      teams.map((t) => ({ ...t, children: [] as any[] })).map((t) => [t.id, t])
    );
    const roots: any[] = [];

    for (const team of teams) {
      const node = teamMap.get(team.id)!;
      if (team.parentTeamId && teamMap.has(team.parentTeamId)) {
        teamMap.get(team.parentTeamId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    res.json({ success: true, data: roots, flat: teams });
  } catch (err) {
    console.error("getTeams error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch teams" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /teams/:id
// Full detail — members, edges, child teams, client assignments, req assignments
// ─────────────────────────────────────────────────────────────────────────────

export const getTeamById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;

    if (!id) {
      res.status(400).json({ success: false, message: "Team ID is required" });

      return;
    }

    const team = await prisma.team.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        nodeType: true,
        category: true,
        parentTeamId: true,
        createdAt: true,
        updatedAt: true,

        // BU
        businessUnit: { select: { id: true, name: true, isActive: true } },

        // Parent team (for breadcrumb/context)
        parentTeam: {
          select: {
            id: true,
            name: true,
            nodeType: true,
            category: true,
            parentTeamId: true,
            parentTeam: {
              select: { id: true, name: true, nodeType: true },
            },
          },
        },

        // Direct child teams
        childTeams: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            nodeType: true,
            category: true,
            _count: { select: { members: { where: { isActive: true } } } },
            members: {
              where: { isActive: true, teamRole: { in: ["LEAD", "CO_LEAD"] } },
              select: {
                teamRole: true,
                user: { select: { id: true, firstName: true, lastName: true } },
              },
              orderBy: { teamRole: "asc" },
              take: 2,
            },
          },
          orderBy: { name: "asc" },
        },

        // All active members with full user info
        members: {
          where: { isActive: true },
          select: {
            id: true,
            teamRole: true,
            joinedAt: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                employeeId: true,
                phone: true,
                role: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: [{ teamRole: "asc" }, { joinedAt: "asc" }],
        },

        // TeamEdge — semantic relationships
        // parentEdges = edges where THIS team is the child (edges coming in from parent)
        parentEdges: {
          select: {
            id: true,
            edgeType: true,
            isActive: true,
            parentId: true,
            parent: { select: { id: true, name: true, nodeType: true } },
          },
        },
        // childEdges = edges where THIS team is the parent (edges going out to children)
        childEdges: {
          select: {
            id: true,
            edgeType: true,
            isActive: true,
            childId: true,
            child: { select: { id: true, name: true, nodeType: true } },
          },
        },

        // Visibility config
        visibilityConfig: true,

        // Clients this team is assigned to
        clientAssignments: {
          select: {
            assignedAt: true,
            client: {
              select: {
                id: true,
                name: true,
                category: true,
                industry: true,
                status: true,
                _count: {
                  select: {
                    requirements: {
                      where: { status: "ACTIVE", deletedAt: null },
                    },
                  },
                },
              },
            },
          },
          orderBy: { assignedAt: "desc" },
        },

        // Active requirement assignments to this team
        requirementAssignments: {
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
            requirement: {
              select: {
                id: true,
                reqCode: true,
                title: true,
                status: true,
                priority: true,
                totalOpenings: true,
                filledOpenings: true,
                salaryMin: true,
                salaryMax: true,
                salaryType: true,
                respondBy: true,
                isRespondByBreached: true,
                client: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { assignedAt: "desc" },
          take: 30,
        },

        // Member history — last 30 events
        memberHistories: {
          select: {
            id: true,
            event: true,
            eventAt: true,
            reason: true,
            userId: true,
            user: { select: { id: true, firstName: true, lastName: true } },
            performedById: true,
            performedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: { eventAt: "desc" },
          take: 30,
        },

        // Counts
        _count: {
          select: {
            members: { where: { isActive: true } },
            childTeams: { where: { isActive: true } },
            clientAssignments: true,
            requirementAssignments: { where: { status: "ACTIVE" } },
          },
        },
      },
    });

    if (!team) {
      res.status(404).json({ success: false, message: "Team not found" });
      return;
    }

    res.json({ success: true, data: team });
  } catch (err) {
    console.error("getTeamById error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch team" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /teams
// Creates team. If parentTeamId provided → auto-creates 3 TeamEdge rows (isActive: false)
// ─────────────────────────────────────────────────────────────────────────────

export const createTeam = async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      nodeType,
      category,
      businessUnitId,
      parentTeamId,
    } = req.body;

    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          name,
          description: description ?? null,
          nodeType: nodeType ?? "GROUP",
          category: category ?? null,
          businessUnitId: businessUnitId ?? null,
          parentTeamId: parentTeamId ?? null,
        },
        select: {
          id: true,
          name: true,
          nodeType: true,
          category: true,
          isActive: true,
          parentTeamId: true,
          businessUnitId: true,
          createdAt: true,
          businessUnit: { select: { id: true, name: true } },
          parentTeam: { select: { id: true, name: true } },
        },
      });

      // Auto-create 3 TeamEdge rows if parent provided
      if (parentTeamId) {
        await tx.teamEdge.createMany({
          data: [
            {
              parentId: parentTeamId,
              childId: created.id,
              edgeType: "ASSIGNS_TO",
              isActive: false,
            },
            {
              parentId: parentTeamId,
              childId: created.id,
              edgeType: "REPORTS_TO",
              isActive: false,
            },
            {
              parentId: parentTeamId,
              childId: created.id,
              edgeType: "VISIBILITY",
              isActive: false,
            },
          ],
          skipDuplicates: true,
        });
      }

      return created;
    });

    res
      .status(201)
      .json({ success: true, message: "Team created", data: team });
  } catch (err: any) {
    console.error("createTeam error:", err);
    if (err.code === "P2002") {
      res
        .status(409)
        .json({ success: false, message: "Team name already exists" });
      return;
    }
    res.status(500).json({ success: false, message: "Failed to create team" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /teams/:id
// Update team. If parentTeamId changes → delete old 3 edges, create 3 new ones
// ─────────────────────────────────────────────────────────────────────────────

export const updateTeam = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, nodeType, category, isActive, parentTeamId } =
      req.body;

    const existing = await prisma.team.findUnique({
      where: { id },
      select: { id: true, parentTeamId: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Team not found" });
      return;
    }

    const parentChanged =
      "parentTeamId" in req.body && parentTeamId !== existing.parentTeamId;

    const updated = await prisma.$transaction(async (tx) => {
      const team = await tx.team.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(nodeType !== undefined && { nodeType }),
          ...(category !== undefined && { category }),
          ...(isActive !== undefined && { isActive }),
          ...(parentChanged && { parentTeamId: parentTeamId ?? null }),
        },
        select: {
          id: true,
          name: true,
          nodeType: true,
          category: true,
          isActive: true,
          parentTeamId: true,
          businessUnit: { select: { id: true, name: true } },
          parentTeam: { select: { id: true, name: true } },
          updatedAt: true,
        },
      });

      // Rebuild edges if parent changed
      if (parentChanged) {
        // Delete old edges for old parent
        if (existing.parentTeamId) {
          await tx.teamEdge.deleteMany({
            where: {
              OR: [
                { parentId: existing.parentTeamId, childId: id },
                { parentId: id, childId: existing.parentTeamId },
              ],
            },
          });
        }

        // Create 3 new edges for new parent (inactive by default)
        if (parentTeamId) {
          await tx.teamEdge.createMany({
            data: [
              {
                parentId: parentTeamId,
                childId: id,
                edgeType: "ASSIGNS_TO",
                isActive: false,
              },
              {
                parentId: parentTeamId,
                childId: id,
                edgeType: "REPORTS_TO",
                isActive: false,
              },
              {
                parentId: parentTeamId,
                childId: id,
                edgeType: "VISIBILITY",
                isActive: false,
              },
            ],
            skipDuplicates: true,
          });
        }
      }

      return team;
    });

    res.json({ success: true, message: "Team updated", data: updated });
  } catch (err: any) {
    console.error("updateTeam error:", err);
    if (err.code === "P2002") {
      res
        .status(409)
        .json({ success: false, message: "Team name already exists" });
      return;
    }
    res.status(500).json({ success: false, message: "Failed to update team" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /teams/:id
// Blocked if has active members or active requirement assignments
// ─────────────────────────────────────────────────────────────────────────────

export const deleteTeam = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const team = await prisma.team.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            members: { where: { isActive: true } },
            requirementAssignments: { where: { status: "ACTIVE" } },
            childTeams: { where: { isActive: true } },
          },
        },
      },
    });

    if (!team) {
      res.status(404).json({ success: false, message: "Team not found" });
      return;
    }

    if (team._count.members > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete — team has ${team._count.members} active member(s). Remove them first.`,
      });
      return;
    }

    if (team._count.requirementAssignments > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete — team has ${team._count.requirementAssignments} active requirement assignment(s).`,
      });
      return;
    }

    if (team._count.childTeams > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete — team has ${team._count.childTeams} active child team(s).`,
      });
      return;
    }

    await prisma.team.delete({ where: { id } });

    res.json({ success: true, message: `Team "${team.name}" deleted` });
  } catch (err) {
    console.error("deleteTeam error:", err);
    res.status(500).json({ success: false, message: "Failed to delete team" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /teams/:id/edges/:edgeId
// Toggle a single edge isActive
// ─────────────────────────────────────────────────────────────────────────────

export const updateTeamEdge = async (req: Request, res: Response) => {
  try {
    const { edgeId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      res
        .status(400)
        .json({ success: false, message: "isActive (boolean) is required" });
      return;
    }

    const edge = await prisma.teamEdge.update({
      where: { id: edgeId },
      data: { isActive },
      select: {
        id: true,
        edgeType: true,
        isActive: true,
        parentId: true,
        childId: true,
      },
    });

    res.json({ success: true, message: "Edge updated", data: edge });
  } catch (err: any) {
    console.error("updateTeamEdge error:", err);
    if (err.code === "P2025") {
      res.status(404).json({ success: false, message: "Edge not found" });
      return;
    }
    res.status(500).json({ success: false, message: "Failed to update edge" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /teams/:id/members
// Add one or more members. Writes TeamMemberHistory (JOINED).
// ─────────────────────────────────────────────────────────────────────────────

export const addTeamMembers = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { members } = req.body as {
      members: Array<{
        userId: string;
        teamRole?: "LEAD" | "CO_LEAD" | "MEMBER";
      }>;
    };
    const actorId = (req as any).user?.id;

    if (!members?.length) {
      res
        .status(400)
        .json({ success: false, message: "members[] is required" });
      return;
    }

    const team = await prisma.team.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!team) {
      res.status(404).json({ success: false, message: "Team not found" });
      return;
    }

    const results = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const m of members) {
        // Upsert — re-activates if previously removed
        const member = await tx.teamMember.upsert({
          where: { userId_teamId: { userId: m.userId, teamId: id } },
          create: {
            userId: m.userId,
            teamId: id,
            teamRole: m.teamRole ?? "MEMBER",
            isActive: true,
          },
          update: {
            isActive: true,
            teamRole: m.teamRole ?? "MEMBER",
            deactivatedAt: null,
            deactivatedById: null,
            deactivationReason: null,
          },
          select: {
            id: true,
            teamRole: true,
            joinedAt: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                employeeId: true,
              },
            },
          },
        });

        await tx.teamMemberHistory.create({
          data: {
            teamMemberId: member.id,
            userId: m.userId,
            teamId: id,
            event: "JOINED",
            performedById: actorId ?? null,
          },
        });

        created.push(member);
      }
      return created;
    });

    res
      .status(201)
      .json({ success: true, message: "Member(s) added", data: results });
  } catch (err: any) {
    console.error("addTeamMembers error:", err);
    if (err.code === "P2002") {
      res.status(409).json({
        success: false,
        message: "One or more users are already members",
      });
      return;
    }
    res.status(500).json({ success: false, message: "Failed to add members" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /teams/:id/members/:userId/role
// Change a member's teamRole
// ─────────────────────────────────────────────────────────────────────────────

export const updateMemberRole = async (req: Request, res: Response) => {
  try {
    const { id, userId } = req.params;
    const { teamRole } = req.body;

    if (!["LEAD", "CO_LEAD", "MEMBER"].includes(teamRole)) {
      res.status(400).json({ success: false, message: "Invalid teamRole" });
      return;
    }

    const member = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId: id } },
    });

    if (!member || !member.isActive) {
      res
        .status(404)
        .json({ success: false, message: "Active member not found" });
      return;
    }

    const updated = await prisma.teamMember.update({
      where: { userId_teamId: { userId, teamId: id } },
      data: { teamRole },
      select: {
        id: true,
        teamRole: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.json({ success: true, message: "Role updated", data: updated });
  } catch (err) {
    console.error("updateMemberRole error:", err);
    res.status(500).json({ success: false, message: "Failed to update role" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /teams/:id/members/:userId
// Soft-remove member. Writes TeamMemberHistory (LEFT).
// ─────────────────────────────────────────────────────────────────────────────

export const removeTeamMember = async (req: Request, res: Response) => {
  try {
    const { id, userId } = req.params;
    const { reason } = req.body;
    const actorId = (req as any).user?.id;

    const member = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId: id } },
      select: { id: true, isActive: true },
    });

    if (!member || !member.isActive) {
      res
        .status(404)
        .json({ success: false, message: "Active member not found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.teamMember.update({
        where: { userId_teamId: { userId, teamId: id } },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedById: actorId ?? null,
          deactivationReason: reason ?? null,
        },
      });

      await tx.teamMemberHistory.create({
        data: {
          teamMemberId: member.id,
          userId,
          teamId: id,
          event: "LEFT",
          reason: reason ?? null,
          performedById: actorId ?? null,
        },
      });
    });

    res.json({ success: true, message: "Member removed" });
  } catch (err) {
    console.error("removeTeamMember error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to remove member" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /teams/:id/members
// Returns active members with full user details
// ─────────────────────────────────────────────────────────────────────────────

export const getTeamMembers = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const team = await prisma.team.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!team) {
      res.status(404).json({ success: false, message: "Team not found" });
      return;
    }

    const members = await prisma.teamMember.findMany({
      where: { teamId: id, isActive: true },
      select: {
        id: true,
        teamRole: true,
        joinedAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            employeeId: true,
            phone: true,
            isActive: true,
            role: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ teamRole: "asc" }, { joinedAt: "asc" }],
    });

    res.json({ success: true, data: members });
  } catch (err) {
    console.error("getTeamMembers error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch members" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /teams/:id/available-users
// Users in the same BU who are NOT already active members of this team
// ─────────────────────────────────────────────────────────────────────────────

export const getAvailableUsers = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { search } = req.query as { search?: string };

    const team = await prisma.team.findUnique({
      where: { id },
      select: { businessUnitId: true },
    });

    if (!team) {
      res.status(404).json({ success: false, message: "Team not found" });
      return;
    }

    // Current active member userIds
    const existing = await prisma.teamMember.findMany({
      where: { teamId: id, isActive: true },
      select: { userId: true },
    });
    const excludeIds = existing.map((m) => m.userId);

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        businessUnitId: team.businessUnitId,
        id: { notIn: excludeIds },
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { employeeId: { contains: search, mode: "insensitive" } },
          ],
        }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employeeId: true,
        role: { select: { id: true, name: true } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 50,
    });

    res.json({ success: true, data: users });
  } catch (err) {
    console.error("getAvailableUsers error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch available users" });
  }
};
