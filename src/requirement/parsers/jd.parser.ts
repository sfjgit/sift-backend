// File: jd.parser.ts
// Path: src/requirement/parsers/jd.parser.ts

// =============================================================================
// jd.parser.ts
// Parses JD file buffer → plain text → GPT structured JSON
// Mirrors resume pipeline: unpdf for PDF, mammoth for DOCX, RTF basic cleanup
// DOC (legacy) rejected — same policy as extractResumeText.ts
// No DB writes. Returns ParsedJD for frontend to prefill the requirement form.
// =============================================================================

import OpenAI from "openai";
import { extractText } from "unpdf";
import mammoth from "mammoth";
import { config } from "dotenv";
// import { createLogger } from "@/utils/logging";

// const log = createLogger("jd-parser");
function log(level: string, message: string, meta?: any) {
  // createLogger("jd-routes").log(level, message, meta);
  console.log(level, message, meta);
}

config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const JD_TEXT_MIN_LENGTH = 50;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedJD {
  title: string | null;
  description: string | null;
  primarySkills: string[];
  keySkills: string[];
  experienceMin: number | null;
  experienceMax: number | null;
  education: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryType: "MONTHLY" | "ANNUAL" | "HOURLY" | "DAILY" | null;
  jobType: "CONTRACT" | "PERMANENT" | "CONTRACT_TO_HIRE" | "FREELANCE" | null;
  remoteType: "ONSITE" | "REMOTE" | "HYBRID" | null;
  shift: string | null;
  functionalArea: string | null;
  targetCompanies: string[];
  noPoachCompanies: string[];
  bonusAmount: number | null;
}

export type JDExtractError =
  | "DOC_NOT_SUPPORTED"
  | "UNSUPPORTED_FILE_TYPE"
  | "TEXT_EXTRACTION_FAILED";

export class JDExtractException extends Error {
  constructor(public code: JDExtractError, message: string) {
    super(message);
    this.name = "JDExtractException";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — extract text from buffer
// Mirrors extractResumeText.ts exactly — same libs, same rejection policy
// ─────────────────────────────────────────────────────────────────────────────

export async function extractTextFromJD(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  log("info", "Extracting JD text", { mimeType, bufferSize: buffer.length });

  let text = "";

  // ── PDF ────────────────────────────────────────────────────────────────────
  if (mimeType === "application/pdf") {
    const uint8Array = new Uint8Array(buffer);
    const result = await extractText(uint8Array);
    text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  }

  // ── DOCX ───────────────────────────────────────────────────────────────────
  else if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  }

  // ── RTF ────────────────────────────────────────────────────────────────────
  else if (mimeType === "application/rtf" || mimeType === "text/rtf") {
    text = buffer
      .toString("utf-8")
      .replace(/\\par[d]?/g, "\n")
      .replace(/\\'[0-9a-f]{2}/gi, "")
      .replace(/{\\.*?}/g, "")
      .replace(/[{}\\]/g, "");
  }

  // ── DOC (legacy) — reject same as resume pipeline ──────────────────────────
  else if (mimeType === "application/msword") {
    log("warn", "Legacy DOC rejected");
    throw new JDExtractException(
      "DOC_NOT_SUPPORTED",
      "Legacy .doc files are not supported. Please upload DOCX or PDF."
    );
  }

  // ── Unsupported ────────────────────────────────────────────────────────────
  else {
    throw new JDExtractException(
      "UNSUPPORTED_FILE_TYPE",
      `Unsupported file type: ${mimeType}`
    );
  }

  // ── Min length check ───────────────────────────────────────────────────────
  const trimmed = text.replace(/\x00/g, "").trim();

  if (!trimmed || trimmed.length < JD_TEXT_MIN_LENGTH) {
    log("warn", "JD text too short after extraction", {
      length: trimmed.length,
    });
    throw new JDExtractException(
      "TEXT_EXTRACTION_FAILED",
      "Could not extract readable text. File may be scanned, empty, or corrupted."
    );
  }

  log("info", "JD text extracted", {
    length: trimmed.length,
    preview: trimmed.slice(0, 120),
  });

  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — GPT parse
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are a JD (Job Description) parser. You will receive raw text extracted from a Job Description document.

Return ONLY a valid JSON object with the fields below.
No explanation, no markdown, no code fences — raw JSON only.

{
  "title":            string | null,
  "description":      string | null,       // summary, max 2000 chars
  "primarySkills":    string[],            // top 3-5 must-have skills only
  "keySkills":        string[],            // all other required skills
  "experienceMin":    number | null,       // years, decimal ok (e.g. 2.5)
  "experienceMax":    number | null,
  "education":        string | null,       // e.g. "B.Tech / B.E. in Computer Science"
  "location":         string | null,       // full location string as in JD
  "city":             string | null,
  "state":            string | null,
  "country":          string | null,
  "salaryMin":        number | null,       // number only, no currency or LPA
  "salaryMax":        number | null,
  "salaryType":       "MONTHLY" | "ANNUAL" | "HOURLY" | "DAILY" | null,
  "jobType":          "CONTRACT" | "PERMANENT" | "CONTRACT_TO_HIRE" | "FREELANCE" | null,
  "remoteType":       "ONSITE" | "REMOTE" | "HYBRID" | null,
  "shift":            string | null,       // e.g. "Morning", "Night", "Flexible"
  "functionalArea":   string | null,       // e.g. "Engineering", "Sales", "Finance"
  "targetCompanies":  string[],
  "noPoachCompanies": string[],
  "bonusAmount":      number | null
}

Rules:
- Missing field → null or [] for arrays, never guess
- salaryMin/Max → strip currency symbols, LPA, "per annum" — number only
- "8-12 LPA" → salaryMin=8, salaryMax=12, salaryType="ANNUAL"
- experienceMin/Max in years as number
`.trim();

export async function parseJDWithGPT(extractedText: string): Promise<ParsedJD> {
  // truncate — JDs rarely exceed 6000 useful chars
  const truncated = extractedText.slice(0, 6000);

  log("info", "Sending JD to GPT", { charCount: truncated.length });

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Parse this Job Description:\n\n${truncated}` },
    ],
  });

  const raw = response.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error("GPT returned empty response");

  // strip fences if GPT disobeys
  const clean = raw
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch {
    log("error", "GPT response not valid JSON", {
      preview: clean.slice(0, 200),
    });
    throw new Error("GPT response was not valid JSON");
  }

  const normalized = normalizeJDOutput(parsed);

  log("info", "JD parsed successfully", {
    title: normalized.title,
    primarySkills: normalized.primarySkills,
    jobType: normalized.jobType,
    remoteType: normalized.remoteType,
  });

  return normalized;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — normalize + null-safe sanitize
// ─────────────────────────────────────────────────────────────────────────────

function normalizeJDOutput(raw: any): ParsedJD {
  return {
    title: str(raw.title),
    description: str(raw.description),
    primarySkills: strArr(raw.primarySkills),
    keySkills: strArr(raw.keySkills),
    experienceMin: num(raw.experienceMin),
    experienceMax: num(raw.experienceMax),
    education: str(raw.education),
    location: str(raw.location),
    city: str(raw.city),
    state: str(raw.state),
    country: str(raw.country),
    salaryMin: num(raw.salaryMin),
    salaryMax: num(raw.salaryMax),
    salaryType: oneOf(raw.salaryType, ["MONTHLY", "ANNUAL", "HOURLY", "DAILY"]),
    jobType: oneOf(raw.jobType, [
      "CONTRACT",
      "PERMANENT",
      "CONTRACT_TO_HIRE",
      "FREELANCE",
    ]),
    remoteType: oneOf(raw.remoteType, ["ONSITE", "REMOTE", "HYBRID"]),
    shift: str(raw.shift),
    functionalArea: str(raw.functionalArea),
    targetCompanies: strArr(raw.targetCompanies),
    noPoachCompanies: strArr(raw.noPoachCompanies),
    bonusAmount: num(raw.bonusAmount),
  };
}

const str = (v: any): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: any): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;
const strArr = (v: any): string[] =>
  Array.isArray(v)
    ? v.filter((x: any) => typeof x === "string" && x.trim())
    : [];
const oneOf = <T extends string>(v: any, allowed: T[]): T | null =>
  allowed.includes(v) ? v : null;
