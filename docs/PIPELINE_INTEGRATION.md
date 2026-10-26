# CRM ⇄ CSR pipeline engine — integration contract

**crm-core-service is the system of record.** The Python CSR pipeline
(`AI_Agent_2_Amruta-main`) is an *engine*: it receives one job, does the
work, and reports back. It never reads or writes the CRM database, and it no
longer touches CASPA.

```
crm (browser) ─► crm-core-service ──POST /api/crm/jobs──────────► engine (FastAPI :8770)
                   ▲    Postgres = truth                            │ worker runs the stage
                   │    reconciler: dispatch retry, re-check,       │ in ws/crm/<clientId>/
                   │    timeouts, health                            │
                   └──── POST /api/svc/step-runs/:id/{events,results}┘
```

## 1. Auth

| Direction | Header | Value |
|---|---|---|
| CRM → engine | `X-Service-Key` | env var named in `ExternalService.outboundKeyEnv` (default `CSR_PIPELINE_KEY`). Engine compares with its own `CRM_SERVICE_KEY`. |
| engine → CRM | `X-Service-Key` | engine env `CRM_CALLBACK_KEY`. CRM stores only `sha256(key)` in `ExternalService.inboundKeyHash` (seed reads `CSR_PIPELINE_INBOUND_KEY`). |

Every `/api/svc/*` route also checks the service's `scopes`
(`step-runs:write`, `clients:read`) and that the run belongs to one of the
service's steps.

## 2. Steps

Catalog: `src/config/pipeline.ts` → seeded into `PipelineStep`.

| CRM key | engine stage | writes | SPOCs sent |
|---|---|---|---|
| reports | reports_spocs | documents | – |
| report_spocs | report_spocs | spocs | all active |
| figures | figures | financials, programs | – |
| enrich | enrich | spocs | all active (or `spocIds`) |
| apollo | apollo | spocs | all active (or `spocIds`) |
| validate | validate | spocs (validation) | all active (or `spocIds`) |
| emails | emails | outreach | APPROVED only (or `spocIds`, must be approved) |
| run_all | – (CRM orchestrates) | – | – |

Approval is **not** an engine step: `POST /api/spocs/approval`.

"Run all steps" is a parent `StepRun` (step `run_all`); the CRM dispatches
one child run per step, in order, **after** the previous child's results are
saved — so every step works on CRM data. A failed child is recorded and the
chain carries on; it stops before approval.

## 3. Dispatch — `POST {baseUrl}/api/crm/jobs`

```jsonc
{
  "runId": "uuid",                     // CRM StepRun id — the engine's idempotency key
  "step": "figures",                   // engine stage key
  "callbackUrl": "https://crm/api/svc/step-runs/<runId>",
  "client": {
    "id": "uuid",                      // use as caspa_id everywhere in the engine
    "name": "…", "shortName": "…", "cin": "…", "website": "…", "linkedinUrl": "…",
    "category": "…", "industry": "…", "state": "…", "district": "…",
    "legacyCaspaId": 123
  },
  "spocs": [ { "id": "uuid", "firstName": "…", "lastName": "…", "designation": "…",
               "email": "…", "phone": "…", "linkedinUrl": "…", "approvalStatus": "APPROVED",
               "validationScore": 81, "validationBand": "READY" } ],
  "context": {
    "documents":  [ { "type": "ANNUAL_REPORT", "fy": "2024-2025", "url": "presigned GET", "fileName": "…" } ],
    "financials": [ { "fy": "…", "obligationRs": 0, "budgetRs": 0, "spentRs": 0, "unspentRs": 0 } ],
    "programs":   [ { "fy": "…", "name": "…", "sector": "…", "budgetRs": 0, "locations": "…" } ]
  },
  "options": { "dryRun": false, "...": "step options (see step config)" }
}
```

Reply `202 { "jobId": "engine job id", "status": "QUEUED" }`. Same `runId`
twice → same `jobId` (no second job).

Other engine routes (all behind `X-Service-Key`):

- `GET /api/crm/jobs/{jobId}` → `{ status, progress, note, finishedAt, result? }` —
  `result` is the full results body (§5) once finished; the reconciler uses it
  when callbacks were lost.
- `POST /api/crm/jobs/{jobId}/stop` → `{ stopping: true }`
- `GET /api/crm/health` → `{ ok, worker: { online, ageSeconds }, keys: { apollo: true, … }, limits: { … }, version }`
- `POST /api/crm/keys/test` `{ provider }` → `{ ok, detail }`

## 4. Progress — `POST /api/svc/step-runs/:id/events`

```jsonc
{ "status": "RUNNING", "progress": 40, "note": "12 of 30 reports checked", "message": "optional log line" }
```

Any subset. `status` may only be `RUNNING` here. Throttle to ≤ 1 / 5 s.

## 5. Results — `POST /api/svc/step-runs/:id/results`

Sent once, at the end. Retry with backoff until `2xx`. A second delivery for
a finished run is answered `200 { duplicate: true }` and ignored.

```jsonc
{
  "status": "DONE",                    // DONE | EMPTY | FAILED | STOPPED
  "summary": { "...": "engine summary dict, shown as-is" },
  "error": { "code": "…", "message": "plain English", "howToContinue": "…" },   // FAILED only
  "costUsd": 0.42,
  "credits": { "apollo": 3, "brightdata": 2, "claude": 1 },
  "data": {
    "documents":  [ { "type": "ANNUAL_REPORT", "fy": "2024-2025", "fileKey": "s3 key", "fileName": "…",
                      "sourceUrl": "…", "sha256": "…" } ],
    "spocs":      [ { "id": "crm uuid, when it came in the job",
                      "firstName": "…", "lastName": "…", "designation": "…", "department": "…",
                      "email": "…", "emailSource": "APOLLO", "phone": "…", "linkedinUrl": "…",
                      "seniority": "…", "totalExpYears": 12.5, "currentOrgExpYears": 3,
                      "source": "REPORT",
                      "fieldSources": { "email": "apollo", "linkedin": "brightdata" },
                      "validation": { "score": 81, "band": "READY", "emailStatus": "GOOD",
                                      "checks": { "v_name": "pass", "...": "…", "suggestion": "…" } },
                      "reviewFlag": false, "reviewReason": "…", "sourceUrl": "evidence link" } ],
    "financials": [ { "fy": "2024-2025", "obligationRs": 1.2e8, "budgetRs": …, "spentRs": …, "unspentRs": …,
                      "evidence": "quote + page", "confidence": 0.9, "flagged": false, "reviewReason": "…" } ],
    "programs":   [ { "fy": "…", "name": "…", "sector": "Education", "budgetRs": …, "locations": "…",
                      "beneficiaries": "…", "implementor": "…", "sourceUrl": "…" } ],
    "outreach":   [ { "spocId": "crm uuid", "fileKey": "s3 key of the .docx", "model": "…",
                      "messages": [ { "sequenceNo": 0, "subject": "…", "body": "…" } ] } ]
  }
}
```

Money is **rupees** (the engine converts its crore figures). Only the kinds
the step may write (§2) are read; others are reported as skipped.

## 6. How the CRM saves results

| Kind | Rule |
|---|---|
| spocs | Match by `id` → email (global, lowercased) → `(client, nameKey)`. Blank fields are filled; a different existing value is **never overwritten** — it is listed in `viewData.conflicts`. Validation fields are latest-wins. An email owned by another client's SPOC → skipped. New SPOCs: handler = requester, BU/SL from the run, `approvalStatus = PENDING`. |
| financials | Upsert per `(client, fy)`; `isLocked` rows are never touched; `flagged` figures go to `viewData.flaggedFigures` only. |
| programs | Upsert per `(client, fy, name)`. |
| documents | Upsert per `(client, type, fy)`; unknown type → skipped. |
| outreach | Always a new pack (history kept); SPOC must belong to the run's client. |

Every save writes `ClientActivity` rows, `StepRun.resultSummary`
(`{ spocs: { created, updated, skipped[] }, … }`) and notifies the requester.

## 7. Reliability

- **Dispatch** retries with backoff up to `maxDispatchTries`, then `DISPATCH_FAILED`.
- **Re-check**: a run with no callback for 2 minutes is checked with
  `GET /api/crm/jobs/{jobId}` (`nextCheckAt`).
- **Timeout**: `timeoutMins` after start → `TIMED_OUT`, and the engine is asked to stop.
- **Idempotency**: one active run per `(step, client, spocs, options)`; a
  double click returns the existing run.
- **Every** status change, dispatch attempt and callback is an append-only
  `StepRunEvent` (payloads masked).

## 8. Env

| Service | Var | Meaning |
|---|---|---|
| core | `CSR_PIPELINE_URL` | engine base URL (seeded into `ExternalService.baseUrl`) |
| core | `CSR_PIPELINE_KEY` | key sent to the engine |
| core | `CSR_PIPELINE_INBOUND_KEY` | key the engine sends back (seed stores the hash) |
| core | `CRM_PUBLIC_URL` | base for `callbackUrl` (default `http://localhost:$PORT`) |
| core | `PIPELINE_RECONCILE_SECONDS` | reconciler tick, default 30; `0` disables |
| engine | `CRM_SERVICE_KEY` | must equal core's `CSR_PIPELINE_KEY` |
| engine | `CRM_CALLBACK_KEY` | must equal core's `CSR_PIPELINE_INBOUND_KEY` |
| engine | `CRM_MODE=1` | locks the old `/api/*` routes, disables CASPA reads/writes |
