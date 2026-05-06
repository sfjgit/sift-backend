// controller/department.controller.ts
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

// ── GET /departments
export const getDepartments = async (req: Request, res: Response) => {
  try {
    const { search, isActive } = req.query as Record<string, string>;

    const where: any = {};

    if (isActive !== undefined) {
      where.isActive = isActive === "true";
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
      ];
    }

    const departments = await prisma.department.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
      orderBy: { name: "asc" },
    });

    res.json({ success: true, data: departments });
  } catch (err) {
    console.error("getDepartments:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch departments" });
  }
};

// ── GET /departments/:id
export const getDepartmentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const department = await prisma.department.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        createdAt: true,
        users: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
            role: { select: { id: true, name: true } },
          },
          orderBy: { firstName: "asc" },
        },
        _count: { select: { users: true } },
      },
    });

    if (!department) {
      res.status(404).json({ success: false, message: "Department not found" });
      return;
    }

    res.json({ success: true, data: department });
  } catch (err) {
    console.error("getDepartmentById:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch department" });
  }
};

// ── POST /departments
export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name, code } = req.body;

    const existing = await prisma.department.findUnique({
      where: { name },
      select: { id: true },
    });

    if (existing) {
      res
        .status(409)
        .json({
          success: false,
          message: "Department with this name already exists",
        });
      return;
    }

    const department = await prisma.department.create({
      data: {
        name,
        code: code ?? null,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        createdAt: true,
      },
    });

    res
      .status(201)
      .json({ success: true, message: "Department created", data: department });
  } catch (err) {
    console.error("createDepartment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create department" });
  }
};

// ── PUT /departments/:id
export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code } = req.body;

    const existing = await prisma.department.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Department not found" });
      return;
    }

    // check name conflict on rename
    if (name) {
      const conflict = await prisma.department.findFirst({
        where: { name, id: { not: id } },
        select: { id: true },
      });

      if (conflict) {
        res
          .status(409)
          .json({
            success: false,
            message: "Department with this name already exists",
          });
        return;
      }
    }

    const updated = await prisma.department.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
      },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
      },
    });

    res.json({ success: true, message: "Department updated", data: updated });
  } catch (err) {
    console.error("updateDepartment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update department" });
  }
};

// ── PATCH /departments/:id/toggle
// toggle isActive instead of hard delete
// cant delete if users are assigned
export const toggleDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.department.findUnique({
      where: { id },
      select: { id: true, isActive: true, _count: { select: { users: true } } },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Department not found" });
      return;
    }

    // block deactivation if users are still assigned
    if (existing.isActive && existing._count.users > 0) {
      res.status(400).json({
        success: false,
        message: `Cannot deactivate — ${existing._count.users} user(s) still assigned to this department`,
      });
      return;
    }

    const updated = await prisma.department.update({
      where: { id },
      data: { isActive: !existing.isActive },
      select: { id: true, name: true, isActive: true },
    });

    res.json({
      success: true,
      message: `Department ${updated.isActive ? "activated" : "deactivated"}`,
      data: updated,
    });
  } catch (err) {
    console.error("toggleDepartment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to toggle department" });
  }
};
