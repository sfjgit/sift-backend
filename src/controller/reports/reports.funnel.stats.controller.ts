// File: reports.funnel.stats.controller.ts
// Path: src/controller/reports/reports.funnel.stats.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { resolveOrgTreeDown } from "./reports.controller";
import { resolveEffectiveUserIds } from "./reports.overview.drill.controller";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function str(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function prismaIn(v: string | string[] | undefined) {
  if (!v) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  if (!arr.length) return undefined;
  return arr.length === 1 ? arr[0] : { in: arr };
}

function resolveDateWindow(q: Record<string, string | string[] | undefined>): {
  gte?: Date;
  lte?: Date;
} {
  const now = new Date();
  const hours = str(q.hours);
  const fromDate = str(q.fromDate);
  const toDate = str(q.toDate);
  const range = str(q.range);

  if (hours) {
    const h = parseInt(hours, 10);
    return { gte: new Date(now.getTime() - h * 3_600_000) };
  }
  if (fromDate || toDate) {
    return {
      ...(fromDate ? { gte: new Date(fromDate) } : {}),
      ...(toDate
        ? { lte: new Date(new Date(toDate).setHours(23, 59, 59, 999)) }
        : {}),
    };
  }
  if (range) {
    const start = new Date(now);
    switch (range) {
      case "today":
        start.setHours(0, 0, 0, 0);
        return { gte: start };
      case "yesterday": {
        const s = new Date(now);
        s.setDate(s.getDate() - 1);
        s.setHours(0, 0, 0, 0);
        const e = new Date(s);
        e.setHours(23, 59, 59, 999);
        return { gte: s, lte: e };
      }
      case "last7":
        start.setDate(start.getDate() - 7);
        return { gte: start };
      case "last30":
        start.setDate(start.getDate() - 30);
        return { gte: start };
      case "thisMonth":
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        return { gte: start };
    }
  }
  return {};
}

// Sale value — same priority chain as requirements controller
// saleValue = already total, band/pct = per-opening
type SaleValueBasis = "SALE_VALUE" | "BAND" | "FIXED_PCT" | "NOT_FOUND";

function computeSaleValue(r: {
  saleValue: number | null;
  totalOpenings: number;
  salaryMin: number | null;
  band: { value: any } | null;
  client: { percentageValue: any } | null;
}): { value: number | null; basis: SaleValueBasis } {
  if (r.saleValue != null && Number(r.saleValue) > 0)
    return { value: Number(r.saleValue), basis: "SALE_VALUE" };

  const bv = r.band?.value != null ? Number(r.band.value) : null;
  if (bv != null && bv > 0)
    return { value: bv * r.totalOpenings, basis: "BAND" };

  const pct =
    r.client?.percentageValue != null ? Number(r.client.percentageValue) : null;
  const sm = r.salaryMin != null ? Number(r.salaryMin) : null;
  if (pct != null && pct > 0 && sm != null && sm > 0)
    return { value: sm * (pct / 100) * r.totalOpenings, basis: "FIXED_PCT" };

  return { value: null, basis: "NOT_FOUND" };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/requirements/funnel-stats
//
// Returns:
// {
//   summary: {
//     nearTerminalCandidates: number,   // total NDA/Offered count
//     terminalCandidates: number,       // total Deal Closed/Training Started count
//   },
//   nearTerminal: {
//     requirements: RequirementFunnelRow[]
//   },
//   terminal: {
//     requirements: RequirementFunnelRow[]
//   }
// }
//
// RequirementFunnelRow: {
//   id, reqCode, title, status, totalOpenings,
//   client: { id, name },
//   serviceLine: { id, name } | null,
//   createdBy: { firstName, lastName },
//   computedSaleValue, saleValueBasis,
//   nearTerminalCount, nearTerminalValue,   // populated for nearTerminal set
//   terminalCount, achievedValue,           // populated for terminal set
// }
// ─────────────────────────────────────────────────────────────────────────────

export const getFunnelStats = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | string[] | undefined>;

    // ── Scope ────────────────────────────────────────────────────────────────
    const creatorIds = await resolveOrgTreeDown(
      req.user!.id,
      req.user!.isSuperAdmin,
    );

    const requestedCreatorId = str(q.createdById)?.trim() || null;
    const effectiveCreatorIds =
      creatorIds === null
        ? requestedCreatorId
          ? [requestedCreatorId]
          : null
        : requestedCreatorId
          ? creatorIds.includes(requestedCreatorId)
            ? [requestedCreatorId]
            : []
          : creatorIds;

    let createdByWhere: Record<string, any> = {};
    if (effectiveCreatorIds !== null) {
      const assignedReqRows = await prisma.requirementAssignment.findMany({
        where: {
          assignedToId: { in: effectiveCreatorIds },
          status: "ACTIVE",
        },
        select: { requirementId: true },
      });
      const assignedReqIds = [
        ...new Set(assignedReqRows.map((a) => a.requirementId)),
      ];
      createdByWhere = {
        OR: [
          { createdById: { in: effectiveCreatorIds } },
          ...(assignedReqIds.length > 0
            ? [{ id: { in: assignedReqIds } }]
            : []),
        ],
      };
    }

    // ── Date window ──────────────────────────────────────────────────────────
    const win = resolveDateWindow(q);
    const activityWindow =
      win.gte || win.lte
        ? {
            ...(win.gte ? { gte: win.gte } : {}),
            ...(win.lte ? { lte: win.lte } : {}),
          }
        : null;

    const activityFilter = activityWindow
      ? {
          pipelines: {
            some: {
              OR: [
                { createdAt: activityWindow },
                { updatedAt: activityWindow },
                { stageHistory: { some: { createdAt: activityWindow } } },
              ],
            },
          },
        }
      : {};

    // ── Req where ────────────────────────────────────────────────────────────
    const reqWhere: Record<string, any> = {
      deletedAt: null,
      ...activityFilter,
      ...createdByWhere,
    };

    if (q.status) reqWhere.status = prismaIn(q.status);
    if (q.clientId) reqWhere.clientId = prismaIn(q.clientId);
    if (q.serviceLineId) reqWhere.serviceLineId = prismaIn(q.serviceLineId);
    if (q.businessUnitId) reqWhere.businessUnitId = str(q.businessUnitId);
    if (q.clientSpocId) reqWhere.clientSpocId = prismaIn(q.clientSpocId);

    // Team filter
    if (q.userIds) {
      const teamIds = (str(q.userIds) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (teamIds.length > 0) {
        const allowed =
          effectiveCreatorIds === null
            ? teamIds
            : teamIds.filter((id) => effectiveCreatorIds.includes(id));
        if (allowed.length > 0) {
          const [assignedRows, createdRows] = await Promise.all([
            prisma.requirementAssignment.findMany({
              where: { assignedToId: { in: allowed }, status: "ACTIVE" },
              select: { requirementId: true },
            }),
            prisma.requirement.findMany({
              where: { createdById: { in: allowed }, deletedAt: null },
              select: { id: true },
            }),
          ]);
          const uniqueIds = new Set([
            ...assignedRows.map((a) => a.requirementId),
            ...createdRows.map((r) => r.id),
          ]);
          reqWhere.id = { in: [...uniqueIds] };
        } else {
          reqWhere.id = { in: [] };
        }
      }
    }

    // ── Fetch all active pipeline stages with flags ───────────────────────────
    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: { id: true, isTerminal: true, isNearTerminal: true },
    });
    const stageById = new Map(allStages.map((s) => [s.id, s]));

    const nearTerminalStageIds = allStages
      .filter((s) => s.isNearTerminal && !s.isTerminal)
      .map((s) => s.id);

    const terminalStageIds = allStages
      .filter((s) => s.isTerminal)
      .map((s) => s.id);

    // ── Requirements ─────────────────────────────────────────────────────────
    const requirements = await prisma.requirement.findMany({
      where: reqWhere,
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        totalOpenings: true,
        saleValue: true,
        salaryMin: true,
        client: { select: { id: true, name: true, percentageValue: true } },
        serviceLine: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        band: { select: { value: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1_000,
    });

    if (!requirements.length) {
      return res.json({
        success: true,
        summary: { nearTerminalCandidates: 0, terminalCandidates: 0 },
        nearTerminal: { requirements: [] },
        terminal: { requirements: [] },
      });
    }

    const reqIds = requirements.map((r) => r.id);

    // ── Stage counts — one groupBy ────────────────────────────────────────────
    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: {
        requirementId: { in: reqIds },
        currentStageId: {
          in: [...nearTerminalStageIds, ...terminalStageIds],
        },
      },
      _count: { id: true },
    });

    // reqId → stageId → count
    const countsByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = {};
      countsByReq[sc.requirementId][sc.currentStageId] =
        (countsByReq[sc.requirementId][sc.currentStageId] ?? 0) + sc._count.id;
    }

    // ── Build per-req rows ────────────────────────────────────────────────────
    let totalNearTerminalCandidates = 0;
    let totalTerminalCandidates = 0;

    const nearTerminalRows: any[] = [];
    const terminalRows: any[] = [];

    for (const r of requirements) {
      const stageCts = countsByReq[r.id] ?? {};

      let nearTerminalCount = 0;
      let terminalCount = 0;

      for (const [stageId, count] of Object.entries(stageCts)) {
        const stage = stageById.get(stageId);
        if (!stage) continue;
        if (stage.isTerminal) terminalCount += count;
        else if (stage.isNearTerminal) nearTerminalCount += count;
      }

      // Skip reqs with zero in both — no point showing them
      if (nearTerminalCount === 0 && terminalCount === 0) continue;

      const { value: computedSaleValue, basis: saleValueBasis } =
        computeSaleValue({
          saleValue: r.saleValue != null ? Number(r.saleValue) : null,
          totalOpenings: r.totalOpenings,
          salaryMin: r.salaryMin != null ? Number(r.salaryMin) : null,
          band: r.band
            ? { value: r.band.value != null ? Number(r.band.value) : null }
            : null,
          client: r.client
            ? {
                percentageValue:
                  r.client.percentageValue != null
                    ? Number(r.client.percentageValue)
                    : null,
              }
            : null,
        });

      const nearTerminalValue =
        computedSaleValue != null && r.totalOpenings > 0
          ? (nearTerminalCount / r.totalOpenings) * computedSaleValue
          : null;

      const achievedValue =
        computedSaleValue != null && r.totalOpenings > 0
          ? (terminalCount / r.totalOpenings) * computedSaleValue
          : null;

      const base = {
        id: r.id,
        reqCode: r.reqCode,
        title: r.title,
        status: r.status,
        totalOpenings: r.totalOpenings,
        client: r.client ? { id: r.client.id, name: r.client.name } : null,
        serviceLine: r.serviceLine ?? null,
        businessUnit: r.businessUnit ?? null,
        createdBy: r.createdBy,
        computedSaleValue,
        saleValueBasis,
      };

      if (nearTerminalCount > 0) {
        totalNearTerminalCandidates += nearTerminalCount;
        nearTerminalRows.push({
          ...base,
          nearTerminalCount,
          nearTerminalValue,
        });
      }

      if (terminalCount > 0) {
        totalTerminalCandidates += terminalCount;
        terminalRows.push({
          ...base,
          terminalCount,
          achievedValue,
        });
      }
    }

    // Sort — highest count first
    nearTerminalRows.sort((a, b) => b.nearTerminalCount - a.nearTerminalCount);
    terminalRows.sort((a, b) => b.terminalCount - a.terminalCount);

    return res.json({
      success: true,
      summary: {
        nearTerminalCandidates: totalNearTerminalCandidates,
        terminalCandidates: totalTerminalCandidates,
      },
      nearTerminal: { requirements: nearTerminalRows },
      terminal: { requirements: terminalRows },
    });
  } catch (err) {
    console.error("getFunnelStats:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch funnel stats" });
  }
};

// export const getFunnelStats = async (req: Request, res: Response) => {
//   try {
//     const q = req.query as Record<string, string | string[] | undefined>;
//     // if req have no candidate ot if candidate preste got transffered then the requirement will not show

//     const scopedRecruiterIds = await resolveEffectiveUserIds(
//       req,
//       q as Record<string, string | undefined>,
//     );
//     // ── Scope ────────────────────────────────────────────────────────────────
//     const creatorIds = await resolveOrgTreeDown(
//       req.user!.id,
//       req.user!.isSuperAdmin,
//     );

//     const requestedCreatorId = str(q.createdById)?.trim() || null;
//     const effectiveCreatorIds =
//       creatorIds === null
//         ? requestedCreatorId
//           ? [requestedCreatorId]
//           : null
//         : requestedCreatorId
//           ? creatorIds.includes(requestedCreatorId)
//             ? [requestedCreatorId]
//             : []
//           : creatorIds;

//     let createdByWhere: Record<string, any> = {};
//     if (effectiveCreatorIds !== null) {
//       const assignedReqRows = await prisma.requirementAssignment.findMany({
//         where: {
//           assignedToId: { in: effectiveCreatorIds },
//           status: "ACTIVE",
//         },
//         select: { requirementId: true },
//       });
//       const assignedReqIds = [
//         ...new Set(assignedReqRows.map((a) => a.requirementId)),
//       ];
//       createdByWhere = {
//         OR: [
//           { createdById: { in: effectiveCreatorIds } },
//           ...(assignedReqIds.length > 0
//             ? [{ id: { in: assignedReqIds } }]
//             : []),
//         ],
//       };
//     }

//     // ── Date window ──────────────────────────────────────────────────────────
//     const win = resolveDateWindow(q);
//     const activityWindow =
//       win.gte || win.lte
//         ? {
//             ...(win.gte ? { gte: win.gte } : {}),
//             ...(win.lte ? { lte: win.lte } : {}),
//           }
//         : null;

//     const activityFilter = activityWindow
//       ? {
//           pipelines: {
//             some: {
//               // if req have no candidate ot if candidate preste got transffered then the requirement will not show
//               ...(scopedRecruiterIds !== null
//                 ? { recruiterId: { in: scopedRecruiterIds } }
//                 : {}),
//               OR: [
//                 { createdAt: activityWindow },
//                 { updatedAt: activityWindow },
//                 { stageHistory: { some: { createdAt: activityWindow } } },
//               ],
//             },
//           },
//         }
//       : {};

//     // ── Req where ────────────────────────────────────────────────────────────
//     const reqWhere: Record<string, any> = {
//       deletedAt: null,
//       ...activityFilter,
//       ...createdByWhere,
//     };

//     if (q.status) reqWhere.status = prismaIn(q.status);
//     if (q.clientId) reqWhere.clientId = prismaIn(q.clientId);
//     if (q.serviceLineId) reqWhere.serviceLineId = prismaIn(q.serviceLineId);
//     if (q.businessUnitId) reqWhere.businessUnitId = str(q.businessUnitId);
//     if (q.clientSpocId) reqWhere.clientSpocId = prismaIn(q.clientSpocId);

//     // Team filter
//     if (q.userIds) {
//       const teamIds = (str(q.userIds) ?? "")
//         .split(",")
//         .map((s) => s.trim())
//         .filter(Boolean);
//       if (teamIds.length > 0) {
//         const allowed =
//           effectiveCreatorIds === null
//             ? teamIds
//             : teamIds.filter((id) => effectiveCreatorIds.includes(id));
//         if (allowed.length > 0) {
//           const [assignedRows, createdRows] = await Promise.all([
//             prisma.requirementAssignment.findMany({
//               where: { assignedToId: { in: allowed }, status: "ACTIVE" },
//               select: { requirementId: true },
//             }),
//             prisma.requirement.findMany({
//               where: { createdById: { in: allowed }, deletedAt: null },
//               select: { id: true },
//             }),
//           ]);
//           const uniqueIds = new Set([
//             ...assignedRows.map((a) => a.requirementId),
//             ...createdRows.map((r) => r.id),
//           ]);
//           reqWhere.id = { in: [...uniqueIds] };
//         } else {
//           reqWhere.id = { in: [] };
//         }
//       }
//     }

//     // ── Fetch all active pipeline stages with flags ───────────────────────────
//     const allStages = await prisma.pipelineStage.findMany({
//       where: { isActive: true },
//       select: { id: true, isTerminal: true, isNearTerminal: true },
//     });
//     const stageById = new Map(allStages.map((s) => [s.id, s]));

//     const nearTerminalStageIds = allStages
//       .filter((s) => s.isNearTerminal && !s.isTerminal)
//       .map((s) => s.id);

//     const terminalStageIds = allStages
//       .filter((s) => s.isTerminal)
//       .map((s) => s.id);

//     // ── Requirements ─────────────────────────────────────────────────────────
//     const requirements = await prisma.requirement.findMany({
//       where: reqWhere,
//       select: {
//         id: true,
//         reqCode: true,
//         title: true,
//         status: true,
//         totalOpenings: true,
//         saleValue: true,
//         salaryMin: true,
//         client: { select: { id: true, name: true, percentageValue: true } },
//         serviceLine: { select: { id: true, name: true } },
//         businessUnit: { select: { id: true, name: true } },
//         createdBy: { select: { id: true, firstName: true, lastName: true } },
//         band: { select: { value: true } },
//       },
//       orderBy: { createdAt: "desc" },
//       take: 1_000,
//     });

//     if (!requirements.length) {
//       return res.json({
//         success: true,
//         summary: { nearTerminalCandidates: 0, terminalCandidates: 0 },
//         nearTerminal: { requirements: [] },
//         terminal: { requirements: [] },
//       });
//     }

//     const reqIds = requirements.map((r) => r.id);

//     // ── Stage counts — one groupBy ────────────────────────────────────────────
//     const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
//       by: ["requirementId", "currentStageId"],
//       where: {
//         requirementId: { in: reqIds },
//         currentStageId: {
//           in: [...nearTerminalStageIds, ...terminalStageIds],
//         },
//         // if req have no candidate ot if candidate preste got transffered then the requirement will not show
//         ...(scopedRecruiterIds !== null
//           ? { recruiterId: { in: scopedRecruiterIds } }
//           : {}),
//       },
//       _count: { id: true },
//     });

//     // reqId → stageId → count
//     const countsByReq: Record<string, Record<string, number>> = {};
//     for (const sc of stageCounts as any[]) {
//       if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = {};
//       countsByReq[sc.requirementId][sc.currentStageId] =
//         (countsByReq[sc.requirementId][sc.currentStageId] ?? 0) + sc._count.id;
//     }

//     // ── Build per-req rows ────────────────────────────────────────────────────
//     let totalNearTerminalCandidates = 0;
//     let totalTerminalCandidates = 0;

//     const nearTerminalRows: any[] = [];
//     const terminalRows: any[] = [];

//     for (const r of requirements) {
//       const stageCts = countsByReq[r.id] ?? {};

//       let nearTerminalCount = 0;
//       let terminalCount = 0;

//       for (const [stageId, count] of Object.entries(stageCts)) {
//         const stage = stageById.get(stageId);
//         if (!stage) continue;
//         if (stage.isTerminal) terminalCount += count;
//         else if (stage.isNearTerminal) nearTerminalCount += count;
//       }

//       // Skip reqs with zero in both — no point showing them
//       if (nearTerminalCount === 0 && terminalCount === 0) continue;

//       const { value: computedSaleValue, basis: saleValueBasis } =
//         computeSaleValue({
//           saleValue: r.saleValue != null ? Number(r.saleValue) : null,
//           totalOpenings: r.totalOpenings,
//           salaryMin: r.salaryMin != null ? Number(r.salaryMin) : null,
//           band: r.band
//             ? { value: r.band.value != null ? Number(r.band.value) : null }
//             : null,
//           client: r.client
//             ? {
//                 percentageValue:
//                   r.client.percentageValue != null
//                     ? Number(r.client.percentageValue)
//                     : null,
//               }
//             : null,
//         });

//       const nearTerminalValue =
//         computedSaleValue != null && r.totalOpenings > 0
//           ? (nearTerminalCount / r.totalOpenings) * computedSaleValue
//           : null;

//       const achievedValue =
//         computedSaleValue != null && r.totalOpenings > 0
//           ? (terminalCount / r.totalOpenings) * computedSaleValue
//           : null;

//       const base = {
//         id: r.id,
//         reqCode: r.reqCode,
//         title: r.title,
//         status: r.status,
//         totalOpenings: r.totalOpenings,
//         client: r.client ? { id: r.client.id, name: r.client.name } : null,
//         serviceLine: r.serviceLine ?? null,
//         businessUnit: r.businessUnit ?? null,
//         createdBy: r.createdBy,
//         computedSaleValue,
//         saleValueBasis,
//       };

//       if (nearTerminalCount > 0) {
//         totalNearTerminalCandidates += nearTerminalCount;
//         nearTerminalRows.push({
//           ...base,
//           nearTerminalCount,
//           nearTerminalValue,
//         });
//       }

//       if (terminalCount > 0) {
//         totalTerminalCandidates += terminalCount;
//         terminalRows.push({
//           ...base,
//           terminalCount,
//           achievedValue,
//         });
//       }
//     }

//     // Sort — highest count first
//     nearTerminalRows.sort((a, b) => b.nearTerminalCount - a.nearTerminalCount);
//     terminalRows.sort((a, b) => b.terminalCount - a.terminalCount);

//     return res.json({
//       success: true,
//       summary: {
//         nearTerminalCandidates: totalNearTerminalCandidates,
//         terminalCandidates: totalTerminalCandidates,
//       },
//       nearTerminal: { requirements: nearTerminalRows },
//       terminal: { requirements: terminalRows },
//     });
//   } catch (err) {
//     console.error("getFunnelStats:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch funnel stats" });
//   }
// };
