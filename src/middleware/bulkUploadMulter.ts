// File: bulkUploadMulter.ts
// Path: src/middleware/bulkUploadMulter.ts

import multer from "multer";

const ACCEPTED_MIMETYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
];

export const bulkUploadMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    const validExt = ["xlsx", "xls", "csv"].includes(ext ?? "");
    const validMime = ACCEPTED_MIMETYPES.includes(file.mimetype);
    if (validExt || validMime) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file type. Only .xlsx, .xls, and .csv are accepted.`,
        ),
      );
    }
  },
});
