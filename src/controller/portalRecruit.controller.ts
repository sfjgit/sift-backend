// File: portalRecruit.controller.ts
// Path: src/controller/portalRecruit.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

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
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch portal recruit status",
      });
  }
};
