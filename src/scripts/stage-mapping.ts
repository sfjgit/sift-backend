// File: stage-mapping.ts
// Path: src/migration/stage-mapping.ts
//
// There are only ~40 distinct (Stage, Substage) combinations across all
// 97,832 candidate rows. Rather than flagging every one of 97k rows for
// manual review, this file maps each distinct combination ONCE. Review
// this file (it's short), fix anything wrong, then migrate-candidates.ts
// applies it deterministically to every row.
//
// Rows marked needsReview: true are my best guess from the label alone —
// double check those specifically. Everything else is fairly unambiguous.
//
// Key format: "Stage|||Substage" (exact strings as they appear in the xlsx,
// case-sensitive on purpose so you can see typos/inconsistent casing in the
// source data, e.g. "on hold" vs "On Hold" are BOTH present in the real file
// and both mapped below).

import { CanonicalStage, CandidateDisposition } from "@prisma/client";

export interface StageMapping {
  canonicalStage: CanonicalStage;
  disposition: CandidateDisposition;
  dropReason?: string; // matches DropReason enum, only set when disposition is DROPPED
  isRejected?: boolean;
  isOnHold?: boolean;
  isWithdrawn?: boolean;
  needsReview?: boolean; // true = I guessed, verify this one
}

export const STAGE_MAPPING: Record<string, StageMapping> = {
  "Source|||Candidate Pool": {
    canonicalStage: "SOURCED",
    disposition: "ACTIVE",
  },

  "Submission|||Submitted to Client": {
    canonicalStage: "SUBMMITED",
    disposition: "ACTIVE",
  },
  "Submission|||Rejected by Client": {
    canonicalStage: "REJECTED",
    disposition: "DROPPED",
    dropReason: "CLIENT_REJECTED",
    isRejected: true,
  },
  "Submission|||Client Duplicate": {
    canonicalStage: "DROPPED",
    disposition: "DUPLICATE",
  },
  "Submission|||On Hold": {
    canonicalStage: "SUBMMITED",
    disposition: "ON_HOLD",
    isOnHold: true,
  },
  "Submission|||on hold": {
    canonicalStage: "SUBMMITED",
    disposition: "ON_HOLD",
    isOnHold: true,
  }, // source data has both casings
  "Submission|||Shortlisted by Client": {
    canonicalStage: "SHORTLISTED",
    disposition: "ACTIVE",
  },
  "Submission|||Submitted  for Interview": {
    canonicalStage: "SUBMMITED",
    disposition: "ACTIVE",
  },
  "Submission|||Rejected by Client / CSM": {
    canonicalStage: "REJECTED",
    disposition: "DROPPED",
    dropReason: "CLIENT_REJECTED",
    isRejected: true,
  },
  "Submission|||Shortlisted by Client / CSM": {
    canonicalStage: "SHORTLISTED",
    disposition: "ACTIVE",
  },

  "Screening|||Rejected by Lead": {
    canonicalStage: "REJECTED",
    disposition: "DROPPED",
    dropReason: "OTHER",
    isRejected: true,
  },
  "Screening|||Interested Candidate /Internal Submission": {
    canonicalStage: "SCREENING",
    disposition: "ACTIVE",
  },
  "Screening|||L1": {
    canonicalStage: "SCREENING",
    disposition: "ACTIVE",
    needsReview: true,
  },
  "Screening|||Internal Shortlist": {
    canonicalStage: "SHORTLISTED",
    disposition: "ACTIVE",
  },
  "Screening|||Phone Screen": {
    canonicalStage: "SCREENING",
    disposition: "ACTIVE",
  },
  "Screening|||Screened as per JD": {
    canonicalStage: "SCREENING",
    disposition: "ACTIVE",
  },
  "Screening|||Selected by Lead": {
    canonicalStage: "SHORTLISTED",
    disposition: "ACTIVE",
  },

  "Interview|||First Interview - Rejected": {
    canonicalStage: "REJECTED",
    disposition: "DROPPED",
    dropReason: "CLIENT_REJECTED",
    isRejected: true,
  },
  "Interview|||First Interview Scheduled (L1)": {
    canonicalStage: "INTERVIEW",
    disposition: "ACTIVE",
  },
  "Interview|||Second Interview - Rejected": {
    canonicalStage: "REJECTED",
    disposition: "DROPPED",
    dropReason: "CLIENT_REJECTED",
    isRejected: true,
  },
  "Interview|||First Interview – Rescheduled": {
    canonicalStage: "INTERVIEW",
    disposition: "ACTIVE",
  },
  "Interview|||First Interview - Shortlisted": {
    canonicalStage: "SHORTLISTED",
    disposition: "ACTIVE",
  },
  "Interview|||HR Interview - Rejected": {
    canonicalStage: "REJECTED",
    disposition: "DROPPED",
    dropReason: "CLIENT_REJECTED",
    isRejected: true,
  },
  "Interview|||Second Interview Scheduled (L2)": {
    canonicalStage: "INTERVIEW",
    disposition: "ACTIVE",
  },
  "Interview|||Second Interview - Shortlisted": {
    canonicalStage: "SHORTLISTED",
    disposition: "ACTIVE",
  },
  "Interview|||Final Select": {
    canonicalStage: "SHORTLISTED",
    disposition: "ACTIVE",
    needsReview: true,
  },
  "Interview|||Final Interview": {
    canonicalStage: "INTERVIEW",
    disposition: "ACTIVE",
  },
  "Interview|||L1 Select": {
    canonicalStage: "SHORTLISTED",
    disposition: "ACTIVE",
    needsReview: true,
  },
  "Interview|||L1 Reject": {
    canonicalStage: "REJECTED",
    disposition: "DROPPED",
    dropReason: "CLIENT_REJECTED",
    isRejected: true,
    needsReview: true,
  },

  "Offer|||Offer Declined": {
    canonicalStage: "DECLINED",
    disposition: "DROPPED",
    dropReason: "CANDIDATE_DECLINED",
  },
  "Offer|||Document Required": {
    canonicalStage: "OFFER_IN_PROGRESS",
    disposition: "ACTIVE",
  },
  "Offer|||offer": { canonicalStage: "OFFERED", disposition: "ACTIVE" },
  "Offer|||Client Select": {
    canonicalStage: "OFFERED",
    disposition: "ACTIVE",
    needsReview: true,
  },
  "Offer|||Offer Rejected": {
    canonicalStage: "DECLINED",
    disposition: "DROPPED",
    dropReason: "CANDIDATE_DECLINED",
  },
  "Offer|||Not Joined": {
    canonicalStage: "DROPPED",
    disposition: "DROPPED",
    dropReason: "NO_SHOW",
    needsReview: true, // "not joined" could also mean OFFER_EXPIRED — check a few of these manually
  },
  "Offer|||Offer Accepted": {
    canonicalStage: "OFFERED",
    disposition: "ACTIVE",
  },
  "Offer|||NDA Discussion": {
    canonicalStage: "OFFER_IN_PROGRESS",
    disposition: "ACTIVE",
  },
  "Offer|||NDA Released": {
    canonicalStage: "OFFER_IN_PROGRESS",
    disposition: "ACTIVE",
  },
  "Offer|||Document": {
    canonicalStage: "OFFER_IN_PROGRESS",
    disposition: "ACTIVE",
  },
  "Offer|||Training Started": {
    canonicalStage: "JOINED",
    disposition: "PLACED",
    needsReview: true, // guessing "training started" = joined - confirm this is right for your client
  },

  "Hire|||Hired": { canonicalStage: "HIRED", disposition: "PLACED" },
};

/** Build the lookup key the same way for both this table and the migration script. */
export function stageKey(
  stage: string | null,
  substage: string | null
): string {
  return `${stage ?? ""}|||${substage ?? ""}`;
}
