// File: csr.ts
// Path: src/config/csr.ts
//
// CSR reference data the code relies on. Schedule VII of the Companies Act lists
// the activities CSR money may go to; they are seeded as PROGRAM_SECTOR lookups
// (labels stay admin-editable) and the pipeline's free-text sectors are matched
// to them by keyword.

export const SCHEDULE_VII_SECTORS: { code: string; label: string; keywords: RegExp }[] = [
  {
    code: "HEALTH",
    label: "Hunger, poverty, health care, sanitation & drinking water",
    keywords: /hunger|poverty|malnutrition|health|hospital|medical|sanitation|hygiene|drinking water|\bwash\b/i,
  },
  {
    code: "EDUCATION",
    label: "Education, vocational skills & livelihood",
    keywords: /educat|school|literacy|scholar|skill|vocational|livelihood|employab/i,
  },
  {
    code: "GENDER",
    label: "Gender equality, women empowerment & reducing inequalities",
    keywords: /gender|women|girl|orphan|old age|elderly|senior citizen|inequalit|disab|divyang/i,
  },
  {
    code: "ENVIRONMENT",
    label: "Environment, animal welfare & natural resources",
    keywords: /environment|ecolog|climate|forest|tree|plantation|animal|wildlife|biodiversity|water conservation|natural resource|renewable/i,
  },
  { code: "HERITAGE", label: "National heritage, art & culture", keywords: /heritage|culture|art\b|arts\b|craft|monument|librar/i },
  { code: "VETERANS", label: "Armed forces veterans, war widows & dependants", keywords: /veteran|armed forces|war widow|soldier|military/i },
  { code: "SPORTS", label: "Sports training & promotion", keywords: /sport|athlet|olympic|paralympic/i },
  {
    code: "RELIEF_FUNDS",
    label: "PM CARES / PM National Relief Fund & similar funds",
    keywords: /pm cares|relief fund|national relief|prime minister/i,
  },
  { code: "RESEARCH", label: "Technology incubators & research", keywords: /incubat|research|r&d|innovation|science|technolog/i },
  { code: "RURAL", label: "Rural development", keywords: /rural|village|gram|agricultur|farmer/i },
  { code: "SLUM", label: "Slum area development", keywords: /slum|urban poor/i },
  { code: "DISASTER", label: "Disaster management & relief", keywords: /disaster|flood|cyclone|earthquake|covid|pandemic|relief|rehabilitat/i },
];

export const OTHER_SECTOR = { code: "OTHER", label: "Other" };

/** Schedule VII codes a free-text sector mentions ("Education & healthcare" → both) */
export const matchSectorCodes = (text?: string | null): string[] =>
  text ? SCHEDULE_VII_SECTORS.filter((s) => s.keywords.test(text)).map((s) => s.code) : [];

/** MCA CSR-1 registration number of an implementing agency */
export const CSR_REGISTRATION_NO = /^CSR\d{8}$/;
