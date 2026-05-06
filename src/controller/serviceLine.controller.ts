// controller/serviceLine.controller.ts
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

// ── GET /service-lines
export const getServiceLines = async (req: Request, res: Response) => {
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

    const serviceLines = await prisma.serviceLine.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        createdAt: true,
        _count: { select: { requirements: true, clientSpocs: true } },
      },
      orderBy: { name: "asc" },
    });

    res.json({ success: true, data: serviceLines });
  } catch (err) {
    console.error("getServiceLines:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch service lines" });
  }
};

// ── GET /service-lines/:id
export const getServiceLineById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const serviceLine = await prisma.serviceLine.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: { requirements: true, clientSpocs: true },
        },
      },
    });

    if (!serviceLine) {
      res
        .status(404)
        .json({ success: false, message: "Service line not found" });
      return;
    }

    res.json({ success: true, data: serviceLine });
  } catch (err) {
    console.error("getServiceLineById:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch service line" });
  }
};

// ── POST /service-lines
export const createServiceLine = async (req: Request, res: Response) => {
  try {
    const { name, code } = req.body;

    const existing = await prisma.serviceLine.findUnique({
      where: { name },
      select: { id: true },
    });

    if (existing) {
      res
        .status(409)
        .json({
          success: false,
          message: "Service line with this name already exists",
        });
      return;
    }

    if (code) {
      const codeConflict = await prisma.serviceLine.findUnique({
        where: { code },
        select: { id: true },
      });

      if (codeConflict) {
        res
          .status(409)
          .json({
            success: false,
            message: "Service line with this code already exists",
          });
        return;
      }
    }

    const serviceLine = await prisma.serviceLine.create({
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
      .json({
        success: true,
        message: "Service line created",
        data: serviceLine,
      });
  } catch (err) {
    console.error("createServiceLine:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create service line" });
  }
};

// ── PUT /service-lines/:id
export const updateServiceLine = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code } = req.body;

    const existing = await prisma.serviceLine.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Service line not found" });
      return;
    }

    if (name) {
      const conflict = await prisma.serviceLine.findFirst({
        where: { name, id: { not: id } },
        select: { id: true },
      });
      if (conflict) {
        res
          .status(409)
          .json({
            success: false,
            message: "Service line with this name already exists",
          });
        return;
      }
    }

    if (code) {
      const codeConflict = await prisma.serviceLine.findFirst({
        where: { code, id: { not: id } },
        select: { id: true },
      });
      if (codeConflict) {
        res
          .status(409)
          .json({
            success: false,
            message: "Service line with this code already exists",
          });
        return;
      }
    }

    const updated = await prisma.serviceLine.update({
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

    res.json({ success: true, message: "Service line updated", data: updated });
  } catch (err) {
    console.error("updateServiceLine:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update service line" });
  }
};

// ── PATCH /service-lines/:id/toggle
export const toggleServiceLine = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.serviceLine.findUnique({
      where: { id },
      select: {
        id: true,
        isActive: true,
        _count: { select: { clientSpocs: true } },
      },
    });

    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Service line not found" });
      return;
    }

    if (existing.isActive && existing._count.clientSpocs > 0) {
      res.status(400).json({
        success: false,
        message: `Cannot deactivate — ${existing._count.clientSpocs} active SPOC(s) using this service line`,
      });
      return;
    }

    const updated = await prisma.serviceLine.update({
      where: { id },
      data: { isActive: !existing.isActive },
      select: { id: true, name: true, isActive: true },
    });

    res.json({
      success: true,
      message: `Service line ${updated.isActive ? "activated" : "deactivated"}`,
      data: updated,
    });
  } catch (err) {
    console.error("toggleServiceLine:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to toggle service line" });
  }
};
