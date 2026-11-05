// File: platform.controller.ts
// Path: src/controller/platform.controller.ts
//
// /platform/* — the enterprise console. Runs with no tenant filter (see
// requirePlatformAdmin), so every query here names its tenant on purpose.

import crypto from "crypto";
import bcrypt from "bcrypt";
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { ApiError, notFound } from "@/utils/httpError";
import { sendMail } from "@/utils/mailer";
import { definedOnly } from "@/utils/pagination";
import { createAuditLog } from "@/services/auditLogs.service";
import { provisionTenant } from "@/services/tenant.service";
import { logAuthEvent } from "@/services/authLog.service";
import { generatePlatformToken } from "@/utils/jwt";
import { PLATFORM_COOKIE, platformCookie } from "@/middleware/platformAuth";
import type { CreateTenantInput, UpdateTenantInput } from "@/validators/platform.validators";

const TENANT_SELECT = {
  id: true,
  slug: true,
  name: true,
  legalName: true,
  status: true,
  plan: true,
  maxUsers: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TenantSelect;

const DAY = 86_400_000;

type Usage = {
  users: number;
  activeUsers: number;
  clients: number;
  spocs: number;
  runs30d: number;
  lastLoginAt: Date | null;
};

const countBy = <T extends { tenantId: string; _count: number }>(rows: T[]) =>
  new Map(rows.map((r) => [r.tenantId, r._count]));

// one grouped query per measure — not one per tenant
const usageByTenant = async (tenantIds?: string[]) => {
  const scope = tenantIds ? { tenantId: { in: tenantIds } } : {};
  const since = new Date(Date.now() - 30 * DAY);
  const [users, activeUsers, clients, spocs, runs, logins] = await Promise.all([
    prisma.user.groupBy({ by: ["tenantId"], where: scope, _count: true }),
    prisma.user.groupBy({ by: ["tenantId"], where: { ...scope, isActive: true }, _count: true }),
    prisma.client.groupBy({ by: ["tenantId"], where: { ...scope, deletedAt: null }, _count: true }),
    prisma.clientSpoc.groupBy({ by: ["tenantId"], where: { ...scope, isActive: true }, _count: true }),
    prisma.stepRun.groupBy({ by: ["tenantId"], where: { ...scope, createdAt: { gte: since } }, _count: true }),
    // AuthLogs has no tenant column — reached through the user
    prisma.$queryRaw<{ tenantId: string; at: Date }[]>`
      SELECT u."tenantId", MAX(a."createdAt") AS at
      FROM "AuthLogs" a JOIN "User" u ON u."id" = a."userId"
      WHERE a."type" = 'LOGIN'
        ${tenantIds ? Prisma.sql`AND u."tenantId" = ANY(${tenantIds}::text[])` : Prisma.empty}
      GROUP BY u."tenantId"`,
  ]);
  const m = {
    users: countBy(users),
    activeUsers: countBy(activeUsers),
    clients: countBy(clients),
    spocs: countBy(spocs),
    runs30d: countBy(runs),
    lastLoginAt: new Map(logins.map((l) => [l.tenantId, l.at])),
  };
  return (id: string): Usage => ({
    users: m.users.get(id) ?? 0,
    activeUsers: m.activeUsers.get(id) ?? 0,
    clients: m.clients.get(id) ?? 0,
    spocs: m.spocs.get(id) ?? 0,
    runs30d: m.runs30d.get(id) ?? 0,
    lastLoginAt: m.lastLoginAt.get(id) ?? null,
  });
};

// ── GET /platform/overview — every tenant with its usage, plus totals
export const getPlatformOverview = async (_req: Request, res: Response) => {
  const tenants = await prisma.tenant.findMany({ select: TENANT_SELECT, orderBy: { createdAt: "asc" } });
  const usage = await usageByTenant();
  const rows = tenants.map((t) => ({ ...t, usage: usage(t.id) }));

  const sum = (k: keyof Omit<Usage, "lastLoginAt">) => rows.reduce((n, r) => n + r.usage[k], 0);
  res.json({
    success: true,
    data: {
      totals: {
        tenants: rows.length,
        activeTenants: rows.filter((r) => r.status === "ACTIVE").length,
        users: sum("users"),
        activeUsers: sum("activeUsers"),
        clients: sum("clients"),
        spocs: sum("spocs"),
        runs30d: sum("runs30d"),
      },
      tenants: rows,
    },
  });
};

// ── GET /platform/tenants/:id
export const getTenant = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const tenant = await prisma.tenant.findUnique({ where: { id }, select: TENANT_SELECT });
  if (!tenant) throw notFound("Tenant");

  const [usage, admins, roles, recent] = await Promise.all([
    usageByTenant([id]),
    prisma.user.findMany({
      where: { tenantId: id, isSuperAdmin: true },
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.role.count({ where: { tenantId: id } }),
    prisma.auditLog.findMany({
      where: { tenantId: id },
      select: {
        id: true,
        action: true,
        module: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

  res.json({ success: true, data: { ...tenant, usage: usage(id), admins, roles, recentActivity: recent } });
};

// ── POST /platform/tenants — tenant + first admin (set-password mail)
export const createTenant = async (req: Request, res: Response) => {
  const body = req.validatedBody as CreateTenantInput;

  if (await prisma.tenant.findUnique({ where: { slug: body.slug }, select: { id: true } })) {
    throw ApiError(409, `The short name "${body.slug}" is taken`, "DUPLICATE");
  }
  if (await prisma.user.findUnique({ where: { email: body.admin.email }, select: { id: true } })) {
    throw ApiError(409, "That email already has an account (emails are unique across companies)", "DUPLICATE");
  }
  if (body.templateTenantId && !(await prisma.tenant.findUnique({ where: { id: body.templateTenantId } }))) {
    throw ApiError(400, "Unknown template tenant", "INVALID_REFERENCE");
  }

  const out = await provisionTenant(
    {
      name: body.name,
      slug: body.slug,
      legalName: body.legalName ?? null,
      plan: body.plan,
      maxUsers: body.maxUsers ?? null,
      admin: body.admin,
      templateTenantId: body.templateTenantId ?? null,
    },
    req.user.id,
  );

  // outside the transaction — a mail failure must not undo the tenant
  let mailed = true;
  try {
    const url = `${process.env.FRONTEND_URL}/sign-in?token=${out.setupToken}`;
    await sendMail({
      to: out.admin.email,
      subject: `Your ${out.tenant.name} CRM is ready — set your password`,
      html: `
        <h2>Welcome, ${out.admin.firstName}!</h2>
        <p>A CRM workspace has been created for <b>${out.tenant.name}</b> and you are its administrator.</p>
        <a href="${url}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Set your password</a>
        <p style="color:#6B7280;font-size:14px;">This link expires in 3 days.</p>
      `,
    });
  } catch (e) {
    mailed = false;
    console.error("createTenant: welcome email failed:", e);
  }

  res.status(201).json({
    success: true,
    message: mailed
      ? `${out.tenant.name} created — ${out.admin.email} got a set-password email`
      : `${out.tenant.name} created, but the welcome email failed — use "Send set-password email" on the company page for ${out.admin.email}`,
    data: { tenant: out.tenant, admin: out.admin, seeded: out.seeded, mailed },
  });
};

// ── PATCH /platform/tenants/:id
export const updateTenant = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as UpdateTenantInput;

  const before = await prisma.tenant.findUnique({ where: { id }, select: TENANT_SELECT });
  if (!before) throw notFound("Tenant");
  if (body.status === "SUSPENDED" && id === req.user.tenantId) {
    throw ApiError(400, "You can't suspend the company you belong to", "SELF");
  }

  const tenant = await prisma.tenant.update({ where: { id }, data: definedOnly(body), select: TENANT_SELECT });
  // suspended: sign everyone out now, not when their token expires
  if (body.status === "SUSPENDED" && before.status !== "SUSPENDED") {
    await prisma.refreshToken.deleteMany({ where: { user: { tenantId: id, isPlatformAdmin: false } } });
  }

  await createAuditLog({
    actorId: req.user.id,
    action: "TENANT_UPDATED",
    module: "platform",
    recordId: id,
    oldData: before,
    newData: body,
    req,
  });
  res.json({ success: true, message: "Tenant updated", data: tenant });
};

// ── console sign-in ──────────────────────────────────────────────────────────

const PLATFORM_ME_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  tenant: { select: { id: true, name: true, slug: true } },
} as const satisfies Prisma.UserSelect;

// ── POST /platform/auth/login — platform admins only; same message for every failure
export const platformLogin = async (req: Request, res: Response) => {
  const { email, password } = req.validatedBody as { email: string; password: string };
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, isActive: true, isPlatformAdmin: true },
  });
  const ok = !!user && user.isActive && user.isPlatformAdmin && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    if (user) await logAuthEvent(user.id, "FAILED_LOGIN", req);
    throw ApiError(401, "Invalid email or password, or no enterprise console access", "INVALID_CREDENTIALS");
  }

  res.cookie(PLATFORM_COOKIE, generatePlatformToken(user.id), { ...platformCookie(), maxAge: 12 * 60 * 60 * 1000 });
  await logAuthEvent(user.id, "LOGIN", req);
  await createAuditLog({ actorId: user.id, action: "CONSOLE_LOGIN", module: "platform", recordId: user.id, req });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: PLATFORM_ME_SELECT });
  res.json({ success: true, message: "Signed in", data: me });
};

// ── GET /platform/auth/me
export const platformMe = async (req: Request, res: Response) => {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id }, select: PLATFORM_ME_SELECT });
  res.json({ success: true, data: me });
};

// ── POST /platform/auth/logout
export const platformLogout = async (_req: Request, res: Response) => {
  res.clearCookie(PLATFORM_COOKIE, platformCookie());
  res.json({ success: true, message: "Signed out" });
};

// ── one company's people ─────────────────────────────────────────────────────

// ── GET /platform/tenants/:id/users
export const listTenantUsers = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  if (!(await prisma.tenant.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Tenant");

  const users = await prisma.user.findMany({
    where: { tenantId: id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      isSuperAdmin: true,
      createdAt: true,
      role: { select: { id: true, name: true } },
      designation: { select: { name: true } },
      authLogs: { where: { type: "LOGIN" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
    orderBy: [{ isSuperAdmin: "desc" }, { firstName: "asc" }],
  });
  res.json({
    success: true,
    data: users.map(({ authLogs, ...u }) => ({ ...u, lastLoginAt: authLogs[0]?.createdAt ?? null })),
  });
};

// ── POST /platform/tenants/:id/users/:userId/invite — fresh set-password link
export const resendInvite = async (req: Request, res: Response) => {
  const { id, userId } = req.validatedParams;
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: id },
    select: { id: true, email: true, firstName: true, isActive: true, tenant: { select: { name: true } } },
  });
  if (!user) throw notFound("User");
  if (!user.isActive) throw ApiError(400, "The user is deactivated", "INACTIVE");

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: user.id },
    data: { resetPasswordToken: token, resetPasswordExpires: new Date(Date.now() + 3 * DAY) },
  });
  await createAuditLog({ actorId: req.user.id, action: "INVITE_RESENT", module: "platform", recordId: user.id, req });

  try {
    const url = `${process.env.FRONTEND_URL}/sign-in?token=${token}`;
    await sendMail({
      to: user.email,
      subject: `Set your password for the ${user.tenant.name} CRM`,
      html: `<p>Hi ${user.firstName},</p><p>Use the link below to set your password. It expires in 3 days.</p>
        <p><a href="${url}">Set your password</a></p>`,
    });
  } catch (e) {
    console.error("resendInvite: email failed:", e);
    throw ApiError(502, "The link was created but the email could not be sent", "MAIL_FAILED");
  }
  res.json({ success: true, message: `Set-password email sent to ${user.email}` });
};

// ── platform health ──────────────────────────────────────────────────────────

// ── GET /platform/alerts?status=open|resolved
export const listPlatformAlerts = async (req: Request, res: Response) => {
  const resolved = req.query.status === "resolved";
  const rows = await prisma.systemAlert.findMany({
    where: { resolvedAt: resolved ? { not: null } : null },
    select: {
      id: true,
      key: true,
      severity: true,
      source: true,
      title: true,
      body: true,
      count: true,
      firstSeenAt: true,
      lastSeenAt: true,
      resolvedAt: true,
      tenant: { select: { id: true, name: true } },
      resolvedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { lastSeenAt: "desc" },
    take: 200,
  });
  res.json({ success: true, data: rows });
};

// ── PATCH /platform/alerts/:id/resolve
export const resolvePlatformAlert = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const { count } = await prisma.systemAlert.updateMany({
    where: { id, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedById: req.user.id },
  });
  if (!count) throw notFound("Open alert");
  res.json({ success: true, message: "Alert resolved" });
};

// ── GET /platform/services — the shared pipeline engines
export const listPlatformServices = async (_req: Request, res: Response) => {
  const services = await prisma.externalService.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      baseUrl: true,
      isActive: true,
      lastUsedAt: true,
      lastHealthAt: true,
      lastHealthOk: true,
      timeoutMins: true,
      steps: { select: { id: true, key: true, label: true, isActive: true }, orderBy: { uiOrder: "asc" } },
    },
    orderBy: { name: "asc" },
  });
  const since = new Date(Date.now() - 30 * DAY);
  const runs = await prisma.stepRun.groupBy({
    by: ["stepId", "status"],
    where: { createdAt: { gte: since } },
    _count: true,
  });
  res.json({
    success: true,
    data: services.map((s) => {
      const ids = new Set(s.steps.map((st) => st.id));
      const mine = runs.filter((r) => ids.has(r.stepId));
      const total = mine.reduce((n, r) => n + r._count, 0);
      const failed = mine
        .filter((r) => ["FAILED", "DISPATCH_FAILED", "TIMED_OUT"].includes(r.status))
        .reduce((n, r) => n + r._count, 0);
      return { ...s, runs30d: total, failed30d: failed };
    }),
  });
};

// ── GET /platform/audit?page&tenantId — what platform admins did (sign-ins, companies, invites)
export const listPlatformAudit = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 50;
  const tenantId = typeof req.query.tenantId === "string" && req.query.tenantId ? req.query.tenantId : undefined;
  const where: Prisma.AuditLogWhereInput = { module: "platform", ...(tenantId && { tenantId }) };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        recordId: true,
        newData: true,
        createdAt: true,
        ip: true,
        actor: { select: { id: true, firstName: true, lastName: true, email: true } },
        tenant: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  res.json({ success: true, data: rows, meta: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } });
};
