// routes/internal.routes.ts
// These routes are NOT behind user auth.
// Protected by x-internal-secret header middleware only.
// Never expose to frontend. Mount at /internal.

import { Router, Request, Response, NextFunction } from "express";
import { syncCandidateToCore } from "@/controller/internal.controller";
import { z } from "zod";
import { config } from "dotenv";
import { validate } from "@/validators/validator";
import { resolveRecruiters } from "@/controller/internalUsers.controller";

const router = Router();

config();

// ── shared secret middleware
const requireInternalSecret = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const secret = req.headers["x-internal-secret"];
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  next();
};

// ── validation
const syncSchema = z.object({
  candidateServiceId: z.string().min(1),
  requirementId: z.string().min(1),
  recruiterId: z.string().min(1),
  assignmentId: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  currentTitle: z.string().optional().nullable(),
  currentCompany: z.string().optional().nullable(),
  totalExpYears: z.number().optional().nullable(),
  topSkills: z.array(z.string()).default([]),
  resumeUrl: z.string().optional().nullable(),
  rawSnapshot: z.any(),
  sourced: z.string().optional().nullable(),
});

// const validate = (req: Request, res: Response, next: NextFunction) => {
//   const result = syncSchema.safeParse(req.body);
//   if (!result.success) {
//     res.status(400).json({
//       success: false,
//       code: "VALIDATION_ERROR",
//       errors: result.error.flatten().fieldErrors,
//     });
//     return;
//   }
//   req.body = result.data;
//   next();
// };

// POST /internal/candidates/sync
router.post(
  "/candidates/sync",
  requireInternalSecret,
  // validate.body(syncSchema),
  syncCandidateToCore
);

router.post("/users/resolve", resolveRecruiters);

export default router;
