// File: parsers.ts
// Path: src/migration/parsers.ts
//
// All the string-wrangling for the legacy export's "CODE|Team|Name (email)"
// pattern lives here, isolated from the DB logic in migrate-requirements.ts.
// If the export format changes, this is the only file that should need edits.

/**
 * Matches an email inside the LAST parenthesis in a string.
 * "SFJ-R-11776|TaaS|Joanna|Durga Sujanitha Vadavalli (dh01@sfjbs.com)"
 *   -> "dh01@sfjbs.com"
 */
const TRAILING_EMAIL_RE =
  /\(([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)(?!.*\()/;

/**
 * Extracts a single email from a "Created By" / "Hiring Manager" style cell.
 * Returns null if the cell is empty or has no recognizable email.
 */
export function extractSingleEmail(
  cell: string | null | undefined
): string | null {
  if (!cell) return null;
  const match = cell.match(TRAILING_EMAIL_RE);
  return match ? match[1].toLowerCase().trim() : null;
}

/**
 * The "Recruiters" column packs multiple "CODE|Team|Name (email)" entries
 * separated by ", " at the top level. Splits them and extracts one email
 * per entry. Entries with no extractable email are dropped (not nulled) —
 * caller decides what "expected N recruiters, found M emails" means for
 * staging purposes.
 */
export function extractMultipleEmails(
  cell: string | null | undefined
): string[] {
  if (!cell) return [];
  // Top-level split on comma followed by a space and another CODE| pattern.
  // Using a simple comma split is good enough here because none of the
  // observed values contain commas inside a single entry.
  const segments = cell
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const emails = segments
    .map((seg) =>
      seg.match(/\(([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)/)
    )
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => m[1].toLowerCase().trim());
  return Array.from(new Set(emails)); // de-dupe, same recruiter can appear twice
}

/**
 * "Capgemini_TaaS_2023" -> { clientName: "Capgemini", serviceLineCode: "TaaS", year: "2023" }
 * "SFJBS_B2I&B2G_2025"  -> { clientName: "SFJBS", serviceLineCode: "B2I&B2G", year: "2025" }
 * Falls back gracefully if the trailing _ServiceLine_Year pattern isn't there —
 * returns the raw string as clientName so nothing silently disappears.
 */
export function parseClientDepartment(cell: string | null | undefined): {
  clientName: string;
  serviceLineCode: string | null;
  year: string | null;
  raw: string;
} {
  const raw = (cell ?? "").trim();
  const match = raw.match(/^(.*)_([A-Za-z0-9&]+)_(\d{4})$/);
  if (!match) {
    return { clientName: raw, serviceLineCode: null, year: null, raw };
  }
  return {
    clientName: match[1].trim(),
    serviceLineCode: match[2].trim(),
    year: match[3],
    raw,
  };
}

/**
 * Best-effort parse of the messy "Client Contact" column into a candidate
 * ClientSpoc: the name immediately before the LAST "(" and the email inside
 * it. This is intentionally conservative — if it can't confidently find
 * both a name and an email, it returns null and the caller stages the raw
 * string for a human instead of guessing.
 *
 * Example:
 *   "...Sr.Cxxx|K kakarla.kiran(R)| TaaS_Durga Sujanitha Vadavalli (kakarla.kiran@capgemini.com)"
 *   -> { name: "Durga Sujanitha Vadavalli", email: "kakarla.kiran@capgemini.com" }
 */
export function parseClientSpoc(
  cell: string | null | undefined
): { name: string; email: string } | null {
  if (!cell) return null;
  const emailMatch = cell.match(TRAILING_EMAIL_RE);
  if (!emailMatch) return null;
  const beforeParen = cell.slice(0, emailMatch.index).trim();
  // Take the last "|"-delimited segment as the name; strip a trailing
  // "(R)" / "(Manager)" style role tag if present.
  const lastSegment = beforeParen.split("|").pop() ?? beforeParen;
  const name = lastSegment.replace(/\([^)]*\)\s*$/, "").trim();
  if (!name) return null;
  return { name, email: emailMatch[1].toLowerCase().trim() };
}

/**
 * Extracts name + email pairs from a multi-entry cell like "Recruiters" or
 * a single-entry cell like "Created By". Pattern per entry:
 * "CODE|Team|Lead|Full Name (email@x.com)". Name = last |-segment before the
 * final parenthesis. Used by auto-user-creation so migrated users get real
 * names, not email prefixes.
 */
export function extractNameEmailPairs(
  cell: string | null | undefined
): Array<{ name: string; email: string }> {
  if (!cell) return [];
  const segments = cell
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const pairs: Array<{ name: string; email: string }> = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    const m = seg.match(
      /\(([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)\s*$/
    );
    if (!m) continue;
    const email = m[1].toLowerCase().trim();
    if (seen.has(email)) continue;
    seen.add(email);
    const beforeParen = seg.slice(0, m.index).trim();
    const lastSegment = beforeParen.split("|").pop() ?? beforeParen;
    const name =
      lastSegment.replace(/\([^)]*\)\s*$/, "").trim() || email.split("@")[0];
    pairs.push({ name, email });
  }
  return pairs;
}
