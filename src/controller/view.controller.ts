// File: view.controller.ts
// Path: src/controller/view.controller.ts
//
// Saved table / report views. Own views are editable; shared views of others
// are read-only. Someone else's view is 404, never 403.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { notFound } from "@/utils/httpError";
import { getUserPermissionMap } from "@/services/permission.service";
import { forbidden } from "@/services/grant.service";
import type {
  CreateViewInput,
  ListViewsQuery,
  UpdateViewInput,
} from "@/validators/view.validators";

const PERSON = { id: true, firstName: true, lastName: true } as const;

// making a view visible to everyone needs views.share
const assertCanShare = async (req: Request, isShared: boolean | undefined) => {
  if (!isShared) return;
  if (!(await getUserPermissionMap(req.user))["views.share"]) throw forbidden(["views.share"]);
};

const VIEW_SELECT = {
  id: true,
  module: true,
  name: true,
  config: true,
  isDefault: true,
  isShared: true,
  createdAt: true,
  updatedAt: true,
  user: { select: PERSON },
} as const satisfies Prisma.SavedViewSelect;

type ViewRow = Prisma.SavedViewGetPayload<{ select: typeof VIEW_SELECT }>;

const toViewResponse = (v: ViewRow, userId: string) => ({ ...v, isOwner: v.user.id === userId });

// one default per user + module
const clearOtherDefaults = (
  tx: Prisma.TransactionClient,
  userId: string,
  module: string,
  keepId: string,
) =>
  tx.savedView.updateMany({
    where: { userId, module, isDefault: true, id: { not: keepId } },
    data: { isDefault: false },
  });

const findOwnView = async (req: Request, id: string) => {
  const view = await prisma.savedView.findFirst({
    where: { id, userId: req.user.id },
    select: { id: true, module: true },
  });
  if (!view) throw notFound("View");
  return view;
};

// ── GET /views?module= — own first, then name
export const listViews = async (req: Request, res: Response) => {
  const { module } = req.validatedQuery as ListViewsQuery;

  const views = await prisma.savedView.findMany({
    where: {
      ...(module && { module }),
      OR: [{ userId: req.user.id }, { isShared: true }],
    },
    select: VIEW_SELECT,
    orderBy: { name: "asc" },
  });

  const rows = views
    .map((v) => toViewResponse(v, req.user.id))
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner));

  res.json({ success: true, data: rows });
};

// ── POST /views
export const createView = async (req: Request, res: Response) => {
  const body = req.validatedBody as CreateViewInput;
  await assertCanShare(req, body.isShared);

  const view = await prisma.$transaction(async (tx) => {
    const v = await tx.savedView.create({
      data: {
        userId: req.user.id,
        module: body.module,
        name: body.name,
        config: body.config as Prisma.InputJsonObject,
        isDefault: body.isDefault ?? false,
        isShared: body.isShared ?? false,
      },
      select: VIEW_SELECT,
    });
    if (v.isDefault) await clearOtherDefaults(tx, req.user.id, v.module, v.id);
    return v;
  });

  res.status(201).json({
    success: true,
    message: "View saved",
    data: toViewResponse(view, req.user.id),
  });
};

// ── PATCH /views/:id — owner only
export const updateView = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as UpdateViewInput;
  await findOwnView(req, id);
  await assertCanShare(req, body.isShared);

  const view = await prisma.$transaction(async (tx) => {
    const v = await tx.savedView.update({
      where: { id },
      data: {
        ...(body.module !== undefined && { module: body.module }),
        ...(body.name !== undefined && { name: body.name }),
        ...(body.config !== undefined && { config: body.config as Prisma.InputJsonObject }),
        ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
        ...(body.isShared !== undefined && { isShared: body.isShared }),
      },
      select: VIEW_SELECT,
    });
    if (v.isDefault) await clearOtherDefaults(tx, req.user.id, v.module, v.id);
    return v;
  });

  res.json({ success: true, message: "View updated", data: toViewResponse(view, req.user.id) });
};

// ── DELETE /views/:id — owner only
export const deleteView = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  await findOwnView(req, id);

  await prisma.savedView.delete({ where: { id } });

  res.json({ success: true, message: "View deleted" });
};
