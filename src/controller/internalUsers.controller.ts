// File: internalUsers.controller.ts
// Path: core-service/src/modules/internal/internalUsers.controller.ts
// Single endpoint: POST /internal/users/resolve  (behind internal service token)

import { PrismaClient } from "@prisma/client";
import type { Request, Response } from "express";
const prisma = new PrismaClient();

// body: { identifiers: [{ email?, empId? }] }
export async function resolveRecruiters(req: Request, res: Response) {
  const identifiers: { email?: string; empId?: string }[] =
    req.body?.identifiers ?? [];
  const emails = identifiers
    .map((i) => i.email?.toLowerCase())
    .filter(Boolean) as string[];
  const empIds = identifiers.map((i) => i.empId).filter(Boolean) as string[];

  const users = await prisma.user.findMany({
    where: { OR: [{ email: { in: emails } }, { employeeId: { in: empIds } }] },
    select: {
      id: true,
      email: true,
      employeeId: true,
      firstName: true,
      lastName: true,
      displayName: true,
      isActive: true,
      department: { select: { name: true } }, // ← add
      bu: { select: { name: true } },
      serviceline: { select: { name: true } },
    },
  });
  console.log(users);
  res.json(
    users.map((u) => ({
      recruiterId: u.id,
      email: u.email,
      empId: u.employeeId,
      name: u.displayName?.trim() || `${u.firstName} ${u.lastName}`.trim(),
      bu: u.bu?.name ?? null,
      department: u.department?.name ?? null,
      serviceLine: u.serviceline?.name ?? null,
      isActive: u.isActive,
    }))
  );
}
