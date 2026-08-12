// File: naukriAccountability.controller.ts
// Path: core-service/src/modules/naukri/naukriAccountability.controller.ts

import {
  PrismaClient,
  NaukriPromiseStatus,
  MemeCategory,
  NaukriMsgAuthor,
} from "@prisma/client";
import type { Request, Response } from "express";
import { fetchReconciliation } from "@/lib/naukriData.client";
import {
  resolveViewerScope,
  getRandomMeme,
  buildStory,
} from "@/lib/naukriAccountability.helpers";

const prisma = new PrismaClient();
const uid = (req: Request) => (req as any).user?.id as string;

// ── GET /naukri/me?from&to  (self only) ──────────────────────────────────────
export async function getMe(req: Request, res: Response) {
  const userId = uid(req);
  const from = String(req.query.from),
    to = String(req.query.to);

  const [recon, dailies, streak] = await Promise.all([
    fetchReconciliation([userId], from, to),
    prisma.naukriRecruiterDaily.findMany({
      where: {
        recruiterId: userId,
        reportDate: { gte: new Date(from), lte: new Date(to) },
      },
    }),
    prisma.naukriRecruiterStreak.findUnique({ where: { recruiterId: userId } }),
  ]);

  const dailyByDate = new Map(
    dailies.map((d) => [d.reportDate.toISOString().slice(0, 10), d]),
  );
  const totalBroken = streak?.totalBroken ?? 0;

  const days = await Promise.all(
    recon.map(async (r) => {
      const key = r.reportDate.slice(0, 10);
      const d = dailyByDate.get(key);
      const story = buildStory({
        naukri: r.naukriCvConsumed,
        ats: r.atsCaptured,
        diff: r.difference,
        promiseMade: d?.promiseMade ?? false,
        promiseStatus: d?.promiseStatus ?? "NONE",
        totalBroken,
      });
      const meme = await getRandomMeme(story.tone);
      return {
        reportDate: key,
        naukri: r.naukriCvConsumed,
        ats: r.atsCaptured,
        difference: r.difference,
        flags: r.flags,
        atsBySource: r.atsBySource,
        // NEW — 3-step activity breakdown, same fields the admin naukri-logs
        // page shows, now available to the recruiter for their own data too.
        profilesViewed: r.naukriProfilesViewed,
        phonesRevealed: r.naukriPhonesRevealed,
        cvsDownloaded: r.naukriCvsDownloaded,
        completeProfiles: r.completeProfilesCaptured,
        reason: d?.reason ?? null,
        promiseMade: d?.promiseMade ?? false,
        promiseStatus: d?.promiseStatus ?? "NONE",
        story,
        meme: meme ? { url: meme.url, caption: meme.caption } : null,
      };
    }),
  );

  res.json({
    scope: "me",
    streak: streak ?? {
      currentStreak: 0,
      longestStreak: 0,
      totalKept: 0,
      totalBroken: 0,
    },
    days,
  });
}

// ── GET /naukri/team?from&to  (DL / DM / admin — reportees) ───────────────────
export async function getTeam(req: Request, res: Response) {
  const from = String(req.query.from),
    to = String(req.query.to);
  const scope = await resolveViewerScope(uid(req));
  if (scope.recruiterIds.length === 0)
    return res.json({ scope: scope.canon, recruiters: [] });

  const [recon, streaks] = await Promise.all([
    fetchReconciliation(scope.recruiterIds, from, to),
    prisma.naukriRecruiterStreak.findMany({
      where: { recruiterId: { in: scope.recruiterIds } },
    }),
  ]);
  const streakBy = new Map(streaks.map((s) => [s.recruiterId, s]));

  // aggregate per recruiter over the range
  const agg = new Map<string, any>();
  for (const r of recon) {
    const a = agg.get(r.recruiterId) ?? {
      recruiterId: r.recruiterId,
      name: r.recruiterName,
      bu: r.bu,
      rm: r.rm,
      totalNaukri: 0,
      totalAts: 0,
      gap: 0,
      days: 0,
      // NEW — cumulative 3-step activity across the range
      totalProfilesViewed: 0,
      totalPhonesRevealed: 0,
      totalCvsDownloaded: 0,
      totalCompleteProfiles: 0,
    };
    a.totalNaukri += r.naukriCvConsumed ?? 0;
    a.totalAts += r.atsCaptured;
    a.gap += (r.naukriCvConsumed ?? 0) - r.atsCaptured;
    a.days += 1;
    a.totalProfilesViewed += r.naukriProfilesViewed ?? 0;
    a.totalPhonesRevealed += r.naukriPhonesRevealed ?? 0;
    a.totalCvsDownloaded += r.naukriCvsDownloaded ?? 0;
    a.totalCompleteProfiles += r.completeProfilesCaptured ?? 0;
    agg.set(r.recruiterId, a);
  }

  const recruiters = [...agg.values()]
    .map((a) => {
      const s = streakBy.get(a.recruiterId);
      return {
        ...a,
        currentStreak: s?.currentStreak ?? 0,
        promisesKept: s?.totalKept ?? 0,
        promisesBroken: s?.totalBroken ?? 0,
      };
    })
    .sort((x, y) => y.gap - x.gap); // biggest offenders first

  res.json({ scope: scope.canon, recruiters });
}

// ── POST /naukri/reason  { reportDate, reason } ──────────────────────────────
export async function saveReason(req: Request, res: Response) {
  const userId = uid(req);
  const { reportDate, reason } = req.body ?? {};
  if (!reportDate || !reason)
    return res.status(400).json({ error: "reportDate + reason required" });
  const rd = new Date(reportDate);

  const daily = await prisma.naukriRecruiterDaily.upsert({
    where: { reportDate_recruiterId: { reportDate: rd, recruiterId: userId } },
    create: {
      reportDate: rd,
      recruiterId: userId,
      reason,
      reasonAt: new Date(),
    },
    update: { reason, reasonAt: new Date() },
  });
  await prisma.naukriMessage.create({
    data: {
      dailyId: daily.id,
      author: NaukriMsgAuthor.RECRUITER,
      authorId: userId,
      body: reason,
    },
  });
  res.json({ ok: true });
}

// ── POST /naukri/promise  { reportDate, promiseText? } ───────────────────────
export async function makePromise(req: Request, res: Response) {
  const userId = uid(req);
  const { reportDate, promiseText } = req.body ?? {};
  if (!reportDate)
    return res.status(400).json({ error: "reportDate required" });
  const rd = new Date(reportDate);

  await prisma.naukriRecruiterDaily.upsert({
    where: { reportDate_recruiterId: { reportDate: rd, recruiterId: userId } },
    create: {
      reportDate: rd,
      recruiterId: userId,
      promiseMade: true,
      promiseText: promiseText ?? "I will download every profile today.",
      promiseMadeAt: new Date(),
      promiseStatus: NaukriPromiseStatus.PENDING,
    },
    update: {
      promiseMade: true,
      promiseText: promiseText ?? "I will download every profile today.",
      promiseMadeAt: new Date(),
      promiseStatus: NaukriPromiseStatus.PENDING,
    },
  });
  res.json({ ok: true, message: "Promise locked in. We are watching 👀" });
}

// ── POST /naukri/evaluate  { reportDate }  (cron/admin: judge that day's promises) ──
export async function evaluatePromises(req: Request, res: Response) {
  const { reportDate } = req.body ?? {};
  if (!reportDate)
    return res.status(400).json({ error: "reportDate required" });
  const rd = new Date(reportDate);
  const ds = reportDate;

  const pending = await prisma.naukriRecruiterDaily.findMany({
    where: {
      reportDate: rd,
      promiseMade: true,
      promiseStatus: NaukriPromiseStatus.PENDING,
    },
  });
  if (pending.length === 0) return res.json({ evaluated: 0 });

  const ids = pending.map((p) => p.recruiterId);
  const recon = await fetchReconciliation(ids, ds, ds);
  const reconBy = new Map(recon.map((r) => [r.recruiterId, r]));

  let evaluated = 0;
  for (const p of pending) {
    const r = reconBy.get(p.recruiterId);
    const diff = r?.difference ?? null;
    const kept = diff !== null && diff <= 0;
    const status = kept ? NaukriPromiseStatus.KEPT : NaukriPromiseStatus.BROKEN;

    const streak = await prisma.naukriRecruiterStreak.upsert({
      where: { recruiterId: p.recruiterId },
      create: {
        recruiterId: p.recruiterId,
        currentStreak: kept ? 1 : 0,
        longestStreak: kept ? 1 : 0,
        totalKept: kept ? 1 : 0,
        totalBroken: kept ? 0 : 1,
        lastEvaluated: new Date(),
      },
      update: {
        currentStreak: kept ? { increment: 1 } : { set: 0 },
        totalKept: kept ? { increment: 1 } : undefined,
        totalBroken: kept ? undefined : { increment: 1 },
        lastEvaluated: new Date(),
      },
    });
    if (kept && streak.currentStreak > streak.longestStreak) {
      await prisma.naukriRecruiterStreak.update({
        where: { recruiterId: p.recruiterId },
        data: { longestStreak: streak.currentStreak },
      });
    }

    const meme = await getRandomMeme(
      kept ? MemeCategory.CELEBRATE : MemeCategory.SHAME,
    );
    await prisma.naukriRecruiterDaily.update({
      where: { id: p.id },
      data: { promiseStatus: status, evaluatedAt: new Date() },
    });
    await prisma.naukriMessage.create({
      data: {
        dailyId: p.id,
        author: NaukriMsgAuthor.SYSTEM,
        memeId: meme?.id ?? null,
        body: kept
          ? "Promise kept 🎉 Streak alive!"
          : "Promise broken 💔 The gap is still there.",
      },
    });
    evaluated++;
  }
  res.json({ evaluated });
}

// ── memes (admin) ────────────────────────────────────────────────────────────
export async function addMeme(req: Request, res: Response) {
  const { url, category, caption, weight } = req.body ?? {};
  if (!url || !category)
    return res.status(400).json({ error: "url + category required" });
  const meme = await prisma.memeAsset.create({
    data: { url, category, caption, weight: weight ?? 1 },
  });
  res.json(meme);
}
export async function listMemes(req: Request, res: Response) {
  const where = req.query.category
    ? { category: req.query.category as MemeCategory }
    : {};
  res.json(
    await prisma.memeAsset.findMany({ where, orderBy: { createdAt: "desc" } }),
  );
}
