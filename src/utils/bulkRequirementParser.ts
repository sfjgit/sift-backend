// File: bulkRequirementParser.ts
// Path: src/utils/bulkRequirementParser.ts

import { RawRequirementRow } from "@/types/bulkRequirement.type";
import * as xlsx from "xlsx";

const HEADER_ROW_INDEX = 2; // 0-based: row index 2 = the actual column header row (after 2 instruction rows)

/**
 * Parses an uploaded Excel (.xlsx / .xls) buffer into raw row objects.
 * Skips the first 2 instruction rows and uses row 3 as the header.
 */
export function parseExcelBuffer(buffer: Buffer): RawRequirementRow[] {
  const workbook = xlsx.read(buffer, { type: "buffer", cellDates: true });

  // Always use the first sheet (REQUIREMENTS sheet)
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  // sheet_to_json with header:1 gives us a 2D array — rows as arrays
  const allRows = xlsx.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false, // coerce all values to strings for consistent validation
  });

  if (allRows.length <= HEADER_ROW_INDEX) {
    return [];
  }

  // Row at HEADER_ROW_INDEX contains the column names
  const headers = (allRows[HEADER_ROW_INDEX] as string[]).map((h) =>
    String(h ?? "").trim(),
  );

  const dataRows = allRows.slice(HEADER_ROW_INDEX + 1);

  return dataRows
    .map((row: any) => {
      const obj: Record<string, string> = {};
      headers.forEach((header, i) => {
        if (header) {
          obj[header] = String((row as string[])[i] ?? "").trim();
        }
      });
      return obj as RawRequirementRow;
    })
    .filter((row: any) => isRowNonEmpty(row)); // drop fully blank rows
}

/**
 * Parses a CSV buffer into raw row objects.
 * Expects the CSV to have a single header row (column names in row 1).
 * Compatible with csvs exported from Excel using our template.
 */
export function parseCsvBuffer(buffer: Buffer): RawRequirementRow[] {
  const workbook = xlsx.read(buffer, {
    type: "buffer",
    raw: false,
    cellDates: true,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const rows = xlsx.utils.sheet_to_json<RawRequirementRow>(sheet, {
    defval: "",
    raw: false,
  });

  return rows
    .map((row: any) => {
      const cleaned: Record<string, string> = {};
      for (const [key, val] of Object.entries(row)) {
        cleaned[key.trim()] = String(val ?? "").trim();
      }
      return cleaned as RawRequirementRow;
    })
    .filter((row: any) => isRowNonEmpty(row));
}

/**
 * Detects the file format from mimetype or original filename and delegates
 * to the correct parser. Returns raw rows.
 */
export function parseUploadedFile(
  buffer: Buffer,
  mimetype: string,
  originalname: string,
): RawRequirementRow[] {
  const ext = originalname.split(".").pop()?.toLowerCase() ?? "";

  const isExcel =
    mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimetype === "application/vnd.ms-excel" ||
    ext === "xlsx" ||
    ext === "xls";

  const isCsv = mimetype === "text/csv" || ext === "csv";

  if (isExcel) return parseExcelBuffer(buffer);
  if (isCsv) return parseCsvBuffer(buffer);

  throw new Error(
    `Unsupported file format: "${originalname}". Only .xlsx, .xls, and .csv are accepted.`,
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRowNonEmpty(row: RawRequirementRow): boolean {
  return Object.values(row).some(
    (v) => v !== "" && v !== null && v !== undefined,
  );
}
