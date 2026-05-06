// controller/requirementExtras.controller.ts
import { uploadToS3 } from "@/services/s3.service";
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
// import { uploadToS3 } from "@/utils/s3";

// ─────────────────────────────────────────────────────────────────────────────
// NOTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /requirements/:id/notes
export const addNote = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const { content } = req.body;
    const actorId = req.user!.id;

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true },
    });

    if (!requirement) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    const note = await prisma.$transaction(async (tx) => {
      const n = await tx.requirementNote.create({
        data: {
          requirementId,
          authorId: actorId,
          content: content.trim(),
        },
        select: {
          id: true,
          content: true,
          createdAt: true,
          author: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await tx.requirementActivity.create({
        data: {
          requirementId,
          actorId,
          type: "NOTE_ADDED",
          summary: "Note added",
        },
      });

      return n;
    });

    res.status(201).json({ success: true, data: note });
  } catch (err) {
    console.error("addNote:", err);
    res.status(500).json({ success: false, message: "Failed to add note" });
  }
};

// DELETE /requirements/:id/notes/:noteId
export const deleteNote = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, noteId } = req.params;
    const actorId = req.user!.id;

    const note = await prisma.requirementNote.findFirst({
      where: { id: noteId, requirementId, authorId: actorId },
    });

    if (!note) {
      res
        .status(404)
        .json({ success: false, message: "Note not found or not yours" });
      return;
    }

    await prisma.requirementNote.delete({ where: { id: noteId } });
    res.json({ success: true, message: "Note deleted" });
  } catch (err) {
    console.error("deleteNote:", err);
    res.status(500).json({ success: false, message: "Failed to delete note" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

// POST /requirements/:id/documents
// supports both file upload and text content (for issues/notes without file)
export const addDocument = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const { content, isIssue } = req.body;
    const actorId = req.user!.id;
    const file = req.file;

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true, reqCode: true },
    });

    if (!requirement) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    if (!file && !content) {
      res.status(400).json({
        success: false,
        message: "Either file or content is required",
      });
      return;
    }

    let fileKey: string | null = null;
    let fileName: string | null = null;
    let fileType: string | null = null;

    if (file) {
      const uploaded = await uploadToS3(
        file,
        `requirements/${requirementId}/documents`
      );
      fileKey = uploaded.key;
      fileName = file.originalname;
      fileType = file.mimetype;
    }

    const issueFlag = isIssue === true || isIssue === "true";

    const document = await prisma.$transaction(async (tx) => {
      const doc = await tx.requirementDocument.create({
        data: {
          requirementId,
          type: issueFlag ? "ISSUE_RAISED" : file ? "FILE_UPLOAD" : "NOTE",
          fileName,
          fileKey,
          fileType,
          content: content ?? null,
          isIssue: issueFlag,
          issueResolved: false,
          raisedById: actorId,
        },
        select: {
          id: true,
          type: true,
          fileName: true,
          fileType: true,
          content: true,
          isIssue: true,
          issueResolved: true,
          createdAt: true,
          raisedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await tx.requirementActivity.create({
        data: {
          requirementId,
          actorId,
          type: issueFlag ? "ISSUE_RAISED" : "DOCUMENT_UPLOADED",
          summary: issueFlag
            ? "Issue raised"
            : file
            ? `Document uploaded: ${file.originalname}`
            : "Note added",
        },
      });

      return doc;
    });

    res.status(201).json({ success: true, data: document });
  } catch (err) {
    console.error("addDocument:", err);
    res.status(500).json({ success: false, message: "Failed to add document" });
  }
};

// GET /requirements/:id/documents
export const getDocuments = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const { isIssue, issueResolved } = req.query as Record<string, string>;

    const where: any = { requirementId };
    if (isIssue !== undefined) where.isIssue = isIssue === "true";
    if (issueResolved !== undefined)
      where.issueResolved = issueResolved === "true";

    const documents = await prisma.requirementDocument.findMany({
      where,
      select: {
        id: true,
        type: true,
        fileName: true,
        fileKey: true,
        fileType: true,
        content: true,
        isIssue: true,
        issueResolved: true,
        resolvedAt: true,
        createdAt: true,
        raisedBy: { select: { id: true, firstName: true, lastName: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: documents });
  } catch (err) {
    console.error("getDocuments:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch documents" });
  }
};

// PATCH /requirements/:id/documents/:docId/resolve
export const resolveDocument = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, docId } = req.params;
    const actorId = req.user!.id;

    const doc = await prisma.requirementDocument.findFirst({
      where: { id: docId, requirementId, isIssue: true, issueResolved: false },
    });

    if (!doc) {
      res.status(404).json({
        success: false,
        message: "Issue not found or already resolved",
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const d = await tx.requirementDocument.update({
        where: { id: docId },
        data: {
          issueResolved: true,
          resolvedById: actorId,
          resolvedAt: new Date(),
        },
        select: {
          id: true,
          isIssue: true,
          issueResolved: true,
          resolvedAt: true,
          resolvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await tx.requirementActivity.create({
        data: {
          requirementId,
          actorId,
          type: "ISSUE_RESOLVED",
          summary: "Issue resolved",
        },
      });

      return d;
    });

    res.json({ success: true, message: "Issue resolved", data: updated });
  } catch (err) {
    console.error("resolveDocument:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to resolve issue" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY FEED
// ─────────────────────────────────────────────────────────────────────────────

// GET /requirements/:id/activities
export const getActivities = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const { page = "1", limit = "50" } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const [total, activities] = await Promise.all([
      prisma.requirementActivity.count({ where: { requirementId } }),
      prisma.requirementActivity.findMany({
        where: { requirementId },
        select: {
          id: true,
          type: true,
          summary: true,
          meta: true,
          createdAt: true,
          actor: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    res.json({
      success: true,
      data: activities,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error("getActivities:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch activities" });
  }
};
