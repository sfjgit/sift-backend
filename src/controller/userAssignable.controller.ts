// File: userAssignable.controller.ts
// Path: src/controller/userAssignable.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

const TARGET_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeId: true,
  isActive: true,
  role: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// GET /users/:id/assignable-to
// Returns all users that :id can assign to (beyond their reporting chain)
// ─────────────────────────────────────────────────────────────────────────────

export const getAssignableTo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const rows = await prisma.userAssignableTo.findMany({
      where: { userId: id },
      select: {
        id: true,
        createdAt: true,
        target: { select: TARGET_SELECT },
        addedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("getAssignableTo:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch assignable targets" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /users/:id/assignable-to
// Body: { targetIds: string[] }
// Tags one or more users that :id can now assign to
// ─────────────────────────────────────────────────────────────────────────────

export const addAssignableTo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { targetIds } = req.body as { targetIds: string[] };
    const actorId = req.user!.id;

    if (!Array.isArray(targetIds) || targetIds.length === 0) {
      res
        .status(400)
        .json({
          success: false,
          message: "targetIds must be a non-empty array",
        });
      return;
    }

    // can't tag yourself
    const filtered = targetIds.filter((t) => t !== id);
    if (filtered.length === 0) {
      res
        .status(400)
        .json({ success: false, message: "Cannot tag yourself as assignable" });
      return;
    }

    // verify all targets exist
    const targets = await prisma.user.findMany({
      where: { id: { in: filtered }, isActive: true },
      select: { id: true },
    });
    const validIds = targets.map((t) => t.id);

    if (validIds.length === 0) {
      res
        .status(404)
        .json({
          success: false,
          message: "No valid active users found in targetIds",
        });
      return;
    }

    // upsert — skip already-existing pairs silently
    const created: string[] = [];
    const skipped: string[] = [];

    for (const targetId of validIds) {
      const existing = await prisma.userAssignableTo.findUnique({
        where: { userId_targetId: { userId: id, targetId } },
      });
      if (existing) {
        skipped.push(targetId);
        continue;
      }
      await prisma.userAssignableTo.create({
        data: { userId: id, targetId, addedById: actorId },
      });
      created.push(targetId);
    }

    res.status(201).json({
      success: true,
      message: `${created.length} tagged, ${skipped.length} already existed`,
      data: { created, skipped },
    });
  } catch (err) {
    console.error("addAssignableTo:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to add assignable targets" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /users/:id/assignable-to/:targetId
// Removes a single tag
// ─────────────────────────────────────────────────────────────────────────────

export const removeAssignableTo = async (req: Request, res: Response) => {
  try {
    const { id, targetId } = req.params;

    const existing = await prisma.userAssignableTo.findUnique({
      where: { userId_targetId: { userId: id, targetId } },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Tag not found" });
      return;
    }

    await prisma.userAssignableTo.delete({
      where: { userId_targetId: { userId: id, targetId } },
    });

    res.json({ success: true, message: "Tag removed" });
  } catch (err) {
    console.error("removeAssignableTo:", err);
    res.status(500).json({ success: false, message: "Failed to remove tag" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /users/:id/assignable-to/candidates
// Returns all active users NOT already tagged and NOT in the reporting chain
// — used to populate the "add DM" picker
// ─────────────────────────────────────────────────────────────────────────────

export const getAssignableToCandidates = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { search } = req.query as { search?: string };

    // already tagged
    const existing = await prisma.userAssignableTo.findMany({
      where: { userId: id },
      select: { targetId: true },
    });
    const alreadyTaggedIds = existing.map((e) => e.targetId);

    // direct reportees + team members (already in chain — no need to tag)
    const chainUsers = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [{ reportingToId: id }, { teamLeadId: id }],
      },
      select: { id: true },
    });
    const chainIds = chainUsers.map((u) => u.id);

    const excludeIds = [...new Set([id, ...alreadyTaggedIds, ...chainIds])];

    const where: any = {
      isActive: true,
      id: { notIn: excludeIds },
    };

    if (search?.trim()) {
      where.OR = [
        { firstName: { contains: search.trim(), mode: "insensitive" } },
        { lastName: { contains: search.trim(), mode: "insensitive" } },
        { employeeId: { contains: search.trim(), mode: "insensitive" } },
        { email: { contains: search.trim(), mode: "insensitive" } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: TARGET_SELECT,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 50,
    });

    res.json({ success: true, data: users });
  } catch (err) {
    console.error("getAssignableToCandidates:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidates" });
  }
};
