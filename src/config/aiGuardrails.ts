// File: aiGuardrails.ts
// Path: src/config/aiGuardrails.ts
//
// AI assistant — golden rules + the destructive-intent guard (spec §0, §4 L2).
//
// AI_READ_ONLY is a code constant ON PURPOSE, not a DB / env flag: config can be
// flipped by mistake, code needs a reviewed deploy. There is no bypass, no
// override setting and no "admin mode" — Super Admin included.
//
// The guard (G3) is a UX layer, not the security boundary: it rejects obvious
// change requests instantly (no LLM call, ₹0). The walls are L1 (no write
// actions exist), L4 (output validation) and L6 (read-only DB role).

export const AI_READ_ONLY = true as const;

/** max characters a request may have (G2) */
export const AI_MAX_INPUT_CHARS = 500;

// verbs that, as the action of a sentence, ask for a change
const DESTRUCTIVE_VERBS = [
  "delete", "del", "remove", "rm", "drop", "truncate", "update", "edit", "change", "modify", "alter",
  "assign", "reassign", "unassign", "allot", "allocate", "move", "merge", "archive", "unarchive",
  "restore", "approve", "reject", "decline", "send", "resend", "email", "mail", "sms", "whatsapp",
  "import", "upload", "reset", "override", "grant", "revoke", "create", "add",
  "insert", "mark", "set", "unset", "close", "cancel", "deactivate", "activate", "disable",
  "enable", "erase", "wipe", "purge", "clear", "destroy", "rename", "transfer", "increase",
  "decrease", "raise", "lower", "unlock", "lock", "publish", "unpublish", "run", "rerun", "trigger",
  "start", "stop", "kill", "execute", "schedule", "invite", "block", "unblock", "ban", "empty",
  "overwrite", "replace", "write", "save", "fix", "correct", "upgrade", "downgrade", "promote",
  "demote", "validate", "enrich", "generate", "submit", "unlink",
  "attach", "detach", "unhide", "flush", "kick", "suspend",
] as const;

// Hindi / Hinglish / Kannada imperatives — reject wherever they appear
const NATIVE_DESTRUCTIVE = [
  "hatao", "hata do", "hatado", "hata", "mitao", "mita do", "mitado", "nikalo", "nikaal do",
  "badlo", "badal do", "badaldo", "bhejo", "bhej do", "bhejdo", "band karo", "khatam karo",
  "saaf karo", "daalo", "daal do", "jodo", "jod do", "banao", "bana do", "mita",
  "tegedu", "tegedu haaku", "tegedubidi", "tegi", "alisu", "alisi", "alisibidi", "kalisu",
  "kalisi", "badalisu", "badalisi", "seris", "serisu", "nillisu", "muchchu", "ilisu",
] as const;

// "<english verb> karo / kar do / maadi" — Hinglish & Kanglish
const NATIVE_SUFFIXES = [
  "karo", "kar do", "kardo", "kariye", "kijiye", "kar dijiye", "kar de", "karde", "maadi", "madi",
  "maado", "mado", "maadu", "madu", "maadbidi", "hogu",
] as const;

// talking the assistant out of its rules — no override exists, so reject
const OVERRIDE_PATTERNS = [
  /\bignore (all |the |any |your )?(previous|prior|above|earlier)? ?(instructions|rules|prompt)/,
  /\b(admin|developer|god|debug|sudo|root) mode\b/,
  /\bi (am|m|'m) (the |a )?(super ?admin|admin|owner|developer|ceo)\b/,
  /\bi authori[sz]e\b/,
  /\b(bypass|jailbreak|disable (the )?(guard|safety|rules))\b/,
  /\byou are now\b/,
  /\bsystem prompt\b/,
  /\bpretend (you|to)\b/,
  /\b(write access|read ?only off|(turn|switch) off read ?only|disable read ?only)\b/,
  /\b(insert into|update \w+ set|delete from|drop table|alter table|truncate table)\b/,
] as const;

// lead-ins before the real verb ("please …", "can you …")
const LEAD_INS = [
  "please", "pls", "plz", "kindly", "can you", "could you", "would you", "will you", "can u",
  "could u", "i want to", "i want you to", "i wanna", "i need to", "i need you to", "i would like to",
  "i'd like to", "id like to", "help me", "help me to", "let's", "lets", "let us", "go ahead and",
  "just", "now", "ok", "okay", "hey", "hi", "ai", "also", "and", "then", "quickly", "asap", "pl",
  "try to", "you should", "you must", "you can", "u can", "go and", "simply", "first", "next",
] as const;

// clause breaks for chained requests ("show X and delete them")
const CLAUSE_SPLIT =
  /\s*(?:[.;!?\n]|,|\band then\b|\bthen\b|\band also\b|\balso\b|\bafter that\b|\bafterwards\b|\band\b|\bplus\b|&|\+)\s*/;

const VERB_SET = new Set<string>(DESTRUCTIVE_VERBS);

// "generate a report", "create a chart", "build a dashboard", "report banao": these
// verbs only make something to LOOK at when what they make is a report. Anything
// else ("create a client", "run the pipeline", "send the report") stays rejected.
const READ_ARTEFACT = /\b(reports?|charts?|graphs?|canvas(es)?|summary|summaries|dashboards?|breakdowns?|overviews?|analysis|analyses|tables?|pie|trends?|visuali[sz]ations?|stats|statistics|kpis?|insights?|views?)\b/;
const MAKE_VERBS = new Set(["generate", "create", "build", "make", "prepare", "add", "run", "start", "draw", "plot"]);
const MAKE_NATIVE = /^(banao|bana do|bana)$/;
/** canvas edits: "remove the table", "drop the pie chart" — the canvas, not CRM data */
const BLOCK_NOUN = /\b(chart|charts|graph|graphs|table|tables|pie|block|blocks|kpi|kpis|trend|line)\b/;
const BLOCK_VERBS = new Set(["remove", "drop", "delete", "hide"]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NATIVE_RE = new RegExp(`(^|\\s)(${NATIVE_DESTRUCTIVE.map(escape).join("|")})(\\s|$)`);
const SUFFIX_RE = new RegExp(
  `\\b(${[...DESTRUCTIVE_VERBS].map(escape).join("|")})\\s+(${NATIVE_SUFFIXES.map(escape).join("|")})\\b`,
);
const LEAD_RE = new RegExp(`^(?:(?:${[...LEAD_INS].sort((a, b) => b.length - a.length).map(escape).join("|")})\\s+)+`);

/** lowercase, curly quotes straightened, spaces collapsed; {placeholders} kept */
export const normaliseInput = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}{}_'"&+.,;!?\-\s:/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: "destructive" | "override"; matched: string };

/**
 * G3 — runs on ENTITY-MASKED text, so a status called "Closed" or a client called
 * "Delete Logistics" has already become a {placeholder} and can't trigger it.
 */
/** inside the canvas these verbs change the REPORT ("remove the trend chart", "replace it with users") */
const CANVAS_EDIT_VERBS = new Set(["remove", "drop", "delete", "hide", "replace", "swap", "change", "edit", "modify", "update", "set", "add", "clear", "reset", "move", "rename", "increase", "decrease", "lower", "raise", "start", "create", "generate", "make", "build", "run", "mark", "correct", "fix"]);
/** …unless the clause is plainly about CRM records rather than the report */
const RECORD_ACTION = /\b(from (the )?(crm|database|db|system)|permanently|in the crm|their (status|owner|handler)|status to|assign|reassign|send|email (them|the)|approve|reject)\b/;

export const checkDestructiveIntent = (maskedText: string, opts: { canvas?: boolean } = {}): GuardResult => {
  const text = normaliseInput(maskedText);

  for (const re of OVERRIDE_PATTERNS) {
    const m = text.match(re);
    if (m) return { ok: false, reason: "override", matched: m[0] };
  }
  const native = text.match(NATIVE_RE);
  if (native && !(MAKE_NATIVE.test(native[2]!) && READ_ARTEFACT.test(text)))
    return { ok: false, reason: "destructive", matched: native[2]! };
  const suffix = text.match(SUFFIX_RE);
  if (suffix) return { ok: false, reason: "destructive", matched: suffix[0] };

  // the action of each clause: first word after any lead-ins
  for (const raw of text.split(CLAUSE_SPLIT)) {
    const clause = raw.replace(LEAD_RE, "").trim();
    if (!clause) continue;
    const first = clause.split(" ")[0]!.replace(/[^a-z']/g, "");
    if (!VERB_SET.has(first)) continue;
    // canvas: editing the report is not changing data — the AI has no write path anyway
    if (opts.canvas && CANVAS_EDIT_VERBS.has(first) && !RECORD_ACTION.test(clause)) continue;
    // making a report / chart is reading; removing a chart from the canvas is not touching data
    if (MAKE_VERBS.has(first) && READ_ARTEFACT.test(clause)) continue;
    if (BLOCK_VERBS.has(first) && BLOCK_NOUN.test(clause) && !/\b(clients?|spocs?|leads?|users?|records?|data|all)\b/.test(clause)) continue;
    return { ok: false, reason: "destructive", matched: first };
  }
  return { ok: true };
};

/** fixed, non-LLM reply for a rejected change request (spec §5) */
export const READ_ONLY_MESSAGE =
  "The AI assistant is read-only and can't delete or change anything.";
