// File: naukriAccountability.helpers.ts
// Path: core-service/src/modules/naukri/naukriAccountability.helpers.ts

import { PrismaClient, MemeCategory } from "@prisma/client";
const prisma = new PrismaClient();

// hardcoded role scope → which recruiter ids the viewer can see
export async function resolveViewerScope(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });
  if (!user)
    return { canon: "UNMAPPED", self: userId, recruiterIds: [] as string[] };
  const canon = user.isSuperAdmin
    ? "SUPER_ADMIN"
    : user.role.canonical ?? "UNMAPPED";

  if (canon === "RECRUITER")
    return { canon, self: userId, recruiterIds: [userId] };

  if (canon === "DELIVERY_LEAD" || canon === "DELIVERY_MANAGER") {
    const reports = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [{ reportingToId: userId }, { teamLeadId: userId }],
      },
      select: { id: true },
    });
    return { canon, self: userId, recruiterIds: reports.map((r) => r.id) };
  }

  if (canon === "ADMIN" || canon === "SUPER_ADMIN") {
    const all = await prisma.userAppCredential.findMany({
      where: { appName: "NAUKRI", user: { isActive: true } },
      select: { userId: true },
    });
    return { canon, self: userId, recruiterIds: all.map((a) => a.userId) };
  }
  return { canon, self: userId, recruiterIds: [userId] }; // safe default: self only
}

// weighted random meme by mood
export async function getRandomMeme(category: MemeCategory) {
  const memes = await prisma.memeAsset.findMany({
    where: { category, isActive: true },
  });
  if (!memes.length) return null;
  const pool = memes.flatMap((m) => Array(Math.max(1, m.weight)).fill(m));
  return pool[Math.floor(Math.random() * pool.length)];
}

// the big-letter story + tone for a single day
export function buildStory(args: {
  naukri: number | null;
  ats: number;
  diff: number | null;
  promiseMade: boolean;
  promiseStatus: string;
  totalBroken: number;
}) {
  const { naukri, ats, diff, promiseMade, promiseStatus, totalBroken } = args;

  if (naukri == null) {
    return {
      tone: "NEUTRAL" as MemeCategory,
      headline: "No Naukri data for this day.",
      detail: "",
      requireReason: false,
      askPromise: false,
    };
  }
  if (promiseStatus === "KEPT") {
    return {
      tone: "CELEBRATE" as MemeCategory,
      headline: "YOU KEPT YOUR PROMISE 🎉",
      detail: `Naukri ${naukri} = ATS ${ats}. Legend.`,
      requireReason: false,
      askPromise: false,
    };
  }
  if (promiseStatus === "BROKEN") {
    return {
      tone: "SHAME" as MemeCategory,
      headline: `PROMISE BROKEN 💔 (#${totalBroken})`,
      detail: `You swore you'd download them all. ${diff} still missing.`,
      requireReason: true,
      askPromise: true,
    };
  }
  if ((diff ?? 0) <= 0) {
    return {
      tone: "HAPPY" as MemeCategory,
      headline: "CLEAN DAY ✅",
      detail: `You captured everything Naukri gave you (${ats}/${naukri}).`,
      requireReason: false,
      askPromise: false,
    };
  }
  // there's a gap, no promise resolved yet
  return {
    tone: "SHAME" as MemeCategory,
    headline: `YOU VISITED ${naukri} PROFILES — ONLY ${ats} MADE IT IN`,
    detail: `${diff} profiles vanished into thin air. Where did they go?`,
    requireReason: true,
    askPromise: !promiseMade,
  };
}
