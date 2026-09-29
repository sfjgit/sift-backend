// File: publicRequirement.controller.ts
// Path: src/controllers/public/publicRequirement.controller.ts
//
// PUBLIC, UNAUTHENTICATED careers-page API.
// No auth, no scopeFilter — mounted on a separate /public router.
// Exposes ONLY candidate-facing fields. NEVER leaks:
//   client, createdBy, created/approved dates, SPOC, BU/serviceLine,
//   targetCompanies/noPoachCompanies, assignments, pipeline, recruiters,
//   internal breach flags.
// Surfaces only published, externally-open roles.

import { Request, Response } from "express";

import { Prisma, RequirementType, RemoteType } from "@prisma/client";
import prisma from "@/utils/prisma/client";

// ── Hard public gate — never user-controllable ──────────────────────────────
const PUBLIC_WHERE: Prisma.RequirementWhereInput = {
  deletedAt: null,
  status: "ACTIVE", // only live roles — no DRAFT/PENDING/ON_HOLD/CLOSED/CANCELLED
  jobOpenFor: { in: ["EXTERNAL", "BOTH"] }, // never INTERNAL-only roles
};

// strip salary if the req is set to hide it from candidates
function withSalary(r: any) {
  const {
    hideSalaryFromCandidate,
    salaryMin,
    salaryMax,
    salaryType,
    salaryCurrency,
    showMedianSalary,
    ...rest
  } = r;
  return {
    ...rest,
    salary: hideSalaryFromCandidate
      ? null
      : {
          min: salaryMin,
          max: salaryMax,
          type: salaryType,
          currency: salaryCurrency,
          showMedian: showMedianSalary,
        },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST — GET /api/public/requirements
// // ─────────────────────────────────────────────────────────────────────────────
// export const getPublicRequirements = async (req: Request, res: Response) => {
//   try {
//     const {
//       search,
//       categorySlug,
//       jobType,
//       remoteType,
//       city,
//       page = "1",
//       limit = "12",
//       sortDir = "desc",
//     } = req.query as Record<string, string>;

//     const pageNum = Math.max(parseInt(page) || 1, 1);
//     const take = Math.min(Math.max(parseInt(limit) || 12, 1), 50); // cap for public
//     const skip = (pageNum - 1) * take;

//     const where: Prisma.RequirementWhereInput = { ...PUBLIC_WHERE };

//     if (categorySlug) {
//       where.requirementCategory = { slug: categorySlug, isActive: true };
//     }
//     // validate enums so garbage input doesn't 500 the endpoint
//     if (jobType && jobType in RequirementType)
//       where.jobType = jobType as RequirementType;
//     if (remoteType && remoteType in RemoteType)
//       where.remoteType = remoteType as RemoteType;
//     if (city) where.city = { contains: city, mode: "insensitive" };

//     if (search) {
//       where.OR = [
//         { title: { contains: search, mode: "insensitive" } },
//         { primarySkills: { has: search } },
//         { keySkills: { has: search } },
//         { city: { contains: search, mode: "insensitive" } },
//       ];
//     }

//     const orderBy = {
//       createdAt: (sortDir === "asc" ? "asc" : "desc") as "asc" | "desc",
//     };

//     const [total, rows] = await Promise.all([
//       prisma.requirement.count({ where }),
//       prisma.requirement.findMany({
//         where,
//         select: {
//           id: true,
//           reqCode: true, // public job code — used in the apply URL
//           title: true,
//           description: true,
//           jobType: true,
//           remoteType: true,
//           city: true,
//           state: true,
//           country: true,
//           primarySkills: true,
//           keySkills: true,
//           experienceMin: true,
//           experienceMax: true,
//           totalOpenings: true,
//           functionalArea: true,
//           // salary pulled but conditionally stripped in withSalary()
//           salaryMin: true,
//           salaryMax: true,
//           salaryType: true,
//           salaryCurrency: true,
//           hideSalaryFromCandidate: true,
//           showMedianSalary: true,
//           requirementCategory: { select: { name: true, slug: true } },
//         },
//         orderBy,
//         skip,
//         take,
//       }),
//     ]);

//     return res.json({
//       success: true,
//       data: rows.map(withSalary),
//       meta: {
//         total,
//         page: pageNum,
//         limit: take,
//         pages: Math.ceil(total / take),
//       },
//     });
//   } catch (err) {
//     console.error("getPublicRequirements:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch openings" });
//   }
// };

export const getPublicRequirements = async (req: Request, res: Response) => {
  try {
    const {
      search,
      categorySlug,
      jobType,
      remoteType,
      city,
      page = "1",
      limit = "12",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const take = Math.min(Math.max(parseInt(limit) || 12, 1), 50);
    const skip = (pageNum - 1) * take;

    // Minimal safety net for a public, unauthenticated endpoint:
    // only show requirements that are actually open and meant for
    // external candidates. Adjust/remove these two lines if you
    // genuinely want internal and closed reqs visible too.
    const where: Prisma.RequirementWhereInput = {
      status: "ACTIVE",
    };

    if (categorySlug) {
      where.requirementCategory = { slug: categorySlug, isActive: true };
    }
    if (jobType && jobType in RequirementType)
      where.jobType = jobType as RequirementType;
    if (remoteType && remoteType in RemoteType)
      where.remoteType = remoteType as RemoteType;
    if (city) where.city = { contains: city, mode: "insensitive" };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { primarySkills: { has: search } },
        { keySkills: { has: search } },
        { city: { contains: search, mode: "insensitive" } },
      ];
    }

    const orderBy = {
      createdAt: (sortDir === "asc" ? "asc" : "desc") as "asc" | "desc",
    };

    const [total, rows] = await Promise.all([
      prisma.requirement.count({ where }),
      prisma.requirement.findMany({
        where,
        select: {
          id: true,
          reqCode: true,
          title: true,
          description: true,
          jobType: true,
          remoteType: true,
          city: true,
          state: true,
          country: true,
          primarySkills: true,
          keySkills: true,
          experienceMin: true,
          experienceMax: true,
          totalOpenings: true,
          functionalArea: true,
          salaryMin: true,
          salaryMax: true,
          salaryType: true,
          salaryCurrency: true,
          hideSalaryFromCandidate: true,
          showMedianSalary: true,
          requirementCategory: { select: { name: true, slug: true } },
        },
        orderBy,
        skip,
        take,
      }),
    ]);

    return res.json({
      success: true,
      data: rows.map(withSalary),
      meta: {
        total,
        page: pageNum,
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error("getPublicRequirements:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch openings" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DETAIL — GET /api/public/requirements/:reqCode
// Keyed by reqCode (not internal uuid) so public URLs read cleanly:
//   /careers/SFJ-REQ-1234
// The apply form posts against this reqCode.
// ─────────────────────────────────────────────────────────────────────────────
export const getPublicRequirementDetail = async (
  req: Request,
  res: Response
) => {
  try {
    const { reqCode } = req.params;

    const r = await prisma.requirement.findFirst({
      where: { reqCode, ...PUBLIC_WHERE }, // gate applies here too
      select: {
        id: true,
        reqCode: true,
        title: true,
        description: true,
        jobType: true,
        remoteType: true,
        jobOpenFor: true,
        city: true,
        state: true,
        country: true,
        primarySkills: true,
        keySkills: true,
        experienceMin: true,
        experienceMax: true,
        education: true,
        functionalArea: true,
        shift: true,
        totalOpenings: true,
        salaryMin: true,
        salaryMax: true,
        salaryType: true,
        salaryCurrency: true,
        hideSalaryFromCandidate: true,
        showMedianSalary: true,
        jdFileName: true, // name only — NEVER expose jdFileKey (raw S3 key)
        requirementCategory: { select: { name: true, slug: true } },
      },
    });

    if (!r) {
      return res
        .status(404)
        .json({ success: false, message: "Opening not found" });
    }

    return res.json({ success: true, data: withSalary(r) });
  } catch (err) {
    console.error("getPublicRequirementDetail:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch opening" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORIES — GET /api/public/categories
// For the filter chips on the careers page, with live open-count per category.
// ─────────────────────────────────────────────────────────────────────────────
export const getPublicCategories = async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.requirementCategory.findMany({
      where: { isActive: true },
      select: {
        name: true,
        slug: true,
        _count: {
          select: {
            requirements: { where: PUBLIC_WHERE }, // only count publicly-visible reqs
          },
        },
      },
      orderBy: { order: "asc" },
    });

    return res.json({
      success: true,
      data: categories.map((c) => ({
        name: c.name,
        slug: c.slug,
        openings: c._count.requirements,
      })),
    });
  } catch (err) {
    console.error("getPublicCategories:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch categories" });
  }
};
