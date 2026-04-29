import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import { reqScopeWhere } from "@/middleware/scopeFilter.middleware";

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/assignable-targets
//
// Returns who the calling user can assign this requirement to.
// The response shape changes based on caller's existing assignments on this req:
//
//   Sales (no assignment yet on this req from their side)
//   → returns DM-level teams reachable via ASSIGNS_TO from caller's teams
//   → these are INDIVIDUAL-nodeType teams directly below their team in the arc
//
//   DM (has a team assignment on this req already — their team is the target)
//   → returns their child teams (ASSIGNS_TO edges below them)
//   → returns members of those child teams (for direct individual assignment)
//
//   Others (recruiter, team lead etc)
//   → returns empty — they have no assign authority
//
// Frontend uses this to build the assign dialog without ever showing UUIDs.
// ─────────────────────────────────────────────────────────────────────────────

export const getAssignableTargets = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const userId = req.user!.id;

    // Verify requirement exists and caller can see it
    const requirement = await prisma.requirement.findFirst({
      where: {
        id: requirementId,
        deletedAt: null,
        ...reqScopeWhere(req.scopeFilter),
      },
      select: { id: true, status: true, totalOpenings: true },
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

    // Get caller's team memberships (all active)
    const myMemberships = await prisma.teamMember.findMany({
      where: { userId, isActive: true },
      select: {
        teamId: true,
        teamRole: true,
        team: {
          select: { id: true, name: true, nodeType: true, category: true },
        },
      },
    });

    const myTeamIds = myMemberships.map((m) => m.teamId);

    if (myTeamIds.length === 0) {
      res.json({ success: true, role: "none", targets: [] });
      return;
    }

    // ── Check if caller is a DM ────────────────────────────────────────────
    // A DM sits on an INDIVIDUAL-nodeType team that has an active assignment
    // on this requirement, and has ASSIGNS_TO children (delivery teams below)

    const myTeamAssignments = await prisma.requirementAssignment.findMany({
      where: {
        requirementId,
        status: "ACTIVE",
        teamId: { in: myTeamIds },
      },
      select: {
        id: true,
        teamId: true,
        allocatedOpenings: true,
        filledOpenings: true,
      },
    });

    if (myTeamAssignments.length > 0) {
      // Caller's team is already assigned → they are the DM distributing work
      // Fetch their child teams via ASSIGNS_TO edges
      const childEdges = await prisma.teamEdge.findMany({
        where: {
          parentId: { in: myTeamIds },
          edgeType: "ASSIGNS_TO",
          isActive: true,
        },
        select: {
          childId: true,
          child: {
            select: {
              id: true,
              name: true,
              nodeType: true,
              category: true,
              members: {
                where: { isActive: true },
                select: {
                  id: true,
                  teamRole: true,
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      employeeId: true,
                      workingLocation: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Also check which child teams / individuals are already assigned
      const existingChildAssignments =
        await prisma.requirementAssignment.findMany({
          where: {
            requirementId,
            status: "ACTIVE",
            parentAssignmentId: { in: myTeamAssignments.map((a) => a.id) },
          },
          select: {
            id: true,
            teamId: true,
            recruiterId: true,
            allocatedOpenings: true,
            filledOpenings: true,
            assignmentType: true,
          },
        });

      const assignedTeamIds = new Set(
        existingChildAssignments.filter((a) => a.teamId).map((a) => a.teamId!)
      );
      const assignedRecruiterIds = new Set(
        existingChildAssignments
          .filter((a) => a.recruiterId)
          .map((a) => a.recruiterId!)
      );

      const teams = childEdges.map((e) => ({
        id: e.child.id,
        name: e.child.name,
        nodeType: e.child.nodeType,
        category: e.child.category,
        alreadyAssigned: assignedTeamIds.has(e.child.id),
        members: e.child.members.map((m) => ({
          memberId: m.id,
          teamRole: m.teamRole,
          alreadyAssigned: assignedRecruiterIds.has(m.user.id),
          user: m.user,
        })),
      }));

      res.json({
        success: true,
        role: "dm",
        // The DM's own assignment ID — needed as parentAssignmentId when assigning down
        parentAssignmentId: myTeamAssignments[0].id,
        targets: { teams },
      });
      return;
    }

    // ── Caller is not yet assigned — check if they are sales ──────────────
    // Sales teams have category SALES. Find DM-level teams reachable from
    // caller's teams via ASSIGNS_TO edges.

    const mySalesTeams = myMemberships.filter(
      (m) => m.team.category === "SALES"
    );

    if (mySalesTeams.length === 0) {
      // ── Check if caller is a Team Lead ──────────────────────────────────
      // A TL is a LEAD member of a DELIVERY GROUP team.
      // They can assign directly to members of their own team.
      // The parent assignment is the TEAM assignment on this requirement
      // that covers their team.

      const myDeliveryTeams = myMemberships.filter(
        (m) => m.team.category === "DELIVERY" && m.team.nodeType === "GROUP"
      );

      if (myDeliveryTeams.length > 0) {
        // Find if any of their teams has an active assignment on this req
        const myTeamAssignmentsForTL =
          await prisma.requirementAssignment.findMany({
            where: {
              requirementId,
              status: "ACTIVE",
              teamId: { in: myDeliveryTeams.map((m) => m.teamId) },
            },
            select: {
              id: true,
              teamId: true,
              allocatedOpenings: true,
              filledOpenings: true,
            },
          });

        if (myTeamAssignmentsForTL.length > 0) {
          // Fetch members of their teams
          const teamWithMembers = await prisma.team.findMany({
            where: { id: { in: myDeliveryTeams.map((m) => m.teamId) } },
            select: {
              id: true,
              name: true,
              nodeType: true,
              category: true,
              members: {
                where: { isActive: true },
                select: {
                  id: true,
                  teamRole: true,
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      employeeId: true,
                      workingLocation: true,
                    },
                  },
                },
              },
            },
          });

          // Check already assigned individuals under these team assignments
          const existingIndividual =
            await prisma.requirementAssignment.findMany({
              where: {
                requirementId,
                status: "ACTIVE",
                parentAssignmentId: {
                  in: myTeamAssignmentsForTL.map((a) => a.id),
                },
              },
              select: { recruiterId: true },
            });

          const assignedRecruiterIds = new Set(
            existingIndividual
              .filter((a) => a.recruiterId)
              .map((a) => a.recruiterId!)
          );

          const teams = teamWithMembers.map((t) => ({
            id: t.id,
            name: t.name,
            nodeType: t.nodeType,
            category: t.category,
            alreadyAssigned: false,
            members: t.members.map((m) => ({
              memberId: m.id,
              teamRole: m.teamRole,
              alreadyAssigned: assignedRecruiterIds.has(m.user.id),
              user: m.user,
            })),
          }));

          res.json({
            success: true,
            role: "tl",
            parentAssignmentId: myTeamAssignmentsForTL[0].id,
            targets: { teams },
          });
          return;
        }
      }

      // Not a sales person, not a DM with assignment, not a TL with assignment — no authority
      res.json({ success: true, role: "none", targets: [] });
      return;
    }

    // Fetch teams directly reachable via ASSIGNS_TO from sales teams
    const reachableEdges = await prisma.teamEdge.findMany({
      where: {
        parentId: { in: mySalesTeams.map((m) => m.teamId) },
        edgeType: "ASSIGNS_TO",
        isActive: true,
      },
      select: {
        childId: true,
        child: {
          select: {
            id: true,
            name: true,
            nodeType: true,
            category: true,
            // Members of the DM team (the DM themselves)
            members: {
              where: { isActive: true },
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
            },
          },
        },
      },
    });

    // Check which of these are already assigned on this requirement
    const existingTopAssignments = await prisma.requirementAssignment.findMany({
      where: {
        requirementId,
        status: "ACTIVE",
        teamId: { in: reachableEdges.map((e) => e.childId) },
      },
      select: { teamId: true },
    });

    const alreadyAssignedTeamIds = new Set(
      existingTopAssignments.map((a) => a.teamId!)
    );

    const dmTeams = reachableEdges.map((e) => ({
      id: e.child.id,
      name: e.child.name,
      nodeType: e.child.nodeType,
      category: e.child.category,
      alreadyAssigned: alreadyAssignedTeamIds.has(e.child.id),
      members: e.child.members.map((m) => ({
        memberId: m.id,
        teamRole: m.teamRole,
        user: m.user,
      })),
    }));

    res.json({
      success: true,
      role: "sales",
      // No parentAssignmentId at this level — this is the top assignment
      parentAssignmentId: null,
      targets: { teams: dmTeams },
    });
  } catch (err) {
    console.error("getAssignableTargets:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch assignable targets" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /clients — add handledBy=me filter
//
// When handledBy=me, only return clients where caller is an active
// ClientHandler OR owns a ClientContact on that client.
// Used by the requirement creation form so sales only sees their clients.
// ─────────────────────────────────────────────────────────────────────────────

export const getClientsHandledByMe = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { search, limit = "200" } = req.query as Record<string, string>;

    const where: any = {
      deletedAt: null,
      status: "ACTIVE",
      OR: [
        // Is an active handler on this client
        { handlers: { some: { userId, status: "ACTIVE" } } },
        // Owns a contact on this client
        { contacts: { some: { ownerId: userId, status: "ACTIVE" } } },
      ],
    };

    if (search) {
      where.AND = [
        { OR: where.OR },
        {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { vmsName: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
      delete where.OR;
    }

    const clients = await prisma.client.findMany({
      where,
      select: {
        id: true,
        name: true,
        vmsName: true,
        industry: true,
        status: true,
        contacts: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            email: true,
          },
        },
      },
      orderBy: { name: "asc" },
      take: Math.min(parseInt(limit), 500),
    });

    res.json({ success: true, data: clients });
  } catch (err) {
    console.error("getClientsHandledByMe:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch clients" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /clients — add handledBy=me filter
//
// When handledBy=me, only return clients where caller is an active
// ClientHandler OR owns a ClientContact on that client.
// Used by the requirement creation form so sales only sees their clients.
// ─────────────────────────────────────────────────────────────────────────────

// export const getClientsHandledByMe = async (req: Request, res: Response) => {
//   try {
//     const userId = req.user!.id;
//     const { search, limit = "200" } = req.query as Record<string, string>;

//     const where: any = {
//       deletedAt: null,
//       status: "ACTIVE",
//       OR: [
//         // Is an active handler on this client
//         { handlers: { some: { userId, status: "ACTIVE" } } },
//         // Owns a contact on this client
//         { contacts: { some: { ownerId: userId, status: "ACTIVE" } } },
//       ],
//     };

//     if (search) {
//       where.AND = [
//         { OR: where.OR },
//         {
//           OR: [
//             { name: { contains: search, mode: "insensitive" } },
//             { vmsName: { contains: search, mode: "insensitive" } },
//           ],
//         },
//       ];
//       delete where.OR;
//     }

//     const clients = await prisma.client.findMany({
//       where,
//       select: {
//         id: true,
//         name: true,
//         vmsName: true,
//         industry: true,
//         status: true,
//         contacts: {
//           where: { status: "ACTIVE" },
//           select: {
//             id: true,
//             firstName: true,
//             lastName: true,
//             designation: true,
//             email: true,
//           },
//         },
//       },
//       orderBy: { name: "asc" },
//       take: Math.min(parseInt(limit), 500),
//     });

//     res.json({ success: true, data: clients });
//   } catch (err) {
//     console.error("getClientsHandledByMe:", err);
//     res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch clients" });
//   }
// };
