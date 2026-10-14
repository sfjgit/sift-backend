// File: reports.requirements.export.controller.ts
// Path: src/controller/reports/reports.requirements.export.controller.ts

import ExcelJS from "exceljs";
import { addDays, addMonths, format, parse } from "date-fns";
import { CandidateDisposition, Prisma } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import {
  Q,
  str,
  toArr,
  personName,
  enumIn,
  REPORT_ASSIGNMENT_STATUSES,
  computeSaleValue,
  SaleValueBasis,
  shareOf,
  pctOf,
  windowLabel,
  fetchScopedStages,
  fetchStageFlagMap,
  classifyStageCounts,
  resolveRequirementScope,
  buildRequirementWhere,
  buildActivityPipelineWhere,
  monthKey,
  monthLabel,
  buildCreatedMonthBreakdown,
  ScopedStage,
} from "./reports.requirements.shared";

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
  if (mins < 43800) return `${Math.floor(mins / 10080)}wk`;
  return `${Math.floor(mins / 43800)}mo`;
}

/** Priority: actual → expected → LWD → noticePeriod from today */
function deriveJoiningDate(
  actualJoiningDate: Date | null,
  expectedJoiningDate: Date | null,
  lastWorkingDate: Date | null,
  noticePeriod: string | null
): Date | null {
  if (actualJoiningDate) return actualJoiningDate;
  if (expectedJoiningDate) return expectedJoiningDate;
  if (lastWorkingDate) return lastWorkingDate;
  if (noticePeriod) {
    const lower = noticePeriod.toLowerCase().trim();
    const m = lower.match(/^(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      return lower.includes("month")
        ? addMonths(new Date(), n)
        : addDays(new Date(), n);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE
// ─────────────────────────────────────────────────────────────────────────────

const mkFill = (argb: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});

const FILLS = {
  header: mkFill("FF1E3A5F"),
  sub: mkFill("FF2D5986"),
  sale: mkFill("FF1A5C2A"),
  near: mkFill("FF8B5E0A"),
  achieved: mkFill("FF4A148C"),
  totals: mkFill("FFF0F4FF"),
};

const LIGHT = {
  green: mkFill("FFE2EFDA"),
  red: mkFill("FFFCE4D6"),
  amber: mkFill("FFFFF3CD"),
};

const COLORS = {
  white: "FFFFFFFF",
  green: "FF1A5C2A",
  red: "FFDE350B",
  grey: "FF9E9E9E",
  border: "FF4A90D9",
  totalsBorder: "FF4F46E5",
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "FF00875A",
  CLOSED: "FFDE350B",
  ON_HOLD: "FFFF991F",
  PENDING_APPROVAL: "FF0052CC",
  DRAFT: "FF6B778C",
  CANCELLED: "FF5E6C84",
};

const CANDIDATE_STATUS = {
  PLACED: "Placed",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  ON_HOLD: "On Hold",
  NEAR_CLOSE: "Near Close",
  ACTIVE: "Active",
} as const;

const FMT = {
  date: "dd-mmm-yyyy",
  dateTime: "dd-mmm-yyyy hh:mm",
  money: "#,##0.00",
};

/** Filters echoed into the Summary sheet so you can verify what was applied */
const FILTER_LABELS: Record<string, string> = {
  status: "Status",
  priority: "Priority",
  jobType: "Job Type",
  remoteType: "Remote Type",
  clientId: "Client",
  clientSpocId: "Client SPOC",
  serviceLineId: "Service Line",
  businessUnitId: "Business Unit",
  createdById: "Created By",
  assignedToId: "Assigned To",
  assignedById: "Assigned By",
  recruiterId: "Recruiter",
  userIds: "Team",
  disposition: "Disposition",
  stageIds: "Stages (candidates)",
  hiddenStageIds: "Hidden Stages",
  ids: "Selected Requirements",
  bucket: "Summary Slice",
};
const USER_FILTER_KEYS = [
  "createdById",
  "assignedToId",
  "assignedById",
  "recruiterId",
  "userIds",
];

function styleHeaderCell(cell: ExcelJS.Cell, fill: ExcelJS.Fill) {
  cell.fill = fill;
  cell.font = { color: { argb: COLORS.white }, bold: true, size: 10 };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = { bottom: { style: "thin", color: { argb: COLORS.border } } };
}

/** Styles every column 1..colCount (eachCell skips empty/merged cells) */
function styleHeaderRow(
  row: ExcelJS.Row,
  colCount: number,
  fill: ExcelJS.Fill
) {
  for (let c = 1; c <= colCount; c++) styleHeaderCell(row.getCell(c), fill);
  row.height = 26;
}

function styleTotalsRow(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true };
    cell.fill = FILLS.totals;
    cell.border = {
      top: { style: "medium", color: { argb: COLORS.totalsBorder } },
    };
  }
  row.height = 22;
}

type ColDef = { header: string; key: string; width: number };

const stageCol = (s: ScopedStage, grand: Record<string, number>): ColDef => ({
  header: `${s.label} (${grand[s.id] ?? 0})`,
  key: `stage_${s.id}`,
  width: Math.max(s.label.length + 6, 14),
});

// ─────────────────────────────────────────────────────────────────────────────
// exportRequirementReport
// GET /reports/requirements/export      — all / selected (?ids=)
// GET /reports/requirements/:id/export  — single requirement
//
// Same scope + filters as GET /reports/requirements (shared helper).
// Candidate rows and counts are ALWAYS restricted to the caller's hierarchy.
// ─────────────────────────────────────────────────────────────────────────────

export const exportRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const singleId = str((req.params as { id?: string }).id) ?? null;
    const selectedIds = toArr(q.ids);
    const selectedStageIds = toArr(q.stageIds);
    const hiddenStageIds = new Set(toArr(q.hiddenStageIds));
    const standardOnly = str(q.standardOnly) === "true";
    const dispositionIn = enumIn(
      q.disposition,
      Object.values(CandidateDisposition)
    );

    // ── 1. Scope + where (identical to the on-screen report) ─────────────
    const scope = await resolveRequirementScope(req, q);
    const reqWhere = await buildRequirementWhere(q, scope, {
      singleId,
      selectedIds: selectedIds.length ? selectedIds : null,
    });

    const requirements = await prisma.requirement.findMany({
      where: reqWhere,
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
        country: true,
        respondBy: true,
        isRespondByBreached: true,
        isTurnaroundBreached: true,
        createdAt: true,
        deletedAt: true,
        saleValue: true,
        perOpeningValue: true,
        saleValueBasis: true,
        salaryMin: true,
        salaryMax: true,
        band: { select: { id: true, code: true, name: true, value: true } },
        client: { select: { id: true, name: true, percentageValue: true } },
        clientSpoc: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        businessUnit: { select: { id: true, name: true } },
        serviceLine: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1_000,
    });

    if (!requirements.length)
      return res
        .status(404)
        .json({ success: false, message: "No requirements found" });

    const reqIds = requirements.map((r) => r.id);

    // ── 2. Stages ────────────────────────────────────────────────────────
    const slFilter = toArr(q.serviceLineId);
    const stageSlIds = slFilter.length
      ? slFilter
      : singleId && requirements[0].serviceLine
      ? [requirements[0].serviceLine.id]
      : [];

    const [scopedStages, stageById] = await Promise.all([
      fetchScopedStages(stageSlIds),
      fetchStageFlagMap(),
    ]);

    const visibleStages = scopedStages.filter(
      (s) => (!standardOnly || s.isStandard) && !hiddenStageIds.has(s.id)
    );
    const terminalStages = visibleStages.filter((s) => s.isTerminal);
    const nearStages = visibleStages.filter(
      (s) => s.isNearTerminal && !s.isTerminal
    );
    const pipelineStages = visibleStages.filter(
      (s) => !s.isTerminal && !s.isNearTerminal
    );

    // ── 3. Pipeline where — ownership ALWAYS applied ─────────────────────
    const pipelineBaseWhere: Prisma.RequirementCandidatePipelineWhereInput = {
      requirementId: { in: reqIds },
      ...scope.pipelineOwnerWhere,
      ...buildActivityPipelineWhere(q), // activity date → counts + candidate rows
      ...(dispositionIn ? { disposition: dispositionIn } : {}),
    };
    const candidateWhere: Prisma.RequirementCandidatePipelineWhereInput = {
      ...pipelineBaseWhere,
      ...(selectedStageIds.length
        ? { currentStageId: { in: selectedStageIds } }
        : hiddenStageIds.size
        ? { currentStageId: { notIn: [...hiddenStageIds] } }
        : {}),
    };

    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: pipelineBaseWhere,
      _count: { id: true },
    });

    const [pipelines, assignments] = await Promise.all([
      prisma.requirementCandidatePipeline.findMany({
        where: candidateWhere,
        select: {
          id: true,
          requirementId: true,
          currentStageId: true,
          disposition: true,
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
          monthOfJoining: true,
          createdAt: true,
          currentStage: {
            select: { label: true, isTerminal: true, isNearTerminal: true },
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
        },
        orderBy: [{ requirementId: "asc" }, { createdAt: "asc" }],
      }),
      prisma.requirementAssignment.findMany({
        where: {
          requirementId: { in: reqIds },
          status: { in: REPORT_ASSIGNMENT_STATUSES },
        },
        select: { requirementId: true, assignedToId: true, assignedById: true },
      }),
    ]);

    // ── 4. Name lookups (assignees + filter echo) ────────────────────────
    const filterUserIds = USER_FILTER_KEYS.flatMap((k) => toArr(q[k]));
    const lookupIds = [
      ...new Set(
        [
          ...assignments.flatMap((a) => [a.assignedToId, a.assignedById]),
          ...filterUserIds,
        ].filter((x): x is string => !!x)
      ),
    ];
    const lookupUsers = lookupIds.length
      ? await prisma.user.findMany({
          where: { id: { in: lookupIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const userName = new Map(lookupUsers.map((u) => [u.id, personName(u)]));

    const assigneesByReq: Record<string, { to: Set<string>; by: Set<string> }> =
      {};
    for (const a of assignments) {
      const b = (assigneesByReq[a.requirementId] ??= {
        to: new Set(),
        by: new Set(),
      });
      if (a.assignedToId) b.to.add(userName.get(a.assignedToId) ?? "");
      if (a.assignedById) b.by.add(userName.get(a.assignedById) ?? "");
    }
    const joinNames = (s?: Set<string>) =>
      s ? [...s].filter(Boolean).join(", ") : "";

    // ── 5. Per-requirement calculations (computed ONCE) ──────────────────
    const countsByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      const bucket = (countsByReq[sc.requirementId] ??= {});
      bucket[sc.currentStageId] =
        (bucket[sc.currentStageId] ?? 0) + sc._count.id;
    }

    // ── Summary-bar slice — same rule the screen uses on its rows ────────
    const bucket = str(q.bucket);
    if (bucket) {
      const keep = requirements.filter((r) => {
        const { terminal, nearTerminal } = classifyStageCounts(
          countsByReq[r.id] ?? {},
          stageById
        );
        return bucket === "terminal"
          ? terminal > 0
          : bucket === "nearTerminal"
          ? nearTerminal > 0
          : true;
      });
      if (!keep.length)
        return res
          .status(404)
          .json({ success: false, message: "No requirements in this slice" });
      requirements.splice(0, requirements.length, ...keep);
    }

    type ReqCalc = {
      counts: Record<string, number>;
      total: number;
      terminal: number;
      near: number;
      saleValue: number | null;
      basis: SaleValueBasis;
      achievedValue: number | null;
      nearValue: number | null;
    };
    const calcByReq = new Map<string, ReqCalc>();
    const grandStageCounts: Record<string, number> = {};

    for (const r of requirements) {
      const counts = countsByReq[r.id] ?? {};
      const { total, terminal, nearTerminal } = classifyStageCounts(
        counts,
        stageById
      );
      const { value, basis } = computeSaleValue(r);
      calcByReq.set(r.id, {
        counts,
        total,
        terminal,
        near: nearTerminal,
        saleValue: value,
        basis,
        achievedValue: shareOf(terminal, r.totalOpenings, value),
        nearValue: shareOf(nearTerminal, r.totalOpenings, value),
      });
      for (const s of visibleStages)
        grandStageCounts[s.id] =
          (grandStageCounts[s.id] ?? 0) + (counts[s.id] ?? 0);
    }

    // ── Workbook ─────────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();
    const now = Date.now();

    // ════════════════════════════════════════════════════════════════════
    // SHEET 1: Requirements (row 1 = group headers, row 2 = column headers)
    // ════════════════════════════════════════════════════════════════════
    const sheet1 = workbook.addWorksheet("Requirements", {
      views: [{ state: "frozen", ySplit: 2, xSplit: 2 }],
    });

    const fixedCols: ColDef[] = [
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
      { header: "Assigned To", key: "assignedTo", width: 28 },
      { header: "Assigned By", key: "assignedBy", width: 22 },
      { header: "Created Date", key: "createdAt", width: 18 },
      { header: "Created Month", key: "createdMonth", width: 14 },
      { header: "Days Open", key: "daysOpen", width: 12 },
      { header: "Respond By", key: "respondBy", width: 16 },
      { header: "SLA Breached?", key: "breached", width: 14 },
      { header: "Total Candidates", key: "total", width: 16 },
    ];

    const saleCols: ColDef[] = [
      { header: "Salary Min", key: "salaryMin", width: 14 },
      { header: "Salary Max", key: "salaryMax", width: 14 },
      { header: "Band Code", key: "bandCode", width: 12 },
      { header: "Band Name", key: "bandName", width: 20 },
      { header: "Band Value", key: "bandValue", width: 14 },
      { header: "Client %", key: "clientPct", width: 10 },
      { header: "Req Sale Value", key: "reqSaleValue", width: 16 },
      { header: "Computed Sale Value", key: "computedSaleValue", width: 20 },
      { header: "Sale Basis", key: "saleValueBasis", width: 14 },
      { header: "Achieved Count", key: "achievedCount", width: 14 },
      { header: "Achieved Value", key: "achievedValue", width: 16 },
      { header: "Achieved %", key: "achievedPct", width: 12 },
      { header: "Near Close Count", key: "nearCount", width: 14 },
      { header: "Near Close Value", key: "nearValue", width: 16 },
      { header: "Near Close %", key: "nearPct", width: 12 },
    ];
    const MONEY_KEYS = [
      "salaryMin",
      "salaryMax",
      "bandValue",
      "reqSaleValue",
      "computedSaleValue",
      "achievedValue",
      "nearValue",
    ];

    const pipelineCols = pipelineStages.map((s) =>
      stageCol(s, grandStageCounts)
    );
    const nearCols = nearStages.map((s) => stageCol(s, grandStageCounts));
    const terminalCols = terminalStages.map((s) =>
      stageCol(s, grandStageCounts)
    );

    const colGroups = [
      { label: "Requirement Details", cols: fixedCols, fill: FILLS.header },
      { label: "Sale Value", cols: saleCols, fill: FILLS.sale },
      { label: "Pipeline Stages", cols: pipelineCols, fill: FILLS.sub },
      { label: "Near Close", cols: nearCols, fill: FILLS.near },
      { label: "Achieved / Placed", cols: terminalCols, fill: FILLS.achieved },
    ].filter((g) => g.cols.length > 0);

    const allCols = colGroups.flatMap((g) => g.cols);

    // NOTE: no `header` here — otherwise ExcelJS writes headers into row 1
    // underneath the merged group headers (that was the "messed up" sheet).
    sheet1.columns = allCols.map(({ key, width }) => ({ key, width }));

    // Row 1 — group headers
    const groupRow = sheet1.getRow(1);
    let cursor = 1;
    for (const g of colGroups) {
      const start = cursor;
      const end = cursor + g.cols.length - 1;
      groupRow.getCell(start).value = g.label;
      if (end > start) sheet1.mergeCells(1, start, 1, end);
      for (let c = start; c <= end; c++)
        styleHeaderCell(groupRow.getCell(c), g.fill);
      cursor = end + 1;
    }
    groupRow.height = 26;

    // Row 2 — column headers
    const colHdr = sheet1.getRow(2);
    allCols.forEach((col, i) => (colHdr.getCell(i + 1).value = col.header));
    styleHeaderRow(colHdr, allCols.length, FILLS.sub);

    // Data rows
    const totals = {
      openings: 0,
      candidates: 0,
      daysOpen: 0,
      sale: 0,
      achievedCount: 0,
      achievedValue: 0,
      nearCount: 0,
      nearValue: 0,
      omitted: 0,
    };

    for (const r of requirements) {
      const c = calcByReq.get(r.id)!;
      const daysOpen = Math.floor(
        (now - new Date(r.createdAt).getTime()) / 86_400_000
      );
      const breached = r.isRespondByBreached || r.isTurnaroundBreached;

      totals.openings += r.totalOpenings;
      totals.candidates += c.total;
      totals.daysOpen += daysOpen;
      totals.achievedCount += c.terminal;
      totals.nearCount += c.near;
      if (c.saleValue != null) {
        totals.sale += c.saleValue;
        totals.achievedValue += c.achievedValue ?? 0;
        totals.nearValue += c.nearValue ?? 0;
      } else {
        totals.omitted++;
      }

      const rowData: Record<string, unknown> = {
        reqCode: r.reqCode,
        title: r.title,
        status: r.status,
        priority: r.priority,
        client: r.client?.name ?? "",
        spoc: personName(r.clientSpoc),
        spocEmail: r.clientSpoc?.email ?? "",
        bu: r.businessUnit?.name ?? "",
        sl: r.serviceLine?.name ?? "",
        city: r.city ?? "",
        country: r.country ?? "",
        jobType: r.jobType,
        remote: r.remoteType,
        openings: r.totalOpenings,
        createdBy: personName(r.createdBy),
        assignedTo: joinNames(assigneesByReq[r.id]?.to),
        assignedBy: joinNames(assigneesByReq[r.id]?.by),
        createdAt: new Date(r.createdAt),
        createdMonth: monthLabel(monthKey(r.createdAt)),
        daysOpen,
        respondBy: r.respondBy ? new Date(r.respondBy) : "",
        breached: breached ? "Yes" : "No",
        total: c.total,
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
        computedSaleValue: c.saleValue ?? "No Data",
        saleValueBasis: c.basis,
        achievedCount: c.terminal,
        achievedValue: c.achievedValue ?? "",
        achievedPct: pctOf(c.terminal, r.totalOpenings),
        nearCount: c.near,
        nearValue: c.nearValue ?? "",
        nearPct: pctOf(c.near, r.totalOpenings),
      };
      for (const s of visibleStages)
        rowData[`stage_${s.id}`] = c.counts[s.id] ?? 0;

      const row = sheet1.addRow(rowData);
      row.height = 20;
      row.getCell("createdAt").numFmt = FMT.dateTime;
      if (r.respondBy) row.getCell("respondBy").numFmt = FMT.date;
      for (const k of MONEY_KEYS) row.getCell(k).numFmt = FMT.money;

      const sc = STATUS_COLORS[r.status];
      if (sc) {
        row.getCell("status").fill = mkFill(sc);
        row.getCell("status").font = {
          color: { argb: COLORS.white },
          bold: true,
        };
      }
      if (breached) {
        row.getCell("breached").fill = mkFill(COLORS.red);
        row.getCell("breached").font = {
          color: { argb: COLORS.white },
          bold: true,
        };
      }

      const svCell = row.getCell("computedSaleValue");
      if (c.saleValue != null) {
        svCell.fill = LIGHT.green;
        svCell.font = { bold: true };
      } else {
        svCell.fill = LIGHT.red;
        svCell.font = { color: { argb: COLORS.red } };
      }

      for (const s of nearStages) {
        if ((c.counts[s.id] ?? 0) > 0) {
          row.getCell(`stage_${s.id}`).fill = LIGHT.amber;
          row.getCell(`stage_${s.id}`).font = { bold: true };
        }
      }
      for (const s of terminalStages) {
        if ((c.counts[s.id] ?? 0) > 0) {
          row.getCell(`stage_${s.id}`).fill = LIGHT.green;
          row.getCell(`stage_${s.id}`).font = {
            bold: true,
            color: { argb: COLORS.green },
          };
        }
      }
    }

    // Totals row
    const grandStageData: Record<string, number> = {};
    for (const s of visibleStages)
      grandStageData[`stage_${s.id}`] = grandStageCounts[s.id] ?? 0;

    const totalsRow = sheet1.addRow({
      reqCode: `TOTAL: ${requirements.length} requirements (${totals.omitted} without sale data)`,
      openings: totals.openings,
      daysOpen: Math.round(totals.daysOpen / requirements.length),
      total: totals.candidates,
      computedSaleValue: totals.sale,
      achievedCount: totals.achievedCount,
      achievedValue: totals.achievedValue,
      nearCount: totals.nearCount,
      nearValue: totals.nearValue,
      ...grandStageData,
    });
    styleTotalsRow(totalsRow, allCols.length);
    for (const k of MONEY_KEYS) totalsRow.getCell(k).numFmt = FMT.money;
    totalsRow.getCell("computedSaleValue").font = {
      bold: true,
      color: { argb: COLORS.green },
    };
    sheet1.mergeCells(totalsRow.number, 1, totalsRow.number, 4);

    sheet1.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: allCols.length },
    };

    // ════════════════════════════════════════════════════════════════════
    // SHEET 2: Candidates (scoped to caller's hierarchy)
    // ════════════════════════════════════════════════════════════════════
    const reqLookup = new Map(requirements.map((r) => [r.id, r]));
    const rowsPerReq: Record<string, number> = {};
    for (const p of pipelines)
      rowsPerReq[p.requirementId] = (rowsPerReq[p.requirementId] ?? 0) + 1;

    // ════════════════════════════════════════════════════════════════════
    // SHEET: By Created Month — where the requirements in this export come from
    // ════════════════════════════════════════════════════════════════════
    const createdMonths = buildCreatedMonthBreakdown(
      requirements.map((r) => {
        const c = calcByReq.get(r.id)!;
        return {
          createdAt: r.createdAt,
          totalOpenings: r.totalOpenings,
          computedSaleValue: c.saleValue,
          terminalCount: c.terminal,
          achievedValue: c.achievedValue,
          nearTerminalCount: c.near,
          nearTerminalValue: c.nearValue,
        };
      })
    );

    const sheetMonths = workbook.addWorksheet("By Created Month", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const monthCols: ColDef[] = [
      { header: "Created Month", key: "label", width: 16 },
      { header: "Requirements", key: "requirements", width: 14 },
      { header: "Openings", key: "openings", width: 12 },
      { header: "Computed Sale Value", key: "computedSaleValue", width: 20 },
      { header: "Placed", key: "terminalCount", width: 10 },
      { header: "Achieved Value", key: "achievedValue", width: 18 },
      { header: "Achieved %", key: "achievedPct", width: 12 },
      { header: "Near Close", key: "nearTerminalCount", width: 12 },
      { header: "Near Close Value", key: "nearTerminalValue", width: 18 },
    ];
    const MONTH_MONEY_KEYS = [
      "computedSaleValue",
      "achievedValue",
      "nearTerminalValue",
    ];
    sheetMonths.columns = monthCols;
    styleHeaderRow(sheetMonths.getRow(1), monthCols.length, FILLS.header);
    for (const m of createdMonths) {
      const row = sheetMonths.addRow(m);
      for (const k of MONTH_MONEY_KEYS) row.getCell(k).numFmt = FMT.money;
    }
    const monthTotals = sheetMonths.addRow({
      label: `TOTAL (${createdMonths.length} months)`,
      requirements: createdMonths.reduce((s, m) => s + m.requirements, 0),
      openings: createdMonths.reduce((s, m) => s + m.openings, 0),
      computedSaleValue: createdMonths.reduce(
        (s, m) => s + m.computedSaleValue,
        0
      ),
      terminalCount: createdMonths.reduce((s, m) => s + m.terminalCount, 0),
      achievedValue: createdMonths.reduce((s, m) => s + m.achievedValue, 0),
      nearTerminalCount: createdMonths.reduce(
        (s, m) => s + m.nearTerminalCount,
        0
      ),
      nearTerminalValue: createdMonths.reduce(
        (s, m) => s + m.nearTerminalValue,
        0
      ),
    });
    styleTotalsRow(monthTotals, monthCols.length);
    for (const k of MONTH_MONEY_KEYS) monthTotals.getCell(k).numFmt = FMT.money;

    const sheet2 = workbook.addWorksheet("Candidates", {
      views: [{ state: "frozen", ySplit: 1, xSplit: 2 }],
    });

    const candCols: ColDef[] = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Requirement", key: "reqTitle", width: 36 },
      { header: "Req Created Month", key: "reqCreatedMonth", width: 16 },
      { header: "Candidates (this export)", key: "totalPipeline", width: 16 },
      { header: "Client", key: "client", width: 22 },
      { header: "Client SPOC", key: "spoc", width: 22 },
      { header: "Service Line", key: "reqSL", width: 18 },
      { header: "Business Unit", key: "reqBU", width: 18 },
      { header: "Req Assigned To", key: "reqAssignedTo", width: 26 },
      { header: "Candidate Name", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Current Title", key: "title", width: 26 },
      { header: "Current Company", key: "company", width: 24 },
      { header: "Exp (yrs)", key: "exp", width: 10 },
      { header: "Top Skills", key: "skills", width: 40 },
      { header: "Recruiter", key: "recruiter", width: 22 },
      { header: "Current Stage", key: "stage", width: 22 },
      { header: "Is Terminal?", key: "isTerminal", width: 12 },
      { header: "Is Near Terminal?", key: "isNearTerminal", width: 14 },
      { header: "Status", key: "status", width: 12 },
      { header: "Disposition", key: "disposition", width: 14 },
      { header: "Added On", key: "addedOn", width: 14 },
      { header: "Days in Pipeline", key: "pipelineDays", width: 14 },
      { header: "Stage Aging", key: "stageAging", width: 12 },
      { header: "Submitted At", key: "submittedAt", width: 18 },
      { header: "Offer Status", key: "offerStatus", width: 14 },
      { header: "Current CTC", key: "currentCtc", width: 14 },
      { header: "Expected CTC", key: "expectedCtc", width: 14 },
      { header: "Negotiated CTC", key: "negotiatedCtc", width: 14 },
      { header: "Offered CTC", key: "offeredCtc", width: 14 },
      { header: "Notice Period", key: "noticePeriod", width: 14 },
      { header: "Last Working Day", key: "lastWorkingDay", width: 16 },
      { header: "Expected Joining", key: "expectedJoining", width: 16 },
      { header: "Actual Joining", key: "actualJoining", width: 16 },
      { header: "Derived Joining", key: "derivedJoining", width: 16 },
      { header: "Month of Joining", key: "monthOfJoining", width: 16 },
      { header: "Days to Join", key: "daysToJoin", width: 12 },
      { header: "Rejected?", key: "rejected", width: 10 },
      { header: "Withdrawn?", key: "withdrawn", width: 10 },
      { header: "On Hold?", key: "onHold", width: 10 },
      { header: "Req Salary Min", key: "reqSalaryMin", width: 14 },
      { header: "Req Salary Max", key: "reqSalaryMax", width: 14 },
      { header: "Computed Sale Value", key: "computedSaleValue", width: 20 },
      { header: "Sale Basis", key: "saleValueBasis", width: 14 },
    ];
    sheet2.columns = candCols;
    styleHeaderRow(sheet2.getRow(1), candCols.length, FILLS.header);

    const monthJoinMap: Record<
      string,
      { label: string; ts: number; count: number }
    > = {};

    for (const p of pipelines) {
      const r = reqLookup.get(p.requirementId);
      if (!r) continue;
      const c = calcByReq.get(r.id)!;

      const stageAnchor = p.stageUpdatedAt ?? p.createdAt;
      const stageAgeMins = Math.max(
        0,
        Math.floor((now - new Date(stageAnchor).getTime()) / 60_000)
      );
      const totalPipelineMins =
        p.stageHistory.reduce((s, l) => s + (l.timeInPrevStageMins ?? 0), 0) +
        stageAgeMins;

      const derivedJoining = deriveJoiningDate(
        p.actualJoiningDate,
        p.expectedJoiningDate,
        p.lastWorkingDate,
        p.noticePeriod
      );
      // Stored on write (source of truth for MOJ reports) → derived fallback
      const monthOfJoining =
        p.monthOfJoining ||
        (derivedJoining ? format(derivedJoining, "MMMM yyyy") : "");
      if (monthOfJoining) {
        const parsed = parse(monthOfJoining, "MMMM yyyy", new Date());
        const m = (monthJoinMap[monthOfJoining] ??= {
          label: monthOfJoining,
          ts: Number.isNaN(parsed.getTime())
            ? Number.MAX_SAFE_INTEGER
            : parsed.getTime(),
          count: 0,
        });
        m.count++;
      }

      const isTerminal = !!p.currentStage?.isTerminal;
      const isNear = !!p.currentStage?.isNearTerminal && !isTerminal;
      const status = isTerminal
        ? CANDIDATE_STATUS.PLACED
        : p.isRejected
        ? CANDIDATE_STATUS.REJECTED
        : p.isWithdrawn
        ? CANDIDATE_STATUS.WITHDRAWN
        : p.isOnHold
        ? CANDIDATE_STATUS.ON_HOLD
        : isNear
        ? CANDIDATE_STATUS.NEAR_CLOSE
        : CANDIDATE_STATUS.ACTIVE;

      const snap = p.snapshot as Record<string, any> | null;
      const skills = Array.isArray(snap?.topSkills)
        ? snap!.topSkills.join(", ")
        : snap?.topSkills ?? "";

      const row = sheet2.addRow({
        reqCode: r.reqCode,
        reqTitle: r.title,
        reqCreatedMonth: monthLabel(monthKey(r.createdAt)),
        totalPipeline: rowsPerReq[p.requirementId] ?? 0,
        client: r.client?.name ?? "",
        spoc: personName(r.clientSpoc),
        reqSL: r.serviceLine?.name ?? "",
        reqBU: r.businessUnit?.name ?? "",
        reqAssignedTo: joinNames(assigneesByReq[r.id]?.to),
        name: snap?.fullName ?? "",
        email: snap?.email ?? "",
        phone: snap?.phone ?? "",
        title: snap?.currentTitle ?? "",
        company: snap?.currentCompany ?? "",
        exp: snap?.totalExpYears ?? "",
        skills,
        recruiter: personName(p.recruiter),
        stage:
          p.currentStage?.label ?? stageById.get(p.currentStageId)?.label ?? "",
        isTerminal: isTerminal ? "Yes" : "No",
        isNearTerminal: isNear ? "Yes" : "No",
        status,
        disposition: p.disposition ?? "",
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
        daysToJoin: derivedJoining
          ? Math.max(
              0,
              Math.floor((derivedJoining.getTime() - now) / 86_400_000)
            )
          : "",
        rejected: p.isRejected ? "Yes" : "No",
        withdrawn: p.isWithdrawn ? "Yes" : "No",
        onHold: p.isOnHold ? "Yes" : "No",
        reqSalaryMin: r.salaryMin != null ? Number(r.salaryMin) : "",
        reqSalaryMax: r.salaryMax != null ? Number(r.salaryMax) : "",
        computedSaleValue: c.saleValue ?? "No Data",
        saleValueBasis: c.basis,
      });
      row.height = 18;

      row.getCell("addedOn").numFmt = FMT.date;
      row.getCell("submittedAt").numFmt = FMT.dateTime;
      for (const k of [
        "lastWorkingDay",
        "expectedJoining",
        "actualJoining",
        "derivedJoining",
      ])
        row.getCell(k).numFmt = FMT.date;
      for (const k of [
        "currentCtc",
        "expectedCtc",
        "negotiatedCtc",
        "offeredCtc",
        "reqSalaryMin",
        "reqSalaryMax",
        "computedSaleValue",
      ])
        row.getCell(k).numFmt = FMT.money;

      if (isTerminal) {
        for (const k of ["stage", "isTerminal", "status", "monthOfJoining"]) {
          row.getCell(k).fill = LIGHT.green;
          row.getCell(k).font = { bold: true, color: { argb: COLORS.green } };
        }
        if (p.actualJoiningDate)
          row.getCell("actualJoining").fill = LIGHT.green;
      } else if (isNear) {
        for (const k of ["stage", "isNearTerminal", "status"]) {
          row.getCell(k).fill = LIGHT.amber;
          row.getCell(k).font = { bold: true };
        }
      }

      const svCell = row.getCell("computedSaleValue");
      if (c.saleValue != null) {
        svCell.fill = LIGHT.green;
        svCell.font = { bold: true };
      } else {
        svCell.fill = LIGHT.red;
      }

      if (p.isRejected || p.isWithdrawn) {
        row.eachCell((cell) => {
          cell.font = { ...cell.font, color: { argb: COLORS.grey } };
        });
      }
    }

    sheet2.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: candCols.length },
    };

    // ════════════════════════════════════════════════════════════════════
    // SHEET 3: Summary (+ applied filters, so you can verify the export)
    // ════════════════════════════════════════════════════════════════════
    const sheet3 = workbook.addWorksheet("Summary");
    sheet3.columns = [
      { header: "Metric", key: "metric", width: 34 },
      { header: "Value", key: "value", width: 40 },
    ];
    styleHeaderRow(sheet3.getRow(1), 2, FILLS.header);

    type SummaryRow = {
      metric: string;
      value: string | number;
      money?: boolean;
      section?: boolean;
    };
    const blank: SummaryRow = { metric: "", value: "" };
    const section = (metric: string): SummaryRow => ({
      metric,
      value: "",
      section: true,
    });
    const stageRows = (list: ScopedStage[]): SummaryRow[] =>
      list.map((s) => ({
        metric: `  ${s.label}`,
        value: grandStageCounts[s.id] ?? 0,
      }));

    const appliedFilterRows: SummaryRow[] = Object.entries(
      FILTER_LABELS
    ).flatMap(([key, label]) => {
      const vals = toArr(q[key]);
      if (!vals.length) return [];
      const display = USER_FILTER_KEYS.includes(key)
        ? vals.map((id) => userName.get(id) || id)
        : vals;
      return [{ metric: `  ${label}`, value: display.join(", ") }];
    });

    const summaryRows: SummaryRow[] = [
      { metric: "Requirements", value: requirements.length },
      { metric: "Total Openings", value: totals.openings },
      { metric: "Total Candidates (in scope)", value: totals.candidates },
      { metric: "Candidate Rows Exported", value: sheet2.rowCount - 1 },
      { metric: "Computed Sale Value", value: totals.sale, money: true },
      {
        metric: "Achieved Value (Terminal)",
        value: totals.achievedValue,
        money: true,
      },
      { metric: "Near Close Value", value: totals.nearValue, money: true },
      { metric: "Requirements with No Sale Data", value: totals.omitted },
      {
        metric: "Created Months Spanned",
        value: createdMonths.length
          ? `${createdMonths.length} (${createdMonths[0].label} → ${
              createdMonths[createdMonths.length - 1].label
            }) — see "By Created Month"`
          : 0,
      },
      blank,
      section("APPLIED FILTERS"),
      { metric: "  Window", value: windowLabel(q) },
      {
        metric: "  Scope",
        value:
          scope.treeUserIds === null
            ? "All (super admin)"
            : `Org tree (${scope.treeUserIds.length} users)`,
      },
      ...appliedFilterRows,
      blank,
      section("MONTH OF JOINING BREAKDOWN"),
      ...Object.values(monthJoinMap)
        .sort((a, b) => a.ts - b.ts)
        .map((m) => ({ metric: `  ${m.label}`, value: m.count })),
      blank,
      section("STAGE BREAKDOWN (ACTIVE)"),
      ...stageRows(pipelineStages),
      blank,
      section("NEAR TERMINAL (NEAR CLOSE)"),
      ...stageRows(nearStages),
      blank,
      section("ACHIEVED / PLACED"),
      ...stageRows(terminalStages),
      blank,
      {
        metric: "Export Generated At",
        value: format(new Date(), "dd-MMM-yyyy HH:mm"),
      },
    ];

    for (const sr of summaryRows) {
      const row = sheet3.addRow({ metric: sr.metric, value: sr.value });
      if (sr.money) {
        row.getCell("value").numFmt = FMT.money;
        row.getCell("value").font = {
          bold: true,
          color: { argb: COLORS.green },
        };
      }
      if (sr.section) row.getCell("metric").font = { bold: true };
    }

    // ── Stream ───────────────────────────────────────────────────────────
    const suffix = singleId
      ? requirements[0].reqCode ?? singleId
      : selectedIds.length
      ? "selected"
      : "all";
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="requirements-${suffix}-${format(
        new Date(),
        "yyyy-MM-dd"
      )}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportRequirementReport:", err);
    if (!res.headersSent)
      return res
        .status(500)
        .json({
          success: false,
          message: "Failed to export requirement report",
        });
  }
};
