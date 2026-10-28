// File: resultNote.ts
// Path: src/services/pipeline/resultNote.ts
//
// One plain line for a finished run, shown on its step card and in run lists:
// "3 SPOCs scored", "2 reports saved", "18 programmes · 2 years of figures to check".

type Counts = Record<string, number | undefined>;

const n = (v: unknown) => (typeof v === "number" ? v : 0);
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const resultNote = (stepKey: string, summary: Record<string, unknown>): string | null => {
  const spocs = (summary.spocs ?? {}) as Counts;
  const fin = (summary.financials ?? {}) as Counts;
  const parts: string[] = [];

  if (stepKey === "validate") {
    const scored = n(spocs.updated) + n(spocs.created);
    if (scored) parts.push(`${plural(scored, "SPOC")} scored`);
  } else {
    if (n(spocs.created)) parts.push(`${plural(n(spocs.created), "new SPOC")} to approve`);
    if (n(spocs.updated)) parts.push(`${plural(n(spocs.updated), "SPOC")} updated`);
  }
  if (n((summary.documents as Counts)?.saved)) parts.push(`${plural(n((summary.documents as Counts).saved), "report")} saved`);
  if (n(fin.saved)) parts.push(`${plural(n(fin.saved), "year")} of figures saved`);
  if (n(fin.flagged)) parts.push(`${plural(n(fin.flagged), "year")} of figures to check`);
  if (n((summary.programs as Counts)?.saved)) parts.push(plural(n((summary.programs as Counts).saved), "programme"));
  if (n((summary.outreach as Counts)?.packs)) parts.push(`${plural(n((summary.outreach as Counts).packs), "email pack")} written`);

  if (!parts.length && n(spocs.unchanged)) parts.push(`${plural(n(spocs.unchanged), "SPOC")} checked, nothing new`);

  return parts.length ? parts.join(" · ").slice(0, 300) : null;
};
