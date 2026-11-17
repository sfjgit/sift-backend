// File: glossary.ts
// Path: src/services/ai/glossary.ts
//
// "What is CSR obligation?" — the words the CRM uses, answered in plain words
// without an AI call. `figure` finds the matching numbers on the canvas on
// screen, so the answer can say "for this client it is …".

export interface Term {
  term: string;
  /** what the user may call it */
  re: RegExp;
  /** a block title / series label carrying this figure */
  figure?: RegExp;
  text: string;
}

export const GLOSSARY: Term[] = [
  {
    term: "CSR obligation",
    re: /\b(csr )?(obligation|prescribed csr|mandatory csr|2 ?% (rule|spend))\b/i,
    figure: /obligation/i,
    text: "the amount a company must spend on CSR in a financial year — 2% of its average net profit of the three years before (Companies Act 2013, section 135). It applies to companies with net worth of ₹500 crore or more, turnover of ₹1,000 crore or more, or net profit of ₹5 crore or more.",
  },
  {
    term: "CSR budget",
    re: /\b(csr )?(budget|allocation|allocated|outlay)\b/i,
    figure: /budget/i,
    text: "what the company's board set aside for CSR that year. It can be more than the obligation; it is the plan, not what was spent.",
  },
  {
    term: "CSR spent",
    re: /\b(csr )?(spent|spend|spending|expenditure|amount spent)\b/i,
    figure: /spent|spend/i,
    text: "what the company actually spent on CSR projects in the year (admin overheads count up to 5%). It can be above the obligation — the extra may be set off in the next three years.",
  },
  {
    term: "Unspent CSR",
    re: /\b(unspent|unspent csr|unspent account|carry ?forward)\b/i,
    figure: /unspent/i,
    text: "the part of the obligation not spent in the year. For ongoing projects it goes to an Unspent CSR Account within 30 days of the year end and must be used within 3 years; otherwise it goes to a Schedule VII fund (e.g. PM CARES) within 6 months.",
  },
  {
    term: "Schedule VII",
    re: /\b(schedule (vii|7)|csr sectors?|csr activities)\b/i,
    text: "the list of activities CSR money may be spent on — education, health, skilling and livelihood, environment, rural development, women and children, sports, disaster relief and others.",
  },
  {
    term: "Implementing agency",
    re: /\b(implementing agenc(y|ies)|implementor|csr-?1)\b/i,
    text: "an NGO, trust or foundation, registered with the government (form CSR-1), that runs CSR programmes for a company.",
  },
  {
    term: "Financial year (FY)",
    re: /\b(fy|financial year)\b/i,
    text: "April to March. FY 2025-26 runs from 1 April 2025 to 31 March 2026. CSR figures are reported after the year ends, so the latest full year is usually the one before the running year.",
  },
  {
    term: "SPOC",
    re: /\bspocs?\b/i,
    figure: /spoc/i,
    text: "single point of contact — a person at the client we talk to (CSR head, foundation head, HR head and so on).",
  },
  {
    term: "Not set",
    re: /\bnot set\b/i,
    figure: /status/i,
    text: "nobody has chosen a value yet — for a SPOC's sales status it means no one has recorded where the conversation stands.",
  },
  {
    term: "Data quality band",
    re: /\b(data quality|validation band|band|score)\b/i,
    figure: /quality|band/i,
    text: "how sure we are that a SPOC's contact details are right — High, Medium or Low, from the checks the pipeline ran (email, LinkedIn, current company).",
  },
];

const ASK = /^(what|whats|what's|wat|define|meaning|explain|tell me|how (is|are) .{0,40}(calculated|worked out|decided))\b/i;
const FILLER = /\b(what|whats|what's|wat|is|are|the|a|an|does|do|mean|means|meaning|of|define|explain|tell|me|about|by|term|word|this|in|csr|please|pls|how|calculated|worked|out|decided|exactly)\b/gi;

/** a "what is X" question about a CRM word — only when nothing else is asked */
export const definitionAsked = (text: string): Term | null => {
  const t = text.trim().replace(/[?!.]+$/, "");
  if (!ASK.test(t) || t.split(/\s+/).length > 9) return null;
  const hit = GLOSSARY.find((g) => g.re.test(t));
  if (!hit) return null;
  // whatever is left after the term and the question words must be empty
  const rest = t.replace(hit.re, " ").replace(FILLER, " ").replace(/[^a-z0-9]+/gi, " ").trim();
  return rest ? null : hit;
};

/** the term a data question touches ("what is TCS's obligation") — for a one-line definition */
export const termIn = (text: string): Term | null => GLOSSARY.find((g) => g.figure && g.re.test(text)) ?? null;
