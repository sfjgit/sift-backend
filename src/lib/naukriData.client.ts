// File: naukriData.client.ts

import { config } from "dotenv";

// Path: core-service/src/clients/naukriData.client.ts
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
}

export async function fetchReconciliation(
  recruiterIds: string[],
  from: string,
  to: string
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
    }
  );
  if (!res.ok)
    throw new Error(
      `candidate recon failed: ${res.status} ${await res.text()}`
    );
  return res.json();
}
