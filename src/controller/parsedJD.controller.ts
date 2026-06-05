// File: parsedJD.controller.ts
// Path: src/controllers/parsedJD.controller.ts

import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// POST /jd/library
// Called automatically after /jd/parse succeeds.
// Saves the parsed output to the library for future reuse.
// ─────────────────────────────────────────────────────────────────────────────
export const saveToLibrary = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const { title, parsedData, jdFileKey, jdFileName, jdFileType } = req.body;

    if (!title || !parsedData) {
      return res
        .status(400)
        .json({ success: false, message: "title and parsedData are required" });
    }

    // check if identical title already exists — if so, just bump usageCount
    // (same role parsed twice — don't duplicate)
    const existing = await prisma.parsedJDLibrary.findFirst({
      where: { title: { equals: title, mode: "insensitive" }, isActive: true },
      select: { id: true },
    });

    if (existing) {
      // update parsedData with latest parse (more recent = better)
      const updated = await prisma.parsedJDLibrary.update({
        where: { id: existing.id },
        data: {
          parsedData,
          jdFileKey: jdFileKey ?? undefined,
          jdFileName: jdFileName ?? undefined,
          jdFileType: jdFileType ?? undefined,
          parsedById: actorId,
          parsedAt: new Date(),
        },
        select: { id: true, title: true, usageCount: true },
      });
      return res
        .status(200)
        .json({ success: true, data: updated, updated: true });
    }

    const entry = await prisma.parsedJDLibrary.create({
      data: {
        title,
        parsedData,
        jdFileKey: jdFileKey ?? null,
        jdFileName: jdFileName ?? null,
        jdFileType: jdFileType ?? null,
        parsedById: actorId,
        usageCount: 0,
        usedByIds: [],
        isActive: true,
      },
      select: { id: true, title: true, usageCount: true, parsedAt: true },
    });

    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    console.error("saveToLibrary:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to save to JD library" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /jd/library/search?q=react&limit=10
// Fuzzy search by title. Returns lightweight list for the search dropdown.
// ─────────────────────────────────────────────────────────────────────────────
export const searchLibrary = async (req: Request, res: Response) => {
  try {
    const { q = "", limit = "10" } = req.query as Record<string, string>;
    const take = Math.min(parseInt(limit), 50);

    const entries = await prisma.parsedJDLibrary.findMany({
      where: {
        isActive: true,
        ...(q.trim()
          ? { title: { contains: q.trim(), mode: "insensitive" } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        usageCount: true,
        parsedAt: true,
        parsedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        // preview fields from parsedData pulled at query time for display
        parsedData: true,
      },
      orderBy: [
        { usageCount: "desc" }, // most used first
        { parsedAt: "desc" },
      ],
      take,
    });

    // extract preview fields from parsedData JSON for the dropdown
    const results = entries.map((e) => {
      const pd = e.parsedData as any;
      return {
        id: e.id,
        title: e.title,
        usageCount: e.usageCount,
        parsedAt: e.parsedAt,
        parsedBy: e.parsedBy,
        // preview for search result card
        primarySkills: pd?.primarySkills ?? [],
        experienceMin: pd?.experienceMin ?? null,
        experienceMax: pd?.experienceMax ?? null,
        jobType: pd?.jobType ?? null,
        remoteType: pd?.remoteType ?? null,
        city: pd?.city ?? null,
      };
    });

    return res.json({ success: true, data: results });
  } catch (err) {
    console.error("searchLibrary:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to search JD library" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /jd/library/:id/use
// Called when a recruiter selects a library entry to prefill their form.
// Returns full parsedData, bumps usageCount, appends userId to usedByIds.
// ─────────────────────────────────────────────────────────────────────────────
export const useFromLibrary = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actorId = req.user!.id;

    const entry = await prisma.parsedJDLibrary.findFirst({
      where: { id, isActive: true },
      select: { id: true, parsedData: true, usageCount: true, usedByIds: true },
    });

    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: "JD not found in library" });
    }

    // bump usageCount + append userId (deduped)
    const updatedUsedByIds = Array.from(new Set([...entry.usedByIds, actorId]));

    await prisma.parsedJDLibrary.update({
      where: { id },
      data: {
        usageCount: { increment: 1 },
        usedByIds: updatedUsedByIds,
      },
    });

    return res.json({
      success: true,
      data: entry.parsedData, // full ParsedJD — frontend uses this to prefill form
      usageCount: entry.usageCount + 1,
    });
  } catch (err) {
    console.error("useFromLibrary:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch from JD library" });
  }
};
