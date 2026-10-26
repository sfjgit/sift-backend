// File: permissions.migrate.ts
// Path: src/scripts/permissions.migrate.ts
//
// One-time carry-over of role grants to the expanded registry:
//   - renamed keys (LEGACY_KEY_MAP)          → new keys, old row removed
//   - actions split out of a broader key     → added at the same scope
//     (IMPLIED_BY_LEGACY: clients.update used to cover locations, ...)
//
// npm run perm:migrate              → dry run, prints the plan
// npm run perm:migrate -- --apply   → writes it
//
// Run it once. Re-running re-adds implied grants an admin may have removed since.

import { PermissionScope, PrismaClient } from "@prisma/client";
import {
  IMPLIED_BY_LEGACY,
  LEGACY_KEY_MAP,
  PermissionKey,
  findMissingRequirements,
  isPermissionKey,
  isScopedAction,
} from "../config/permissions.registry";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const main = async () => {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, permissions: { select: { permissionKey: true, scope: true } } },
    orderBy: { name: "asc" },
  });

  const plan: { role: string; change: string; key: string; scope: string }[] = [];

  for (const role of roles) {
    const current = new Map(role.permissions.map((p) => [p.permissionKey, p.scope]));
    const add = new Map<PermissionKey, PermissionScope>();
    const remove: string[] = [];

    const grant = (key: PermissionKey, scope: PermissionScope) => {
      if (current.has(key) || add.has(key)) return;
      add.set(key, isScopedAction(key) ? scope : "OWN");
    };

    for (const [key, scope] of current) {
      const renamed = LEGACY_KEY_MAP[key];
      if (renamed) {
        renamed.forEach((k) => grant(k, scope));
        remove.push(key);
      }
      if (isPermissionKey(key)) IMPLIED_BY_LEGACY[key]?.forEach((k) => grant(k, scope));
    }

    add.forEach((scope, key) => plan.push({ role: role.name, change: "+ add", key, scope }));
    remove.forEach((key) => plan.push({ role: role.name, change: "- remove", key, scope: "" }));

    const after = [...current.keys(), ...add.keys()].filter(
      (k): k is PermissionKey => isPermissionKey(k) && !remove.includes(k),
    );
    for (const m of findMissingRequirements(after)) {
      console.warn(`⚠ ${role.name}: ${m.key} needs ${m.missing.join(", ")} — fix in the role grid`);
    }

    if (apply && (add.size || remove.length)) {
      await prisma.$transaction([
        prisma.rolePermission.createMany({
          data: [...add].map(([permissionKey, scope]) => ({ roleId: role.id, permissionKey, scope })),
          skipDuplicates: true,
        }),
        prisma.rolePermission.deleteMany({
          where: { roleId: role.id, permissionKey: { in: remove } },
        }),
      ]);
    }
  }

  if (!plan.length) return console.log("Nothing to migrate.");
  console.table(plan);
  console.log(
    apply
      ? `Applied ${plan.length} changes. Running servers pick them up within a minute.`
      : `DRY RUN — ${plan.length} changes. Re-run with --apply to write them.`,
  );
};

main().finally(() => prisma.$disconnect());
