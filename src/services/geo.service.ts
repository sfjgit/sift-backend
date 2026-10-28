// File: geo.service.ts
// Path: src/services/geo.service.ts
//
// Countries → states → cities from the bundled country-state-city data (250
// countries, ISO codes). Everything in the CRM stores the plain names
// ("India", "Karnataka", "Bengaluru"); lookups here accept names or codes.
// normaliseLocation() turns what people type ("BANGALORE.", "bombay") into
// those names — used on save and by the one-off cleanup script.

import { City, Country, State } from "country-state-city";

export type GeoCountry = { code: string; name: string };
export type GeoState = { code: string; name: string; country: string; countryCode: string };
export type GeoCity = { name: string; state: string; country: string };

const key = (s: string) => s.trim().toLowerCase().replace(/[.\s]+$/g, "").replace(/\s+/g, " ");

// India first, then A–Z
const COUNTRIES: GeoCountry[] = Country.getAllCountries()
  .map((c) => ({ code: c.isoCode, name: c.name }))
  .sort((a, b) => (a.code === "IN" ? -1 : b.code === "IN" ? 1 : a.name.localeCompare(b.name)));

const countryBy = new Map<string, GeoCountry>();
for (const c of COUNTRIES) {
  countryBy.set(key(c.name), c);
  countryBy.set(key(c.code), c);
}
// common spellings people use
for (const [alias, code] of [["usa", "US"], ["us", "US"], ["united states of america", "US"], ["uk", "GB"], ["england", "GB"], ["uae", "AE"]] as const) {
  countryBy.set(alias, COUNTRIES.find((c) => c.code === code)!);
}

const statesCache = new Map<string, GeoState[]>();
const statesOf = (countryCode: string): GeoState[] => {
  let s = statesCache.get(countryCode);
  if (!s) {
    const country = countryBy.get(key(countryCode))!;
    s = State.getStatesOfCountry(countryCode)
      .map((x) => ({ code: `${countryCode}-${x.isoCode}`, name: x.name, country: country.name, countryCode }))
      .sort((a, b) => a.name.localeCompare(b.name));
    statesCache.set(countryCode, s);
  }
  return s;
};

const citiesCache = new Map<string, GeoCity[]>();
const citiesOf = (st: GeoState): GeoCity[] => {
  let c = citiesCache.get(st.code);
  if (!c) {
    const seen = new Set<string>();
    c = [];
    for (const x of City.getCitiesOfState(st.countryCode, st.code.split("-").slice(1).join("-"))) {
      if (seen.has(key(x.name))) continue; // the data repeats some cities
      seen.add(key(x.name));
      c.push({ name: x.name, state: st.name, country: st.country });
    }
    c.sort((a, b) => a.name.localeCompare(b.name));
    citiesCache.set(st.code, c);
  }
  return c;
};

export const findCountry = (v?: string | null) => (v ? countryBy.get(key(v)) : undefined);

const findState = (v: string, countryCodes: string[]) => {
  const k = key(v);
  for (const cc of countryCodes) {
    const hit = statesOf(cc).find((s) => key(s.name) === k || key(s.code) === k || key(s.code.split("-")[1]!) === k);
    if (hit) return hit;
  }
  return undefined;
};

const matches = (name: string, q?: string) => !q || name.toLowerCase().includes(q.toLowerCase());

// ── lists for pickers / filters ──────────────────────────────────────────────

export const listCountries = (q?: string) => COUNTRIES.filter((c) => matches(c.name, q) || c.code === q?.toUpperCase());

/** states of the given countries (names or codes); none given = India */
export const listStates = (countries: string[] = [], q?: string) => {
  const codes = (countries.length ? countries : ["IN"]).map((c) => findCountry(c)?.code).filter(Boolean) as string[];
  return codes.flatMap(statesOf).filter((s) => matches(s.name, q));
};

/** cities of the given states (within the given countries; none = India) */
export const listCities = (opts: {
  countries?: string[] | undefined;
  states?: string[] | undefined;
  q?: string | undefined;
  limit?: number | undefined;
}) => {
  const countryCodes = (opts.countries?.length ? opts.countries : ["IN"])
    .map((c) => findCountry(c)?.code)
    .filter(Boolean) as string[];
  const states = opts.states?.length
    ? (opts.states.map((s) => findState(s, countryCodes)).filter(Boolean) as GeoState[])
    : countryCodes.flatMap(statesOf);
  const out: GeoCity[] = [];
  const limit = opts.limit ?? 100;
  for (const st of states) {
    for (const c of citiesOf(st)) {
      if (!matches(c.name, opts.q)) continue;
      out.push(c);
      if (out.length >= limit) return out;
    }
  }
  return out;
};

// ── normalising what people type ─────────────────────────────────────────────

// old / English names → the names the data uses
const CITY_ALIASES: Record<string, string> = {
  bangalore: "Bengaluru",
  bengalooru: "Bengaluru",
  bombay: "Mumbai",
  madras: "Chennai",
  calcutta: "Kolkata",
  mangalore: "Mangaluru",
  mysore: "Mysuru",
  belgaum: "Belagavi",
  gulbarga: "Kalaburagi",
  hubli: "Hubballi",
  gurgaon: "Gurugram",
  poona: "Pune",
  baroda: "Vadodara",
  trivandrum: "Thiruvananthapuram",
  cochin: "Kochi",
  pondicherry: "Puducherry",
  benares: "Varanasi",
  "new delhi": "New Delhi",
};
const STATE_ALIASES: Record<string, string> = {
  orissa: "Odisha",
  pondicherry: "Puducherry",
  uttaranchal: "Uttarakhand",
  delhi: "Delhi",
  "nct of delhi": "Delhi",
};

// "ANEKAL TALUK" → "Anekal Taluk"; mixed case is left as typed
const tidy = (v: string) => {
  const s = v.trim().replace(/\s+/g, " ").replace(/[.,]+$/, "");
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : s;
};

export const normaliseLocation = <T extends { country?: string | null; state?: string | null; city?: string | null }>(
  loc: T,
): T => {
  const out = { ...loc };
  const country = findCountry(loc.country) ?? (loc.country ? undefined : findCountry("IN"));
  if (loc.country) out.country = country?.name ?? tidy(loc.country);
  const codes = country ? [country.code] : [];

  let state: GeoState | undefined;
  if (loc.state) {
    const raw = STATE_ALIASES[key(loc.state)] ?? loc.state;
    state = codes.length ? findState(raw, codes) : undefined;
    out.state = state?.name ?? tidy(raw);
  }
  if (loc.city) {
    const raw = CITY_ALIASES[key(loc.city)] ?? loc.city;
    const pool = state ? citiesOf(state) : codes.length ? listCities({ countries: codes, limit: 100_000 }) : [];
    const hit = pool.find((c) => key(c.name) === key(raw));
    out.city = hit?.name ?? tidy(raw);
  }
  return out;
};
