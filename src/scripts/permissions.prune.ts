// File: permissions.prune.ts
// Path: src/scripts/permissions.prune.ts
//
// Grants whose permissionKey no longer exists in permissions.registry.ts.
// npm run perm:prune              → dry run, lists orphans
// npm run perm:prune -- --apply   → deletes them

import { PrismaClient } from "@prisma/client";
import { ALL_PERMISSION_KEYS } from "../config/permissions.registry";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const main = async () => {
  const orphans = await prisma.rolePermission.findMany({
    where: { permissionKey: { notIn: ALL_PERMISSION_KEYS as string[] } },
    select: { id: true, permissionKey: true, role: { select: { name: true } } },
  });

  if (!orphans.length) return console.log("No orphan grants.");

  console.table(orphans.map((o) => ({ role: o.role.name, permissionKey: o.permissionKey })));

  if (!apply) {
    return console.log(`DRY RUN — ${orphans.length} rows. Re-run with --apply to delete.`);
  }

  const { count } = await prisma.rolePermission.deleteMany({
    where: { id: { in: orphans.map((o) => o.id) } },
  });
  // running servers already skip unknown keys; their role cache expires within a minute
  console.log(`Deleted ${count} orphan grants.`);
};

main().finally(() => prisma.$disconnect());
