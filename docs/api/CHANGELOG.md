# API changelog

Newest first. Every API change gets a line here in the same commit as the code, and `npm run docs:api` is re-run.
**⚠ Breaking** = existing callers must change; announced at least one working day ahead.

Format: `- METHOD /api/path — what changed (request #issue)`

## 2026-11-23 — client add-ons, persons, B2G

- `GET /api/schema-map` (super admins) — the database structure for Admin › Data map: `graph` (tables, fields, links parsed from prisma/schema.prisma), `domains` + `modelNotes` + `fieldNotes` (plain-language what / why, src/docs/schemaNotes.ts), `history` (every schema change since the first version, docs/schema/history.json — rebuilt by `npm run docs:schema`, part of `npm run docs:api`).
- **Client add-ons** (tables `ClientRegistration`, `ClientCsr`, `ClientGovt`; Client keeps only what every client has). Client responses keep the old flat fields (`cin`, `isListed`, `marketCapRs`, `subCategory`, `csrEligible`, `foundationName`, `foundationWebsite`) and add objects `registration` `{ cin, ownership, companyClass, yearOfIncorporation, isListed, marketCapRs, subCategory }`, `csr` `{ csrRole, csrEligible, foundationName, foundationWebsite }`, `govt` `{ level, orgType, parent, nodalMinistry, ministryName, departmentName, stateSkillBody, sector, skillFamily, isNational, schemeType, estimatedBudget, tenderPortal, tenderAuthority, priority, digitalMaturity }` (each `null` when absent), plus `groupName`, `email`, `phone` (the organisation's office contact).
- `POST /api/clients`, `PATCH /api/clients/:id` — new body fields `groupName`, `email`, `phone`, `ownership` (`PRIVATE|CENTRAL_GOVT|STATE_GOVT`; read from the CIN when not sent), `companyClass`, `yearOfIncorporation`, `csrRoleId` (lookup `CSR_ROLE`), `govt: { … }` (only the fields sent are saved; `orgTypeId` = lookup `GOVT_ORG_TYPE`). The edit rule applies to each add-on (government `priority` and CSR `csrEligible` are work fields).
- **⚠ Breaking — service lines are automatic:** a client's `serviceLines` = the service lines of its active SPOCs. `serviceLineIds` is no longer accepted on create / update (ignored). `GET /api/clients?serviceLineId=` and the `serviceLineId` facet now match clients with an active SPOC on that line. Pipeline runs may add SPOCs on any active service line (`SL_NOT_CLIENTS` is gone).
- `GET /api/clients` + `/facets` — new filters and facet fields `groupName`, `ownership`, `csrRoleId`, `govtLevel` (`CENTRAL|STATE|DISTRICT|LOCAL`), `govtOrgTypeId`.
- **Persons:** a `Person` is one human; each client they work with is a SPOC row. SPOC responses include `personId`; `GET /api/spocs/:id` adds `alsoWorksWith: [{ id, designation, isActive, client, serviceLine }]` (only clients the caller may see). Contact changes on one SPOC (name, email, phone, LinkedIn) are copied to the same person's other SPOC rows. Senders (n8n, exports) should send once per `personId`.
- **⚠ Breaking — SPOC email uniqueness:** an email is unique **per client** (409 `DUPLICATE_EMAIL` when another active SPOC at the same client has it), no longer per tenant — the same person may be a SPOC at several clients. Pipeline results no longer skip "email belongs to a SPOC of another client"; they add the role and link the person.
- Lookup types `CSR_ROLE` (Donor / Implementing agency / Foundation) and `GOVT_ORG_TYPE` (Ministry, Central department, CPSU, SPSU, State skill mission, SSC, ULB …).
- Financial years are stored in one form, `2025-2026` (the `2024-25` rows from the CASPA import were converted).

## 2026-11-21

- **⚠ Breaking — edit rule:** filled data is changed or removed only by a super admin; others fill empty fields and add new rows. Non-super-admins now get **403 `EDIT_LOCKED`** for: `PATCH /api/clients/:id` and `PATCH /api/spocs/:id` changing or clearing a field that has a value (removing a service line counts); `PUT /api/clients/:id/financials` · `/corporate-financials` · `/technologies` changing an existing FY / category's filled values; `POST /api/clients/:id/website` when a website is already on file; `PATCH /api/spocs/bulk-update` changing a filled ERP; and every edit/delete of an existing row — `DELETE /api/clients/:id`, `DELETE /api/spocs/:id`, `PATCH|DELETE` notes, locations, CSR programmes, `DELETE` documents, financial years, technologies. Not affected (work, not data): client `status`, `csrEligible`, `projectIds`; SPOC `salesStatusId`, `callConnected`, `dataFlag`, `isPrimary`, `notes`, `projectIds`; tasks, meetings, interactions, assignments, approvals, key-account stars. UI: show filled fields read-only (lock) for non-super-admins (`GET /api/me` → `isSuperAdmin`).
- `GET /api/clients` (and `/stats`) — new column filters: `name`, `shortName`, `cin`, `website` (contains, any case), `csrFy` (`2024-25`, comma list); `status` now takes a comma list (`ACTIVE,PENDING`; one value still works). New `sortBy`: `shortName`, `cin`, `entityType`, `industry`, `category`, `employeeSize` (by label), `businessUnit`.
- `GET /api/clients` — latest-FY figures: `sortBy` `csrObligation`, `csrFund`, `csrUnspent`, `revenue`, `netProfit`, `netWorth`, `paidUpCapital`, `authorisedCapital` (blanks last) and ranges `<figure>MinCr` / `<figure>MaxCr` (₹ crore, e.g. `csrFundMinCr=100`); `employeeMin` / `employeeMax`; `address` (contains), `pincode` (starts with) on active offices; `district` is now "contains". Needs `client_financials.read` for figures.
- `GET /api/clients/facets` — `q` = only values whose label contains it; new fields `assignedToId`, `projectId`.
- `GET /api/clients/facets?field=` — one column's values with how many clients have each, `[{ value, label, count }]` (most first, max 500; `value: null` = blank). Takes every list filter; the column's own filter is ignored so more values can be added. `field`: `status`, `entityType`, `industryId`, `categoryId`, `employeeSizeId`, `businessUnitId`, `serviceLineId`, `csrFy`, `createdById`, `country`, `state`, `city`.
- Generated API docs: `GET /api/docs` (explorer), `/api/docs/openapi.json`, `/api/docs/endpoints.md` (dev / shared backend only); `docs/api/ENDPOINTS.md` + `openapi.json` in the repo (`npm run docs:api`).

## 2026-11-19

- `GET|PUT /api/clients/:id/tasks/:taskId/meeting` — the full meeting behind a MEETING task (CASPA meeting form: mode, link, attendees, minutes 1–4, meeting / proposal status, proposal date / amount, tentative date, sales SPOC, category, MOU programme, visit check-in). `PUT` with `meetingStatus: "Completed"` closes the task and sets `approvalStatus: "PENDING"`. Response includes `options` (allowed values) and `canApprove`. *Needs DB migration `20261119100000_meeting_details`.*
- `POST /api/clients/:id/tasks/:taskId/meeting/files` (multipart `file` + `kind`), `GET …/files/:fileId/url`, `DELETE …/files/:fileId`.
- `POST /api/clients/:id/tasks/:taskId/meeting/approval` `{ decision: "APPROVED" | "REJECTED", note? }` — the owner's manager, a super admin or `clients.approve`.
- `POST /api/admin/users/:id/impersonate` and `/api/admin/impersonation/stop` — with `X-Client: mobile` the token pair comes in the body; header `X-Impersonation-Log` audits phone actions.

## 2026-11-18

- `GET /api/clients?assignedTo=team` — me + everyone reporting to me.
- `GET /api/spocs?handledBy=me|team`.
- `GET /api/me/work?kind=&done=&from=&to=` — my open / done tasks, calls and meetings across clients (each with `client { id, name }`).
- `POST /api/auth/login`, `/api/auth/refresh` — `X-Client: mobile` returns `{ tokens }` in the body; refresh accepts `{ refreshToken }` in the body.
- Org chart (`GET /api/users/org-tree`): the single active super admin is the root; people without (or with an inactive) manager sit under them.
