// File: module.controller.ts
// Path: src/controller/module.controller.ts

import { Request, Response } from "express";
// import { prisma } from "@/lib/prisma";
import {
  CreateModuleInput,
  UpdateModuleInput,
} from "@/validators/module.validator";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// GET /modules
// Returns all active modules — used by role permissions matrix dropdown
// ─────────────────────────────────────────────────────────────────────────────
export const listModules = async (req: Request, res: Response) => {
  try {
    const modules = await prisma.module.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { label: "asc" }],
      select: {
        id: true,
        name: true,
        label: true,
        order: true,
        isActive: true,
      },
    });

    return res.json({ success: true, data: modules });
  } catch (err) {
    console.error("[listModules]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch modules" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /modules/all
// Returns ALL modules including inactive — for admin management page
// ─────────────────────────────────────────────────────────────────────────────
export const listAllModules = async (req: Request, res: Response) => {
  try {
    const modules = await prisma.module.findMany({
      orderBy: [{ order: "asc" }, { label: "asc" }],
      select: {
        id: true,
        name: true,
        label: true,
        order: true,
        isActive: true,
        createdAt: true,
        _count: { select: { permissions: true } },
      },
    });

    return res.json({ success: true, data: modules });
  } catch (err) {
    console.error("[listAllModules]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch modules" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /modules/:id
// ─────────────────────────────────────────────────────────────────────────────
export const getModuleById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const module = await prisma.module.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        label: true,
        order: true,
        isActive: true,
        createdAt: true,
        _count: { select: { permissions: true } },
      },
    });

    if (!module) {
      return res
        .status(404)
        .json({ success: false, message: "Module not found" });
    }

    return res.json({ success: true, data: module });
  } catch (err) {
    console.error("[getModuleById]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch module" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /modules
// ─────────────────────────────────────────────────────────────────────────────
export const createModule = async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateModuleInput;

    const existing = await prisma.module.findUnique({
      where: { name: body.name },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Module "${body.name}" already exists`,
      });
    }

    const module = await prisma.module.create({
      data: {
        name: body.name,
        label: body.label,
        order: body.order,
      },
      select: {
        id: true,
        name: true,
        label: true,
        order: true,
        isActive: true,
        createdAt: true,
      },
    });

    return res.status(201).json({ success: true, data: module });
  } catch (err) {
    console.error("[createModule]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create module" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /modules/:id
// ─────────────────────────────────────────────────────────────────────────────
export const updateModule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as UpdateModuleInput;

    const existing = await prisma.module.findUnique({ where: { id } });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Module not found" });
    }

    const module = await prisma.module.update({
      where: { id },
      data: {
        ...(body.label !== undefined && { label: body.label }),
        ...(body.order !== undefined && { order: body.order }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
      select: {
        id: true,
        name: true,
        label: true,
        order: true,
        isActive: true,
      },
    });

    return res.json({ success: true, data: module });
  } catch (err) {
    console.error("[updateModule]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update module" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /modules/:id/toggle
// Toggle isActive — cannot deactivate if roles are using it
// ─────────────────────────────────────────────────────────────────────────────
export const toggleModule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.module.findUnique({
      where: { id },
      include: { _count: { select: { permissions: true } } },
    });

    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Module not found" });
    }

    // Block deactivation if any role permission is using this module
    if (existing.isActive && existing._count.permissions > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot deactivate — ${existing._count.permissions} role(s) are using this module`,
      });
    }

    const module = await prisma.module.update({
      where: { id },
      data: { isActive: !existing.isActive },
      select: { id: true, name: true, label: true, isActive: true },
    });

    return res.json({ success: true, data: module });
  } catch (err) {
    console.error("[toggleModule]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to toggle module" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /modules/:id
// Hard delete — only if zero role permissions reference it
// ─────────────────────────────────────────────────────────────────────────────
export const deleteModule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.module.findUnique({
      where: { id },
      include: { _count: { select: { permissions: true } } },
    });

    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Module not found" });
    }

    if (existing._count.permissions > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete — ${existing._count.permissions} role permission(s) reference this module. Remove them first.`,
      });
    }

    await prisma.module.delete({ where: { id } });

    return res.json({ success: true, message: "Module deleted" });
  } catch (err) {
    console.error("[deleteModule]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete module" });
  }
};
