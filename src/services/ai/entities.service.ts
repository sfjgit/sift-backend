// File: entities.service.ts
// Path: src/services/ai/entities.service.ts
//
// T1 — entity extraction + masking (spec §3). Pure read, runs BEFORE the
// destructive guard so a DB value ("Closed", a client called "Delete Logistics")
// becomes a {placeholder} and can't trip it.
//
// What the LLM gets: the masked text and each placeholder's KIND ("industry",
// "user", "date") — never the label, never an id. Ids are put back in on the
// server after the LLM answers (resolve.ts → substitute).
//
// Matching: a per-tenant dictionary (lowercased label → entity) is scanned with
// word n-grams, longest first — cheap even with thousands of client names.
// Labels of 3 characters or fewer ("IT", "CSR") only match in the same case.

import { aiDb } from "@/config/aiDb";
import { currentTenantId } from "@/utils/prisma/tenant";

export type EntityKind =
  | `lookup:${string}`
  | "business_unit"
  | "service_line"
  | "department"
  | "user"
  | "client"
  | "date_range"
  | "fy"
  /** a place as the user said it ("Bangalore") — reports match its other spellings */
  | "city"
  | "state";

export interface Entity {
  /** placeholder as it appears in the masked text, e.g. "{industry_1}" */
  ph: string;
  kind: EntityKind;
  /** the id (lookup / BU / user / client), the FY ("2024-25"), or unused for dates */
  value?: string;
  from?: string; // date_range, YYYY-MM-DD
  to?: string;
  /** shown to the user in the reply ("Banking"), never sent to the LLM */
  label: string;
}

export interface Extraction {
  masked: string;
  entities: Entity[];
}

interface DictEntry {
  kind: EntityKind;
  value: string;
  label: string;
  caseSensitive: boolean;
}

// ── dictionary per tenant, cached 5 min ──────────────────────────────────────

const TTL_MS = 5 * 60_000;
const MAX_NGRAM = 7;
const cache = new Map<string, { at: number; dict: Map<string, DictEntry> }>();

// first names that are also ordinary words never match on their own
const COMMON_WORDS = new Set([
  "show", "open", "list", "find", "all", "with", "from", "this", "that", "last", "next", "week",
  "month", "year", "today", "clients", "client", "spocs", "users", "runs", "status", "active",
  "pending", "april", "may", "june", "july", "august", "summer", "grace", "hope", "joy", "will",
  "mark", "bill", "faith", "dawn", "rose", "victor", "sunny", "honey", "lucky", "happy", "prince",
]);
// names people say that the stored addresses may spell differently
const PLACE_OTHER_NAMES: [string, "city" | "state"][] = [
  ["Bangalore", "city"], ["Bengaluru", "city"], ["Bombay", "city"], ["Mumbai", "city"], ["Madras", "city"], ["Chennai", "city"],
  ["Calcutta", "city"], ["Kolkata", "city"], ["Gurgaon", "city"], ["Gurugram", "city"], ["Pune", "city"], ["Hyderabad", "city"],
  ["Delhi", "city"], ["New Delhi", "city"], ["Noida", "city"], ["Mysore", "city"], ["Mysuru", "city"], ["Mangalore", "city"],
  ["Karnataka", "state"], ["Maharashtra", "state"], ["Tamil Nadu", "state"], ["Telangana", "state"], ["Kerala", "state"],
  ["Gujarat", "state"], ["Haryana", "state"], ["Uttar Pradesh", "state"], ["West Bengal", "state"], ["Odisha", "state"],
];

// legal suffixes dropped to make a second, shorter alias ("Infosys Limited" → "infosys")
const SUFFIX_RE =
  /\s+(limited|ltd\.?|private|pvt\.?|pvt\.? ltd\.?|private limited|llp|inc\.?|corp\.?|corporation|company|co\.?)$/i;

const slug = (lookupType: string) => lookupType.toLowerCase();
const kindSlug = (k: EntityKind) => (k.startsWith("lookup:") ? slug(k.slice(7)) : k);

// words people use to talk to the assistant — never read as a pick-list value / name,
// even when a lookup happens to be called that (there is an email source named "Report")
const COMMAND_WORDS = new Set([
  "report", "reports", "chart", "charts", "graph", "graphs", "table", "tables", "stats", "statistics", "summary",
  "dashboard", "canvas", "overview", "list", "data", "details", "detail", "breakdown", "trend", "pie", "bar", "line",
  "count", "total", "top", "new", "other", "others", "none", "unknown", "manual", "me", "my", "team", "back", "previous",
]);

const put = (dict: Map<string, DictEntry>, label: string, e: Omit<DictEntry, "caseSensitive" | "label">) => {
  const clean = label.replace(/\s+/g, " ").trim();
  if (clean.length < 2 || COMMAND_WORDS.has(clean.toLowerCase())) return;
  const key = clean.toLowerCase();
  if (!dict.has(key)) dict.set(key, { ...e, label: clean, caseSensitive: clean.length <= 3 });
};

const buildDictionary = async (): Promise<Map<string, DictEntry>> => {
  const db = aiDb();
  const [lookups, bus, sls, depts, users, clients, places] = await Promise.all([
    db.lookup.findMany({ where: { isActive: true }, select: { id: true, type: true, label: true } }),
    db.businessUnit.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true } }),
    db.serviceLine.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true } }),
    db.department.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, firstName: true, lastName: true, displayName: true },
    }),
    db.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true, shortName: true }, take: 50_000 }),
    db.clientLocation.findMany({
      where: { isActive: true },
      distinct: ["city", "district", "state"],
      select: { city: true, district: true, state: true },
      take: 20_000,
    }),
  ]);

  // priority = insertion order: people, org units, pick-lists, then clients
  const dict = new Map<string, DictEntry>();
  const firstNameCount = new Map<string, number>();
  for (const u of users) firstNameCount.set(u.firstName.toLowerCase(), (firstNameCount.get(u.firstName.toLowerCase()) ?? 0) + 1);
  for (const u of users) {
    const full = `${u.firstName} ${u.lastName}`.trim();
    put(dict, full, { kind: "user", value: u.id });
    if (u.displayName) put(dict, u.displayName, { kind: "user", value: u.id });
    const first = u.firstName.toLowerCase();
    if (first.length >= 4 && firstNameCount.get(first) === 1 && !COMMON_WORDS.has(first)) {
      put(dict, u.firstName, { kind: "user", value: u.id });
    }
  }
  for (const b of bus) {
    put(dict, b.name, { kind: "business_unit", value: b.id });
    if (b.code) put(dict, b.code, { kind: "business_unit", value: b.id });
  }
  for (const s of sls) {
    put(dict, s.name, { kind: "service_line", value: s.id });
    if (s.code) put(dict, s.code, { kind: "service_line", value: s.id });
  }
  for (const d of depts) put(dict, d.name, { kind: "department", value: d.id });
  for (const l of lookups) put(dict, l.label, { kind: `lookup:${l.type}`, value: l.id });
  // places from the clients' offices (+ old names people still say), before client names
  const placeOk = (p: string | null) => !!p && p.trim().length >= 4 && !COMMON_WORDS.has(p.trim().toLowerCase());
  for (const pl of places) {
    if (placeOk(pl.state)) put(dict, pl.state!, { kind: "state", value: pl.state!.trim() });
    for (const c of [pl.city, pl.district]) if (placeOk(c)) put(dict, c!.replace(/\s+(urban|rural)$/i, ""), { kind: "city", value: c!.replace(/\s+(urban|rural)$/i, "").trim() });
  }
  for (const alt of PLACE_OTHER_NAMES) put(dict, alt[0], { kind: alt[1], value: alt[0] });
  // leading words of a client's name, 2+ words, when only that client starts that way
  const prefixOwners = new Map<string, Set<string>>();
  const words = (name: string) => name.replace(SUFFIX_RE, "").replace(SUFFIX_RE, "").toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, " ").trim().split(" ");
  for (const c of clients) {
    const w = words(c.name);
    for (let n = 2; n < w.length; n++) {
      const k = w.slice(0, n).join(" ");
      if (!prefixOwners.has(k)) prefixOwners.set(k, new Set());
      prefixOwners.get(k)!.add(c.id);
    }
  }
  for (const c of clients) {
    put(dict, c.name, { kind: "client", value: c.id });
    const short = c.name.replace(SUFFIX_RE, "").trim();
    if (short.length >= 4 && short !== c.name) put(dict, short, { kind: "client", value: c.id });
    if (c.shortName && c.shortName.length >= 3) put(dict, c.shortName, { kind: "client", value: c.id });
  }
  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  for (const [k, owners] of prefixOwners) {
    if (owners.size !== 1 || k.length < 6) continue;
    const id = [...owners][0]!;
    const name = nameById.get(id)!;
    put(dict, k, { kind: "client", value: id });
    // shown as the real name, not the words typed
    const e = dict.get(k);
    if (e && e.value === id) e.label = name;
  }
  return dict;
};

const dictionary = async () => {
  const key = currentTenantId() ?? "_";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.dict;
  const dict = await buildDictionary();
  cache.set(key, { at: Date.now(), dict });
  return dict;
};

/** drop a tenant's dictionary (after lookups / users change) — optional, TTL covers it */
export const forgetEntityCache = (tenantId?: string) => (tenantId ? cache.delete(tenantId) : cache.clear());

// ── dates ────────────────────────────────────────────────────────────────────

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIndex = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.slice(0, 3)));

type DateHit = { re: RegExp; make: (m: RegExpMatchArray, now: Date) => { from: string; to: string } | { fy: string } };

const startOfWeek = (d: Date) => {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
/** the FY as CSR figures store it: 2025 → "2025-2026" */
const fyLabel = (startYear: number) => `${startYear}-${startYear + 1}`;
/** the FY that is running now (April–March) */
const currentFyStart = (n: Date) => (n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1);
/** "2025" + "26" / "2026" → the second year really follows the first */
const follows = (a: number, b: string) => (b.length === 2 ? Number(b) === (a + 1) % 100 : Number(b) === a + 1);

// the request is about CSR money → "this year" means a financial year, not the calendar
const CSR_CONTEXT = /\b(csr|spent|spend|spends|spending|budget|budgets|obligation|unspent|programmes?|programs?|financials?|figures?)\b/i;

// "CSR spent / budget / programmes" — here CSR is the money, not a service line or lookup called "CSR"
const CSR_MONEY = /\b(spent|spend|spends|spending|budget|budgets|obligation|unspent|programmes?|programs?|financials?|figures?|activities|activity|projects?)\b/i;

// financial years — read before the calendar patterns
const FY_PATTERNS: { re: RegExp; csrOnly?: boolean; make: (m: RegExpMatchArray, now: Date) => { fy: string; label: string } | null }[] = [
  {
    re: /\b(?:this|current|running) (?:fy|financial year)\b/i,
    make: (_, n) => ({ fy: fyLabel(currentFyStart(n)), label: `FY ${currentFyStart(n)}-${String((currentFyStart(n) + 1) % 100).padStart(2, "0")} (current)` }),
  },
  {
    re: /\b(?:last|previous|prev|past) (?:fy|financial year)\b/i,
    make: (_, n) => ({ fy: fyLabel(currentFyStart(n) - 1), label: `FY ${currentFyStart(n) - 1}-${String(currentFyStart(n) % 100).padStart(2, "0")}` }),
  },
  // CSR is reported after the year ends: "CSR spent this year" = the latest FULL year (2025-26 in Nov 2026),
  // "last year" = the one before. The running year is asked for as "this FY" / "current financial year".
  {
    re: /\b(?:this|current) year\b/i,
    csrOnly: true,
    make: (_, n) => {
      const y = currentFyStart(n) - 1;
      return { fy: fyLabel(y), label: `FY ${y}-${String((y + 1) % 100).padStart(2, "0")} (latest full year)` };
    },
  },
  {
    re: /\b(?:last|previous) year\b/i,
    csrOnly: true,
    make: (_, n) => {
      const y = currentFyStart(n) - 2;
      return { fy: fyLabel(y), label: `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}` };
    },
  },
  // "2025-26", "2025 26", "2025-2026", "2025 to 2026"
  {
    re: /\b(20\d{2})\s*(?:-|\/|–|to|\s)\s*(20\d{2}|\d{2})\b(?![-/]\d)/i,
    make: (m) => (follows(Number(m[1]), m[2]!) ? { fy: fyLabel(Number(m[1])), label: `FY ${m[1]}-${m[2]!.slice(-2)}` } : null),
  },
  // "25-26" — only when the talk is about CSR money
  {
    re: /\b(\d{2})\s?[-/]\s?(\d{2})\b(?![-/]\d)/,
    csrOnly: true,
    make: (m) => (follows(2000 + Number(m[1]), m[2]!) ? { fy: fyLabel(2000 + Number(m[1])), label: `FY ${m[1]}-${m[2]}` } : null),
  },
];


const DATE_PATTERNS: DateHit[] = [
  { re: /\btoday\b/i, make: (_, n) => ({ from: iso(n), to: iso(n) }) },
  { re: /\byesterday\b/i, make: (_, n) => ({ from: iso(addDays(n, -1)), to: iso(addDays(n, -1)) }) },
  { re: /\bthis week\b/i, make: (_, n) => ({ from: iso(startOfWeek(n)), to: iso(n) }) },
  { re: /\blast week\b/i, make: (_, n) => ({ from: iso(addDays(startOfWeek(n), -7)), to: iso(addDays(startOfWeek(n), -1)) }) },
  { re: /\bthis month\b/i, make: (_, n) => ({ from: iso(new Date(n.getFullYear(), n.getMonth(), 1)), to: iso(n) }) },
  {
    re: /\blast month\b/i,
    make: (_, n) => ({ from: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), to: iso(new Date(n.getFullYear(), n.getMonth(), 0)) }),
  },
  { re: /\bthis year\b/i, make: (_, n) => ({ from: `${n.getFullYear()}-01-01`, to: iso(n) }) },
  { re: /\blast year\b/i, make: (_, n) => ({ from: `${n.getFullYear() - 1}-01-01`, to: `${n.getFullYear() - 1}-12-31` }) },
  {
    re: /\b(?:in the )?(?:last|past) (\d{1,3}) (day|week|month)s?\b/i,
    make: (m, n) => {
      const k = Number(m[1]);
      const unit = m[2]!.toLowerCase();
      const from = unit === "day" ? addDays(n, -k) : unit === "week" ? addDays(n, -7 * k) : new Date(n.getFullYear(), n.getMonth() - k, n.getDate());
      return { from: iso(from), to: iso(n) };
    },
  },
  {
    re: /\bfy\s?'?(\d{2}|\d{4})(?:\s?[-/]\s?(\d{2}|\d{4}))?\b/i,
    make: (m) => {
      const a = Number(m[1]!.length === 2 ? `20${m[1]}` : m[1]);
      // "FY25" alone = the year ending in 2025 (2024-25); "FY 2024-25" = starts 2024
      return { fy: fyLabel(m[2] ? a : a - 1) };
    },
  },
  {
    re: new RegExp(`\\b(since|after|from|before|until|till|in|during) ${MON_RE}(?:,? (20\\d{2}))?\\b`, "i"),
    make: (m, n) => {
      const mi = monthIndex(m[2]!.toLowerCase());
      let y = m[3] ? Number(m[3]) : n.getFullYear();
      if (!m[3] && mi > n.getMonth()) y -= 1; // "since November" in March → last November
      const first = new Date(y, mi, 1);
      const last = new Date(y, mi + 1, 0);
      const w = m[1]!.toLowerCase();
      if (w === "since" || w === "after" || w === "from") return { from: iso(first), to: iso(n) };
      if (w === "before" || w === "until" || w === "till") return { from: "2000-01-01", to: iso(addDays(first, -1)) };
      return { from: iso(first), to: iso(last) };
    },
  },
  {
    re: new RegExp(`\\b${MON_RE} (20\\d{2})\\b`, "i"),
    make: (m) => {
      const mi = monthIndex(m[1]!.toLowerCase());
      const y = Number(m[2]);
      return { from: iso(new Date(y, mi, 1)), to: iso(new Date(y, mi + 1, 0)) };
    },
  },
];

// ── extraction ───────────────────────────────────────────────────────────────

/** places = read city / state names too (the report canvas, whose queries filter by them) */
export const extractEntities = async (input: string, now = new Date(), opts: { places?: boolean } = {}): Promise<Extraction> => {
  const entities: Entity[] = [];
  const counters = new Map<string, number>();
  const next = (kind: EntityKind) => {
    const s = kindSlug(kind);
    const n = (counters.get(s) ?? 0) + 1;
    counters.set(s, n);
    return `{${s}_${n}}`;
  };

  // 1. dates first (they contain ordinary words like "may") — financial years before calendar ones
  let text = input.replace(/\s+/g, " ").trim().replace(/[{}]/g, "");
  const csr = CSR_CONTEXT.test(text);
  for (const p of FY_PATTERNS) {
    if (p.csrOnly && !csr) continue;
    let from = 0;
    for (;;) {
      const m = text.slice(from).match(p.re);
      if (!m || m.index === undefined) break;
      const at = from + m.index;
      const made = p.make(m, now);
      if (!made) {
        from = at + m[0].length; // "2025 30" is not a year pair — look further on
        continue;
      }
      const ph = next("fy");
      entities.push({ ph, kind: "fy", value: made.fy, label: made.label });
      text = `${text.slice(0, at)}${ph}${text.slice(at + m[0].length)}`;
      from = at + ph.length;
    }
  }
  for (const p of DATE_PATTERNS) {
    for (;;) {
      const m = text.match(p.re);
      if (!m || m.index === undefined) break;
      const made = p.make(m, now);
      const kind: EntityKind = "fy" in made ? "fy" : "date_range";
      const ph = next(kind);
      entities.push(
        "fy" in made ? { ph, kind, value: made.fy, label: `FY ${made.fy}` } : { ph, kind, from: made.from, to: made.to, label: m[0] },
      );
      // keep the preposition of "since March" so the sentence still reads
      text = `${text.slice(0, m.index)}${ph}${text.slice(m.index + m[0].length)}`;
    }
  }

  // 2. dictionary entities, longest n-gram first
  const dict = await dictionary();
  const moneyTalk = CSR_MONEY.test(text);
  const tokens = text.split(" ");
  const out: string[] = [];
  const seen = new Map<string, string>(); // kind:value → placeholder (same thing twice = same ph)
  for (let i = 0; i < tokens.length; ) {
    let matched = 0;
    for (let n = Math.min(MAX_NGRAM, tokens.length - i); n >= 1; n--) {
      const raw = tokens.slice(i, i + n).join(" ");
      const trimmed = raw.replace(/^[("'“]+|[)"'”.,;:!?]+$/g, "");
      if (!trimmed || trimmed.startsWith("{")) continue;
      const hit = dict.get(trimmed.toLowerCase());
      if (!hit || (hit.caseSensitive && trimmed !== hit.label)) continue;
      if (trimmed.toLowerCase() === "csr" && moneyTalk) continue;
      if ((hit.kind === "city" || hit.kind === "state") && !opts.places) continue;
      const key = `${hit.kind}:${hit.value}`;
      let ph = seen.get(key);
      if (!ph) {
        ph = next(hit.kind);
        seen.set(key, ph);
        entities.push({ ph, kind: hit.kind, value: hit.value, label: hit.label });
      }
      const tail = raw.slice(raw.indexOf(trimmed) + trimmed.length);
      out.push(ph + tail);
      matched = n;
      break;
    }
    if (matched) i += matched;
    else out.push(tokens[i++]!);
  }
  return { masked: out.join(" "), entities };
};

/** "show {industry_1} clients" → kinds the LLM may see: [{ ph, kind }] */
export const entityHints = (entities: Entity[]) =>
  entities.map((e) => ({ placeholder: e.ph, kind: e.kind.startsWith("lookup:") ? `pick-list ${e.kind.slice(7)}` : e.kind }));
