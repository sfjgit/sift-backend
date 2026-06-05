// File: jd.routes.ts (updated)
// Path: src/routes/jd.routes.ts

import { Router } from "express";
import multer from "multer";
import { authenticateUser } from "@/middleware/auth";
import {
  extractTextFromJD,
  parseJDWithGPT,
  JDExtractException,
} from "@/requirement/parsers/jd.parser";
import { createLogger } from "@/utils/logging";
import {
  saveToLibrary,
  searchLibrary,
  useFromLibrary,
} from "@/controller/parsedJD.controller";
// import { saveToLibrary, searchLibrary, useFromLibrary } from '@/controllers/parsedJD.controller';
// import { createLogger } from '@/utils/logging';

const log = createLogger("jd-routes");
const router = Router();

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

// ── POST /jd/parse — extract + GPT parse, return JSON (no DB write here)
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

// ── POST /jd/library — save parsed JD to library
router.post("/library", authenticateUser, saveToLibrary);

// ── GET /jd/library/search?q=react&limit=10 — search library
router.get("/library/search", authenticateUser, searchLibrary);

// ── POST /jd/library/:id/use — get full parsedData, bump usageCount
router.post("/library/:id/use", authenticateUser, useFromLibrary);

export default router;
