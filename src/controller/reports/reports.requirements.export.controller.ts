// File: exportRequirementReport.ts
// Path: src/controllers/reports.requirements.export.controller.ts
// (Drop this function into your reports requirements controller — replaces exportRequirementReport)

import ExcelJS from "exceljs";
import { addDays, addMonths, format } from "date-fns";
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import { computeSaleValue } from "../requirementsController";
import { resolveOrgTreeDown } from "./reports.controller";
// import { computeSaleValue } from "./requirementsController";
// import { resolveOrgTreeDown } from "@/services/orgTreeService";

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function parseIds(val: string | undefined): string[] | null {
  if (!val?.trim()) return null;
  const ids = val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

type CandidateColKey = string;

function spocName(
  spoc: { firstName: string; lastName: string } | null | undefined
): string {
  if (!spoc) return "";
  return [spoc.firstName, spoc.lastName].filter(Boolean).join(" ");
}

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
  if (mins < 43800) return `${Math.floor(mins / 10080)}wk`;
  return `${Math.floor(mins / 43800)}mo`;
}

/**
 * Derive expected joining date from available fields.
 * Priority: actualJoiningDate → expectedJoiningDate → lastWorkingDate → noticePeriod from today
 */
function deriveJoiningDate(
  actualJoiningDate: Date | null,
  expectedJoiningDate: Date | null,
  lastWorkingDate: Date | null,
  noticePeriod: string | null
): Date | null {
  if (actualJoiningDate) return actualJoiningDate;
  if (expectedJoiningDate) return expectedJoiningDate;
  if (lastWorkingDate) return lastWorkingDate; // LWD is effectively the joining anchor

  if (noticePeriod) {
    const lower = noticePeriod.toLowerCase().trim();
    const numMatch = lower.match(/^(\d+)/);
    const num = numMatch ? parseInt(numMatch[1], 10) : null;
    if (num != null) {
      const base = new Date();
      if (lower.includes("month")) return addMonths(base, num);
      return addDays(base, num);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const mkFill = (argb: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});

const styleHdr = (row: ExcelJS.Row, fill?: ExcelJS.Fill) => {
  const f = fill ?? mkFill("FF1E3A5F");
  row.eachCell((cell) => {
    cell.fill = f;
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 10 };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = { bottom: { style: "thin", color: { argb: "FF4A90D9" } } };
  });
  row.height = 26;
};

const styleTotalsRow = (row: ExcelJS.Row) => {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = mkFill("FFF0F4FF");
    cell.border = { top: { style: "medium", color: { argb: "FF4F46E5" } } };
  });
  row.height = 22;
};

const SUB_FILL = mkFill("FF2D5986");
const SALE_FILL = mkFill("FF1A5C2A");
const ACHIEVED_FILL = mkFill("FF4A148C");
const NEAR_FILL = mkFill("FF8B5E0A");

const LIGHT = {
  green: mkFill("FFE2EFDA"),
  red: mkFill("FFFCE4D6"),
  purple: mkFill("FFEDE7F6"),
  amber: mkFill("FFFFF3CD"),
  blue: mkFill("FFE8F0FE"),
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "FF00875A",
  CLOSED: "FFDE350B",
  ON_HOLD: "FFFF991F",
  PENDING_APPROVAL: "FF0052CC",
  DRAFT: "FF6B778C",
  CANCELLED: "FF5E6C84",
};

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE DETAIL SELECT — what we fetch for each pipeline row
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_DETAIL_SELECT = {
  id: true,
  requirementId: true,
  stageUpdatedAt: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  submittedAt: true,
  offerStatus: true,
  offeredCtc: true,
  currentCtc: true,
  expectedCtc: true,
  negotiatedCtc: true,
  expectedJoiningDate: true,
  actualJoiningDate: true,
  lastWorkingDate: true,
  noticePeriod: true,
  createdAt: true,
  currentStage: {
    select: {
      code: true,
      label: true,
      isTerminal: true,
      isNearTerminal: true,
      isSourced: true,
    },
  },
  recruiter: { select: { firstName: true, lastName: true } },
  snapshot: {
    select: {
      fullName: true,
      email: true,
      phone: true,
      currentTitle: true,
      currentCompany: true,
      totalExpYears: true,
      topSkills: true,
    },
  },
  stageHistory: { select: { timeInPrevStageMins: true } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// fetchScopedStages — fetch pipeline stages visible for this service line
// ─────────────────────────────────────────────────────────────────────────────

async function fetchScopedStages(serviceLineId?: string) {
  return prisma.pipelineStage.findMany({
    where: {
      isActive: true,
      ...(serviceLineId
        ? { OR: [{ serviceLineId: null }, { serviceLineId }] }
        : {}),
    },
    select: {
      id: true,
      label: true,
      order: true,
      isStandard: true,
      isTerminal: true,
      isNearTerminal: true,
      serviceLineId: true,
      serviceLine: { select: { name: true } },
    },
    orderBy: { order: "asc" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// buildReqWhere — re-usable base requirement where clause (no date window)
// ─────────────────────────────────────────────────────────────────────────────

function buildReqWhere(q: Record<string, string>): Record<string, any> {
  const where: Record<string, any> = { deletedAt: null };

  // multi-value params — frontend sends repeated keys e.g. status=ACTIVE&status=CLOSED
  const statuses = q.status
    ? Array.isArray((q as any).status)
      ? (q as any).status
      : [q.status]
    : null;
  if (statuses?.length) {
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }

  const clientIds = q.clientId
    ? Array.isArray((q as any).clientId)
      ? (q as any).clientId
      : [q.clientId]
    : null;
  if (clientIds?.length) {
    where.clientId = clientIds.length === 1 ? clientIds[0] : { in: clientIds };
  }

  const serviceLineIds = q.serviceLineId
    ? Array.isArray((q as any).serviceLineId)
      ? (q as any).serviceLineId
      : [q.serviceLineId]
    : null;
  if (serviceLineIds?.length) {
    where.serviceLineId =
      serviceLineIds.length === 1 ? serviceLineIds[0] : { in: serviceLineIds };
  }

  if (q.businessUnitId) where.businessUnitId = q.businessUnitId;

  const spocIds = q.clientSpocId
    ? Array.isArray((q as any).clientSpocId)
      ? (q as any).clientSpocId
      : [q.clientSpocId]
    : null;
  if (spocIds?.length) {
    where.clientSpocId = spocIds.length === 1 ? spocIds[0] : { in: spocIds };
  }

  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// exportRequirementReport
// GET /reports/requirements/export    — all / selected
// GET /reports/requirements/:id/export — single requirement
//
// Changes from previous version:
//  ✅ Requirements sheet: adds salaryMin, salaryMax, computedSaleValue,
//     saleValueBasis, bandCode, bandName, bandValue, clientPct columns
//  ✅ isNearTerminal stages get their own section header
//  ✅ Candidates sheet: adds Month of Joining, Days to Join derived from
//     lastWorkingDate (priority: actual → expected → LWD → noticePeriod)
//  ✅ Candidates sheet: adds currentCtc, expectedCtc, negotiatedCtc, offeredCtc,
//     noticePeriod, lastWorkingDate, derivedJoiningDate
//  ✅ All existing columns preserved
// ─────────────────────────────────────────────────────────────────────────────

export const exportRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const singleId = (req.params as any).id ?? null;
    const selectedIds = parseIds(q.ids);
    const selectedStageIds = parseIds(q.stageIds);
    const hiddenStageIds = new Set(parseIds(q.hiddenStageIds) ?? []);
    const standardOnly = q.standardOnly === "true";

    // ── Build where ──────────────────────────────────────────────────────────
    let baseWhere: Record<string, any>;
    if (singleId) {
      baseWhere = { id: singleId, deletedAt: null };
    } else {
      const creatorIds = await resolveOrgTreeDown(
        req.user!.id,
        req.user!.isSuperAdmin
      );
      const reqFilter = buildReqWhere(q);
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
      // baseWhere =
      //   creatorIds !== null
      //     ? { ...reqFilter, ...activityFilter, createdById: { in: creatorIds } }
      //     : { ...reqFilter, ...activityFilter };

      if (creatorIds !== null) {
        const assignedReqRows = await prisma.requirementAssignment.findMany({
          where: { assignedToId: { in: creatorIds }, status: "ACTIVE" },
          select: { requirementId: true },
        });
        const assignedReqIds = [
          ...new Set(assignedReqRows.map((a) => a.requirementId)),
        ];

        baseWhere = {
          ...reqFilter,
          ...activityFilter,
          OR: [
            { createdById: { in: creatorIds } },
            ...(assignedReqIds.length > 0
              ? [{ id: { in: assignedReqIds } }]
              : []),
          ],
        };
      } else {
        baseWhere = { ...reqFilter, ...activityFilter };
      }

      if (selectedIds) {
        baseWhere.id = { in: selectedIds };
        delete baseWhere.pipelines;
      }
    }

    // ── Stages ───────────────────────────────────────────────────────────────
    const stages = await fetchScopedStages(q.serviceLineId);
    const activeStages = (
      standardOnly ? stages.filter((s) => s.isStandard) : stages
    ).filter((s) => !hiddenStageIds.has(s.id));
    const stageIdSet = new Set(stages.map((s) => s.id));

    // Separate stage groups
    const terminalStages = activeStages.filter((s) => s.isTerminal);
    const nearTerminalStages = activeStages.filter(
      (s) => s.isNearTerminal && !s.isTerminal
    );
    const pipelineStages = activeStages.filter(
      (s) => !s.isTerminal && !s.isNearTerminal
    );

    // ── Requirements ─────────────────────────────────────────────────────────
    const requirements = await prisma.requirement.findMany({
      where: baseWhere,
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        priority: true,
        jobType: true,
        remoteType: true,
        totalOpenings: true,
        city: true,
        state: true,
        country: true,
        respondBy: true,
        isRespondByBreached: true,
        isTurnaroundBreached: true,
        createdAt: true,
        deletedAt: true,
        // Sale value fields
        saleValue: true,
        salaryMin: true,
        salaryMax: true,
        band: {
          select: {
            id: true,
            code: true,
            name: true,
            value: true,
          },
        },
        client: {
          select: {
            id: true,
            name: true,
            percentageValue: true,
          },
        },
        clientSpoc: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            designation: true,
          },
        },
        businessUnit: { select: { id: true, name: true } },
        serviceLine: { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    if (!requirements.length)
      return res
        .status(404)
        .json({ success: false, message: "No requirements found" });

    const reqIds = requirements.map((r) => r.id);

    // ── Stage counts ─────────────────────────────────────────────────────────
    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: { requirementId: { in: reqIds } },
      _count: { id: true },
    });
    const countsByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      if (!stageIdSet.has(sc.currentStageId)) continue;
      if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = {};
      countsByReq[sc.requirementId][sc.currentStageId] =
        (countsByReq[sc.requirementId][sc.currentStageId] ?? 0) + sc._count.id;
    }

    // ── Grand stage totals for column headers ────────────────────────────────
    const grandStageCounts: Record<string, number> = {};
    for (const r of requirements) {
      const counts = countsByReq[r.id] ?? {};
      for (const s of activeStages) {
        grandStageCounts[s.id] =
          (grandStageCounts[s.id] ?? 0) + (counts[s.id] ?? 0);
      }
    }

    // ── Pipeline rows ────────────────────────────────────────────────────────
    const pipelineWhere: Record<string, any> = {
      requirementId: { in: reqIds },
    };
    if (q.disposition) pipelineWhere.disposition = q.disposition as any;
    // Stage filter from export options
    if (selectedStageIds) {
      pipelineWhere.currentStageId = { in: selectedStageIds };
    }

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: PIPELINE_DETAIL_SELECT as any,
      orderBy: { createdAt: "asc" },
    });

    // ── Build workbook ───────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 1: Requirements
    // ════════════════════════════════════════════════════════════════════════
    const sheet1 = workbook.addWorksheet("Requirements", {
      views: [{ state: "frozen", ySplit: 2 }],
    });

    // Fixed columns — always shown
    const fixedCols = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Title", key: "title", width: 38 },
      { header: "Status", key: "status", width: 16 },
      { header: "Priority", key: "priority", width: 12 },
      { header: "Client", key: "client", width: 24 },
      { header: "Client SPOC", key: "spoc", width: 22 },
      { header: "SPOC Email", key: "spocEmail", width: 26 },
      { header: "Business Unit", key: "bu", width: 22 },
      { header: "Service Line", key: "sl", width: 20 },
      { header: "City", key: "city", width: 16 },
      { header: "Country", key: "country", width: 14 },
      { header: "Job Type", key: "jobType", width: 16 },
      { header: "Remote", key: "remote", width: 12 },
      { header: "Total Openings", key: "openings", width: 14 },
      { header: "Created By", key: "createdBy", width: 22 },
      { header: "Created Date", key: "createdAt", width: 18 },
      { header: "Deleted Date", key: "deletedAt", width: 18 },
      { header: "Days Open", key: "daysOpen", width: 12 },
      { header: "Respond By", key: "respondBy", width: 18 },
      { header: "SLA Breached?", key: "breached", width: 14 },
      { header: "Total Candidates", key: "total", width: 16 },
    ];

    // Sale value columns — NEW: all computation details
    const saleValueCols = [
      { header: "Salary Min", key: "salaryMin", width: 14 },
      { header: "Salary Max", key: "salaryMax", width: 14 },
      { header: "Band Code", key: "bandCode", width: 12 },
      { header: "Band Name", key: "bandName", width: 20 },
      { header: "Band Value", key: "bandValue", width: 14 },
      { header: "Client %", key: "clientPct", width: 12 },
      { header: "Req Sale Value", key: "reqSaleValue", width: 16 },
      { header: "Computed Sale Value", key: "computedSaleValue", width: 22 },
      { header: "Sale Basis", key: "saleValueBasis", width: 18 },
    ];

    // Pipeline stage columns — split into groups
    const pipelineStageCols = pipelineStages.map((s) => ({
      header: `${s.label} (${grandStageCounts[s.id] ?? 0})`,
      key: `stage_${s.id}`,
      width: Math.max(s.label.length + 6, 14),
    }));
    const nearTermStageCols = nearTerminalStages.map((s) => ({
      header: `${s.label} (${grandStageCounts[s.id] ?? 0})`,
      key: `stage_${s.id}`,
      width: Math.max(s.label.length + 6, 14),
    }));
    const terminalStageCols = terminalStages.map((s) => ({
      header: `${s.label} (${grandStageCounts[s.id] ?? 0})`,
      key: `stage_${s.id}`,
      width: Math.max(s.label.length + 6, 14),
    }));

    sheet1.columns = [
      ...fixedCols,
      ...saleValueCols,
      ...pipelineStageCols,
      ...nearTermStageCols,
      ...terminalStageCols,
    ];

    // ── Group header row (row 1) ─────────────────────────────────────────────
    const nFixed = fixedCols.length;
    const nSale = saleValueCols.length;
    const nPipeline = pipelineStageCols.length;
    const nNear = nearTermStageCols.length;
    const nTerminal = terminalStageCols.length;

    const groupRow = sheet1.getRow(1);
    let colCursor = 1;

    // Fixed group
    groupRow.getCell(colCursor).value = "Requirement Details";
    if (nFixed > 1) sheet1.mergeCells(1, colCursor, 1, colCursor + nFixed - 1);
    colCursor += nFixed;

    // Sale value group
    groupRow.getCell(colCursor).value = "Sale Value";
    if (nSale > 1) sheet1.mergeCells(1, colCursor, 1, colCursor + nSale - 1);
    colCursor += nSale;

    // Pipeline stages group
    if (nPipeline > 0) {
      groupRow.getCell(colCursor).value = "Pipeline Stages";
      if (nPipeline > 1)
        sheet1.mergeCells(1, colCursor, 1, colCursor + nPipeline - 1);
      colCursor += nPipeline;
    }

    // Near-terminal group
    if (nNear > 0) {
      groupRow.getCell(colCursor).value = "Near Close";
      if (nNear > 1) sheet1.mergeCells(1, colCursor, 1, colCursor + nNear - 1);
      colCursor += nNear;
    }

    // Terminal / Achieved group
    if (nTerminal > 0) {
      groupRow.getCell(colCursor).value = "Achieved / Placed";
      if (nTerminal > 1)
        sheet1.mergeCells(1, colCursor, 1, colCursor + nTerminal - 1);
    }

    styleHdr(groupRow);
    // Colour each group header differently
    groupRow.getCell(nFixed + 1).fill = SALE_FILL;
    if (nPipeline > 0) groupRow.getCell(nFixed + nSale + 1).fill = SUB_FILL;
    if (nNear > 0)
      groupRow.getCell(nFixed + nSale + nPipeline + 1).fill = NEAR_FILL;
    if (nTerminal > 0)
      groupRow.getCell(nFixed + nSale + nPipeline + nNear + 1).fill =
        ACHIEVED_FILL;

    // ── Column header row (row 2) ────────────────────────────────────────────
    const allColDefs = [
      ...fixedCols,
      ...saleValueCols,
      ...pipelineStageCols,
      ...nearTermStageCols,
      ...terminalStageCols,
    ];
    const colHdr = sheet1.getRow(2);
    allColDefs.forEach((col, i) => {
      colHdr.getCell(i + 1).value = col.header;
    });
    styleHdr(colHdr, SUB_FILL);

    // ── Data rows ─────────────────────────────────────────────────────────────
    const now = Date.now();
    let grandTotal = 0;
    let grandDaysOpen = 0;
    let grandSaleValueSum = 0;
    let grandAchievedSum = 0;
    let omittedCount = 0;

    for (const r of requirements) {
      const counts = countsByReq[r.id] ?? {};
      const totalCandidates = Object.values(counts).reduce((s, n) => s + n, 0);
      const daysOpen = Math.floor(
        (now - new Date(r.createdAt).getTime()) / 86400000
      );
      grandTotal += totalCandidates;
      grandDaysOpen += daysOpen;

      // Sale value computation
      const { computedSaleValue, saleValueBasis } = computeSaleValue({
        saleValue: r.saleValue,
        totalOpenings: r.totalOpenings,
        salaryMin: r.salaryMin,
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

      if (computedSaleValue != null) {
        grandSaleValueSum += computedSaleValue;
        // Achieved value: terminal stage counts / openings × computedSaleValue
        const terminalCount = terminalStages.reduce(
          (sum, s) => sum + (counts[s.id] ?? 0),
          0
        );
        if (r.totalOpenings > 0) {
          grandAchievedSum +=
            (terminalCount / r.totalOpenings) * computedSaleValue;
        }
      } else {
        omittedCount++;
      }

      const rowData: Record<string, any> = {
        reqCode: r.reqCode,
        title: r.title,
        status: r.status,
        priority: r.priority,
        client: r.client?.name ?? "",
        spoc: spocName(r.clientSpoc),
        spocEmail: r.clientSpoc?.email ?? "",
        bu: r.businessUnit?.name ?? "",
        sl: r.serviceLine?.name ?? "",
        city: r.city ?? "",
        country: r.country ?? "",
        jobType: r.jobType,
        remote: r.remoteType,
        openings: r.totalOpenings,
        createdBy: [r.createdBy.firstName, r.createdBy.lastName]
          .filter(Boolean)
          .join(" "),
        createdAt: new Date(r.createdAt),
        deletedAt: r.deletedAt ? new Date(r.deletedAt) : "",
        daysOpen,
        respondBy: r.respondBy ? new Date(r.respondBy) : "",
        breached:
          r.isRespondByBreached || r.isTurnaroundBreached ? "Yes" : "No",
        total: totalCandidates,
        // Sale value
        salaryMin: r.salaryMin != null ? Number(r.salaryMin) : "",
        salaryMax: r.salaryMax != null ? Number(r.salaryMax) : "",
        bandCode: r.band?.code ?? "",
        bandName: r.band?.name ?? "",
        bandValue: r.band?.value != null ? Number(r.band.value) : "",
        clientPct:
          r.client?.percentageValue != null
            ? Number(r.client.percentageValue)
            : "",
        reqSaleValue: r.saleValue != null ? Number(r.saleValue) : "",
        computedSaleValue: computedSaleValue ?? "",
        saleValueBasis:
          computedSaleValue != null ? saleValueBasis : "NOT_FOUND",
      };

      // Stage count cells
      for (const s of activeStages) {
        rowData[`stage_${s.id}`] = counts[s.id] ?? 0;
      }

      const dataRow = sheet1.addRow(rowData);
      dataRow.height = 20;
      dataRow.getCell("createdAt").numFmt = "dd-mmm-yyyy hh:mm";
      if (r.deletedAt)
        dataRow.getCell("deletedAt").numFmt = "dd-mmm-yyyy hh:mm";
      if (r.respondBy) dataRow.getCell("respondBy").numFmt = "dd-mmm-yyyy";

      // Status colour
      const sc = STATUS_COLORS[r.status];
      if (sc) {
        dataRow.getCell("status").fill = mkFill(sc);
        dataRow.getCell("status").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      }

      // Breach highlight
      if (r.isRespondByBreached || r.isTurnaroundBreached) {
        dataRow.getCell("breached").fill = mkFill("FFDE350B");
        dataRow.getCell("breached").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      }

      // Computed sale value styling
      if (computedSaleValue != null) {
        dataRow.getCell("computedSaleValue").fill = LIGHT.green;
        dataRow.getCell("computedSaleValue").font = { bold: true };
        dataRow.getCell("computedSaleValue").numFmt = "#,##0.00";
      } else {
        dataRow.getCell("computedSaleValue").fill = LIGHT.red;
        dataRow.getCell("computedSaleValue").font = {
          color: { argb: "FFDE350B" },
        };
        dataRow.getCell("computedSaleValue").value = "No Data";
      }

      // Near-terminal stage cells — amber tint
      for (const s of nearTerminalStages) {
        if ((counts[s.id] ?? 0) > 0) {
          dataRow.getCell(`stage_${s.id}`).fill = LIGHT.amber;
          dataRow.getCell(`stage_${s.id}`).font = { bold: true };
        }
      }

      // Terminal stage cells — green tint
      for (const s of terminalStages) {
        if ((counts[s.id] ?? 0) > 0) {
          dataRow.getCell(`stage_${s.id}`).fill = LIGHT.green;
          dataRow.getCell(`stage_${s.id}`).font = {
            bold: true,
            color: { argb: "FF1A5C2A" },
          };
        }
      }
    }

    // ── Totals row ─────────────────────────────────────────────────────────
    const grandStageData: Record<string, number> = {};
    for (const s of activeStages) {
      grandStageData[`stage_${s.id}`] = grandStageCounts[s.id] ?? 0;
    }

    const totalsRow = sheet1.addRow({
      reqCode: `TOTAL: ${requirements.length} requirements (${omittedCount} no sale data)`,
      title: "",
      status: "",
      priority: "",
      client: "",
      spoc: "",
      spocEmail: "",
      bu: "",
      sl: "",
      city: "",
      country: "",
      jobType: "",
      remote: "",
      openings: requirements.reduce((s, r) => s + r.totalOpenings, 0),
      createdBy: "",
      createdAt: "",
      deletedAt: "",
      daysOpen:
        requirements.length > 0
          ? Math.round(grandDaysOpen / requirements.length)
          : 0,
      respondBy: "",
      breached: "",
      total: grandTotal,
      salaryMin: "",
      salaryMax: "",
      bandCode: "",
      bandName: "",
      bandValue: "",
      clientPct: "",
      reqSaleValue: "",
      computedSaleValue: grandSaleValueSum,
      saleValueBasis: "",
      ...grandStageData,
    });
    styleTotalsRow(totalsRow);
    totalsRow.getCell("computedSaleValue").numFmt = "#,##0.00";
    totalsRow.getCell("computedSaleValue").font = {
      bold: true,
      color: { argb: "FF1A5C2A" },
    };
    sheet1.mergeCells(totalsRow.number, 1, totalsRow.number, 4);

    sheet1.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: allColDefs.length },
    };

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 2: Candidates
    // ════════════════════════════════════════════════════════════════════════
    const reqLookup = Object.fromEntries(requirements.map((r) => [r.id, r]));
    const totalPipelineByReq: Record<string, number> = {};
    for (const p of pipelines) {
      totalPipelineByReq[p.requirementId] =
        (totalPipelineByReq[p.requirementId] ?? 0) + 1;
    }

    const sheet2 = workbook.addWorksheet("Candidates", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet2.columns = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Requirement", key: "reqTitle", width: 36 },
      { header: "Total Pipeline", key: "totalPipeline", width: 14 },
      { header: "Client", key: "client", width: 22 },
      { header: "Client SPOC", key: "spoc", width: 22 },
      { header: "Service Line", key: "reqSL", width: 18 },
      { header: "Business Unit", key: "reqBU", width: 18 },
      // Candidate
      { header: "Candidate Name", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Current Title", key: "title", width: 26 },
      { header: "Current Company", key: "company", width: 24 },
      { header: "Exp (yrs)", key: "exp", width: 10 },
      { header: "Top Skills", key: "skills", width: 40 },
      { header: "Recruiter", key: "recruiter", width: 22 },
      // Stage
      { header: "Current Stage", key: "stage", width: 22 },
      { header: "Is Terminal?", key: "isTerminal", width: 12 },
      { header: "Is Near Terminal?", key: "isNearTerminal", width: 14 },
      { header: "Status", key: "status", width: 12 },
      // Timeline
      { header: "Added On", key: "addedOn", width: 16 },
      { header: "Days in Pipeline", key: "pipelineDays", width: 16 },
      { header: "Stage Aging", key: "stageAging", width: 14 },
      // Offer / CTC
      { header: "Submitted At", key: "submittedAt", width: 18 },
      { header: "Offer Status", key: "offerStatus", width: 14 },
      { header: "Current CTC", key: "currentCtc", width: 14 },
      { header: "Expected CTC", key: "expectedCtc", width: 14 },
      { header: "Negotiated CTC", key: "negotiatedCtc", width: 14 },
      { header: "Offered CTC", key: "offeredCtc", width: 14 },
      // Joining
      { header: "Notice Period", key: "noticePeriod", width: 14 },
      { header: "Last Working Day", key: "lastWorkingDay", width: 16 },
      { header: "Expected Joining", key: "expectedJoining", width: 16 },
      { header: "Actual Joining", key: "actualJoining", width: 16 },
      { header: "Derived Joining", key: "derivedJoining", width: 16 },
      { header: "Month of Joining", key: "monthOfJoining", width: 16 },
      { header: "Days to Join", key: "daysToJoin", width: 12 },
      // Disposition flags
      { header: "Rejected?", key: "rejected", width: 10 },
      { header: "Withdrawn?", key: "withdrawn", width: 10 },
      { header: "On Hold?", key: "onHold", width: 10 },
      // Sale value context
      { header: "Req Salary Min", key: "reqSalaryMin", width: 14 },
      { header: "Req Salary Max", key: "reqSalaryMax", width: 14 },
      { header: "Computed Sale Value", key: "computedSaleValue", width: 20 },
      { header: "Sale Basis", key: "saleValueBasis", width: 16 },
    ];

    const candHdr = sheet2.getRow(1);
    styleHdr(candHdr);

    for (const p of pipelines as any[]) {
      const r = reqLookup[p.requirementId];
      if (!r) continue;

      const stageAgeMins = Math.floor(
        (now - new Date(p.stageUpdatedAt).getTime()) / 60000
      );
      const totalPipelineMins =
        (p.stageHistory ?? []).reduce(
          (sum: number, log: any) => sum + (log.timeInPrevStageMins ?? 0),
          0
        ) + stageAgeMins;

      // Joining date derivation
      const derivedJoining = deriveJoiningDate(
        p.actualJoiningDate,
        p.expectedJoiningDate,
        p.lastWorkingDate,
        p.noticePeriod
      );
      const monthOfJoining = derivedJoining
        ? format(derivedJoining, "MMMM yyyy")
        : "";
      const daysToJoin = derivedJoining
        ? Math.max(0, Math.floor((derivedJoining.getTime() - now) / 86400000))
        : "";

      // Sale value for this requirement
      const { computedSaleValue, saleValueBasis } = computeSaleValue({
        saleValue: r.saleValue,
        totalOpenings: r.totalOpenings,
        salaryMin: r.salaryMin,
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

      // Status string
      const candidateStatus = p.currentStage?.isTerminal
        ? "Placed"
        : p.isNearTerminal
        ? "Near Terminal"
        : p.isRejected
        ? "Rejected"
        : p.isWithdrawn
        ? "Withdrawn"
        : p.isOnHold
        ? "On Hold"
        : "Active";

      const dataRow = sheet2.addRow({
        reqCode: r.reqCode,
        reqTitle: r.title,
        totalPipeline: totalPipelineByReq[p.requirementId] ?? 0,
        client: r.client?.name ?? "",
        spoc: spocName(r.clientSpoc),
        reqSL: r.serviceLine?.name ?? "",
        reqBU: r.businessUnit?.name ?? "",
        name: p.snapshot?.fullName ?? "",
        email: p.snapshot?.email ?? "",
        phone: p.snapshot?.phone ?? "",
        title: p.snapshot?.currentTitle ?? "",
        company: p.snapshot?.currentCompany ?? "",
        exp: p.snapshot?.totalExpYears ?? "",
        skills: Array.isArray(p.snapshot?.topSkills)
          ? p.snapshot.topSkills.join(", ")
          : p.snapshot?.topSkills ?? "",
        recruiter: p.recruiter
          ? `${p.recruiter.firstName} ${p.recruiter.lastName}`
          : "",
        stage: p.currentStage?.label ?? "",
        isTerminal: p.currentStage?.isTerminal ? "Yes" : "No",
        isNearTerminal: p.currentStage?.isNearTerminal ? "Yes" : "No",
        status: candidateStatus,
        addedOn: new Date(p.createdAt),
        pipelineDays: Math.floor(totalPipelineMins / 1440),
        stageAging: formatAging(stageAgeMins),
        submittedAt: p.submittedAt ? new Date(p.submittedAt) : "",
        offerStatus: p.offerStatus ?? "",
        currentCtc: p.currentCtc != null ? Number(p.currentCtc) : "",
        expectedCtc: p.expectedCtc != null ? Number(p.expectedCtc) : "",
        negotiatedCtc: p.negotiatedCtc != null ? Number(p.negotiatedCtc) : "",
        offeredCtc: p.offeredCtc != null ? Number(p.offeredCtc) : "",
        noticePeriod: p.noticePeriod ?? "",
        lastWorkingDay: p.lastWorkingDate ? new Date(p.lastWorkingDate) : "",
        expectedJoining: p.expectedJoiningDate
          ? new Date(p.expectedJoiningDate)
          : "",
        actualJoining: p.actualJoiningDate ? new Date(p.actualJoiningDate) : "",
        derivedJoining: derivedJoining ?? "",
        monthOfJoining,
        daysToJoin,
        rejected: p.isRejected ? "Yes" : "No",
        withdrawn: p.isWithdrawn ? "Yes" : "No",
        onHold: p.isOnHold ? "Yes" : "No",
        reqSalaryMin: r.salaryMin != null ? Number(r.salaryMin) : "",
        reqSalaryMax: r.salaryMax != null ? Number(r.salaryMax) : "",
        computedSaleValue: computedSaleValue ?? "",
        saleValueBasis:
          computedSaleValue != null ? saleValueBasis : "NOT_FOUND",
      });

      dataRow.height = 18;

      // Date formatting
      dataRow.getCell("addedOn").numFmt = "dd-mmm-yyyy";
      if (p.submittedAt)
        dataRow.getCell("submittedAt").numFmt = "dd-mmm-yyyy hh:mm";
      if (p.lastWorkingDate)
        dataRow.getCell("lastWorkingDay").numFmt = "dd-mmm-yyyy";
      if (p.expectedJoiningDate)
        dataRow.getCell("expectedJoining").numFmt = "dd-mmm-yyyy";
      if (p.actualJoiningDate)
        dataRow.getCell("actualJoining").numFmt = "dd-mmm-yyyy";
      if (derivedJoining)
        dataRow.getCell("derivedJoining").numFmt = "dd-mmm-yyyy";

      // Terminal rows — green tint
      if (p.currentStage?.isTerminal) {
        ["stage", "isTerminal", "status"].forEach((k) => {
          dataRow.getCell(k).fill = LIGHT.green;
          dataRow.getCell(k).font = { bold: true, color: { argb: "FF1A5C2A" } };
        });
        if (p.actualJoiningDate) {
          dataRow.getCell("actualJoining").fill = LIGHT.green;
        }
        if (monthOfJoining) {
          dataRow.getCell("monthOfJoining").fill = LIGHT.green;
          dataRow.getCell("monthOfJoining").font = {
            bold: true,
            color: { argb: "FF1A5C2A" },
          };
        }
      }

      // Near-terminal rows — amber tint
      if (p.currentStage?.isNearTerminal && !p.currentStage?.isTerminal) {
        ["stage", "isNearTerminal", "status"].forEach((k) => {
          dataRow.getCell(k).fill = LIGHT.amber;
          dataRow.getCell(k).font = { bold: true };
        });
      }

      // Rejected/withdrawn — grey out
      if (p.isRejected || p.isWithdrawn) {
        dataRow.eachCell((cell) => {
          cell.font = { ...cell.font, color: { argb: "FF9E9E9E" } };
        });
      }

      // Computed sale value styling in candidates sheet
      if (computedSaleValue != null) {
        dataRow.getCell("computedSaleValue").fill = LIGHT.green;
        dataRow.getCell("computedSaleValue").font = { bold: true };
        dataRow.getCell("computedSaleValue").numFmt = "#,##0.00";
      } else {
        dataRow.getCell("computedSaleValue").fill = LIGHT.red;
        dataRow.getCell("computedSaleValue").value = "No Data";
      }
    }

    sheet2.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet2.columnCount },
    };

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 3: Summary
    // ════════════════════════════════════════════════════════════════════════
    const sheet3 = workbook.addWorksheet("Summary");
    sheet3.columns = [
      { header: "Metric", key: "metric", width: 30 },
      { header: "Value", key: "value", width: 20 },
    ];
    styleHdr(sheet3.getRow(1));

    // Month-of-joining breakdown across all pipeline rows
    const monthJoinMap: Record<string, number> = {};
    for (const p of pipelines as any[]) {
      const derivedJoining = deriveJoiningDate(
        p.actualJoiningDate,
        p.expectedJoiningDate,
        p.lastWorkingDate,
        p.noticePeriod
      );
      if (derivedJoining) {
        const mo = format(derivedJoining, "MMMM yyyy");
        monthJoinMap[mo] = (monthJoinMap[mo] ?? 0) + 1;
      }
    }

    const summaryRows = [
      { metric: "Requirements", value: requirements.length },
      {
        metric: "Total Openings",
        value: requirements.reduce((s, r) => s + r.totalOpenings, 0),
      },
      { metric: "Total Candidates", value: grandTotal },
      { metric: "Computed Sale Value", value: grandSaleValueSum },
      { metric: "Achieved Value (Terminal)", value: grandAchievedSum },
      { metric: "Requirements with No Sale Data", value: omittedCount },
      { metric: "", value: "" },
      { metric: "MONTH OF JOINING BREAKDOWN", value: "" },
      ...Object.entries(monthJoinMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, count]) => ({ metric: `  ${month}`, value: count })),
      { metric: "", value: "" },
      { metric: "STAGE BREAKDOWN (ACTIVE)", value: "" },
      ...pipelineStages.map((s) => ({
        metric: `  ${s.label}`,
        value: grandStageCounts[s.id] ?? 0,
      })),
      { metric: "", value: "" },
      { metric: "NEAR TERMINAL (NEAR CLOSE)", value: "" },
      ...nearTerminalStages.map((s) => ({
        metric: `  ${s.label}`,
        value: grandStageCounts[s.id] ?? 0,
      })),
      { metric: "", value: "" },
      { metric: "ACHIEVED / PLACED", value: "" },
      ...terminalStages.map((s) => ({
        metric: `  ${s.label}`,
        value: grandStageCounts[s.id] ?? 0,
      })),
      { metric: "", value: "" },
      {
        metric: "Export Generated At",
        value: format(new Date(), "dd-MMM-yyyy HH:mm"),
      },
    ];

    for (const row of summaryRows) {
      const r = sheet3.addRow(row);
      if (typeof row.value === "number" && row.metric.includes("Value")) {
        r.getCell("value").numFmt = "#,##0.00";
        r.getCell("value").font = { bold: true, color: { argb: "FF1A5C2A" } };
      }
    }

    // ── Stream ────────────────────────────────────────────────────────────────
    const suffix = singleId
      ? requirements[0]?.reqCode ?? singleId
      : selectedIds
      ? "selected"
      : "all";
    const dateStr = format(new Date(), "yyyy-MM-dd");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="requirements-${suffix}-${dateStr}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportRequirementReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to export requirement report" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Date window resolver (keep in sync with your existing one)
// ─────────────────────────────────────────────────────────────────────────────

function resolveDateWindow(q: Record<string, string>): {
  gte?: Date;
  lte?: Date;
} {
  const now = new Date();
  if (q.hours) {
    const h = parseInt(q.hours, 10);
    return { gte: new Date(now.getTime() - h * 3600000) };
  }
  if (q.fromDate || q.toDate) {
    return {
      ...(q.fromDate ? { gte: new Date(q.fromDate) } : {}),
      ...(q.toDate
        ? { lte: new Date(new Date(q.toDate).setHours(23, 59, 59, 999)) }
        : {}),
    };
  }
  if (q.range) {
    const start = new Date(now);
    switch (q.range) {
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
