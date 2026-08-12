// File: naukriData.client.ts
// Path: core-service/src/clients/naukriData.client.ts

import { config } from "dotenv";

config();

export interface ReconRow {
  recruiterId: string;
  reportDate: string;
  recruiterName: string | null;
  bu: string | null;
  rm: string | null;
  naukriCvConsumed: number | null;
  atsCaptured: number;
  difference: number | null;
  flags: string[];
  fillStatus: string;
  atsBySource: Record<string, number>;
  // NEW — 3-step activity breakdown. candidate-service's internal
  // reconciliation endpoint now includes these in its select (previously
  // silently dropped even though the columns existed on the table).
  naukriProfilesViewed: number;
  naukriPhonesRevealed: number;
  naukriCvsDownloaded: number;
  completeProfilesCaptured: number;
}

export async function fetchReconciliation(
  recruiterIds: string[],
  from: string,
  to: string,
): Promise<ReconRow[]> {
  if (recruiterIds.length === 0) return [];
  const res = await fetch(
    `${process.env.CANDIDATE_SERVICE}/api/internal/naukri/reconciliation`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": process.env.INTERNAL_SERVICE_TOKEN ?? "",
      },
      body: JSON.stringify({ recruiterIds, from, to }),
    },
  );
  if (!res.ok)
    throw new Error(
      `candidate recon failed: ${res.status} ${await res.text()}`,
    );
  return res.json();
}
