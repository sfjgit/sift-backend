// File: branchOffices.service.ts
// Path: src/services/pipeline/branchOffices.service.ts
//
// Saves the offices the branch office finder read on a client's own website
// (step "branches") as ClientLocation rows. An office the client already has
// (same PIN, every word of one address in the other) is skipped. The head
// office becomes the primary address when the client has none yet.

import prisma from "@/utils/prisma/client";
import { FINDER_LOCATION_TYPE } from "@/config/pipeline";
import { logClientActivity } from "@/services/clientActivity.service";
import { normaliseLocation } from "@/services/geo.service";
import type { ResultLocation } from "@/validators/svc.validators";

const PIN = /(?<!\d)([1-9]\d{2}) ?(\d{3})(?! ?\d)/g;
const IGNORE = new Set(["pin", "code", "pincode", "india", "no", "the", "of", "and", "at", "is", "office"]);

export const pinOf = (text: string | null | undefined) => {
  const m = [...(text ?? "").matchAll(PIN)].pop();
  return m ? `${m[1]}${m[2]}` : null;
};

const words = (text: string) =>
  new Set(
    text
      .replace(PIN, " ")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((w) => w && !IGNORE.has(w)),
  );

const subset = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));

/** the same office: same PIN, and every word of one address is in the other */
export const sameOffice = (
  a: { address: string; pincode?: string | null },
  b: { address: string; pincode?: string | null },
) => {
  const pa = a.pincode ?? pinOf(a.address);
  const pb = b.pincode ?? pinOf(b.address);
  if (!pa || pa !== pb) return false;
  const wa = words(a.address);
  const wb = words(b.address);
  return wa.size > 0 && wb.size > 0 && (subset(wa, wb) || subset(wb, wa));
};

export const saveBranchOffices = async (
  ctx: { runId: string; clientId: string; requestedById: string },
  rows: ResultLocation[],
) => {
  const [existing, types, primaries] = await Promise.all([
    prisma.clientLocation.findMany({
      where: { clientId: ctx.clientId, isActive: true },
      select: { addressLine: true, city: true, pincode: true },
    }),
    prisma.lookup.findMany({ where: { type: "LOCATION_TYPE" }, select: { id: true, code: true } }),
    prisma.clientLocation.count({ where: { clientId: ctx.clientId, isActive: true, isPrimary: true } }),
  ]);
  const typeId = new Map(types.map((t) => [t.code, t.id]));
  const known = existing.map((l) => ({
    address: [l.addressLine, l.city, l.pincode].filter(Boolean).join(", "),
    pincode: l.pincode ?? pinOf(l.addressLine),
  }));
  let hasPrimary = primaries > 0;
  const counts = { saved: 0, alreadySaved: 0 };

  for (const r of rows) {
    const office = { address: r.address, pincode: r.pincode ?? pinOf(r.address) };
    if (known.some((k) => sameOffice(k, office))) {
      counts.alreadySaved++;
      continue;
    }
    const code = FINDER_LOCATION_TYPE[(r.type ?? "").toUpperCase()] ?? "OFFICE";
    const isPrimary = !hasPrimary && code === "HQ";
    await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.clientLocation.updateMany({ where: { clientId: ctx.clientId, isPrimary: true }, data: { isPrimary: false } });
      }
      await tx.clientLocation.create({
        data: {
          ...normaliseLocation({ state: r.state ?? null, country: "India" }),
          clientId: ctx.clientId,
          typeId: typeId.get(code) ?? null,
          name: r.label ?? null,
          addressLine: r.address,
          district: r.district ?? null,
          pincode: office.pincode,
          latitude: r.latitude ?? null,
          longitude: r.longitude ?? null,
          dmEvidence: r.evidence?.slice(0, 1000) ?? null,
          isPrimary,
          addedById: ctx.requestedById,
          sourceRunId: ctx.runId,
        },
      });
    });
    if (isPrimary) hasPrimary = true;
    known.push(office);
    counts.saved++;
  }

  if (counts.saved) {
    await logClientActivity(prisma, {
      clientId: ctx.clientId,
      actorId: null,
      type: "LOCATION_ADDED",
      summary: `${counts.saved} office(s) found on the client's website`,
      meta: { runId: ctx.runId },
    });
  }
  return counts;
};
