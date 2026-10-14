// File: portalRecruit.controller.ts
// Path: src/controller/portalRecruit.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { Prisma } from "@prisma/client";
import { portalRecruitScopeWhere } from "@/middleware/scopeFilter.middleware";

// ─────────────────────────────────────────────────────────────────────────────
// POST /portal-recruit/log
// Saves the recruiter's reason for going to an external portal (Naukri etc.)
// and permanently unlocks that portal for this recruiter + requirement.
// ─────────────────────────────────────────────────────────────────────────────

export const logPortalRecruit = async (req: Request, res: Response) => {
  try {
    const recruiterId = req.user!.id;
    const { requirementId, reqCode, assignmentId, appName, reason } =
      req.body as {
        requirementId: string;
        reqCode?: string;
        assignmentId: string;
        appName: string;
        reason: string;
      };

    if (!requirementId || !assignmentId || !appName || !reason?.trim()) {
      res.status(400).json({
        success: false,
        message: "requirementId, assignmentId, appName and reason are required",
      });
      return;
    }

    const log = await prisma.portalRecruitLog.create({
      data: {
        recruiterId,
        requirementId,
        assignmentId,
        reqCode: reqCode ?? null,
        appName,
        reason: reason.trim(),
      },
    });

    res.status(201).json({ success: true, message: "Logged", data: log });
  } catch (err) {
    console.error("logPortalRecruit:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to log portal recruit reason" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal-recruit/status?requirementId=...
// Returns which portal apps this recruiter has already unlocked for this
// requirement — unlock is permanent once a reason has ever been logged.
// ─────────────────────────────────────────────────────────────────────────────

export const getPortalRecruitStatus = async (req: Request, res: Response) => {
  try {
    const recruiterId = req.user!.id;
    const { requirementId } = req.query as Record<string, string>;

    if (!requirementId) {
      res
        .status(400)
        .json({ success: false, message: "requirementId is required" });
      return;
    }

    const logs = await prisma.portalRecruitLog.findMany({
      where: { requirementId, recruiterId },
      select: { appName: true },
      distinct: ["appName"],
    });

    res.json({
      success: true,
      unlockedApps: logs.map((l) => l.appName),
    });
  } catch (err) {
    console.error("getPortalRecruitStatus:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch portal recruit status",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal-recruit/logs?search=&dateFrom=&dateTo=&page=&limit=&sortDir=
// Lists the reasons recruiters entered before unlocking an external portal.
// Visibility is fully RBAC-driven via req.scopeFilter (set by scopeFilter
// middleware) — no role names are checked here.
// ─────────────────────────────────────────────────────────────────────────────

export const getPortalRecruitLogs = async (req: Request, res: Response) => {
  try {
    const {
      search,
      dateFrom,
      dateTo,
      page = "1",
      limit = "25",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const take = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const skip = (pageNum - 1) * take;

    // 1) RBAC scope first — this decides WHOSE logs can ever be returned
    const and: Prisma.PortalRecruitLogWhereInput[] = [
      portalRecruitScopeWhere(req.scopeFilter!),
    ];

    // 2) recruiter name search — every word must match, so "john doe" works
    const q = search?.trim();
    if (q) {
      for (const token of q.split(/\s+/)) {
        const contains = { contains: token, mode: "insensitive" as const };
        and.push({
          recruiter: {
            OR: [
              { firstName: contains },
              { lastName: contains },
              { displayName: contains },
              { employeeId: contains },
            ],
          },
        });
      }
    }

    // 3) date range on createdAt (IST, same convention as assignments)
    if (dateFrom || dateTo) {
      const range: { gte?: Date; lte?: Date } = {};
      if (dateFrom) range.gte = new Date(`${dateFrom}T00:00:00+05:30`);
      if (dateTo) range.lte = new Date(`${dateTo}T23:59:59.999+05:30`);

      if (
        (range.gte && isNaN(range.gte.getTime())) ||
        (range.lte && isNaN(range.lte.getTime()))
      ) {
        res
          .status(400)
          .json({ success: false, message: "Invalid date filter" });
        return;
      }
      and.push({ createdAt: range });
    }

    const where: Prisma.PortalRecruitLogWhereInput = { AND: and };

    const [total, logs] = await Promise.all([
      prisma.portalRecruitLog.count({ where }),
      prisma.portalRecruitLog.findMany({
        where,
        orderBy: { createdAt: sortDir === "asc" ? "asc" : "desc" },
        skip,
        take,
        select: {
          id: true,
          requirementId: true,
          assignmentId: true,
          reqCode: true,
          appName: true,
          reason: true,
          createdAt: true,
          recruiter: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeId: true,
              role: { select: { name: true } },
              reportingTo: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);

    // requirementId is a plain string (no relation in schema), so fetch
    // titles/clients for this page in ONE extra query
    const reqIds = [...new Set(logs.map((l) => l.requirementId))];
    const reqs = reqIds.length
      ? await prisma.requirement.findMany({
          where: { id: { in: reqIds } },
          select: { id: true, title: true, client: { select: { name: true } } },
        })
      : [];
    const reqById = new Map(reqs.map((r) => [r.id, r]));

    res.json({
      success: true,
      data: logs.map((l) => {
        const r = reqById.get(l.requirementId);
        return {
          id: l.id,
          appName: l.appName,
          reason: l.reason,
          createdAt: l.createdAt,
          requirementId: l.requirementId,
          assignmentId: l.assignmentId,
          reqCode: l.reqCode,
          requirementTitle: r?.title?.trim() ?? null,
          clientName: r?.client?.name ?? null,
          recruiter: {
            id: l.recruiter.id,
            name: `${l.recruiter.firstName} ${l.recruiter.lastName}`.trim(),
            employeeId: l.recruiter.employeeId ?? null,
            role: l.recruiter.role?.name ?? null,
            reportingTo: l.recruiter.reportingTo
              ? `${l.recruiter.reportingTo.firstName} ${l.recruiter.reportingTo.lastName}`.trim()
              : null,
          },
        };
      }),
      meta: {
        total,
        page: pageNum,
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error("getPortalRecruitLogs:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch portal recruit logs" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal-recruit/logs/export?search=&dateFrom=&dateTo=
// CSV download of ALL matching reasons (no pagination).
// Same RBAC scope + same filters as getPortalRecruitLogs.
// ─────────────────────────────────────────────────────────────────────────────

const EXPORT_MAX_ROWS = 50_000;

// CSV-safe cell: quote it, escape quotes, and neutralise spreadsheet formulas
// (reasons are free text typed by users, so a cell starting with = + - @ could
// otherwise run as a formula when opened in Excel)
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const exportPortalRecruitLogs = async (req: Request, res: Response) => {
  try {
    const { search, dateFrom, dateTo } = req.query as Record<string, string>;

    // 1) RBAC scope first — decides WHOSE logs can ever be exported
    const and: Prisma.PortalRecruitLogWhereInput[] = [
      portalRecruitScopeWhere(req.scopeFilter!),
    ];

    // 2) recruiter name search (same rules as the list endpoint)
    const q = search?.trim();
    if (q) {
      for (const token of q.split(/\s+/)) {
        const contains = { contains: token, mode: "insensitive" as const };
        and.push({
          recruiter: {
            OR: [
              { firstName: contains },
              { lastName: contains },
              { displayName: contains },
              { employeeId: contains },
            ],
          },
        });
      }
    }

    // 3) date range on createdAt (IST)
    if (dateFrom || dateTo) {
      const range: { gte?: Date; lte?: Date } = {};
      if (dateFrom) range.gte = new Date(`${dateFrom}T00:00:00+05:30`);
      if (dateTo) range.lte = new Date(`${dateTo}T23:59:59.999+05:30`);

      if (
        (range.gte && isNaN(range.gte.getTime())) ||
        (range.lte && isNaN(range.lte.getTime()))
      ) {
        res
          .status(400)
          .json({ success: false, message: "Invalid date filter" });
        return;
      }
      and.push({ createdAt: range });
    }

    const where: Prisma.PortalRecruitLogWhereInput = { AND: and };

    const logs = await prisma.portalRecruitLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: EXPORT_MAX_ROWS,
      select: {
        requirementId: true,
        reqCode: true,
        appName: true,
        reason: true,
        createdAt: true,
        recruiter: {
          select: {
            firstName: true,
            lastName: true,
            employeeId: true,
            role: { select: { name: true } },
            reportingTo: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    // requirement titles / clients in one query
    const reqIds = [...new Set(logs.map((l) => l.requirementId))];
    const reqs = reqIds.length
      ? await prisma.requirement.findMany({
          where: { id: { in: reqIds } },
          select: { id: true, title: true, client: { select: { name: true } } },
        })
      : [];
    const reqById = new Map(reqs.map((r) => [r.id, r]));

    const header = [
      "Date (IST)",
      "Recruiter",
      "Employee ID",
      "Role",
      "Manager",
      "Req Code",
      "Requirement",
      "Client",
      "Portal",
      "Reason",
    ];

    const lines = logs.map((l) => {
      const r = reqById.get(l.requirementId);
      return [
        // "2026-09-23 11:57:18" — sortable and Excel-friendly
        l.createdAt.toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }),
        `${l.recruiter.firstName} ${l.recruiter.lastName}`.trim(),
        l.recruiter.employeeId ?? "",
        l.recruiter.role?.name ?? "",
        l.recruiter.reportingTo
          ? `${l.recruiter.reportingTo.firstName} ${l.recruiter.reportingTo.lastName}`.trim()
          : "",
        l.reqCode ?? "",
        r?.title?.trim() ?? "",
        r?.client?.name ?? "",
        l.appName,
        l.reason,
      ]
        .map(csvCell)
        .join(",");
    });

    // BOM so Excel reads UTF-8 (names, special characters) correctly
    const csv =
      "\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="internal-search-reasons.csv"',
    );
    res.send(csv);
  } catch (err) {
    console.error("exportPortalRecruitLogs:", err);
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to export portal recruit logs",
      });
  }
};
