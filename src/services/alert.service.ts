// File: alert.service.ts
// Path: src/services/alert.service.ts
//
// System problems admins must see without watching the server log.
// raiseAlert(key) keeps ONE open alert per key: a repeat only bumps
// count / lastSeenAt, so a failure retried every 30s notifies once.
// Recipients: everyone with system_alerts.read (in-app); ERROR also by email.
// Never throws: an alert that cannot be saved must not break the caller.

import { NotificationSeverity, Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { loggers } from "@/utils/logger";
import { sendMail } from "@/utils/mailer";
import { notifyPermission } from "@/services/notification.service";

export type AlertInput = {
  key: string;
  severity: NotificationSeverity;
  source: "pipeline" | "engine" | "api";
  title: string;
  body?: string;
  link?: string;
  meta?: Prisma.InputJsonValue;
};

// an alert resolved this recently comes back as a repeat, not a fresh alert
const REOPEN_WITHIN_MS = 10 * 60_000;

const emailOn = () => process.env.ALERT_EMAILS !== "0" && !!process.env.SMTP_HOST;

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const email = async (to: string[], a: AlertInput) => {
  if (!emailOn() || !to.length) return;
  const url = a.link && process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}${a.link}` : null;
  await sendMail({
    to: to.join(","),
    subject: `[SFJBS CRM] ${a.title}`,
    html: `<p><b>${escape(a.title)}</b></p>
      ${a.body ? `<p>${escape(a.body)}</p>` : ""}
      ${url ? `<p><a href="${escape(url)}">Open in the CRM</a></p>` : ""}
      <p style="color:#888">Repeats of this problem are counted on the System alerts page, not emailed again.</p>`,
  });
};

export const raiseAlert = async (a: AlertInput) => {
  try {
    const open = await prisma.systemAlert.findFirst({
      where: {
        key: a.key,
        OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(Date.now() - REOPEN_WITHIN_MS) } }],
      },
      orderBy: { lastSeenAt: "desc" },
    });
    if (open) {
      await prisma.systemAlert.update({
        where: { id: open.id },
        data: {
          count: { increment: 1 },
          lastSeenAt: new Date(),
          resolvedAt: null,
          resolvedById: null,
          ...(a.body && { body: a.body }),
          ...(a.meta !== undefined && { meta: a.meta }),
        },
      });
      return;
    }

    const alert = await prisma.systemAlert.create({
      data: {
        key: a.key,
        severity: a.severity,
        source: a.source,
        title: a.title,
        body: a.body ?? null,
        link: a.link ?? null,
        ...(a.meta !== undefined && { meta: a.meta }),
      },
    });
    const users = await notifyPermission("system_alerts.read", null, {
      type: "SYSTEM_ALERT",
      severity: a.severity,
      title: a.title,
      body: a.body ?? null,
      link: a.link ?? "/admin/alerts",
      referenceId: alert.id,
      referenceType: "SYSTEM_ALERT",
    });
    if (a.severity === "ERROR") await email(users.map((u) => u.email), a);
  } catch (e) {
    loggers.error(`Could not raise alert ${a.key}`, e);
  }
};

// The system clears an alert when the problem goes away (e.g. engine healthy again).
export const resolveAlert = async (key: string) => {
  try {
    await prisma.systemAlert.updateMany({
      where: { key, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  } catch (e) {
    loggers.error(`Could not resolve alert ${key}`, e);
  }
};
