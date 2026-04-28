import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: build tree from ASSIGNS_TO edges
//
// Given a flat list of teams (with their childEdges loaded),
// derive parent→child relationships purely from ASSIGNS_TO edges
// and return root nodes with nested children.
//
// A team is a ROOT if no other team in the list has an ASSIGNS_TO
// edge pointing to it (no incoming ASSIGNS_TO within this arc).
// ─────────────────────────────────────────────────────────────────────────────

function buildTreeFromEdges(teams: any[]): any[] {
  // Map id → node with children array
  const nodeMap = new Map<string, any>();
  for (const t of teams) {
    nodeMap.set(t.id, { ...t, children: [] });
  }

  // Track which team IDs are children (have an incoming ASSIGNS_TO)
  const hasParent = new Set<string>();

  for (const t of teams) {
    for (const edge of t.childEdges ?? []) {
      if (edge.edgeType === "ASSIGNS_TO" && nodeMap.has(edge.childId)) {
        nodeMap.get(edge.childId)!; // ensure exists
        nodeMap.get(t.id)!.children.push(nodeMap.get(edge.childId)!);
        hasParent.add(edge.childId);
      }
    }
  }

  // Roots = teams with no incoming ASSIGNS_TO from within this arc
  const roots: any[] = [];
  for (const t of teams) {
    if (!hasParent.has(t.id)) roots.push(nodeMap.get(t.id)!);
  }

  return roots;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /teams
// Query: buId?, arcId?, category?, nodeType?, isActive?, search?
// Returns flat list + tree built from ASSIGNS_TO edges
// ─────────────────────────────────────────────────────────────────────────────

export const getTeams = async (req: Request, res: Response) => {
  try {
    const { buId, arcId, category, nodeType, isActive, search } =
      req.query as Record<string, string>;

    const where: any = {};
    if (buId) where.businessUnitId = buId;
    if (arcId) where.teamArcId = arcId;
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
        businessUnitId: true,
        teamArcId: true,
        createdAt: true,
        businessUnit: { select: { id: true, name: true } },
        teamArc: { select: { id: true, name: true } },
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
          orderBy: { teamRole: "asc" },
        },
        childEdges: {
          select: {
            id: true,
            edgeType: true,
            isActive: true,
            childId: true,
            child: { select: { id: true, name: true, nodeType: true } },
          },
        },
        parentEdges: {
          select: {
            id: true,
            edgeType: true,
            isActive: true,
            parentId: true,
            parent: { select: { id: true, name: true, nodeType: true } },
          },
        },
      },
      orderBy: [{ teamArcId: "asc" }, { name: "asc" }],
    });

    const tree = buildTreeFromEdges(teams);

    res.json({ success: true, data: tree, flat: teams });
  } catch (err) {
    console.error("getTeams error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch teams" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /teams/:id
// Full detail — members, edges, children, clients, reqs, history
// "children" derived from ASSIGNS_TO childEdges
// ─────────────────────────────────────────────────────────────────────────────

export const getTeamById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const team = await prisma.team.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        nodeType: true,
        category: true,
        teamArcId: true,
        createdAt: true,
        updatedAt: true,

        businessUnit: { select: { id: true, name: true, isActive: true } },
        teamArc: { select: { id: true, name: true, isActive: true } },

        // Active members
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

        // Incoming edges (this team is the child)
        parentEdges: {
          select: {
            id: true,
            edgeType: true,
            isActive: true,
            parentId: true,
            parent: { select: { id: true, name: true, nodeType: true } },
          },
        },
        // Outgoing edges (this team is the parent)
        childEdges: {
          select: {
            id: true,
            edgeType: true,
            isActive: true,
            childId: true,
            child: { select: { id: true, name: true, nodeType: true } },
          },
        },

        visibilityConfig: true,

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

        _count: {
          select: {
            members: { where: { isActive: true } },
            clientAssignments: true,
            requirementAssignments: { where: { status: "ACTIVE" } },
            // child count = teams this team has ASSIGNS_TO edges to
            childEdges: { where: { edgeType: "ASSIGNS_TO", isActive: true } },
          },
        },
      },
    });

    if (!team) {
      res.status(404).json({ success: false, message: "Team not found" });
      return;
    }

    // Derive "parent teams" from incoming ASSIGNS_TO edges
    const parentTeams = team.parentEdges
      .filter((e) => e.edgeType === "ASSIGNS_TO")
      .map((e) => e.parent);

    // Derive "child teams" from outgoing ASSIGNS_TO edges — fetch their member counts
    const childTeamIds = team.childEdges
      .filter((e) => e.edgeType === "ASSIGNS_TO")
      .map((e) => e.childId);

    let childTeams: any[] = [];
    if (childTeamIds.length > 0) {
      childTeams = await prisma.team.findMany({
        where: { id: { in: childTeamIds }, isActive: true },
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
      });
    }

    res.json({
      success: true,
      data: {
        ...team,
        parentTeams, // replaces old parentTeam (single) — now can have multiple
        childTeams,
      },
    });
  } catch (err) {
    console.error("getTeamById error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch team" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /teams
// Creates a standalone team. No parentTeamId.
// Link it to other teams by creating edges via POST /teams/:id/edges
// ─────────────────────────────────────────────────────────────────────────────

export const createTeam = async (req: Request, res: Response) => {
  try {
    const { name, description, nodeType, category, businessUnitId, teamArcId } =
      req.body;

    const arc = await prisma.teamArc.findUnique({
      where: { id: teamArcId },
      select: { id: true, businessUnitId: true },
    });
    if (!arc) {
      res.status(404).json({ success: false, message: "Team arc not found" });
      return;
    }

    const team = await prisma.team.create({
      data: {
        name,
        description: description ?? null,
        nodeType: nodeType ?? "GROUP",
        category: category ?? null,
        businessUnitId: businessUnitId ?? arc.businessUnitId,
        teamArcId,
      },
      select: {
        id: true,
        name: true,
        nodeType: true,
        category: true,
        isActive: true,
        teamArcId: true,
        businessUnitId: true,
        createdAt: true,
        businessUnit: { select: { id: true, name: true } },
        teamArc: { select: { id: true, name: true } },
      },
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
// Update name, description, nodeType, category, isActive, teamArcId.
// No parentTeamId — use edge endpoints to change links.
// ─────────────────────────────────────────────────────────────────────────────

export const updateTeam = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, nodeType, category, isActive, teamArcId } =
      req.body;

    const existing = await prisma.team.findUnique({
      where: { id },
      select: { id: true, teamArcId: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Team not found" });
      return;
    }

    if (teamArcId && teamArcId !== existing.teamArcId) {
      const arc = await prisma.teamArc.findUnique({ where: { id: teamArcId } });
      if (!arc) {
        res.status(404).json({ success: false, message: "Team arc not found" });
        return;
      }
    }

    const team = await prisma.team.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(nodeType !== undefined && { nodeType }),
        ...(category !== undefined && { category }),
        ...(isActive !== undefined && { isActive }),
        ...(teamArcId !== undefined && { teamArcId }),
      },
      select: {
        id: true,
        name: true,
        nodeType: true,
        category: true,
        isActive: true,
        teamArcId: true,
        updatedAt: true,
        businessUnit: { select: { id: true, name: true } },
        teamArc: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, message: "Team updated", data: team });
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
// Blocked if has active members or active requirement assignments.
// Edges are cascade-deleted by Prisma (onDelete: Cascade on TeamEdge).
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
            childEdges: { where: { edgeType: "ASSIGNS_TO", isActive: true } },
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
        message: `Cannot delete — team has ${team._count.requirementAssignments} active assignment(s).`,
      });
      return;
    }
    if (team._count.childEdges > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete — team has ${team._count.childEdges} active child link(s). Unlink them first.`,
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
// POST /teams/:id/edges
// Create an edge between this team and a target team.
// direction: "outgoing" = this team is parent (assigns to target)
//            "incoming" = target is parent (assigns to this team)
// When creating ASSIGNS_TO this effectively "links" two teams in the hierarchy.
// ─────────────────────────────────────────────────────────────────────────────

export const createTeamEdge = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { targetTeamId, edgeType, direction = "outgoing" } = req.body;

    const parentId = direction === "outgoing" ? id : targetTeamId;
    const childId = direction === "outgoing" ? targetTeamId : id;

    const [parent, child] = await Promise.all([
      prisma.team.findUnique({
        where: { id: parentId },
        select: { id: true, name: true },
      }),
      prisma.team.findUnique({
        where: { id: childId },
        select: { id: true, name: true },
      }),
    ]);
    if (!parent || !child) {
      res
        .status(404)
        .json({ success: false, message: "One or both teams not found" });
      return;
    }

    // Prevent self-loop
    if (parentId === childId) {
      res
        .status(400)
        .json({
          success: false,
          message: "Cannot create edge from a team to itself",
        });
      return;
    }

    const edge = await prisma.teamEdge.upsert({
      where: { parentId_childId_edgeType: { parentId, childId, edgeType } },
      update: { isActive: true },
      create: { parentId, childId, edgeType, isActive: true },
      select: {
        id: true,
        edgeType: true,
        isActive: true,
        parentId: true,
        childId: true,
        parent: { select: { id: true, name: true } },
        child: { select: { id: true, name: true } },
      },
    });

    res
      .status(201)
      .json({ success: true, message: "Edge created", data: edge });
  } catch (err) {
    console.error("createTeamEdge error:", err);
    res.status(500).json({ success: false, message: "Failed to create edge" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /teams/:id/edges/:edgeId
// Toggle a single edge isActive on/off.
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
// DELETE /teams/:id/edges/:edgeId
// Hard-delete an edge. This IS the "unlink" operation.
// Logs to TeamUnlinkHistory when deleting an ASSIGNS_TO edge.
// ─────────────────────────────────────────────────────────────────────────────

export const deleteTeamEdge = async (req: Request, res: Response) => {
  try {
    const { edgeId } = req.params;
    const actorId = (req as any).user?.id;

    const edge = await prisma.teamEdge.findUnique({
      where: { id: edgeId },
      select: { id: true, parentId: true, childId: true, edgeType: true },
    });
    if (!edge) {
      res.status(404).json({ success: false, message: "Edge not found" });
      return;
    }

    // Count active assignments affected (only relevant for ASSIGNS_TO)
    let pendingCount = 0;
    if (edge.edgeType === "ASSIGNS_TO") {
      pendingCount = await prisma.requirementAssignment.count({
        where: {
          OR: [
            { teamId: edge.childId, status: "ACTIVE" },
            { teamId: edge.parentId, status: "ACTIVE" },
          ],
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.teamEdge.delete({ where: { id: edgeId } });

      // Log unlink history only for ASSIGNS_TO (structural link)
      if (edge.edgeType === "ASSIGNS_TO" && actorId) {
        await tx.teamUnlinkHistory.create({
          data: {
            teamId: edge.childId,
            unlinkedFromTeamId: edge.parentId,
            unlinkedById: actorId,
            pendingAssignmentsCount: pendingCount,
          },
        });
      }
    });

    res.json({
      success: true,
      message: "Edge deleted",
      ...(pendingCount > 0 && {
        warning: `${pendingCount} active assignment(s) may be affected by this unlink`,
      }),
    });
  } catch (err: any) {
    console.error("deleteTeamEdge error:", err);
    if (err.code === "P2025") {
      res.status(404).json({ success: false, message: "Edge not found" });
      return;
    }
    res.status(500).json({ success: false, message: "Failed to delete edge" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /teams/:id/members
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
      res
        .status(409)
        .json({
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
// ─────────────────────────────────────────────────────────────────────────────

export const updateMemberRole = async (req: Request, res: Response) => {
  try {
    const { id, userId } = req.params;
    const { teamRole } = req.body;

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
// Soft-remove. Writes TeamMemberHistory LEFT event.
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

// ═════════════════════════════════════════════════════════════════════════════
// ARC CONTROLLERS
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// GET /arcs
// ─────────────────────────────────────────────────────────────────────────────

export const getArcs = async (req: Request, res: Response) => {
  try {
    const { buId, isActive, search } = req.query as Record<string, string>;

    const where: any = {};
    if (buId) where.businessUnitId = buId;
    if (isActive !== undefined) where.isActive = isActive === "true";
    if (search) where.name = { contains: search, mode: "insensitive" };

    const arcs = await prisma.teamArc.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        businessUnit: { select: { id: true, name: true } },
        _count: { select: { teams: { where: { isActive: true } } } },
        // Root teams = teams in this arc with no incoming ASSIGNS_TO
        // We can't filter that in Prisma without a raw query, so return all
        // and let the frontend determine roots from edges
        teams: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            nodeType: true,
            category: true,
            _count: { select: { members: { where: { isActive: true } } } },
            parentEdges: {
              where: { edgeType: "ASSIGNS_TO" },
              select: { parentId: true },
            },
          },
        },
      },
      orderBy: [{ businessUnitId: "asc" }, { name: "asc" }],
    });

    // Tag root teams server-side for convenience
    const arcsWithRoots = arcs.map((arc) => ({
      ...arc,
      rootTeams: arc.teams.filter((t) => t.parentEdges.length === 0),
    }));

    res.json({ success: true, data: arcsWithRoots });
  } catch (err) {
    console.error("getArcs error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch arcs" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /arcs/:id
// Full arc — all teams with edges, tree built from ASSIGNS_TO
// ─────────────────────────────────────────────────────────────────────────────

export const getArcById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const arc = await prisma.teamArc.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        businessUnit: { select: { id: true, name: true, isActive: true } },
        _count: { select: { teams: { where: { isActive: true } } } },
      },
    });
    if (!arc) {
      res.status(404).json({ success: false, message: "Arc not found" });
      return;
    }

    const teams = await prisma.team.findMany({
      where: { teamArcId: id, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        nodeType: true,
        category: true,
        createdAt: true,
        _count: { select: { members: { where: { isActive: true } } } },
        members: {
          where: { isActive: true, teamRole: { in: ["LEAD", "CO_LEAD"] } },
          select: {
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
          orderBy: { teamRole: "asc" },
        },
        // All edges for layout + display
        parentEdges: {
          select: {
            id: true,
            edgeType: true,
            isActive: true,
            parentId: true,
            parent: { select: { id: true, name: true, nodeType: true } },
          },
        },
        childEdges: {
          select: {
            id: true,
            edgeType: true,
            isActive: true,
            childId: true,
            child: { select: { id: true, name: true, nodeType: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    // Build tree from ASSIGNS_TO edges
    const tree = buildTreeFromEdges(teams);

    res.json({
      success: true,
      data: {
        ...arc,
        tree, // top-down hierarchy derived from ASSIGNS_TO
        flat: teams,
      },
    });
  } catch (err) {
    console.error("getArcById error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch arc" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /arcs
// ─────────────────────────────────────────────────────────────────────────────

export const createArc = async (req: Request, res: Response) => {
  try {
    const { name, description, businessUnitId } = req.body;

    const bu = await prisma.businessUnit.findUnique({
      where: { id: businessUnitId },
    });
    if (!bu) {
      res
        .status(404)
        .json({ success: false, message: "Business unit not found" });
      return;
    }

    const arc = await prisma.teamArc.create({
      data: {
        name,
        description: description ?? null,
        businessUnitId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        createdAt: true,
        businessUnit: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, message: "Arc created", data: arc });
  } catch (err: any) {
    console.error("createArc error:", err);
    if (err.code === "P2002") {
      res
        .status(409)
        .json({
          success: false,
          message: "Arc name already exists in this BU",
        });
      return;
    }
    res.status(500).json({ success: false, message: "Failed to create arc" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /arcs/:id
// ─────────────────────────────────────────────────────────────────────────────

export const updateArc = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;

    const existing = await prisma.teamArc.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: "Arc not found" });
      return;
    }

    const arc = await prisma.teamArc.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        updatedAt: true,
        businessUnit: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, message: "Arc updated", data: arc });
  } catch (err: any) {
    console.error("updateArc error:", err);
    if (err.code === "P2002") {
      res
        .status(409)
        .json({
          success: false,
          message: "Arc name already exists in this BU",
        });
      return;
    }
    res.status(500).json({ success: false, message: "Failed to update arc" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /arcs/:id
// Blocked if has active teams
// ─────────────────────────────────────────────────────────────────────────────

export const deleteArc = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const arc = await prisma.teamArc.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: { select: { teams: { where: { isActive: true } } } },
      },
    });
    if (!arc) {
      res.status(404).json({ success: false, message: "Arc not found" });
      return;
    }

    if (arc._count.teams > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete — arc has ${arc._count.teams} active team(s). Remove or reassign them first.`,
      });
      return;
    }

    await prisma.teamArc.delete({ where: { id } });
    res.json({ success: true, message: `Arc "${arc.name}" deleted` });
  } catch (err) {
    console.error("deleteArc error:", err);
    res.status(500).json({ success: false, message: "Failed to delete arc" });
  }
};
