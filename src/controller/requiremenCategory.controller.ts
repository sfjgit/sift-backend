// File: requirementCategory.controller.ts
// Path: src/controllers/requirementCategory.controller.ts

import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

function toSlug(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// ── POST /requirement-categories ──────────────────────────────────────────
export const createCategory = async (req: Request, res: Response) => {
  try {
    const { name, slug, description, order } = req.body;

    if (!name?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "name is required" });
    }

    const resolvedSlug = slug?.trim() ? toSlug(slug) : toSlug(name);

    const [nameConflict, slugConflict] = await Promise.all([
      prisma.requirementCategory.findUnique({ where: { name: name.trim() } }),
      prisma.requirementCategory.findUnique({ where: { slug: resolvedSlug } }),
    ]);

    if (nameConflict) {
      return res.status(409).json({
        success: false,
        message: `Category "${name.trim()}" already exists`,
      });
    }
    if (slugConflict) {
      return res.status(409).json({
        success: false,
        message: `Slug "${resolvedSlug}" is already taken`,
      });
    }

    const category = await prisma.requirementCategory.create({
      data: {
        name: name.trim(),
        slug: resolvedSlug,
        description: description?.trim() ?? null,
        order: order != null ? Number(order) : null,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        order: true,
        isActive: true,
        createdAt: true,
      },
    });

    return res.status(201).json({ success: true, data: category });
  } catch (err) {
    console.error("createCategory:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create category" });
  }
};

// ── GET /requirement-categories ───────────────────────────────────────────
// ?isActive=true|false|all   (default: true)
// ?search=eng
export const listCategories = async (req: Request, res: Response) => {
  try {
    const { isActive, search } = req.query;

    const activeFilter =
      isActive === "all"
        ? {}
        : { isActive: isActive === "false" ? false : true };

    const searchFilter = search
      ? {
          OR: [
            {
              name: { contains: String(search), mode: "insensitive" as const },
            },
            {
              description: {
                contains: String(search),
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {};

    const categories = await prisma.requirementCategory.findMany({
      where: { ...activeFilter, ...searchFilter },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        order: true,
        isActive: true,
        createdAt: true,
        _count: { select: { requirements: true } },
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });

    return res.json({ success: true, data: categories });
  } catch (err) {
    console.error("listCategories:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch categories" });
  }
};

// ── PATCH /requirement-categories/:id ────────────────────────────────────
export const updateCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, slug, description, order, isActive } = req.body;

    const existing = await prisma.requirementCategory.findUnique({
      where: { id },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    // Conflict checks only if the value is actually changing
    if (name && name.trim() !== existing.name) {
      const conflict = await prisma.requirementCategory.findUnique({
        where: { name: name.trim() },
      });
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: `Name "${name.trim()}" already taken`,
        });
      }
    }

    const newSlug = slug?.trim() ? toSlug(slug) : undefined;
    if (newSlug && newSlug !== existing.slug) {
      const conflict = await prisma.requirementCategory.findUnique({
        where: { slug: newSlug },
      });
      if (conflict) {
        return res
          .status(409)
          .json({ success: false, message: `Slug "${newSlug}" already taken` });
      }
    }

    const category = await prisma.requirementCategory.update({
      where: { id },
      data: {
        ...(name != null ? { name: name.trim() } : {}),
        ...(newSlug ? { slug: newSlug } : {}),
        ...(description != null
          ? { description: description.trim() || null }
          : {}),
        ...(order != null ? { order: Number(order) } : {}),
        ...(isActive != null ? { isActive: Boolean(isActive) } : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        order: true,
        isActive: true,
        updatedAt: true,
      },
    });

    return res.json({ success: true, data: category });
  } catch (err) {
    console.error("updateCategory:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update category" });
  }
};

// ── DELETE /requirement-categories/:id  (soft delete — sets isActive=false) ──
export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.requirementCategory.findUnique({
      where: { id },
      select: { id: true, _count: { select: { requirements: true } } },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    await prisma.requirementCategory.update({
      where: { id },
      data: { isActive: false },
    });

    return res.json({
      success: true,
      message:
        existing._count.requirements > 0
          ? `Category deactivated. ${existing._count.requirements} existing requirement(s) retain the reference.`
          : "Category deactivated.",
    });
  } catch (err) {
    console.error("deleteCategory:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete category" });
  }
};
