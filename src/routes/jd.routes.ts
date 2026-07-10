// File: jd.routes.ts
// Path: src/routes/jd.routes.ts

import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import OpenAI from "openai";
import { authenticateUser } from "@/middleware/auth";
import {
  extractTextFromJD,
  parseJDWithGPT,
} from "@/requirement/parsers/jd.parser";
import { createLogger } from "@/utils/logging";
import {
  saveToLibrary,
  searchLibrary,
  useFromLibrary,
} from "@/controller/parsedJD.controller";
// import { getRedisClient } from "@/utils/redis";

const log = createLogger("jd-routes");
const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// MULTER
// ─────────────────────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/rtf",
      "text/rtf",
    ];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Only PDF, DOCX, RTF supported"));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// REDIS RATE LIMIT MIDDLEWARE
// Key: jd:prompt:<userId>  |  TTL: 1 hour  |  Max: 3 per user per hour
// ─────────────────────────────────────────────────────────────────────────────

// In-memory rate limit — per userId, 3 prompts per hour
// Note: resets on server restart / per Cloud Run instance — acceptable for this use case
const promptUsageMap = new Map<string, { count: number; resetAt: number }>();

const PROMPT_LIMIT = 3;
const PROMPT_TTL_MS = 60 * 60 * 1000; // 1 hour

async function promptRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const userId = req.user!.id;
  const now = Date.now();

  const entry = promptUsageMap.get(userId);

  // expired or first use — reset
  if (!entry || now > entry.resetAt) {
    promptUsageMap.set(userId, { count: 1, resetAt: now + PROMPT_TTL_MS });
    (req as any).promptUsed = 1;
    (req as any).promptLimit = PROMPT_LIMIT;
    return next();
  }

  if (entry.count >= PROMPT_LIMIT) {
    const minutesLeft = Math.ceil((entry.resetAt - now) / 60000);
    return res.status(429).json({
      success: false,
      code: "PROMPT_LIMIT_EXCEEDED",
      message: `You've used all ${PROMPT_LIMIT} AI prompts. Try again in ${minutesLeft} minute${
        minutesLeft !== 1 ? "s" : ""
      }.`,
      retryAfterMinutes: minutesLeft,
      used: entry.count,
      limit: PROMPT_LIMIT,
    });
  }

  entry.count += 1;
  (req as any).promptUsed = entry.count;
  (req as any).promptLimit = PROMPT_LIMIT;
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT → JD PARSER
// Takes a plain-text description prompt, calls GPT to extract structured JD,
// saves to library, returns same shape as /jd/parse.
// ─────────────────────────────────────────────────────────────────────────────

const PROMPT_SYSTEM = `You are a Job Description extraction assistant.
The user will give you a plain-text job description, which may contain multiple sections (About the Role, Responsibilities, Eligibility, Skills, etc.).

You have two jobs on the SAME input:

1. "description" — put the FULL job description in here, cleaned up as Markdown.
   - Preserve every section (About the Role, Key Responsibilities, Eligibility,
     Required Skills, What We're Looking For, Performance Expectations, Why Join Us, etc.)
   - Use "## Heading" for section titles and "- " for bullet lists.
   - Do NOT summarize, shorten, or drop content — even if a detail is also
     pulled into a structured field below, it must still appear in "description".

2. Separately extract the structured fields below FROM the same text, only when
   explicitly stated. These exist for filtering/search — they do not replace
   the full text in "description".

Return ONLY a valid JSON object. No preamble, no explanation, no markdown fences
wrapping the JSON itself (though "description" may contain markdown internally).

Return exactly this shape (all fields optional except title and description):
{
  "title": "string",
  "description": "string (full markdown JD — never thin, never empty)",
  "jobType": "CONTRACT | PERMANENT | CONTRACT_TO_HIRE | FREELANCE | null",
  "remoteType": "ONSITE | REMOTE | HYBRID | null",
  "experienceMin": number | null,
  "experienceMax": number | null,
  "salaryMin": number | null,
  "salaryMax": number | null,
  "salaryType": "MONTHLY | ANNUAL | HOURLY | DAILY | null",
  "education": "string | null",
  "functionalArea": "string | null",
  "shift": "string | null",
  "city": "string | null",
  "state": "string | null",
  "country": "string | null",
  "bonusAmount": number | null,
  "primarySkills": ["string"],
  "keySkills": ["string"],
  "targetCompanies": ["string"],
  "noPoachCompanies": ["string"]
}`;

async function parsePromptWithGPT(
  prompt: string
): Promise<Record<string, any>> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      { role: "system", content: PROMPT_SYSTEM },
      { role: "user", content: prompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  // strip any accidental markdown fences
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /jd/parse — file upload → extract text → GPT parse
router.post(
  "/parse",
  authenticateUser,
  upload.single("jd"),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file)
        return res.status(400).json({
          success: false,
          code: "NO_FILE",
          message: "No file uploaded",
        });

      log("info", "JD parse request", {
        fileName: file.originalname,
        mimeType: file.mimetype,
      });

      let extractedText: string;
      try {
        extractedText = await extractTextFromJD(file.buffer, file.mimetype);
      } catch (err: any) {
        if (err.code) {
          const statusMap: Record<string, number> = {
            DOC_NOT_SUPPORTED: 422,
            UNSUPPORTED_FILE_TYPE: 415,
            TEXT_EXTRACTION_FAILED: 422,
          };
          return res
            .status(statusMap[err.code] ?? 422)
            .json({ success: false, code: err.code, message: err.message });
        }
        throw err;
      }

      let parsed;
      try {
        parsed = await parseJDWithGPT(extractedText);
      } catch (err: any) {
        return res.status(502).json({
          success: false,
          code: "GPT_PARSE_FAILED",
          message: err.message,
        });
      }

      return res.status(200).json({
        success: true,
        data: parsed,
        meta: {
          fileName: file.originalname,
          fileSizeBytes: file.size,
          charCount: extractedText.length,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /jd/prompt-parse — plain text prompt → GPT → save to library
// Rate limited: 3 uses per user per hour via Redis
router.post(
  "/prompt-parse",
  authenticateUser,
  promptRateLimit,
  async (req, res, next) => {
    try {
      const { prompt, saveTitle } = req.body as {
        prompt?: string;
        saveTitle?: string; // optional override for library title
      };

      if (!prompt || prompt.trim().length < 10) {
        return res.status(400).json({
          success: false,
          code: "PROMPT_TOO_SHORT",
          message: "Please describe the requirement in at least 10 characters.",
        });
      }

      log("info", "JD prompt-parse request", { userId: req.user!.id });

      let parsed: Record<string, any>;
      try {
        parsed = await parsePromptWithGPT(prompt.trim());
      } catch (err: any) {
        return res.status(502).json({
          success: false,
          code: "GPT_PARSE_FAILED",
          message: "AI failed to parse the prompt. Please try rephrasing.",
        });
      }

      if (!parsed.title) {
        return res.status(422).json({
          success: false,
          code: "PARSE_INCOMPLETE",
          message:
            "Could not extract a job title from the prompt. Please be more specific.",
        });
      }

      // ── Auto-save to JD library (same as file upload flow) ──────────────
      const libraryTitle = saveTitle?.trim() || parsed.title;
      let libraryId: string | null = null;

      try {
        // reuse the saveToLibrary logic inline to avoid HTTP call to self
        const { prisma } = await import("@/utils/prisma/client");
        const actorId = req.user!.id;

        const existing = await prisma.parsedJDLibrary.findFirst({
          where: {
            title: { equals: libraryTitle, mode: "insensitive" },
            isActive: true,
          },
          select: { id: true },
        });

        if (existing) {
          await prisma.parsedJDLibrary.update({
            where: { id: existing.id },
            data: {
              parsedData: parsed,
              parsedById: actorId,
              parsedAt: new Date(),
            },
          });
          libraryId = existing.id;
        } else {
          const entry = await prisma.parsedJDLibrary.create({
            data: {
              title: libraryTitle,
              parsedData: parsed,
              parsedById: actorId,
              usageCount: 0,
              usedByIds: [],
              isActive: true,
            },
            select: { id: true },
          });
          libraryId = entry.id;
        }
      } catch (libErr) {
        // non-fatal — still return the parsed data even if library save fails
        log("warn", "prompt-parse: failed to save to library", libErr);
      }

      return res.status(200).json({
        success: true,
        data: parsed,
        libraryId,
        used: (req as any).promptUsed ?? 1,
        limit: (req as any).promptLimit ?? PROMPT_LIMIT,
        meta: {
          prompt:
            prompt.trim().slice(0, 100) + (prompt.length > 100 ? "…" : ""),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /jd/library — save parsed JD to library
router.post("/library", authenticateUser, saveToLibrary);

// ── GET /jd/library/search?q=react&limit=10
router.get("/library/search", authenticateUser, searchLibrary);

// ── POST /jd/library/:id/use — get full parsedData, bump usageCount
router.post("/library/:id/use", authenticateUser, useFromLibrary);

export default router;
