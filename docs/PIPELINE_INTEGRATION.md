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
| spocs | Match by `id` → email (global, lowercased) → `(client, nameKey)`. Blank fields are filled; a different existing value is **never overwritten** — it is listed in `viewData.conflicts`. Validation fields are latest-wins. An email owned by another client's SPOC → skipped. New SPOCs: handler = requester, `approvalStatus = PENDING`, BU = the client's BU, SL = the one picked on the run (must be one of the client's service lines; automatic when the client has one). Clients without BU / SLs fall back to the requester's single BU / SL. |
| financials | Upsert per `(client, fy)`; `isLocked` rows are never touched; `flagged` figures go to `viewData.flaggedFigures` only. |
| programs | Upsert per `(client, fy, name)`. |
| documents | Upsert per `(client, type, fy)`; unknown type → skipped. |
| outreach | Always a new pack (history kept); SPOC must belong to the run's client. |

`fy` is always stored as `2025-2026` (the CASPA format): `2025-26` and `FY 2025-26`
are converted on arrival; anything else is kept as sent.

Every save writes `ClientActivity` rows, `StepRun.resultSummary`
(`{ spocs: { created, updated, skipped[] }, … }`) and notifies the requester.

### Ownership — who sees what

- **Clients** are visible (`clients.read` scope) when the user is **assigned**
  (`ClientAssignment`, set by super admin / `clients.assign`), created it, or
  handles one of its SPOCs. `GET/PUT /clients/:id/assignments`,
  `POST /clients/assign` (add / remove / replace for many clients).
- **SPOCs** belong to their handler (`spocs.read` scope). A run only sends the
  **requester's visible SPOCs** to the engine (enrich, apollo, validate,
  emails); `report_spocs` gets all of the client's SPOCs so the engine can tell
  who already exists. On save, a matched SPOC the requester can't see is
  **skipped** ("Already a SPOC of <name>", `handledByOther: true`) — never
  changed by someone else's run. Outreach packs and SPOC activity follow the
  same rule; list / detail SPOC counts are the visible ones.

### Before a run starts (`runRules.service.ts`)

1. **Input** — reports / figures need documents; enrich / validate / apollo
   (pipeline mode) need the requester's own SPOCs; emails need their approved SPOCs.
2. **Already done** — `PipelineStep.rerunAfterDays` (default 90 for reports,
   report_spocs, figures; 30 for enrich, apollo, emails; 14 for validate). A
   DONE run within that window blocks a new one unless the input changed since:
   new documents (report_spocs, figures), new visible SPOCs (enrich, apollo,
   validate; validate also unvalidated SPOCs), newly approved or not-yet-emailed
   SPOCs (emails). Client-level steps (reports, report_spocs, figures) look at
   **anyone's** run; SPOC steps at the requester's own. Refused with
   `409 ALREADY_DONE`; `rerun: true` (super admin / `step_runs.rerun`) forces it
   and sends `force: true` to engine stages that skip finished work.
3. **Run slots** — `RunQuota` rules: `maxRuns` per `DAY | WEEK | MONTH`
   (Asia/Kolkata; week starts Monday), for one step or all steps together
   (`stepId` null — counts top-level runs only), for everyone, a role or a
   user; per step + period the most specific rule wins. QUEUED / RUNNING /
   DONE runs count; failed, EMPTY and skipped do not. Super admin and
   `step_runs.unlimited` have none. Refused with `429 RUN_SLOTS_USED`.
   Admin: `/run-quotas` (`run_slots.manage`); caller: `GET /me/run-slots`.
4. The older `userClientLimit` (distinct clients per user per step, all time) still applies.

Inside "Run all steps" a step failing 1–3 becomes an EMPTY child "Skipped: …"
instead of failing the chain. `GET /step-runs/overview` returns, per step,
`done` (who / when), `rerunBlocked` and `slots`, plus `canRerun` and the
requester's own SPOC counts.

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

## 9. Second engine — branch office finder (`BRANCH_FINDER`)

`AI_Agent_2_Branch_vinutha_backend` (FastAPI, default port **8771**) runs one
step, **`branches` — "Find office locations"**. Same contract as above
(§1 auth, §3 dispatch, §4 progress, §5 results); only the parts that differ:

- **Service row**: `ExternalService.code = BRANCH_FINDER`, `outboundKeyEnv = BRANCH_FINDER_KEY`
  (so the URL env is `BRANCH_FINDER_URL`). Seeded by `npm run seed:pipeline`
  (`SEED_SERVICES=BRANCH_FINDER` to seed only it). Steps say which service they
  belong to in `src/config/pipeline.ts` (`service`, default `CSR_PIPELINE`).
- **Input**: `client.name`, `client.website`, `client.industry`. No SPOCs, no context.
  A client with no website is refused before dispatch (`NO_INPUT`).
- **Results**: `data.locations[]` —
  `{ address, label, type, state, district, pincode, latitude, longitude, evidence, pageUrl, checks }`
  (`type` = the finder's HEAD_OFFICE / REGISTERED_OFFICE / CORPORATE_OFFICE / REGIONAL_OFFICE /
  BRANCH / PLANT / PROJECT_OFFICE / OFFICE, mapped to `LOCATION_TYPE` by `FINDER_LOCATION_TYPE`).
  Nothing found → `EMPTY` (no address, no website, bot check) or `FAILED`
  (site unreachable, AI gave no answer, AI out of credit) with `error.howToContinue`.
- **Saving**: each office becomes a `ClientLocation` (`sourceRunId` = the run, `addedBy` =
  the requester, `dmEvidence` = where it was found). One the client already has (same PIN,
  every word of one address in the other) is skipped. The head office becomes primary when
  the client has none (`services/pipeline/branchOffices.service.ts`).
- **UI**: the clients list **Branches** column — the count opens the branch table, the
  status + ▶ runs the step; the same button on the client's Locations tab.
- **Re-run / lock**: a DONE run locks the client for 90 days (`rerunAfterDays`), anyone's run
  counts. EMPTY / FAILED runs never lock. A changed website lifts the lock; super admin /
  `step_runs.rerun` can force a run (re-testing after the finder is fixed).

| Service | Var | Meaning |
|---|---|---|
| core | `BRANCH_FINDER_URL` | finder base URL (e.g. `http://127.0.0.1:8771`) |
| core | `BRANCH_FINDER_KEY` | key sent to the finder |
| core | `BRANCH_FINDER_INBOUND_KEY` | key the finder sends back (seed stores the hash) |
| finder | `CRM_SERVICE_KEY` | must equal core's `BRANCH_FINDER_KEY` |
| finder | `CRM_CALLBACK_KEY` | must equal core's `BRANCH_FINDER_INBOUND_KEY` |
| finder | `CRM_MODE=1` | shuts the old CASPA screens (`/api/*` → 410), no autopilot, no CASPA DB |

### 9.1 Website check (`website` step, same finder)

Runs by itself (`services/website.service.ts`, an `afterRunEnded` hook) when `branches` or
`reports` ends FAILED / EMPTY because the website does not open (`WEBSITE_UNREACHABLE`, or the
engine's words). At most once per client per 6 h; it never uses a run slot.

- **Dead rule (finder `finder/websites.py`)**: dead only when every form of the address
  (https / http, with / without www) fails twice: DNS, no connection, timeout, or an error
  page (404 / 410 / 5xx). A site that opens — with nothing on it or behind a bot check — is
  never dead, and nothing is proposed (`EMPTY WEBSITE_OPENS`).
- **Candidates**: Wikidata's official website (P856) for the name, plus addresses made from the
  name. Offered only if they open and carry the client's CIN or name on the page (for a
  guessed address, the address itself proves nothing). Another company's CIN means rejected.
- **Results**: `data.website = { oldUrl, dead, opensAt, tried[], candidates[{ url, opened, title, how, evidence[], confidence }] }`,
  kept on the run (`viewData.website`).
- **Pop-up** (`GET /website-suggestions/mine`): the requester picks one and replaces the website
  (`POST /clients/:id/website { website, runId }`, `clients.update`) or keeps it
  (`POST /website-suggestions/:id/dismiss`). No approval; every change — here or in the
  client form — is a `CLIENT_UPDATED` activity with `meta.field = "website"`, `meta.website = { old, new, via, runId }`,
  so `GET /clients/:id/website-history` lists who / when / old → new / how. After a replace,
  `branches` / `reports` whose last run did not finish run again.

**Who can save what (3 Nov, revised):** a website the check *found* (verified: it opens and carries
the CIN / name) can be saved by anyone with `clients.update`. A *typed* website is super-admin
only — on the pop-up and in the client form (`ADMIN_ONLY`) — and is checked first by the finder
(`POST /api/crm/website/check` → `CIN | NAME | OTHER_CIN | UNKNOWN | NO`); `NO` can't be saved,
`OTHER_CIN` / `UNKNOWN` need `force: true` ("Save anyway"). Others press **Ask admin to update**
(`POST /website-suggestions/:id/request-admin` → `viewData.websiteRequest`, a notification to every
super admin linking to `/clients/:id?fixWebsite=<run>`). When the admin saves, the requester is
notified and the failed steps run again as the requester. The clients list `coverage.website` says
"Waiting for admin" or "Updated by …" (14 days). Last-resort discovery: Claude with web search
(`finder/ai_search.py`), only when the free sources find nothing and `ANTHROPIC_API_KEY` is set.
