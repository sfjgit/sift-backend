// File: lookup.service.ts
// Path: src/services/lookup.service.ts

import prisma from "@/utils/prisma/client";
import type { LookupType } from "@/config/lookups";
import { ApiError } from "@/utils/httpError";

// Every lookup FK must point at an active row of the right type.
// Pass { field: [id, type] }; null/undefined ids are skipped.
export const assertLookups = async (
  refs: Record<string, [string | null | undefined, LookupType]>,
) => {
  const wanted = Object.entries(refs).filter(
    (entry): entry is [string, [string, LookupType]] => !!entry[1][0],
  );
  if (!wanted.length) return;

  const rows = await prisma.lookup.findMany({
    where: { id: { in: wanted.map(([, [id]]) => id) }, isActive: true },
    select: { id: true, type: true },
  });
  const typeById = new Map(rows.map((r) => [r.id, r.type]));

  const bad = wanted
    .filter(([, [id, type]]) => typeById.get(id) !== type)
    .map(([field]) => field);

  if (bad.length) {
    throw ApiError(400, `Invalid lookup value for: ${bad.join(", ")}`, "INVALID_LOOKUP");
  }
};
