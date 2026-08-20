// File: reports.my.requirements.controller.ts
// Path: src/controller/reports/reports.my.requirements.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// DATE WINDOW
// ─────────────────────────────────────────────────────────────────────────────

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

interface DateWindow {
  gte?: Date;
  lte?: Date;
}

function resolveDateWindow(q: Record<string, string | undefined>): DateWindow {
  const now = new Date();
  if (q.hours) {
    const h = parseInt(q.hours, 10);
    if (!isNaN(h) && h > 0)
      return { gte: new Date(now.getTime() - h * 3600000), lte: now };
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
  const w: DateWindow = {};
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

// ─────────────────────────────────────────────────────────────────────────────
// SALE VALUE
// ─────────────────────────────────────────────────────────────────────────────

function computeSaleValue(input: {
  saleValue?: number | null;
  totalOpenings: number;
  salaryMin?: number | null;
  band?: { value?: number | null } | null;
  client?: { percentageValue?: number | null } | null;
}): number | null {
  const open = input.totalOpenings ?? 1;
  if (input.saleValue != null && Number(input.saleValue) > 0)
    return Number(input.saleValue) * open;
  const bv = input.band?.value != null ? Number(input.band.value) : null;
  if (bv != null && bv > 0) return bv * open;
  const pct =
    input.client?.percentageValue != null
      ? Number(input.client.percentageValue)
      : null;
  const sm = input.salaryMin != null ? Number(input.salaryMin) : null;
  if (pct != null && pct > 0 && sm != null && sm > 0)
    return sm * (pct / 100) * open;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/overview/my-requirements
//
// Shows requirements created by the logged-in user with:
// - Pipeline stage counts per requirement
// - Assignment breakdown (who assigned + their candidate counts)
// - Sale value per requirement
// - Filters: status, date range (createdAt), serviceLineId, clientId
// ─────────────────────────────────────────────────────────────────────────────

export const getMyRequirements = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const userId = req.user!.id;
    const win = resolveDateWindow(q);

    // ── Requirement filter ────────────────────────────────────────────────────
    const reqWhere: Record<string, any> = {
      deletedAt: null,
      createdById: userId,
    };

    // Status — default ACTIVE if not specified
    const statusFilter = q.status ?? "ACTIVE";
    if (statusFilter !== "ALL") reqWhere.status = statusFilter;

    // Date filter on createdAt
    if (win.gte || win.lte) {
      reqWhere.createdAt = {
        ...(win.gte ? { gte: win.gte } : {}),
        ...(win.lte ? { lte: win.lte } : {}),
      };
    }

    if (q.clientId) reqWhere.clientId = q.clientId;
    if (q.serviceLineId) reqWhere.serviceLineId = q.serviceLineId;

    // ── Fetch requirements ────────────────────────────────────────────────────
    const requirements = await prisma.requirement.findMany({
      where: reqWhere,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        totalOpenings: true,
        createdAt: true,
        saleValue: true,
        salaryMin: true,
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
          requirements: [],
          summary: {
            total: 0,
            totalOpenings: 0,
            totalFilled: 0,
            fillRate: 0,
            totalSaleValue: 0,
            totalCandidates: 0,
            totalPlaced: 0,
          },
        },
        meta: { userId, status: statusFilter },
      });
    }

    const reqIds = requirements.map((r) => r.id);

    // ── Fetch pipeline stages for these requirements ───────────────────────────
    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        isTerminal: true,
        isSourced: true,
        pipeline: true,
      },
      orderBy: { order: "asc" },
    });

    const terminalStageIds = allStages
      .filter((s) => s.isTerminal)
      .map((s) => s.id);
    const stageById = new Map(allStages.map((s) => [s.id, s]));

    // ── Fetch pipeline rows grouped by requirement ─────────────────────────────
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirementId: { in: reqIds } },
      select: {
        id: true,
        requirementId: true,
        currentStageId: true,
        isRejected: true,
        isWithdrawn: true,
        isOnHold: true,
        recruiterId: true,
        recruiter: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // ── Fetch assignments for these requirements ───────────────────────────────
    const assignments = await prisma.requirementAssignment.findMany({
      where: {
        requirementId: { in: reqIds },
        status: "ACTIVE",
      },
      select: {
        id: true,
        requirementId: true,
        assignedToId: true,
        depth: true,
        allocatedOpenings: true,
        filledOpenings: true,
        submissionsCount: true,
        assignedAt: true,
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

    // ── Aggregate per requirement ─────────────────────────────────────────────
    // Group pipelines by requirement
    const pipelinesByReq: Record<string, typeof pipelines> = {};
    for (const p of pipelines) {
      if (!pipelinesByReq[p.requirementId])
        pipelinesByReq[p.requirementId] = [];
      pipelinesByReq[p.requirementId].push(p);
    }

    // Group assignments by requirement
    const assignmentsByReq: Record<string, typeof assignments> = {};
    for (const a of assignments) {
      if (!assignmentsByReq[a.requirementId])
        assignmentsByReq[a.requirementId] = [];
      assignmentsByReq[a.requirementId].push(a);
    }

    // ── Summary accumulators ──────────────────────────────────────────────────
    let totalSaleValue = 0;
    let totalCandidates = 0;
    let totalPlaced = 0;
    let totalOpenings = 0;
    let totalFilled = 0;

    // ── Build per-requirement rows ────────────────────────────────────────────
    const rows = requirements.map((r) => {
      const sv = computeSaleValue({
        saleValue: r.saleValue,
        totalOpenings: r.totalOpenings,
        salaryMin: r.salaryMin ?? null,
        band: r.band ?? null,
        client: r.client ?? null,
      });

      if (sv) totalSaleValue += sv;
      totalOpenings += r.totalOpenings;
      totalFilled += 0; // filledOpenings is on assignment, not requirement

      // Pipeline stats for this requirement
      const reqPipelines = pipelinesByReq[r.id] ?? [];
      totalCandidates += reqPipelines.length;

      // Stage counts
      const stageCounts: Record<string, number> = {};
      let placed = 0;
      let dropped = 0;
      let onHold = 0;
      let inProgress = 0;
      let sourced = 0;

      for (const p of reqPipelines) {
        const stage = stageById.get(p.currentStageId);
        if (!stage) continue;

        stageCounts[p.currentStageId] =
          (stageCounts[p.currentStageId] ?? 0) + 1;

        if (stage.isTerminal) {
          placed++;
        } else if (p.isRejected || p.isWithdrawn) {
          dropped++;
        } else if (p.isOnHold) {
          onHold++;
        } else if (stage.isSourced) {
          sourced++;
        } else {
          inProgress++;
        }
      }

      totalPlaced += placed;

      // Stage breakdown array for frontend
      const stageBreakdown = allStages
        .filter((s) => stageCounts[s.id] > 0)
        .map((s) => ({
          stageId: s.id,
          code: s.code,
          label: s.label,
          order: s.order,
          isTerminal: s.isTerminal,
          isSourced: s.isSourced,
          count: stageCounts[s.id] ?? 0,
        }));

      // Assignment breakdown for this requirement
      const reqAssignments = assignmentsByReq[r.id] ?? [];
      const assignmentBreakdown = reqAssignments.map((a) => ({
        id: a.id,
        assignedToId: a.assignedToId,
        assigneeName:
          `${a.assignedTo.firstName} ${a.assignedTo.lastName}`.trim(),
        assigneeRole: a.assignedTo.role?.name ?? "",
        depth: a.depth,
        allocatedOpenings: a.allocatedOpenings ?? null,
        filledOpenings: a.filledOpenings,
        submissionsCount: a.submissionsCount,
        assignedAt: a.assignedAt,
        // How many candidates in pipeline sourced by this assignee
        candidateCount: reqPipelines.filter(
          (p) => p.recruiterId === a.assignedToId
        ).length,
      }));

      return {
        id: r.id,
        reqCode: r.reqCode,
        title: r.title,
        status: r.status,
        totalOpenings: r.totalOpenings,
        filledOpenings: 0, // derived from assignments
        fillRate:
          r.totalOpenings > 0
            ? +((placed / r.totalOpenings) * 100).toFixed(1)
            : 0,
        createdAt: r.createdAt,
        closedAt: null,
        targetDate: null,
        saleValue: sv,
        salaryMin: r.salaryMin ?? null,
        salaryMax: null,
        experienceMin: null,
        experienceMax: null,
        location: null,
        client: r.client ? { id: r.client.id, name: r.client.name } : null,
        clientSpoc: r.clientSpoc
          ? `${r.clientSpoc.firstName} ${r.clientSpoc.lastName}`.trim()
          : null,
        serviceLine: r.serviceLine ?? null,
        businessUnit: r.businessUnit ?? null,
        // Pipeline summary
        pipeline: {
          total: reqPipelines.length,
          sourced,
          inProgress,
          placed,
          dropped,
          onHold,
        },
        stageBreakdown,
        assignmentBreakdown,
      };
    });

    const fillRate =
      totalOpenings > 0 ? +((totalFilled / totalOpenings) * 100).toFixed(1) : 0;

    return res.json({
      success: true,
      data: {
        requirements: rows,
        summary: {
          total: rows.length,
          totalOpenings,
          totalFilled,
          fillRate,
          totalSaleValue,
          totalCandidates,
          totalPlaced,
        },
      },
      meta: { userId, status: statusFilter },
    });
  } catch (err) {
    console.error("getMyRequirements:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch my requirements" });
  }
};
