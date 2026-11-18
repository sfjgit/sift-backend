// File: org.service.ts
// Path: src/services/org.service.ts
//
// The reporting tree (who reports to whom), each person with what they carry:
// clients assigned, SPOCs handled, open and overdue tasks, and how many people
// sit under them. Used by the Organisation page (GET /users/org-tree) and by
// the AI canvas ("org chart of my team"). Only people the caller may see are in
// it; anyone always sees themselves and the people below them.

import type { AuthUser } from "@/types/express";
import type { PermissionMap } from "@/services/permission.service";
import { getReportingLineIds, resolveScopeUserIds } from "@/services/scope.service";

export interface OrgTreeNode {
  id: string;
  firstName: string;
  lastName: string | null;
  isActive: boolean;
  role: { name: string };
  department: { name: string } | null;
  designation: string | null;
  reportingToId: string | null;
  teamLeadId: string | null;
  stats: { clients: number; spocs: number; openTasks: number; overdue: number };
  /** everyone below, all levels */
  teamSize: number;
  children: OrgTreeNode[];
  /** the made-up top when there are several heads */
  virtual?: boolean;
}

/** the user-ish client both prisma and aiDb satisfy */
type Db = {
  user: { findMany: (a: object) => Promise<unknown[]> };
  role: { findMany: (a: object) => Promise<unknown[]> };
  department: { findMany: (a: object) => Promise<unknown[]> };
  designation: { findMany: (a: object) => Promise<unknown[]> };
  clientAssignment: { groupBy: (a: object) => Promise<unknown[]> };
  clientSpoc: { groupBy: (a: object) => Promise<unknown[]> };
  workTask: { groupBy: (a: object) => Promise<unknown[]> };
};

/** who the caller may see: null = everyone */
export const visibleUserIds = async (user: AuthUser, perms: PermissionMap): Promise<string[] | null> => {
  const g = perms["users.read"];
  if (g === true) return null;
  if (g) {
    const ids = await resolveScopeUserIds(user, g);
    if (!ids) return null;
    return [...new Set([...ids, user.id, ...(await getReportingLineIds(user.id))])];
  }
  return [user.id, ...(await getReportingLineIds(user.id))];
};

type U = { id: string; firstName: string; lastName: string | null; isActive: boolean; isSuperAdmin: boolean; roleId: string | null; departmentId: string | null; designationId: string | null; reportingToId: string | null; teamLeadId: string | null };

export const buildOrgTree = async (db: Db, opts: { visible: string[] | null; rootId?: string | null; includeInactive?: boolean }) => {
  const users = (await db.user.findMany({
    where: { ...(opts.visible && { id: { in: opts.visible } }), ...(!opts.includeInactive && { isActive: true }) },
    select: { id: true, firstName: true, lastName: true, isActive: true, isSuperAdmin: true, roleId: true, departmentId: true, designationId: true, reportingToId: true, teamLeadId: true },
    take: 5_000,
  })) as U[];
  const ids = users.map((u) => u.id);
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])];
  const [roles, depts, desigs, assigned, handled, open, overdue] = await Promise.all([
    db.role.findMany({ where: { id: { in: uniq(users.map((u) => u.roleId)) } }, select: { id: true, name: true } }),
    db.department.findMany({ where: { id: { in: uniq(users.map((u) => u.departmentId)) } }, select: { id: true, name: true } }),
    db.designation.findMany({ where: { id: { in: uniq(users.map((u) => u.designationId)) } }, select: { id: true, name: true } }),
    db.clientAssignment.groupBy({ by: ["userId"], where: { userId: { in: ids }, endedAt: null, client: { deletedAt: null } }, _count: true }),
    db.clientSpoc.groupBy({ by: ["handlerId"], where: { handlerId: { in: ids }, isActive: true }, _count: true }),
    db.workTask.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: { not: "DONE" } }, _count: true }),
    db.workTask.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: { not: "DONE" }, dueAt: { lt: new Date() } }, _count: true }),
  ]);
  const name = (rows: unknown[]) => new Map((rows as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const count = (rows: unknown[], key: string) => new Map((rows as Record<string, unknown>[]).map((r) => [r[key] as string, r._count as number]));
  const [roleN, deptN, desigN] = [name(roles), name(depts), name(desigs)];
  const [aC, hC, oC, odC] = [count(assigned, "userId"), count(handled, "handlerId"), count(open, "assigneeId"), count(overdue, "assigneeId")];

  const nodes = new Map<string, OrgTreeNode>(
    users.map((u) => [
      u.id,
      {
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        isActive: u.isActive,
        role: { name: (u.roleId && roleN.get(u.roleId)) || "No role" },
        department: u.departmentId && deptN.get(u.departmentId) ? { name: deptN.get(u.departmentId)! } : null,
        designation: (u.designationId && desigN.get(u.designationId)) || null,
        reportingToId: u.reportingToId,
        teamLeadId: u.teamLeadId,
        stats: { clients: aC.get(u.id) ?? 0, spocs: hC.get(u.id) ?? 0, openTasks: oC.get(u.id) ?? 0, overdue: odC.get(u.id) ?? 0 },
        teamSize: 0,
        children: [],
      },
    ]),
  );
  // the super admin heads the company: anyone with no manager (in view) reports to them.
  // Several active super admins → no single head, keep the "Organisation" top.
  const heads = users.filter((u) => u.isSuperAdmin && u.isActive && !u.reportingToId);
  const head = heads.length === 1 ? heads[0]!.id : null;
  // link to the manager (reporting line); someone whose manager is out of view becomes a top
  const tops: OrgTreeNode[] = [];
  for (const n of nodes.values()) {
    // manager out of view (inactive, hidden) or none → under the head
    const boss =
      (n.reportingToId && n.reportingToId !== n.id ? nodes.get(n.reportingToId) : undefined) ??
      (head && n.id !== head ? nodes.get(head) : undefined);
    if (boss) boss.children.push(n);
    else tops.push(n);
  }
  // sizes + a stable order (managers with bigger teams first), with a guard against loops
  const seen = new Set<string>();
  const size = (n: OrgTreeNode): number => {
    if (seen.has(n.id)) return 0;
    seen.add(n.id);
    n.children.sort((a, b) => b.children.length - a.children.length || a.firstName.localeCompare(b.firstName));
    n.teamSize = n.children.reduce((s, c) => s + 1 + size(c), 0);
    return n.teamSize;
  };
  tops.forEach(size);
  // a reporting loop leaves people unreached: put them on top so nobody disappears
  for (const n of nodes.values()) if (!seen.has(n.id)) (tops.push(n), size(n));

  let root: OrgTreeNode;
  if (opts.rootId && nodes.has(opts.rootId)) root = nodes.get(opts.rootId)!;
  else if (tops.length === 1) root = tops[0]!;
  else {
    tops.sort((a, b) => b.teamSize - a.teamSize);
    root = {
      id: "org",
      firstName: "Organisation",
      lastName: null,
      isActive: true,
      role: { name: "Organisation" },
      department: null,
      designation: null,
      reportingToId: null,
      teamLeadId: null,
      stats: [...nodes.values()].reduce(
        (s, n) => ({ clients: s.clients + n.stats.clients, spocs: s.spocs + n.stats.spocs, openTasks: s.openTasks + n.stats.openTasks, overdue: s.overdue + n.stats.overdue }),
        { clients: 0, spocs: 0, openTasks: 0, overdue: 0 },
      ),
      teamSize: nodes.size,
      children: tops,
      virtual: true,
    };
  }
  return { root, total: nodes.size };
};
