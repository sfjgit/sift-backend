// File: upload.ts
// Path: src/middleware/upload.ts
//
// One file per request, kept in memory (S3 upload follows). Size / type
// problems are 400s the form can show, not 500s.

import multer from "multer";
import { Request, Response, NextFunction } from "express";

const MAX_MB = 25;

// reports, filings, sheets, decks, images
const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const single = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
}).single("file");

export const singleFile = (req: Request, res: Response, next: NextFunction) => {
  single(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({
        success: false,
        code: err.code === "LIMIT_FILE_SIZE" ? "FILE_TOO_LARGE" : "BAD_UPLOAD",
        message: err.code === "LIMIT_FILE_SIZE" ? `Files can be up to ${MAX_MB} MB` : err.message,
      });
      return;
    }
    if (err) return next(err);
    // fileFilter skipped it: a type we don't keep
    if (!req.file && req.headers["content-type"]?.startsWith("multipart/")) {
      res.status(400).json({
        success: false,
        code: "FILE_TYPE",
        message: "Upload a PDF, Word, Excel, PowerPoint, CSV, text or image file",
      });
      return;
    }
    next();
  });
};
