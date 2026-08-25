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

// NEW — live, unfrozen activity for a single recruiter, single day. Meant
// specifically for "today", which has no reconciled snapshot yet (and, given
// the real upload pattern — yesterday's report gets uploaded the next
// morning — never will while it's still today).
export interface LiveActivityRow {
  ats: number;
  profilesViewed: number;
  phonesRevealed: number;
  cvsDownloaded: number;
  completeProfiles: number;
}

export async function fetchLiveActivity(
  recruiterId: string,
  date: string,
): Promise<LiveActivityRow | null> {
  const res = await fetch(
    `${process.env.CANDIDATE_SERVICE}/api/internal/naukri/live-activity?recruiterId=${recruiterId}&date=${date}`,
    {
      method: "GET",
      headers: {
        "x-internal-token": process.env.INTERNAL_SERVICE_TOKEN ?? "",
      },
    },
  );
  if (!res.ok) return null; // non-fatal — /naukri/me falls back to whatever it already had
  return res.json();
}

// NEW — sends a recruiter's reason over to candidate-service, so it lands on
// the NaukriReconciliationDaily row the admin's naukri-logs page actually
// reads (and, from there, into the Excel export). Called right after
// saveReason writes the reason into core's own NaukriRecruiterDaily — this
// is just the mirror-over step, not the source of truth for the reason.
export async function postReasonToCandidateService(
  recruiterId: string,
  reportDate: string,
  reason: string,
): Promise<void> {
  try {
    const res = await fetch(
      `${process.env.CANDIDATE_SERVICE}/api/internal/naukri/reason`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": process.env.INTERNAL_SERVICE_TOKEN ?? "",
        },
        body: JSON.stringify({ recruiterId, reportDate, reason }),
      },
    );
    if (!res.ok) {
      console.error(
        `Failed to mirror reason to candidate-service: ${res.status} ${await res.text()}`,
      );
    }
  } catch (err: any) {
    // non-fatal — the reason is already safely saved in core's own
    // NaukriRecruiterDaily either way; don't let this break the recruiter's
    // submission if candidate-service is briefly unreachable
    console.error(
      `Error mirroring reason to candidate-service: ${err.message}`,
    );
  }
}
