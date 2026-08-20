// File: reports.sales.controller.ts
// Path: src/controller/reports/reports.sales.controller.ts

import { Response, Request } from "express";
import prisma from "@/utils/prisma/client";
// import { AuthRequest } from "@/types/auth";

// ─── BFS: collect all userIds in reporting line downward ─────────────────────
async function collectReportingLine(rootUserId: string): Promise<string[]> {
  const visited = new Set<string>([rootUserId]);
  const queue = [rootUserId];
  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length);
    const children = await prisma.user.findMany({
      where: { reportingToId: { in: batch }, isActive: true },
      select: { id: true },
    });
    for (const c of children) {
      if (!visited.has(c.id)) {
        visited.add(c.id);
        queue.push(c.id);
      }
    }
  }
  return [...visited];
}

// ─── Date window (same pattern as my-requirements controller) ─────────────────
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function resolveDateWindow(q: Record<string, string | undefined>) {
  const now = new Date();
  if (q.hours) {
    const h = parseInt(q.hours, 10);
    if (!isNaN(h) && h > 0)
      return { gte: new Date(now.getTime() - h * 3_600_000), lte: now };
  }
  switch (q.range) {
    case "today":
      return { gte: startOfDay(now), lte: now };
    case "yesterday": {
      const y = addDays(now, -1);
      return { gte: startOfDay(y), lte: endOfDay(y) };
    }
    case "last7":
      return { gte: startOfDay(addDays(now, -6)), lte: now };
    case "last30":
      return { gte: startOfDay(addDays(now, -29)), lte: now };
    case "thisMonth":
      return { gte: startOfMonth(now), lte: now };
  }
  const w: { gte?: Date; lte?: Date } = {};
  if (q.fromDate)
    w.gte = /^\d{4}-\d{2}-\d{2}$/.test(q.fromDate)
      ? startOfDay(new Date(q.fromDate))
      : new Date(q.fromDate);
  if (q.toDate)
    w.lte = /^\d{4}-\d{2}-\d{2}$/.test(q.toDate)
      ? endOfDay(new Date(q.toDate))
      : new Date(q.toDate);
  return w;
}

// ─── Sale value — derived from schema fields ──────────────────────────────────
// Schema: saleValue (Float?), salaryMin (Float?), band.value (Decimal?), client.percentageValue (Decimal?)
function computeSaleValue(r: {
  saleValue: number | null;
  salaryMin: number | null;
  totalOpenings: number;
  band: { value: any } | null;
  client: { percentageValue: any } | null;
}): number {
  if (r.saleValue != null && Number(r.saleValue) > 0)
    return Number(r.saleValue) * r.totalOpenings;
  const bv = r.band?.value != null ? Number(r.band.value) : null;
  if (bv != null && bv > 0) return bv * r.totalOpenings;
  const pct =
    r.client?.percentageValue != null ? Number(r.client.percentageValue) : null;
  const sm = r.salaryMin != null ? Number(r.salaryMin) : null;
  if (pct != null && pct > 0 && sm != null && sm > 0)
    return sm * (pct / 100) * r.totalOpenings;
  return 0;
}

function trim(s: string | null | undefined) {
  return (s ?? "").trim();
}
function formatName(u: { firstName: string; lastName: string }) {
  return `${trim(u.firstName)} ${trim(u.lastName)}`.trim();
}

// ─── GET /reports/sales ───────────────────────────────────────────────────────
export async function getSalesReport(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const q = req.query as Record<string, string | undefined>;
    const win = resolveDateWindow(q);

    // Collect scoped userIds — from team picker override OR full reporting line
    let scopedUserIds: string[];
    if (q.userIds) {
      scopedUserIds = q.userIds.split(",").filter(Boolean);
    } else {
      scopedUserIds = await collectReportingLine(userId);
    }

    // Build requirement filter
    const reqWhere: Record<string, any> = {
      deletedAt: null,
      createdById: { in: scopedUserIds },
    };
    if (q.status && q.status !== "ALL") reqWhere.status = q.status;
    else if (!q.status) reqWhere.status = "ACTIVE";
    if (q.clientId) reqWhere.clientId = q.clientId;
    if (q.serviceLineId) reqWhere.serviceLineId = q.serviceLineId;
    if (win.gte || win.lte) {
      reqWhere.createdAt = {
        ...(win.gte ? { gte: win.gte } : {}),
        ...(win.lte ? { lte: win.lte } : {}),
      };
    }

    // Fetch requirements — only real schema fields
    const requirements = await prisma.requirement.findMany({
      where: reqWhere,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        totalOpenings: true,
        saleValue: true,
        salaryMin: true,
        createdAt: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        client: { select: { id: true, name: true, percentageValue: true } },
        serviceLine: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true } },
        band: { select: { value: true } },
        clientSpoc: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!requirements.length) {
      return res.json({
        success: true,
        data: {
          kpi: {
            totalReqs: 0,
            totalSaleValue: 0,
            achievedSaleValue: 0,
            placed: 0,
            active: 0,
            sourced: 0,
            dropped: 0,
            nearTerminal: 0,
          },
          funnel: [],
          leaderboard: [],
          hierarchyTree: [],
          requirements: [],
        },
      });
    }

    const reqIds = requirements.map((r) => r.id);

    // Load pipeline stages once
    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        label: true,
        order: true,
        isTerminal: true,
        isSourced: true,
        isNearTerminal: true,
        pipeline: true,
      },
      orderBy: { order: "asc" },
    });
    const stageById = new Map(allStages.map((s) => [s.id, s]));

    // Fetch ALL pipeline rows for these requirements
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirementId: { in: reqIds } },
      select: {
        id: true,
        requirementId: true,
        currentStageId: true,
        recruiterId: true,
        isRejected: true,
        isWithdrawn: true,
        isOnHold: true,
      },
    });

    // Fetch active assignments for these requirements
    const assignments = await prisma.requirementAssignment.findMany({
      where: { requirementId: { in: reqIds }, status: "ACTIVE" },
      select: {
        id: true,
        requirementId: true,
        depth: true,
        assignedToId: true,
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: { select: { name: true } },
          },
        },
      },
      orderBy: { depth: "asc" },
    });

    // Group by requirementId
    const pipelinesByReq = new Map<string, typeof pipelines>();
    for (const p of pipelines) {
      if (!pipelinesByReq.has(p.requirementId))
        pipelinesByReq.set(p.requirementId, []);
      pipelinesByReq.get(p.requirementId)!.push(p);
    }
    const assignmentsByReq = new Map<string, typeof assignments>();
    for (const a of assignments) {
      if (!assignmentsByReq.has(a.requirementId))
        assignmentsByReq.set(a.requirementId, []);
      assignmentsByReq.get(a.requirementId)!.push(a);
    }

    // Aggregation accumulators
    let totalSaleValue = 0;
    let kpiPlaced = 0,
      kpiActive = 0,
      kpiDropped = 0,
      kpiSourced = 0,
      kpiNearTerminal = 0;

    // Funnel accumulator — across all reqs
    const funnelAcc = new Map<
      string,
      { label: string; order: number; count: number }
    >();

    // Leaderboard accumulator — keyed by createdBy.id
    const leaderMap = new Map<
      string,
      {
        userId: string;
        name: string;
        reqsCreated: number;
        placed: number;
        active: number;
        saleValue: number;
      }
    >();

    // Per-requirement rows
    const reqRows = requirements.map((r) => {
      const sv = computeSaleValue(r);
      totalSaleValue += sv;

      const reqPipelines = pipelinesByReq.get(r.id) ?? [];
      let placed = 0,
        active = 0,
        dropped = 0,
        sourced = 0,
        nearTerminal = 0;
      const stageCounts = new Map<string, number>();

      for (const p of reqPipelines) {
        const stage = stageById.get(p.currentStageId);
        stageCounts.set(
          p.currentStageId,
          (stageCounts.get(p.currentStageId) ?? 0) + 1
        );

        if (!stage) {
          active++;
          continue;
        }
        if (stage.isSourced) {
          sourced++;
        } else if (stage.isTerminal) {
          placed++;
        } else if (!stage.pipeline || p.isRejected || p.isWithdrawn) {
          dropped++;
        } else if (stage.isNearTerminal) {
          nearTerminal++;
        } else {
          active++;
        }

        // Funnel — skip sourced and dropped
        if (stage.pipeline && !stage.isSourced) {
          if (!funnelAcc.has(stage.id))
            funnelAcc.set(stage.id, {
              label: stage.label,
              order: stage.order,
              count: 0,
            });
          funnelAcc.get(stage.id)!.count++;
        }
      }

      kpiPlaced += placed;
      kpiActive += active;
      kpiDropped += dropped;
      kpiSourced += sourced;
      kpiNearTerminal += nearTerminal;

      // Stage breakdown for this req
      const stageBreakdown = allStages
        .filter((s) => (stageCounts.get(s.id) ?? 0) > 0)
        .map((s) => ({
          stageId: s.id,
          label: s.label,
          order: s.order,
          isTerminal: s.isTerminal,
          count: stageCounts.get(s.id)!,
        }));

      // Assignment chain for this req
      const reqAssignments = (assignmentsByReq.get(r.id) ?? []).map((a) => ({
        id: a.id,
        depth: a.depth,
        userId: a.assignedToId,
        name: formatName(a.assignedTo),
        role: a.assignedTo.role?.name ?? "",
        candidateCount: reqPipelines.filter(
          (p) => p.recruiterId === a.assignedToId
        ).length,
        placedCount: reqPipelines.filter((p) => {
          if (p.recruiterId !== a.assignedToId) return false;
          return stageById.get(p.currentStageId)?.isTerminal === true;
        }).length,
      }));

      // Leaderboard entry for creator
      const creatorId = r.createdBy.id;
      const creatorName = formatName(r.createdBy);
      if (!leaderMap.has(creatorId)) {
        leaderMap.set(creatorId, {
          userId: creatorId,
          name: creatorName,
          reqsCreated: 0,
          placed: 0,
          active: 0,
          saleValue: 0,
        });
      }
      const le = leaderMap.get(creatorId)!;
      le.reqsCreated++;
      le.placed += placed;
      le.active += active;
      le.saleValue += sv;

      return {
        id: r.id,
        reqCode: r.reqCode,
        title: r.title,
        status: r.status,
        totalOpenings: r.totalOpenings,
        saleValue: sv,
        createdAt: r.createdAt,
        createdBy: { id: r.createdBy.id, name: creatorName },
        client: r.client ? { id: r.client.id, name: r.client.name } : null,
        serviceLine: r.serviceLine ?? null,
        businessUnit: r.businessUnit ?? null,
        pipeline: {
          total: reqPipelines.length,
          placed,
          active,
          dropped,
          sourced,
          nearTerminal,
        },
        stageBreakdown,
        assignments: reqAssignments,
      };
    });

    // Achieved sale value = sum of sv for reqs that have at least 1 placed
    const achievedSaleValue = reqRows
      .filter((r) => r.pipeline.placed > 0)
      .reduce((s, r) => s + r.saleValue, 0);

    const funnel = [...funnelAcc.values()].sort((a, b) => a.order - b.order);
    const leaderboard = [...leaderMap.values()].sort(
      (a, b) => b.saleValue - a.saleValue
    );

    // Hierarchy tree — aggregate per scoped user from assignment data
    const treeMap = new Map<
      string,
      {
        userId: string;
        name: string;
        depth: number;
        reqs: number;
        saleValue: number;
        placed: number;
        active: number;
      }
    >();
    for (const r of reqRows) {
      for (const a of r.assignments) {
        if (!treeMap.has(a.userId))
          treeMap.set(a.userId, {
            userId: a.userId,
            name: a.name,
            depth: a.depth,
            reqs: 0,
            saleValue: 0,
            placed: 0,
            active: 0,
          });
        const n = treeMap.get(a.userId)!;
        n.reqs++;
        n.saleValue += r.saleValue;
        n.placed += a.placedCount;
        n.active += r.pipeline.active;
      }
    }
    const hierarchyTree = [...treeMap.values()].sort(
      (a, b) => a.depth - b.depth || b.saleValue - a.saleValue
    );

    return res.json({
      success: true,
      data: {
        kpi: {
          totalReqs: reqRows.length,
          totalSaleValue,
          achievedSaleValue,
          placed: kpiPlaced,
          active: kpiActive,
          sourced: kpiSourced,
          dropped: kpiDropped,
          nearTerminal: kpiNearTerminal,
        },
        funnel,
        leaderboard,
        hierarchyTree,
        requirements: reqRows,
      },
    });
  } catch (err) {
    console.error("[getSalesReport]", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
}

// ─── GET /reports/sales/drill ─────────────────────────────────────────────────
export async function getSalesDrill(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const q = req.query as Record<string, string | undefined>;

    const scopedUserIds = q.userIds
      ? q.userIds.split(",").filter(Boolean)
      : await collectReportingLine(userId);

    const pipelineWhere: Record<string, any> = {
      requirement: { createdById: { in: scopedUserIds }, deletedAt: null },
    };

    if (q.reqId) {
      pipelineWhere.requirementId = q.reqId;
    }

    if (q.stageId) {
      pipelineWhere.currentStageId = q.stageId;
    } else if (q.type) {
      switch (q.type) {
        case "placed":
          pipelineWhere.currentStage = { isTerminal: true };
          break;
        case "dropped":
          pipelineWhere.currentStage = { pipeline: false };
          break;
        case "sourced":
          pipelineWhere.currentStage = { isSourced: true };
          break;
        case "nearTerminal":
          pipelineWhere.currentStage = { isNearTerminal: true };
          break;
        case "active":
          pipelineWhere.currentStage = {
            isTerminal: false,
            isSourced: false,
            isNearTerminal: false,
            pipeline: true,
          };
          break;
      }
    }

    const rows = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      take: 500,
      select: {
        id: true,
        createdAt: true,
        currentStage: {
          select: {
            label: true,
            isTerminal: true,
            pipeline: true,
            isSourced: true,
          },
        },
        recruiter: { select: { firstName: true, lastName: true } },
        requirement: {
          select: {
            reqCode: true,
            title: true,
            client: { select: { name: true } },
            serviceLine: { select: { name: true } },
          },
        },
        snapshot: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            currentTitle: true,
            totalExpYears: true,
          },
        },
      },
    });

    const candidates = rows.map((row) => ({
      pipelineId: row.id,
      name: row.snapshot?.fullName ?? "",
      email: row.snapshot?.email ?? "",
      phone: row.snapshot?.phone ?? null,
      designation: row.snapshot?.currentTitle ?? null,
      experience: row.snapshot?.totalExpYears ?? null,
      stage: row.currentStage?.label ?? "",
      reqCode: row.requirement.reqCode,
      reqTitle: row.requirement.title,
      client: row.requirement.client?.name ?? null,
      serviceLine: row.requirement.serviceLine?.name ?? null,
      recruiter: row.recruiter ? formatName(row.recruiter) : null,
      movedAt: row.createdAt,
    }));

    return res.json({
      success: true,
      data: { candidates, total: candidates.length },
    });
  } catch (err) {
    console.error("[getSalesDrill]", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
}

// ─── GET /reports/sales/drill — requirement-level breakdown, not candidates ───
// Returns: which requirements have candidates matching the filter (type/stage),
// grouped with counts per stage. CSM sees req stats, not candidate names.
export async function getSalesDrillByReq(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const q = req.query as Record<string, string | undefined>;

    const scopedUserIds = q.userIds
      ? q.userIds.split(",").filter(Boolean)
      : await collectReportingLine(userId);

    // Load stages once
    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        label: true,
        order: true,
        isTerminal: true,
        isSourced: true,
        isNearTerminal: true,
        pipeline: true,
      },
    });
    const stageById = new Map(allStages.map((s) => [s.id, s]));

    // Build pipeline filter
    const pipelineWhere: Record<string, any> = {
      requirement: { createdById: { in: scopedUserIds }, deletedAt: null },
    };

    if (q.reqId) pipelineWhere.requirementId = q.reqId;

    if (q.stageId) {
      pipelineWhere.currentStageId = q.stageId;
    } else if (q.type) {
      switch (q.type) {
        case "placed":
          pipelineWhere.currentStage = { isTerminal: true };
          break;
        case "dropped":
          pipelineWhere.currentStage = { pipeline: false };
          break;
        case "sourced":
          pipelineWhere.currentStage = { isSourced: true };
          break;
        case "nearTerminal":
          pipelineWhere.currentStage = { isNearTerminal: true };
          break;
        case "active":
          pipelineWhere.currentStage = {
            isTerminal: false,
            isSourced: false,
            isNearTerminal: false,
            pipeline: true,
          };
          break;
      }
    }

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: {
        requirementId: true,
        currentStageId: true,
        requirement: {
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            totalOpenings: true,
            saleValue: true,
            salaryMin: true,
            createdAt: true,
            createdBy: {
              select: { id: true, firstName: true, lastName: true },
            },
            client: { select: { id: true, name: true, percentageValue: true } },
            serviceLine: { select: { id: true, name: true } },
            band: { select: { value: true } },
          },
        },
      },
    });

    // Group pipeline rows by requirementId
    const reqMap = new Map<
      string,
      {
        req: (typeof pipelines)[0]["requirement"];
        stageCounts: Map<string, number>;
        total: number;
      }
    >();

    for (const p of pipelines) {
      if (!reqMap.has(p.requirementId)) {
        reqMap.set(p.requirementId, {
          req: p.requirement,
          stageCounts: new Map(),
          total: 0,
        });
      }
      const entry = reqMap.get(p.requirementId)!;
      entry.total++;
      entry.stageCounts.set(
        p.currentStageId,
        (entry.stageCounts.get(p.currentStageId) ?? 0) + 1
      );
    }

    // Build response rows — requirement stats only, no candidate names
    const rows = [...reqMap.values()].map(({ req, stageCounts, total }) => {
      const sv = computeSaleValue(req);

      let placed = 0,
        active = 0,
        dropped = 0,
        sourced = 0,
        nearTerminal = 0;
      const stageBreakdown: {
        stageId: string;
        label: string;
        count: number;
        isTerminal: boolean;
      }[] = [];

      for (const [stageId, count] of stageCounts.entries()) {
        const stage = stageById.get(stageId);
        if (!stage) {
          active += count;
          continue;
        }
        if (stage.isSourced) sourced += count;
        else if (stage.isTerminal) placed += count;
        else if (!stage.pipeline) dropped += count;
        else if (stage.isNearTerminal) nearTerminal += count;
        else active += count;

        stageBreakdown.push({
          stageId,
          label: stage.label,
          count,
          isTerminal: stage.isTerminal ?? false,
        });
      }

      stageBreakdown.sort((a, b) => {
        const oa = stageById.get(a.stageId)?.order ?? 0;
        const ob = stageById.get(b.stageId)?.order ?? 0;
        return oa - ob;
      });

      const fillRate =
        req.totalOpenings > 0
          ? +((placed / req.totalOpenings) * 100).toFixed(1)
          : 0;

      return {
        id: req.id,
        reqCode: req.reqCode,
        title: req.title,
        status: req.status,
        totalOpenings: req.totalOpenings,
        fillRate,
        saleValue: sv,
        createdAt: req.createdAt,
        createdBy: formatName(req.createdBy),
        client: req.client
          ? { id: req.client.id, name: req.client.name }
          : null,
        serviceLine: req.serviceLine ?? null,
        pipeline: { total, placed, active, dropped, sourced, nearTerminal },
        stageBreakdown,
      };
    });

    // Sort by placed desc, then saleValue
    rows.sort(
      (a, b) =>
        b.pipeline.placed - a.pipeline.placed || b.saleValue - a.saleValue
    );

    // Aggregate totals
    const totals = rows.reduce(
      (acc, r) => ({
        reqs: acc.reqs + 1,
        placed: acc.placed + r.pipeline.placed,
        active: acc.active + r.pipeline.active,
        dropped: acc.dropped + r.pipeline.dropped,
        saleValue: acc.saleValue + r.saleValue,
        total: acc.total + r.pipeline.total,
      }),
      { reqs: 0, placed: 0, active: 0, dropped: 0, saleValue: 0, total: 0 }
    );

    return res.json({ success: true, data: { rows, totals } });
  } catch (err) {
    console.error("[getSalesDrillByReq]", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
}
