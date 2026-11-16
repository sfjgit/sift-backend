// File: recycle.service.ts
// Path: src/services/recycle.service.ts
//
// Recycle bin: put things back. Every restore is itself a tracked write (its
// own batch, source "restore"), so a restore can be undone too.
//   DELETE → the row is created again, as it was (same id)
//   UPDATE → the changed fields get their old values back
//   CREATE → the new row is removed again (and that removal lands in the bin)

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { jsonNames, runWithChanges, scalarNames } from "@/utils/prisma/changes";

type Entry = Awaited<ReturnType<typeof prisma.changeLog.findFirst>> & object;
type Delegate = {
  create: (a: object) => Promise<unknown>;
  update: (a: object) => Promise<unknown>;
  delete: (a: object) => Promise<unknown>;
  findUnique: (a: object) => Promise<unknown>;
};
const lcfirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** a stored row → data Prisma accepts again (JSON nulls, only real columns) */
const asData = (model: string, row: Record<string, unknown>) => {
  const scalars = scalarNames(model);
  const json = jsonNames(model);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!scalars.has(k)) continue;
    out[k] = json.has(k) && v === null ? Prisma.DbNull : v;
  }
  return out;
};

/** the unique where for a compound key ({ clientId, userId } → { clientId_userId: {…} }) */
const whereOf = (key: Record<string, unknown>) => {
  const k = Object.keys(key);
  return k.length === 1 ? key : { [k.join("_")]: key };
};

const friendly = (e: unknown) => {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2003") return "Something it belongs to no longer exists — restore that first.";
    if (e.code === "P2025") return "That record no longer exists.";
    if (e.code === "P2002") return "A record with the same unique value exists now.";
  }
  return (e as Error).message?.split("\n").pop()?.slice(0, 200) ?? "Could not restore";
};

const restoreOne = async (e: Entry) => {
  const d = (prisma as unknown as Record<string, Delegate>)[lcfirst(e.model)];
  if (!d) throw new Error(`Unknown kind of record: ${e.model}`);
  const key = e.recordKey as Record<string, unknown>;
  if (e.op === "DELETE") {
    const data = asData(e.model, (e.before ?? {}) as Record<string, unknown>);
    // already back (restored by hand, or re-created): put its old values back instead
    if (await d.findUnique({ where: whereOf(key) })) {
      const { ...rest } = data;
      for (const k of Object.keys(key)) delete rest[k];
      await d.update({ where: whereOf(key), data: rest });
    } else await d.create({ data });
  } else if (e.op === "UPDATE") {
    await d.update({ where: whereOf(key), data: asData(e.model, (e.before ?? {}) as Record<string, unknown>) });
  } else {
    if (await d.findUnique({ where: whereOf(key) })) await d.delete({ where: whereOf(key) });
  }
};

export type RestoreResult = { restored: number; failed: { id: string; label: string | null; reason: string }[]; batchId: string };

/** put these entries back, newest first (so a later change is undone before an earlier one) */
export const restoreEntries = async (entries: Entry[], actorId: string): Promise<RestoreResult> => {
  const batchId = randomUUID();
  const ordered = [...entries].filter((e) => !e.restoredAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const failed: RestoreResult["failed"] = [];
  let restored = 0;
  await runWithChanges({ actorId, batchId, source: "restore" }, async () => {
    // parents before children: a DELETE restore of a client must come before its notes
    const deletes = ordered.filter((e) => e.op === "DELETE").reverse();
    const others = ordered.filter((e) => e.op !== "DELETE");
    for (const e of [...others, ...deletes]) {
      try {
        await restoreOne(e);
        await prisma.changeLog.update({ where: { id: e.id }, data: { restoredAt: new Date(), restoredById: actorId } });
        restored++;
      } catch (err) {
        failed.push({ id: e.id, label: e.label, reason: friendly(err) });
      }
    }
  });
  return { restored, failed, batchId };
};
