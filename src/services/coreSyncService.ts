// services/coreSyncService.ts  (Candidate Service)
import axios from "axios";

const CORE_SERVICE_URL = process.env.CORE_SERVICE_URL;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

export interface CoreSyncPayload {
  candidateServiceId: string;
  requirementId: string;
  recruiterId: string;
  assignmentId?: string | null;
  fullName: string;
  email: string;
  phone?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  totalExpYears?: number | null;
  topSkills?: string[];
  resumeUrl?: string | null;
  rawSnapshot?: Record<string, unknown>;
}

export async function syncCandidateToCore(
  payload: CoreSyncPayload
): Promise<void> {
  if (!CORE_SERVICE_URL || !INTERNAL_SECRET) return;

  try {
    await axios.post(`${CORE_SERVICE_URL}/internal/candidates/sync`, payload, {
      headers: { "x-internal-secret": INTERNAL_SECRET },
      timeout: 8_000,
    });
  } catch {
    // non-fatal — ingest already succeeded
  }
}
