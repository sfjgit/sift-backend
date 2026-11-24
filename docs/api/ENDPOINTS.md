# SFJBS CRM API — endpoints

Generated 2026-11-23 13:06 UTC from the code (`npm run docs:api`). **Do not edit by hand.** 236 endpoints.
Read first: [CONVENTIONS.md](./CONVENTIONS.md) (sign-in, response envelope, errors, paging). What changed: [CHANGELOG.md](./CHANGELOG.md).

- [auth](#auth) — 7
- [me](#me) — 3
- [website-suggestions](#website-suggestions) — 4
- [users](#users) — 8
- [roles](#roles) — 7
- [permissions](#permissions) — 2
- [business-units](#business-units) — 5
- [service-lines](#service-lines) — 5
- [departments](#departments) — 5
- [designations](#designations) — 5
- [lookups](#lookups) — 5
- [auth-logs](#auth-logs) — 1
- [audit-logs](#audit-logs) — 1
- [admin](#admin) — 2
- [schema-map](#schema-map) — 1
- [clients](#clients) — 48
- [csr-agencies](#csr-agencies) — 1
- [spocs](#spocs) — 11
- [notifications](#notifications) — 5
- [pipeline-steps](#pipeline-steps) — 1
- [step-runs](#step-runs) — 5
- [outreach](#outreach) — 5
- [integrations](#integrations) — 6
- [system-alerts](#system-alerts) — 2
- [run-quotas](#run-quotas) — 4
- [geo](#geo) — 3
- [reports](#reports) — 4
- [search](#search) — 1
- [ai](#ai) — 30
- [recycle-bin](#recycle-bin) — 4
- [tickets](#tickets) — 9
- [platform](#platform) — 13
- [svc](#svc) — 4
- [views](#views) — 4
- [column-access](#column-access) — 3
- [faqs](#faqs) — 6

## auth

### `POST /api/auth/login`
public
*No sign-in.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `email` | string (email) | yes |  |
| body | `password` | string | yes |  |

### `POST /api/auth/refresh`
Refresh
*No sign-in.*

### `POST /api/auth/forgot-password`
Forgot password
*No sign-in.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `email` | string (email) | yes |  |

### `POST /api/auth/reset-password`
Reset password by token
*No sign-in.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `token` | string | yes |  |
| body | `password` | string | yes |  |

### `GET /api/auth/me`
logged in
*Signed-in user.*

### `POST /api/auth/logout`
Logout
*Signed-in user.*

### `POST /api/auth/change-password`
Change password
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `currentPassword` | string | yes |  |
| body | `newPassword` | string | yes |  |
## me

### `GET /api/me/permissions`
logged-in user's map — frontend uses it to show/hide UI
*Signed-in user.*

### `GET /api/me/run-slots`
pipeline run slots left this day / week / month
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `stepId` | string (uuid) |  |  |

### `GET /api/me/work`
my follow-ups / calls / meetings across all clients (phone app Today + Meetings)
*Signed-in user.*
## website-suggestions

### `GET /api/website-suggestions/mine`
List my suggestions
*Signed-in user.*

### `GET /api/website-suggestions/{id}`
Get website suggestion
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/website-suggestions/{id}/request-admin`
Request admin update
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/website-suggestions/{id}/dismiss`
Dismiss website suggestion
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## users

### `GET /api/users`
List users
*Needs permission `users.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `search` | string |  |  |
| query | `roleId` | string (uuid)[] |  |  |
| query | `departmentId` | string (uuid)[] |  |  |
| query | `designationId` | string (uuid)[] |  |  |
| query | `reportingToId` | string (uuid)[] |  |  |
| query | `teamLeadId` | string (uuid)[] |  |  |
| query | `businessUnitId` | string (uuid)[] |  |  |
| query | `serviceLineId` | string (uuid)[] |  |  |
| query | `isActive` | "true" \| "false" |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |
| query | `sortBy` | "firstName" \| "lastName" \| "createdAt" \| "dateOfJoin" | yes | default "firstName" |
| query | `sortDir` | "asc" \| "desc" | yes | default "asc" |

### `POST /api/users`
Create user
*Needs permission `users.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `email` | string (email) | yes |  |
| body | `firstName` | string ≤100 | yes |  |
| body | `lastName` | string ≤100 | yes |  |
| body | `middleName` | string ≤100 \| null |  |  |
| body | `displayName` | string ≤100 \| null |  |  |
| body | `employeeId` | string ≤50 \| null |  |  |
| body | `phone` | string ≤20 \| null |  |  |
| body | `workingLocation` | string ≤200 \| null |  |  |
| body | `timezone` | string ≤100 \| null |  |  |
| body | `dateOfBirth` | string \| null |  |  |
| body | `dateOfJoin` | string \| null |  |  |
| body | `roleId` | string (uuid) | yes |  |
| body | `departmentId` | string (uuid) \| null |  |  |
| body | `designationId` | string (uuid) \| null |  |  |
| body | `reportingToId` | string (uuid) \| null |  |  |
| body | `teamLeadId` | string (uuid) \| null |  |  |
| body | `businessUnitIds` | string (uuid)[] |  | default [] |
| body | `serviceLineIds` | string (uuid)[] |  | default [] |
| body | `isSuperAdmin` | boolean |  | default false |

### `GET /api/users/options`
picker — any logged-in user; scope resolved in the controller. Before /:id.
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `search` | string |  |  |
| query | `for` | "assign" \| "client_assign" \| "filter" |  | default "filter" |
| query | `limit` | integer ≤100 |  | default 20 |

### `GET /api/users/org-tree`
the reporting tree — everyone sees their own line; users.read shows more
*Signed-in user.*

### `GET /api/users/{id}`
Get user by id
*Needs permission `users.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PUT /api/users/{id}`
Update user
*Needs permission `users.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `firstName` | string ≤100 |  |  |
| body | `lastName` | string ≤100 |  |  |
| body | `middleName` | string ≤100 \| null |  |  |
| body | `displayName` | string ≤100 \| null |  |  |
| body | `employeeId` | string ≤50 \| null |  |  |
| body | `phone` | string ≤20 \| null |  |  |
| body | `workingLocation` | string ≤200 \| null |  |  |
| body | `timezone` | string ≤100 \| null |  |  |
| body | `dateOfBirth` | string \| null |  |  |
| body | `dateOfJoin` | string \| null |  |  |
| body | `roleId` | string (uuid) |  |  |
| body | `departmentId` | string (uuid) \| null |  |  |
| body | `designationId` | string (uuid) \| null |  |  |
| body | `reportingToId` | string (uuid) \| null |  |  |
| body | `teamLeadId` | string (uuid) \| null |  |  |
| body | `businessUnitIds` | string (uuid)[] |  |  |
| body | `serviceLineIds` | string (uuid)[] |  |  |
| body | `isSuperAdmin` | boolean |  |  |

### `PATCH /api/users/{id}/toggle`
Toggle user
*Needs permission `users.deactivate`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PATCH /api/users/{id}/reset-password`
Admin reset password
*Needs permission `users.reset_password`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `newPassword` | string | yes |  |
## roles

### `GET /api/roles`
List roles
*Signed-in user.*

### `POST /api/roles`
Create role
*Needs permission `roles.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `name` | string ≤100 | yes |  |
| body | `description` | string ≤500 \| null |  |  |
| body | `grants` | object[] |  | default [] |

### `GET /api/roles/{id}`
Get role by id
*Needs permission `roles.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PUT /api/roles/{id}`
Update role
*Needs permission `roles.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `name` | string ≤100 |  |  |
| body | `description` | string ≤500 \| null |  |  |

### `DELETE /api/roles/{id}`
Delete role
*Needs permission `roles.delete`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `GET /api/roles/{roleId}/permissions`
Get role grants
*Needs permission `roles.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `roleId` | string (uuid) | yes |  |

### `PUT /api/roles/{roleId}/permissions`
Save role grants
*Needs permission `roles.assign_permissions`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `roleId` | string (uuid) | yes |  |
| body | `grants` | object[] | yes |  |
## permissions

### `GET /api/permissions/registry`
Get registry
*Needs permission `roles.read`.*

### `GET /api/permissions/scopes`
Get scopes
*Needs permission `roles.read`.*
## business-units

### `GET /api/business-units`
List business units
*Signed-in user.*

### `POST /api/business-units`
Create business unit
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `name` | string ≤100 | yes |  |
| body | `code` | string ≤20 \| null |  |  |

### `GET /api/business-units/{id}`
Get business unit by id
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PUT /api/business-units/{id}`
Update business unit
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `name` | string ≤100 |  |  |
| body | `code` | string ≤20 \| null |  |  |
| body | `isActive` | boolean |  |  |

### `DELETE /api/business-units/{id}`
Delete business unit
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## service-lines

### `GET /api/service-lines`
List
*Signed-in user.*

### `POST /api/service-lines`
Create
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `name` | string ≤200 | yes |  |
| body | `code` | string ≤50 \| null |  |  |

### `GET /api/service-lines/{id}`
Get by id
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PUT /api/service-lines/{id}`
Update
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `name` | string ≤200 |  |  |
| body | `code` | string ≤50 \| null |  |  |

### `PATCH /api/service-lines/{id}/toggle`
Toggle
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## departments

### `GET /api/departments`
List
*Signed-in user.*

### `POST /api/departments`
Create
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `name` | string ≤200 | yes |  |
| body | `code` | string ≤50 \| null |  |  |

### `GET /api/departments/{id}`
Get by id
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PUT /api/departments/{id}`
Update
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `name` | string ≤200 |  |  |
| body | `code` | string ≤50 \| null |  |  |

### `PATCH /api/departments/{id}/toggle`
Toggle
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## designations

### `GET /api/designations`
List
*Signed-in user.*

### `POST /api/designations`
Create
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `name` | string ≤200 | yes |  |
| body | `code` | string ≤50 \| null |  |  |

### `GET /api/designations/{id}`
Get by id
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PUT /api/designations/{id}`
Update
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `name` | string ≤200 |  |  |
| body | `code` | string ≤50 \| null |  |  |

### `PATCH /api/designations/{id}/toggle`
Toggle
*Needs permission `org.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## lookups

### `GET /api/lookups/types`
List lookup types
*Signed-in user.*

### `GET /api/lookups`
List lookups
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `type` | "INDUSTRY" \| "CLIENT_CATEGORY" \| "EMPLOYEE_SIZE" \| "LOCATION_TYPE" \| "TECH_CATEGORY" \| "DOCUMENT_TYPE" \| "SPOC_SOURCE" \| "EMAIL_SOURCE" \| "SALES_STATUS" \| "PROGRAM_SECTOR" \| "PROJECT" \| "SPOC_ROLE" \| "DECISION_AUTHORITY" \| "ORG_TYPE" \| "REVENUE_BAND" \| "CSR_ROLE" \| "GOVT_ORG_TYPE" |  |  |
| query | `includeInactive` | "true" \| "false" |  |  |

### `POST /api/lookups`
Create lookup
*Needs permission `lookups.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `type` | "INDUSTRY" \| "CLIENT_CATEGORY" \| "EMPLOYEE_SIZE" \| "LOCATION_TYPE" \| "TECH_CATEGORY" \| "DOCUMENT_TYPE" \| "SPOC_SOURCE" \| "EMAIL_SOURCE" \| "SALES_STATUS" \| "PROGRAM_SECTOR" \| "PROJECT" \| "SPOC_ROLE" \| "DECISION_AUTHORITY" \| "ORG_TYPE" \| "REVENUE_BAND" \| "CSR_ROLE" \| "GOVT_ORG_TYPE" | yes |  |
| body | `code` | string ≤100 | yes |  |
| body | `label` | string ≤200 | yes |  |
| body | `order` | integer ≤9007199254740991 \| null |  |  |
| body | `meta` | object \| null |  |  |

### `PUT /api/lookups/{id}`
Update lookup
*Needs permission `lookups.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `code` | string ≤100 |  |  |
| body | `label` | string ≤200 |  |  |
| body | `order` | integer ≤9007199254740991 \| null |  |  |
| body | `meta` | object \| null |  |  |

### `PATCH /api/lookups/{id}/toggle`
Toggle lookup
*Needs permission `lookups.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## auth-logs

### `GET /api/auth-logs`
List auth logs
*Needs permission `audit.view_login_history`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `userId` | string (uuid)[] |  |  |
| query | `departmentId` | string (uuid)[] |  |  |
| query | `type` | "LOGIN" \| "LOGOUT" \| "REFRESH" \| "PASSWORD_RESET" \| "PASSWORD_CHANGE" \| "ACCOUNT_CREATED" \| "ACCOUNT_DEACTIVATED" \| "ACCOUNT_REACTIVATED" \| "FAILED_LOGIN"[] |  |  |
| query | `startDate` | string |  |  |
| query | `endDate` | string |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |
| query | `sortDir` | "asc" \| "desc" | yes | default "desc" |
## audit-logs

### `GET /api/audit-logs`
List audit logs
*Needs permission `audit.view_audit_log`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `actorId` | string (uuid) |  |  |
| query | `module` | string |  |  |
| query | `action` | string |  |  |
| query | `recordId` | string |  |  |
| query | `startDate` | string |  |  |
| query | `endDate` | string |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |
| query | `sortDir` | "asc" \| "desc" | yes | default "desc" |
## admin

### `POST /api/admin/users/{id}/impersonate`
Start impersonation
*Super admin only.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/admin/impersonation/stop`
no auth — works even if the impersonated token expired
*No sign-in.*
## schema-map

### `GET /api/schema-map`
the database structure as a picture, its explanations and its history (super admins)
*Super admin only.*
## clients

### `GET /api/clients`
List clients
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `search` | string ≤200 |  |  |
| query | `status` | "PENDING" \| "ACTIVE" \| "INACTIVE"[] |  |  |
| query | `name` | string ≤200 |  |  |
| query | `shortName` | string ≤200 |  |  |
| query | `cin` | string ≤50 |  |  |
| query | `website` | string ≤200 |  |  |
| query | `groupName` | string ≤150[] |  |  |
| query | `ownership` | "PRIVATE" \| "CENTRAL_GOVT" \| "STATE_GOVT"[] |  |  |
| query | `csrRoleId` | string (uuid)[] |  |  |
| query | `govtLevel` | "CENTRAL" \| "STATE" \| "DISTRICT" \| "LOCAL"[] |  |  |
| query | `govtOrgTypeId` | string (uuid)[] |  |  |
| query | `csrFy` | string[] |  |  |
| query | `entityType` | "COMPANY" \| "GOVERNMENT" \| "INSTITUTION"[] |  |  |
| query | `industryId` | string (uuid)[] |  |  |
| query | `categoryId` | string (uuid)[] |  |  |
| query | `employeeSizeId` | string (uuid)[] |  |  |
| query | `csrSpentMinCr` | number |  |  |
| query | `csrSpentMaxCr` | number |  |  |
| query | `csrObligationMinCr` | number |  |  |
| query | `csrObligationMaxCr` | number |  |  |
| query | `csrFundMinCr` | number |  |  |
| query | `csrFundMaxCr` | number |  |  |
| query | `csrUnspentMinCr` | number |  |  |
| query | `csrUnspentMaxCr` | number |  |  |
| query | `revenueMinCr` | number |  |  |
| query | `revenueMaxCr` | number |  |  |
| query | `netProfitMinCr` | number |  |  |
| query | `netProfitMaxCr` | number |  |  |
| query | `netWorthMinCr` | number |  |  |
| query | `netWorthMaxCr` | number |  |  |
| query | `paidUpCapitalMinCr` | number |  |  |
| query | `paidUpCapitalMaxCr` | number |  |  |
| query | `authorisedCapitalMinCr` | number |  |  |
| query | `authorisedCapitalMaxCr` | number |  |  |
| query | `employeeMin` | integer ≤9007199254740991 |  |  |
| query | `employeeMax` | integer ≤9007199254740991 |  |  |
| query | `address` | string ≤200 |  |  |
| query | `pincode` | string ≤10 |  |  |
| query | `hasBranches` | "true" \| "false" |  |  |
| query | `businessUnitId` | string (uuid)[] |  |  |
| query | `serviceLineId` | string (uuid)[] |  |  |
| query | `handlerId` | string (uuid)[] |  |  |
| query | `createdById` | string (uuid)[] |  |  |
| query | `assignedTo` | string \| string \| string \| string (uuid) |  |  |
| query | `assignedToId` | string (uuid)[] |  |  |
| query | `assignedById` | string (uuid)[] |  |  |
| query | `missing` | "website" \| "reports" \| "spocs" \| "approved" \| "figures" \| "outreach"[] |  |  |
| query | `pipeline` | "never" \| "run" \| "failed" |  |  |
| query | `stepsDone` | "reports" \| "report_spocs" \| "figures" \| "enrich" \| "apollo" \| "validate" \| "emails"[] |  |  |
| query | `stepsNotDone` | "reports" \| "report_spocs" \| "figures" \| "enrich" \| "apollo" \| "validate" \| "emails"[] |  |  |
| query | `outreachStatus` | "DRAFT" \| "REVIEWED" \| "SENT" \| "REPLIED" \| "NO_REPLY" \| "BOUNCED"[] |  |  |
| query | `createdFrom` | string |  |  |
| query | `createdTo` | string |  |  |
| query | `lastRunFrom` | string |  |  |
| query | `lastRunTo` | string |  |  |
| query | `country` | string ≤100[] |  |  |
| query | `state` | string ≤100[] |  |  |
| query | `district` | string ≤100 |  |  |
| query | `city` | string ≤100[] |  |  |
| query | `programSectorId` | string (uuid)[] |  |  |
| query | `programState` | string ≤100[] |  |  |
| query | `programDistrict` | string ≤100 |  |  |
| query | `programAgency` | string ≤200 |  |  |
| query | `keyAccount` | "me" \| "any" \| "none" |  |  |
| query | `csrEligible` | "yes" \| "no" \| "unset" |  |  |
| query | `projectId` | string (uuid)[] |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |
| query | `sortBy` | "name" \| "createdAt" \| "updatedAt" \| "status" \| "csrSpentRs" \| "csrFy" \| "employeeCount" \| "shortName" \| "cin" \| "entityType" \| "industry" \| "category" \| "businessUnit" \| "employeeSize" \| "csrObligation" \| "csrFund" \| "csrUnspent" \| "revenue" \| "netProfit" \| "netWorth" \| "paidUpCapital" \| "authorisedCapital" | yes | default "updatedAt" |
| query | `sortDir` | "asc" \| "desc" | yes | default "desc" |

### `POST /api/clients`
Create client
*Needs permission `clients.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `entityType` | "COMPANY" \| "GOVERNMENT" \| "INSTITUTION" |  |  |
| body | `name` | string ≤200 | yes |  |
| body | `shortName` | string ≤100 \| null |  |  |
| body | `cin` | string ≤21 \| null |  |  |
| body | `website` | string (uri) \| string \| null |  |  |
| body | `linkedinUrl` | string (uri) \| string \| null |  |  |
| body | `industryId` | string (uuid) \| null |  |  |
| body | `categoryId` | string (uuid) \| null |  |  |
| body | `employeeCount` | integer ≤10000000 \| null |  |  |
| body | `employeeSizeId` | string (uuid) \| null |  |  |
| body | `businessUnitId` | string (uuid) \| null |  |  |
| body | `projectIds` | string (uuid)[] |  |  |
| body | `groupName` | string ≤150 \| null |  |  |
| body | `linkedinEmployees` | integer ≤10000000 \| null |  |  |
| body | `ownership` | "PRIVATE" \| "CENTRAL_GOVT" \| "STATE_GOVT" \| null |  |  |
| body | `companyClass` | string ≤150 \| null |  |  |
| body | `yearOfIncorporation` | integer ≤2100 \| null |  |  |
| body | `isListed` | boolean \| null |  |  |
| body | `subCategory` | string ≤200 \| null |  |  |
| body | `marketCapRs` | number ≤100000000000000000 \| null |  |  |
| body | `csrRoleId` | string (uuid) \| null |  |  |
| body | `csrEligible` | boolean \| null |  |  |
| body | `foundationName` | string ≤300 \| null |  |  |
| body | `foundationWebsite` | string (uri) \| string \| null |  |  |
| body | `govt` | object |  |  |

### `GET /api/clients/stats`
Client stats
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `search` | string ≤200 |  |  |
| query | `status` | "PENDING" \| "ACTIVE" \| "INACTIVE"[] |  |  |
| query | `name` | string ≤200 |  |  |
| query | `shortName` | string ≤200 |  |  |
| query | `cin` | string ≤50 |  |  |
| query | `website` | string ≤200 |  |  |
| query | `groupName` | string ≤150[] |  |  |
| query | `ownership` | "PRIVATE" \| "CENTRAL_GOVT" \| "STATE_GOVT"[] |  |  |
| query | `csrRoleId` | string (uuid)[] |  |  |
| query | `govtLevel` | "CENTRAL" \| "STATE" \| "DISTRICT" \| "LOCAL"[] |  |  |
| query | `govtOrgTypeId` | string (uuid)[] |  |  |
| query | `csrFy` | string[] |  |  |
| query | `entityType` | "COMPANY" \| "GOVERNMENT" \| "INSTITUTION"[] |  |  |
| query | `industryId` | string (uuid)[] |  |  |
| query | `categoryId` | string (uuid)[] |  |  |
| query | `employeeSizeId` | string (uuid)[] |  |  |
| query | `csrSpentMinCr` | number |  |  |
| query | `csrSpentMaxCr` | number |  |  |
| query | `csrObligationMinCr` | number |  |  |
| query | `csrObligationMaxCr` | number |  |  |
| query | `csrFundMinCr` | number |  |  |
| query | `csrFundMaxCr` | number |  |  |
| query | `csrUnspentMinCr` | number |  |  |
| query | `csrUnspentMaxCr` | number |  |  |
| query | `revenueMinCr` | number |  |  |
| query | `revenueMaxCr` | number |  |  |
| query | `netProfitMinCr` | number |  |  |
| query | `netProfitMaxCr` | number |  |  |
| query | `netWorthMinCr` | number |  |  |
| query | `netWorthMaxCr` | number |  |  |
| query | `paidUpCapitalMinCr` | number |  |  |
| query | `paidUpCapitalMaxCr` | number |  |  |
| query | `authorisedCapitalMinCr` | number |  |  |
| query | `authorisedCapitalMaxCr` | number |  |  |
| query | `employeeMin` | integer ≤9007199254740991 |  |  |
| query | `employeeMax` | integer ≤9007199254740991 |  |  |
| query | `address` | string ≤200 |  |  |
| query | `pincode` | string ≤10 |  |  |
| query | `hasBranches` | "true" \| "false" |  |  |
| query | `businessUnitId` | string (uuid)[] |  |  |
| query | `serviceLineId` | string (uuid)[] |  |  |
| query | `handlerId` | string (uuid)[] |  |  |
| query | `createdById` | string (uuid)[] |  |  |
| query | `assignedTo` | string \| string \| string \| string (uuid) |  |  |
| query | `assignedToId` | string (uuid)[] |  |  |
| query | `assignedById` | string (uuid)[] |  |  |
| query | `missing` | "website" \| "reports" \| "spocs" \| "approved" \| "figures" \| "outreach"[] |  |  |
| query | `pipeline` | "never" \| "run" \| "failed" |  |  |
| query | `stepsDone` | "reports" \| "report_spocs" \| "figures" \| "enrich" \| "apollo" \| "validate" \| "emails"[] |  |  |
| query | `stepsNotDone` | "reports" \| "report_spocs" \| "figures" \| "enrich" \| "apollo" \| "validate" \| "emails"[] |  |  |
| query | `outreachStatus` | "DRAFT" \| "REVIEWED" \| "SENT" \| "REPLIED" \| "NO_REPLY" \| "BOUNCED"[] |  |  |
| query | `createdFrom` | string |  |  |
| query | `createdTo` | string |  |  |
| query | `lastRunFrom` | string |  |  |
| query | `lastRunTo` | string |  |  |
| query | `country` | string ≤100[] |  |  |
| query | `state` | string ≤100[] |  |  |
| query | `district` | string ≤100 |  |  |
| query | `city` | string ≤100[] |  |  |
| query | `programSectorId` | string (uuid)[] |  |  |
| query | `programState` | string ≤100[] |  |  |
| query | `programDistrict` | string ≤100 |  |  |
| query | `programAgency` | string ≤200 |  |  |
| query | `keyAccount` | "me" \| "any" \| "none" |  |  |
| query | `csrEligible` | "yes" \| "no" \| "unset" |  |  |
| query | `projectId` | string (uuid)[] |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |
| query | `sortBy` | "name" \| "createdAt" \| "updatedAt" \| "status" \| "csrSpentRs" \| "csrFy" \| "employeeCount" \| "shortName" \| "cin" \| "entityType" \| "industry" \| "category" \| "businessUnit" \| "employeeSize" \| "csrObligation" \| "csrFund" \| "csrUnspent" \| "revenue" \| "netProfit" \| "netWorth" \| "paidUpCapital" \| "authorisedCapital" | yes | default "updatedAt" |
| query | `sortDir` | "asc" \| "desc" | yes | default "desc" |

### `GET /api/clients/facets`
one column's values with client counts (the column-header filters); same filters as the list
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `search` | string ≤200 |  |  |
| query | `status` | "PENDING" \| "ACTIVE" \| "INACTIVE"[] |  |  |
| query | `name` | string ≤200 |  |  |
| query | `shortName` | string ≤200 |  |  |
| query | `cin` | string ≤50 |  |  |
| query | `website` | string ≤200 |  |  |
| query | `groupName` | string ≤150[] |  |  |
| query | `ownership` | "PRIVATE" \| "CENTRAL_GOVT" \| "STATE_GOVT"[] |  |  |
| query | `csrRoleId` | string (uuid)[] |  |  |
| query | `govtLevel` | "CENTRAL" \| "STATE" \| "DISTRICT" \| "LOCAL"[] |  |  |
| query | `govtOrgTypeId` | string (uuid)[] |  |  |
| query | `csrFy` | string[] |  |  |
| query | `entityType` | "COMPANY" \| "GOVERNMENT" \| "INSTITUTION"[] |  |  |
| query | `industryId` | string (uuid)[] |  |  |
| query | `categoryId` | string (uuid)[] |  |  |
| query | `employeeSizeId` | string (uuid)[] |  |  |
| query | `csrSpentMinCr` | number |  |  |
| query | `csrSpentMaxCr` | number |  |  |
| query | `csrObligationMinCr` | number |  |  |
| query | `csrObligationMaxCr` | number |  |  |
| query | `csrFundMinCr` | number |  |  |
| query | `csrFundMaxCr` | number |  |  |
| query | `csrUnspentMinCr` | number |  |  |
| query | `csrUnspentMaxCr` | number |  |  |
| query | `revenueMinCr` | number |  |  |
| query | `revenueMaxCr` | number |  |  |
| query | `netProfitMinCr` | number |  |  |
| query | `netProfitMaxCr` | number |  |  |
| query | `netWorthMinCr` | number |  |  |
| query | `netWorthMaxCr` | number |  |  |
| query | `paidUpCapitalMinCr` | number |  |  |
| query | `paidUpCapitalMaxCr` | number |  |  |
| query | `authorisedCapitalMinCr` | number |  |  |
| query | `authorisedCapitalMaxCr` | number |  |  |
| query | `employeeMin` | integer ≤9007199254740991 |  |  |
| query | `employeeMax` | integer ≤9007199254740991 |  |  |
| query | `address` | string ≤200 |  |  |
| query | `pincode` | string ≤10 |  |  |
| query | `hasBranches` | "true" \| "false" |  |  |
| query | `businessUnitId` | string (uuid)[] |  |  |
| query | `serviceLineId` | string (uuid)[] |  |  |
| query | `handlerId` | string (uuid)[] |  |  |
| query | `createdById` | string (uuid)[] |  |  |
| query | `assignedTo` | string \| string \| string \| string (uuid) |  |  |
| query | `assignedToId` | string (uuid)[] |  |  |
| query | `assignedById` | string (uuid)[] |  |  |
| query | `missing` | "website" \| "reports" \| "spocs" \| "approved" \| "figures" \| "outreach"[] |  |  |
| query | `pipeline` | "never" \| "run" \| "failed" |  |  |
| query | `stepsDone` | "reports" \| "report_spocs" \| "figures" \| "enrich" \| "apollo" \| "validate" \| "emails"[] |  |  |
| query | `stepsNotDone` | "reports" \| "report_spocs" \| "figures" \| "enrich" \| "apollo" \| "validate" \| "emails"[] |  |  |
| query | `outreachStatus` | "DRAFT" \| "REVIEWED" \| "SENT" \| "REPLIED" \| "NO_REPLY" \| "BOUNCED"[] |  |  |
| query | `createdFrom` | string |  |  |
| query | `createdTo` | string |  |  |
| query | `lastRunFrom` | string |  |  |
| query | `lastRunTo` | string |  |  |
| query | `country` | string ≤100[] |  |  |
| query | `state` | string ≤100[] |  |  |
| query | `district` | string ≤100 |  |  |
| query | `city` | string ≤100[] |  |  |
| query | `programSectorId` | string (uuid)[] |  |  |
| query | `programState` | string ≤100[] |  |  |
| query | `programDistrict` | string ≤100 |  |  |
| query | `programAgency` | string ≤200 |  |  |
| query | `keyAccount` | "me" \| "any" \| "none" |  |  |
| query | `csrEligible` | "yes" \| "no" \| "unset" |  |  |
| query | `projectId` | string (uuid)[] |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |
| query | `sortBy` | "name" \| "createdAt" \| "updatedAt" \| "status" \| "csrSpentRs" \| "csrFy" \| "employeeCount" \| "shortName" \| "cin" \| "entityType" \| "industry" \| "category" \| "businessUnit" \| "employeeSize" \| "csrObligation" \| "csrFund" \| "csrUnspent" \| "revenue" \| "netProfit" \| "netWorth" \| "paidUpCapital" \| "authorisedCapital" | yes | default "updatedAt" |
| query | `sortDir` | "asc" \| "desc" | yes | default "desc" |
| query | `field` | "groupName" \| "ownership" \| "csrRoleId" \| "govtLevel" \| "govtOrgTypeId" \| "status" \| "entityType" \| "industryId" \| "categoryId" \| "employeeSizeId" \| "businessUnitId" \| "serviceLineId" \| "csrFy" \| "createdById" \| "assignedToId" \| "projectId" \| "country" \| "state" \| "city" | yes |  |
| query | `q` | string ≤100 |  |  |

### `PATCH /api/clients/bulk-status`
bulk — before /:id so "bulk-status" isn't read as an id
*Needs permission `clients.approve`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `clientIds` | string (uuid)[] | yes |  |
| body | `status` | "PENDING" \| "ACTIVE" \| "INACTIVE" | yes |  |

### `POST /api/clients/assign`
Bulk assign clients
*Needs permission `clients.assign`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `clientIds` | string (uuid)[] | yes |  |
| body | `userIds` | string (uuid)[] | yes |  |
| body | `mode` | "add" \| "remove" \| "replace" |  | default "add" |
| body | `note` | string ≤500 |  |  |

### `GET /api/clients/map`
the 3D office map — before /:id so "map" isn't read as an id
*Needs permission `clients.read`.*

### `POST /api/clients/export-details`
the nested data behind an export (extra sheets) — read-only exports are for the super admin only
*Super admin only.*

### `POST /api/clients/{id}/website`
the website: replace it (old one kept in the history), and the history
*Needs permission `clients.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `website` | string ≤500 | yes |  |
| body | `runId` | string (uuid) |  |  |
| body | `force` | boolean |  |  |

### `GET /api/clients/{id}/website-history`
Get website history
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/clients/{id}/website/check`
Check client website
*Needs permission `clients.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `website` | string ≤500 | yes |  |

### `GET /api/clients/{id}`
Get client by id
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PATCH /api/clients/{id}`
Update client
*Needs permission `clients.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `entityType` | "COMPANY" \| "GOVERNMENT" \| "INSTITUTION" |  |  |
| body | `name` | string ≤200 |  |  |
| body | `shortName` | string ≤100 \| null |  |  |
| body | `cin` | string ≤21 \| null |  |  |
| body | `website` | string (uri) \| string \| null |  |  |
| body | `linkedinUrl` | string (uri) \| string \| null |  |  |
| body | `industryId` | string (uuid) \| null |  |  |
| body | `categoryId` | string (uuid) \| null |  |  |
| body | `employeeCount` | integer ≤10000000 \| null |  |  |
| body | `employeeSizeId` | string (uuid) \| null |  |  |
| body | `businessUnitId` | string (uuid) \| null |  |  |
| body | `projectIds` | string (uuid)[] |  |  |
| body | `groupName` | string ≤150 \| null |  |  |
| body | `linkedinEmployees` | integer ≤10000000 \| null |  |  |
| body | `ownership` | "PRIVATE" \| "CENTRAL_GOVT" \| "STATE_GOVT" \| null |  |  |
| body | `companyClass` | string ≤150 \| null |  |  |
| body | `yearOfIncorporation` | integer ≤2100 \| null |  |  |
| body | `isListed` | boolean \| null |  |  |
| body | `subCategory` | string ≤200 \| null |  |  |
| body | `marketCapRs` | number ≤100000000000000000 \| null |  |  |
| body | `csrRoleId` | string (uuid) \| null |  |  |
| body | `csrEligible` | boolean \| null |  |  |
| body | `foundationName` | string ≤300 \| null |  |  |
| body | `foundationWebsite` | string (uri) \| string \| null |  |  |
| body | `govt` | object |  |  |

### `DELETE /api/clients/{id}`
Delete client
*Needs permission `clients.delete`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/clients/{id}/key-account`
my key-account star — a personal mark, so seeing the client is enough
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `GET /api/clients/{id}/assignments`
List client assignments
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PUT /api/clients/{id}/assignments`
Set client assignments
*Needs permission `clients.assign`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `userIds` | string (uuid)[] | yes |  |
| body | `note` | string ≤500 |  |  |

### `PATCH /api/clients/{id}/status`
Update client status
*Needs permission `clients.approve`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `status` | "PENDING" \| "ACTIVE" \| "INACTIVE" | yes |  |

### `GET /api/clients/{id}/activities`
List client activities
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |
| query | `spocId` | string (uuid) |  |  |
| query | `type` | "CLIENT_CREATED" \| "CLIENT_UPDATED" \| "CLIENT_APPROVED" \| "SPOC_ADDED" \| "SPOC_UPDATED" \| "SPOC_REASSIGNED" \| "NOTE_ADDED" \| "LOCATION_ADDED" \| "TECHNOLOGY_UPDATED" \| "DOCUMENT_ADDED" \| "FINANCIALS_UPDATED" \| "PROGRAMS_ADDED" \| "PROGRAMS_UPDATED" \| "OUTREACH_GENERATED" \| "STEP_RUN_STARTED" \| "STEP_RUN_FINISHED" \| "STEP_RUN_FAILED" \| "SPOC_APPROVED" \| "SPOC_REJECTED" \| "OUTREACH_UPDATED" \| "CLIENT_ASSIGNED" \| "NOTE_UPDATED" \| "TASK_ADDED" \| "TASK_UPDATED" \| "TASK_CLOSED" \| "SALES_STATUS_CHANGED" \| "INTERACTION_LOGGED"[] |  |  |

### `GET /api/clients/{id}/documents/{documentId}/url`
documents — presigned read URL, never the raw S3 key
*Needs permission `client_documents.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `documentId` | string (uuid) | yes |  |

### `POST /api/clients/{id}/documents`
Upload client document
*Needs permission `client_documents.upload`.* · multipart upload (field `file`)

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| form | `file` | string (binary) | yes |  |
| form | `typeId` | string (uuid) | yes |  |
| form | `fy` | string | yes |  |

### `DELETE /api/clients/{id}/documents/{documentId}`
Remove client document
*Needs permission `client_documents.delete`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `documentId` | string (uuid) | yes |  |

### `PUT /api/clients/{id}/financials`
financials — CSR figures and company figures, one row per FY
*Needs permission `client_financials.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `fy` | string | yes |  |
| body | `obligationRs` | number ≤10000000000000000 \| null |  |  |
| body | `budgetRs` | number ≤10000000000000000 \| null |  |  |
| body | `spentRs` | number ≤10000000000000000 \| null |  |  |
| body | `unspentRs` | number ≤10000000000000000 \| null |  |  |
| body | `evidence` | string ≤2000 \| null |  |  |

### `DELETE /api/clients/{id}/financials/{financialId}`
Remove csr financial
*Needs permission `client_financials.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `financialId` | string (uuid) | yes |  |

### `PUT /api/clients/{id}/corporate-financials`
Save corporate financial
*Needs permission `client_financials.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `fy` | string | yes |  |
| body | `revenueRs` | number ≤10000000000000000 \| null |  |  |
| body | `netProfitRs` | number ≤10000000000000000 \| null |  |  |
| body | `paidUpCapitalRs` | number ≤10000000000000000 \| null |  |  |
| body | `authorisedCapitalRs` | number ≤10000000000000000 \| null |  |  |
| body | `netWorthRs` | number ≤10000000000000000 \| null |  |  |
| body | `source` | string ≤500 \| null |  |  |

### `DELETE /api/clients/{id}/corporate-financials/{financialId}`
Remove corporate financial
*Needs permission `client_financials.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `financialId` | string (uuid) | yes |  |

### `POST /api/clients/{id}/csr-programs`
CSR programmes — the project table of the annual CSR report
*Needs permission `client_programs.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `fy` | string | yes |  |
| body | `name` | string ≤500 | yes |  |
| body | `sectorIds` | string (uuid)[] |  | default [] |
| body | `sectorText` | string ≤1000 \| null |  |  |
| body | `isOngoing` | boolean \| null |  |  |
| body | `duration` | string ≤100 \| null |  |  |
| body | `isLocalArea` | boolean \| null |  |  |
| body | `locations` | object[] |  |  |
| body | `locationNote` | string ≤2000 \| null |  |  |
| body | `budgetRs` | number ≤10000000000000000 \| null |  |  |
| body | `spentRs` | number ≤10000000000000000 \| null |  |  |
| body | `unspentTransferredRs` | number ≤10000000000000000 \| null |  |  |
| body | `mode` | "DIRECT" \| "AGENCY" \| null |  |  |
| body | `agencyId` | string (uuid) \| null |  |  |
| body | `agencyName` | string ≤300 \| null |  |  |
| body | `agencyRegistrationNo` | string \| null |  |  |
| body | `beneficiaries` | string ≤1000 \| null |  |  |
| body | `sdgs` | integer ≤17[] |  |  |
| body | `sourceUrl` | string (uri) \| string \| null |  |  |

### `PATCH /api/clients/{id}/csr-programs/{programId}`
Update csr program
*Needs permission `client_programs.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `programId` | string (uuid) | yes |  |
| body | `fy` | string |  |  |
| body | `name` | string ≤500 |  |  |
| body | `sectorIds` | string (uuid)[] |  |  |
| body | `sectorText` | string ≤1000 \| null |  |  |
| body | `isOngoing` | boolean \| null |  |  |
| body | `duration` | string ≤100 \| null |  |  |
| body | `isLocalArea` | boolean \| null |  |  |
| body | `locations` | object[] |  |  |
| body | `locationNote` | string ≤2000 \| null |  |  |
| body | `budgetRs` | number ≤10000000000000000 \| null |  |  |
| body | `spentRs` | number ≤10000000000000000 \| null |  |  |
| body | `unspentTransferredRs` | number ≤10000000000000000 \| null |  |  |
| body | `mode` | "DIRECT" \| "AGENCY" \| null |  |  |
| body | `agencyId` | string (uuid) \| null |  |  |
| body | `agencyName` | string ≤300 \| null |  |  |
| body | `agencyRegistrationNo` | string \| null |  |  |
| body | `beneficiaries` | string ≤1000 \| null |  |  |
| body | `sdgs` | integer ≤17[] |  |  |
| body | `sourceUrl` | string (uri) \| string \| null |  |  |
| body | `isLocked` | boolean |  |  |

### `DELETE /api/clients/{id}/csr-programs/{programId}`
Remove csr program
*Needs permission `client_programs.delete`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `programId` | string (uuid) | yes |  |

### `POST /api/clients/{id}/notes`
notes — read with the client; delete: own notes, or anyone's with client_notes.delete_any
*Needs permission `client_notes.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `content` | string ≤5000 | yes |  |
| body | `spocId` | string (uuid) \| null |  |  |
| body | `section` | "info" \| "branches" \| "skilling" \| "csr" \| "reports" \| "spocs" \| "technology" \| "outreach" \| "meetings" \| "sales_assets" \| "marketing_assets" |  |  |

### `PATCH /api/clients/{id}/notes/{noteId}`
Update client note
*Needs permission `client_notes.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `noteId` | string (uuid) | yes |  |
| body | `content` | string ≤5000 | yes |  |

### `DELETE /api/clients/{id}/notes/{noteId}`
Delete client note
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `noteId` | string (uuid) | yes |  |

### `GET /api/clients/{id}/tasks`
List client tasks
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| query | `spocId` | string (uuid) |  |  |
| query | `status` | "OPEN" \| "IN_PROGRESS" \| "DONE"[] |  |  |

### `POST /api/clients/{id}/tasks`
Create client task
*Needs permission `client_notes.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `spocId` | string (uuid) \| null |  |  |
| body | `kind` | "TASK" \| "CALL" \| "MEETING" |  | default "TASK" |
| body | `title` | string ≤300 | yes |  |
| body | `notes` | string ≤2000 \| null |  |  |
| body | `dueAt` | string (date-time) \| null |  |  |
| body | `assigneeId` | string (uuid) |  |  |

### `PATCH /api/clients/{id}/tasks/{taskId}`
Update client task
*Needs permission `client_notes.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `taskId` | string (uuid) | yes |  |
| body | `title` | string ≤300 |  |  |
| body | `notes` | string ≤2000 \| null |  |  |
| body | `dueAt` | string (date-time) \| null |  |  |
| body | `assigneeId` | string (uuid) |  |  |
| body | `status` | "OPEN" \| "IN_PROGRESS" \| "DONE" |  |  |
| body | `closeNote` | string ≤2000 \| null |  |  |

### `DELETE /api/clients/{id}/tasks/{taskId}`
Delete client task
*Needs permission `client_notes.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `taskId` | string (uuid) | yes |  |

### `POST /api/clients/{id}/interactions`
Log client interaction
*Needs permission `client_notes.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `spocId` | string (uuid) \| null |  |  |
| body | `channel` | "EMAIL" \| "CALL" \| "WHATSAPP" \| "LINKEDIN" \| "OTHER" | yes |  |
| body | `note` | string ≤2000 \| null |  |  |
| body | `connected` | boolean |  |  |

### `GET /api/clients/{id}/tasks/{taskId}/meeting`
the full meeting behind a MEETING task (CASPA meeting form) + files + lead approval
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `taskId` | string (uuid) | yes |  |

### `PUT /api/clients/{id}/tasks/{taskId}/meeting`
Save meeting
*Needs permission `client_notes.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `taskId` | string (uuid) | yes |  |
| body | `title` | string ≤300 |  |  |
| body | `spocId` | string (uuid) \| null |  |  |
| body | `dueAt` | string (date-time) \| null |  |  |
| body | `mode` | "virtual" \| "offline" \| null |  |  |
| body | `link` | string ≤1000 \| null |  |  |
| body | `revenueGenerated` | string ≤200 \| null |  |  |
| body | `attendeeCount` | integer ≤10000 \| null |  |  |
| body | `sfjAttendeeIds` | string (uuid)[] |  |  |
| body | `clientAttendeeNames` | string ≤2000 \| null |  |  |
| body | `clientAttendeeEmails` | string ≤2000 \| null |  |  |
| body | `minutes` | string ≤20000[] |  |  |
| body | `meetingStatus` | "Meeting Scheduled" \| "Completed" \| "Cancelled" \| null |  |  |
| body | `proposalStatus` | "Proposal Submitted" \| "Proposal Discussion" \| "Proposal Lost" \| "Proposal Deal Closed" \| "Proposal Deal Completed" \| null |  |  |
| body | `proposalDate` | string (date-time) \| null |  |  |
| body | `proposalAmountRs` | number ≤100000000000000 \| null |  |  |
| body | `tentativeDate` | string (date-time) \| null |  |  |
| body | `salesUserId` | string (uuid) \| null |  |  |
| body | `category` | "Enterprise -CSR" \| "Enterprise -KaaS" \| "Enterprise -OEM" \| "Enterprise -TaaS" \| "B2I -KaaS_Students" \| "B2I -OEM" \| "B2I -Faculty Deployment" \| "B2I -Faculty Training" \| "B2I -CSR" \| "B2G_Skilling -" \| "B2G_Skilling -CPSU Scheme Training" \| "B2G_Skilling -SPSU Scheme Training" \| "B2G_Skilling -OEM" \| "B2G_Skilling -TaaS" \| "B2G_Skilling -CSR" \| "B2G_PSU -KaaS" \| "B2G_PSU -OEM" \| "B2G_PSU -TaaS" \| "B2G_PSU -CSR" \| "Global -KaaS" \| "Global -OEM" \| "Global -CSR" \| "Global -TaaS" \| null |  |  |
| body | `notes` | string ≤5000 \| null |  |  |
| body | `mouShared` | boolean \| null |  |  |
| body | `creditSignedDate` | string (date-time) \| null |  |  |
| body | `mouStartDate` | string (date-time) \| null |  |  |
| body | `mouEndDate` | string (date-time) \| null |  |  |
| body | `semesters` | "1" \| "2" \| "3" \| "4" \| "5" \| "6" \| "7" \| "8"[] |  |  |
| body | `credits` | "1" \| "2" \| "3" \| "4" \| "5" \| "5+"[] |  |  |
| body | `studentCount` | integer ≤1000000 \| null |  |  |
| body | `courses` | string ≤100[] |  |  |
| body | `visitAddress` | string ≤500 \| null |  |  |
| body | `visitPincode` | string ≤10 \| null |  |  |
| body | `visitLat` | number ≤90 \| null |  |  |
| body | `visitLng` | number ≤180 \| null |  |  |

### `POST /api/clients/{id}/tasks/{taskId}/meeting/files`
Upload meeting file
*Needs permission `client_notes.create`.* · multipart upload (field `file`)

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `taskId` | string (uuid) | yes |  |
| form | `file` | string (binary) | yes |  |
| form | `kind` | "MOM" \| "RFP" \| "PROPOSAL" \| "MOU" \| "CREDIT_LETTER" \| "SALES_PITCH" \| "VISIT_PHOTO" | yes |  |

### `GET /api/clients/{id}/tasks/{taskId}/meeting/files/{fileId}/url`
Meeting file url
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `taskId` | string (uuid) | yes |  |
| path | `fileId` | string (uuid) | yes |  |

### `DELETE /api/clients/{id}/tasks/{taskId}/meeting/files/{fileId}`
Delete meeting file
*Needs permission `client_notes.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `taskId` | string (uuid) | yes |  |
| path | `fileId` | string (uuid) | yes |  |

### `POST /api/clients/{id}/tasks/{taskId}/meeting/approval`
Decide meeting
*Needs permission `clients.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `taskId` | string (uuid) | yes |  |
| body | `decision` | "APPROVED" \| "REJECTED" | yes |  |
| body | `note` | string ≤500 |  |  |

### `POST /api/clients/{id}/locations`
locations + technologies
*Needs permission `client_locations.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `typeId` | string (uuid) \| null |  |  |
| body | `name` | string ≤200 \| null |  |  |
| body | `addressLine` | string ≤500 \| null |  |  |
| body | `city` | string ≤100 \| null |  |  |
| body | `district` | string ≤100 \| null |  |  |
| body | `state` | string ≤100 \| null |  |  |
| body | `country` | string ≤100 \| null |  |  |
| body | `pincode` | string ≤10 \| null |  |  |
| body | `latitude` | number ≤90 \| null |  |  |
| body | `longitude` | number ≤180 \| null |  |  |
| body | `isPrimary` | boolean |  |  |
| body | `dmEvidence` | string ≤2000 \| null |  |  |

### `PATCH /api/clients/{id}/locations/{locationId}`
Update client location
*Needs permission `client_locations.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `locationId` | string (uuid) | yes |  |
| body | `typeId` | string (uuid) \| null |  |  |
| body | `name` | string ≤200 \| null |  |  |
| body | `addressLine` | string ≤500 \| null |  |  |
| body | `city` | string ≤100 \| null |  |  |
| body | `district` | string ≤100 \| null |  |  |
| body | `state` | string ≤100 \| null |  |  |
| body | `country` | string ≤100 \| null |  |  |
| body | `pincode` | string ≤10 \| null |  |  |
| body | `latitude` | number ≤90 \| null |  |  |
| body | `longitude` | number ≤180 \| null |  |  |
| body | `isPrimary` | boolean |  |  |
| body | `dmEvidence` | string ≤2000 \| null |  |  |

### `DELETE /api/clients/{id}/locations/{locationId}`
Remove client location
*Needs permission `client_locations.delete`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `locationId` | string (uuid) | yes |  |

### `PUT /api/clients/{id}/technologies`
Save client technology
*Needs permission `client_technologies.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `categoryId` | string (uuid) | yes |  |
| body | `details` | string ≤2000 | yes |  |

### `DELETE /api/clients/{id}/technologies/{technologyId}`
Remove client technology
*Needs permission `client_technologies.delete`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `technologyId` | string (uuid) | yes |  |
## csr-agencies

### `GET /api/csr-agencies`
List csr agencies
*Needs permission `client_programs.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `search` | string ≤100 |  |  |
## spocs

### `GET /api/spocs`
List spocs
*Needs permission `spocs.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `search` | string |  |  |
| query | `clientId` | string (uuid) |  |  |
| query | `handlerId` | string (uuid)[] |  |  |
| query | `handledBy` | "me" \| "team" |  |  |
| query | `businessUnitId` | string (uuid)[] |  |  |
| query | `serviceLineId` | string (uuid)[] |  |  |
| query | `salesStatusId` | string (uuid)[] |  |  |
| query | `emailStatus` | "UNVERIFIED" \| "GOOD" \| "RISKY" \| "BAD"[] |  |  |
| query | `validationBand` | "READY" \| "REVIEW" \| "NOT_USABLE"[] |  |  |
| query | `approvalStatus` | "PENDING" \| "APPROVED" \| "REJECTED"[] |  |  |
| query | `reviewFlag` | "true" \| "false" |  |  |
| query | `dataFlag` | "CONTACT_WRONG" \| "EMAIL_WRONG" \| "BOTH_WRONG" \| string[] |  |  |
| query | `keyAccount` | "me" \| "any" \| "none" |  |  |
| query | `projectId` | string (uuid)[] |  |  |
| query | `erp` | string ≤100 |  |  |
| query | `isActive` | "true" \| "false" |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |
| query | `sortBy` | "firstName" \| "createdAt" \| "updatedAt" \| "validationScore" | yes | default "createdAt" |
| query | `sortDir` | "asc" \| "desc" | yes | default "desc" |

### `POST /api/spocs`
Create spoc
*Needs permission `spocs.create`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `clientId` | string (uuid) | yes |  |
| body | `handlerId` | string (uuid) | yes |  |
| body | `firstName` | string ≤100 | yes |  |
| body | `lastName` | string ≤100 \| null |  |  |
| body | `email` | string (email) \| string \| null |  |  |
| body | `phone` | string ≤30 \| null |  |  |
| body | `designation` | string ≤200 \| null |  |  |
| body | `department` | string ≤200 \| null |  |  |
| body | `linkedinUrl` | string (uri) \| string \| null |  |  |
| body | `seniority` | string ≤50 \| null |  |  |
| body | `totalExpYears` | number ≤99.9 \| null |  |  |
| body | `currentOrgExpYears` | number ≤99.9 \| null |  |  |
| body | `businessUnitId` | string (uuid) | yes |  |
| body | `serviceLineId` | string (uuid) | yes |  |
| body | `locationId` | string (uuid) \| null |  |  |
| body | `sourceId` | string (uuid) \| null |  |  |
| body | `emailSourceId` | string (uuid) \| null |  |  |
| body | `salesStatusId` | string (uuid) \| null |  |  |
| body | `isPrimary` | boolean |  |  |
| body | `notes` | string ≤2000 \| null |  |  |
| body | `erp` | string ≤100 \| null |  |  |
| body | `dataFlag` | "CONTACT_WRONG" \| "EMAIL_WRONG" \| "BOTH_WRONG" \| null |  |  |
| body | `projectIds` | string (uuid)[] |  |  |
| body | `phone2` | string ≤30 \| null |  |  |
| body | `phone3` | string ≤30 \| null |  |  |
| body | `state` | string ≤100 \| null |  |  |
| body | `district` | string ≤100 \| null |  |  |
| body | `city` | string ≤100 \| null |  |  |
| body | `pincode` | string ≤10 \| null |  |  |
| body | `address` | string ≤500 \| null |  |  |
| body | `callConnected` | boolean \| null |  |  |
| body | `roleCategoryId` | string (uuid) \| null |  |  |
| body | `decisionAuthorityId` | string (uuid) \| null |  |  |
| body | `orgTypeId` | string (uuid) \| null |  |  |
| body | `revenueBandId` | string (uuid) \| null |  |  |

### `GET /api/spocs/stats`
Spoc stats
*Needs permission `spocs.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `search` | string |  |  |
| query | `clientId` | string (uuid) |  |  |
| query | `handlerId` | string (uuid)[] |  |  |
| query | `handledBy` | "me" \| "team" |  |  |
| query | `businessUnitId` | string (uuid)[] |  |  |
| query | `serviceLineId` | string (uuid)[] |  |  |
| query | `salesStatusId` | string (uuid)[] |  |  |
| query | `emailStatus` | "UNVERIFIED" \| "GOOD" \| "RISKY" \| "BAD"[] |  |  |
| query | `validationBand` | "READY" \| "REVIEW" \| "NOT_USABLE"[] |  |  |
| query | `approvalStatus` | "PENDING" \| "APPROVED" \| "REJECTED"[] |  |  |
| query | `reviewFlag` | "true" \| "false" |  |  |
| query | `dataFlag` | "CONTACT_WRONG" \| "EMAIL_WRONG" \| "BOTH_WRONG" \| string[] |  |  |
| query | `keyAccount` | "me" \| "any" \| "none" |  |  |
| query | `projectId` | string (uuid)[] |  |  |
| query | `erp` | string ≤100 |  |  |
| query | `isActive` | "true" \| "false" |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |
| query | `sortBy` | "firstName" \| "createdAt" \| "updatedAt" \| "validationScore" | yes | default "createdAt" |
| query | `sortDir` | "asc" \| "desc" | yes | default "desc" |

### `PATCH /api/spocs/bulk-assign`
bulk — before /:id so "bulk-assign" isn't read as an id
*Needs permission `spocs.assign`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `spocIds` | string (uuid)[] | yes |  |
| body | `assignToId` | string (uuid) | yes |  |
| body | `reason` | string ≤500 \| null |  |  |

### `PATCH /api/spocs/bulk-update`
Bulk update spocs
*Needs permission `spocs.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `spocIds` | string (uuid)[] | yes |  |
| body | `salesStatusId` | string (uuid) \| null |  |  |
| body | `dataFlag` | "CONTACT_WRONG" \| "EMAIL_WRONG" \| "BOTH_WRONG" \| null |  |  |
| body | `erp` | string ≤100 \| null |  |  |
| body | `projectIds` | string (uuid)[] |  |  |
| body | `projectMode` | "add" \| "remove" \| "replace" |  | default "add" |

### `POST /api/spocs/approval`
Decide spoc approval
*Needs permission `spocs.approve`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `spocIds` | string (uuid)[] | yes |  |
| body | `decision` | "PENDING" \| "APPROVED" \| "REJECTED" | yes |  |
| body | `note` | string ≤500 \| null |  |  |

### `GET /api/spocs/{id}`
out of scope = 404, never 403
*Needs permission `spocs.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PATCH /api/spocs/{id}`
Update spoc
*Needs permission `spocs.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `firstName` | string ≤100 |  |  |
| body | `lastName` | string ≤100 \| null |  |  |
| body | `email` | string (email) \| string \| null |  |  |
| body | `phone` | string ≤30 \| null |  |  |
| body | `designation` | string ≤200 \| null |  |  |
| body | `department` | string ≤200 \| null |  |  |
| body | `linkedinUrl` | string (uri) \| string \| null |  |  |
| body | `seniority` | string ≤50 \| null |  |  |
| body | `totalExpYears` | number ≤99.9 \| null |  |  |
| body | `currentOrgExpYears` | number ≤99.9 \| null |  |  |
| body | `businessUnitId` | string (uuid) |  |  |
| body | `serviceLineId` | string (uuid) |  |  |
| body | `locationId` | string (uuid) \| null |  |  |
| body | `sourceId` | string (uuid) \| null |  |  |
| body | `emailSourceId` | string (uuid) \| null |  |  |
| body | `salesStatusId` | string (uuid) \| null |  |  |
| body | `isPrimary` | boolean |  |  |
| body | `notes` | string ≤2000 \| null |  |  |
| body | `erp` | string ≤100 \| null |  |  |
| body | `dataFlag` | "CONTACT_WRONG" \| "EMAIL_WRONG" \| "BOTH_WRONG" \| null |  |  |
| body | `projectIds` | string (uuid)[] |  |  |
| body | `phone2` | string ≤30 \| null |  |  |
| body | `phone3` | string ≤30 \| null |  |  |
| body | `state` | string ≤100 \| null |  |  |
| body | `district` | string ≤100 \| null |  |  |
| body | `city` | string ≤100 \| null |  |  |
| body | `pincode` | string ≤10 \| null |  |  |
| body | `address` | string ≤500 \| null |  |  |
| body | `callConnected` | boolean \| null |  |  |
| body | `roleCategoryId` | string (uuid) \| null |  |  |
| body | `decisionAuthorityId` | string (uuid) \| null |  |  |
| body | `orgTypeId` | string (uuid) \| null |  |  |
| body | `revenueBandId` | string (uuid) \| null |  |  |

### `DELETE /api/spocs/{id}`
Delete spoc
*Needs permission `spocs.delete`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PATCH /api/spocs/{id}/assign`
Assign spoc
*Needs permission `spocs.assign`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `assignToId` | string (uuid) | yes |  |
| body | `reason` | string ≤500 \| null |  |  |

### `POST /api/spocs/{id}/key-account`
personal key-account star (one holder per SPOC)
*Needs permission `spocs.update`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## notifications

### `GET /api/notifications`
Get notifications
*Signed-in user.*

### `DELETE /api/notifications`
Clear read notifications
*Signed-in user.*

### `PATCH /api/notifications/read-all`
Mark all as read
*Signed-in user.*

### `PATCH /api/notifications/{id}/read`
Mark as read
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `DELETE /api/notifications/{id}`
Delete notification
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## pipeline-steps

### `GET /api/pipeline-steps`
List pipeline steps
*Needs permission `step_runs.read`.*
## step-runs

### `GET /api/step-runs`
List step runs
*Needs permission `step_runs.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `clientId` | string (uuid) |  |  |
| query | `spocId` | string (uuid) |  |  |
| query | `status` | "QUEUED" \| "RUNNING" \| "DONE" \| "EMPTY" \| "FAILED" \| "STOPPED" \| "DISPATCH_FAILED" \| "TIMED_OUT"[] |  |  |
| query | `stepId` | string (uuid)[] |  |  |
| query | `requestedById` | string (uuid)[] |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |

### `POST /api/step-runs`
Create step run
*Needs permission `step_runs.run`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `stepKey` | string ≤60 | yes |  |
| body | `clientId` | string (uuid) | yes |  |
| body | `spocIds` | string (uuid)[] |  |  |
| body | `businessUnitId` | string (uuid) |  |  |
| body | `serviceLineId` | string (uuid) |  |  |
| body | `rerun` | boolean |  |  |
| body | `options` | object |  |  |

### `GET /api/step-runs/overview`
before /:id so "overview" isn't read as an id
*Needs permission `step_runs.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `clientId` | string (uuid) | yes |  |

### `GET /api/step-runs/{id}`
out of scope = 404, never 403
*Needs permission `step_runs.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/step-runs/{id}/stop`
Stop step run
*Needs permission `step_runs.cancel`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## outreach

### `GET /api/outreach`
List outreach
*Needs permission `outreach.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `clientId` | string (uuid) |  |  |
| query | `spocId` | string (uuid) |  |  |
| query | `status` | "DRAFT" \| "REVIEWED" \| "SENT" \| "REPLIED" \| "NO_REPLY" \| "BOUNCED" |  |  |
| query | `search` | string ≤200 |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |

### `GET /api/outreach/{id}`
Get outreach pack
*Needs permission `outreach.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PATCH /api/outreach/{id}/status`
Set outreach status
*Needs permission `outreach.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `status` | "DRAFT" \| "REVIEWED" \| "REPLIED" \| "NO_REPLY" \| "BOUNCED" | yes |  |
| body | `note` | string ≤2000 |  |  |
| body | `repliedAt` | string (date-time) |  |  |

### `PATCH /api/outreach/{id}/messages/{messageId}`
Edit outreach message
*Needs permission `outreach.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `messageId` | string (uuid) | yes |  |
| body | `subject` | string ≤500 |  |  |
| body | `body` | string ≤20000 |  |  |

### `PATCH /api/outreach/{id}/messages/{messageId}/sent`
Mark outreach sent
*Needs permission `outreach.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `messageId` | string (uuid) | yes |  |
| body | `sent` | boolean | yes |  |
| body | `sentAt` | string (date-time) |  |  |
## integrations

### `GET /api/integrations`
List integrations
*Needs permission `integrations.manage`.*

### `PATCH /api/integrations/steps/{id}`
Update pipeline step
*Needs permission `integrations.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `label` | string ≤100 |  |  |
| body | `isActive` | boolean |  |  |
| body | `userClientLimit` | integer ≤100000 \| null |  |  |
| body | `rerunAfterDays` | integer ≤3650 \| null |  |  |
| body | `config` | object \| null |  |  |

### `GET /api/integrations/{id}/health`
Get service health
*Needs permission `integrations.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/integrations/{id}/test-key`
Test service key
*Needs permission `integrations.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `provider` | "apollo" \| "anthropic" \| "brightdata" \| "bouncer" \| "s3" | yes |  |

### `POST /api/integrations/{id}/rotate-key`
Rotate inbound key
*Needs permission `integrations.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PATCH /api/integrations/{id}`
Update service
*Needs permission `integrations.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `baseUrl` | string (uri) ≤500 \| null |  |  |
| body | `isActive` | boolean |  |  |
| body | `timeoutMins` | integer ≤1440 |  |  |
| body | `maxDispatchTries` | integer ≤20 |  |  |
## system-alerts

### `GET /api/system-alerts`
List alerts
*Needs permission `system_alerts.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `status` | "open" \| "resolved" \| "all" |  | default "open" |
| query | `severity` | "INFO" \| "SUCCESS" \| "WARNING" \| "ERROR" |  |  |
| query | `source` | "pipeline" \| "engine" \| "api" |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |

### `POST /api/system-alerts/resolve`
Resolve alerts
*Needs permission `system_alerts.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `ids` | string (uuid)[] | yes |  |
## run-quotas

### `GET /api/run-quotas`
List run quotas
*Needs permission `run_slots.manage`.*

### `POST /api/run-quotas`
Create run quota
*Needs permission `run_slots.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `stepId` | string (uuid) \| null |  |  |
| body | `roleId` | string (uuid) \| null |  |  |
| body | `userId` | string (uuid) \| null |  |  |
| body | `period` | "DAY" \| "WEEK" \| "MONTH" | yes |  |
| body | `maxRuns` | integer ≤10000 | yes |  |
| body | `isActive` | boolean |  |  |

### `PATCH /api/run-quotas/{id}`
Update run quota
*Needs permission `run_slots.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `period` | "DAY" \| "WEEK" \| "MONTH" |  |  |
| body | `maxRuns` | integer ≤10000 |  |  |
| body | `isActive` | boolean |  |  |

### `DELETE /api/run-quotas/{id}`
Delete run quota
*Needs permission `run_slots.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## geo

### `GET /api/geo/countries`
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `q` | string ≤100 |  |  |
| query | `country` | string ≤100[] |  |  |
| query | `state` | string ≤100[] |  |  |
| query | `limit` | integer ≤500 |  | default 100 |

### `GET /api/geo/states`
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `q` | string ≤100 |  |  |
| query | `country` | string ≤100[] |  |  |
| query | `state` | string ≤100[] |  |  |
| query | `limit` | integer ≤500 |  | default 100 |

### `GET /api/geo/cities`
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `q` | string ≤100 |  |  |
| query | `country` | string ≤100[] |  |  |
| query | `state` | string ≤100[] |  |  |
| query | `limit` | integer ≤500 |  | default 100 |
## reports

### `GET /api/reports/overview`
Get overview
*Needs permission `reports.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `from` | string |  |  |
| query | `to` | string |  |  |

### `GET /api/reports/breakdown`
Get breakdown
*Needs permission `reports.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `entity` | "spocs" \| "clients" | yes |  |
| query | `groupBy` | string | yes |  |
| query | `splitBy` | string |  |  |
| query | `limit` | integer ≤200 |  | default 50 |
| query | `from` | string |  |  |
| query | `to` | string |  |  |
| query | `clientId` | string (uuid) |  |  |
| query | `handlerId` | string (uuid) |  |  |
| query | `businessUnitId` | string (uuid) |  |  |
| query | `serviceLineId` | string (uuid) |  |  |
| query | `salesStatusId` | string (uuid) |  |  |
| query | `emailStatus` | "UNVERIFIED" \| "GOOD" \| "RISKY" \| "BAD" |  |  |
| query | `validationBand` | "READY" \| "REVIEW" \| "NOT_USABLE" |  |  |
| query | `isActive` | "true" \| "false" |  |  |
| query | `status` | "PENDING" \| "ACTIVE" \| "INACTIVE" |  |  |
| query | `industryId` | string (uuid) |  |  |
| query | `categoryId` | string (uuid) |  |  |
| query | `state` | string |  |  |
| query | `city` | string |  |  |

### `GET /api/reports/trend`
Get trend
*Needs permission `reports.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `entity` | "clients" \| "spocs" \| "activities" \| "notes" | yes |  |
| query | `interval` | "day" \| "week" \| "month" |  | default "week" |
| query | `from` | string |  |  |
| query | `to` | string |  |  |
| query | `groupBy` | string |  |  |
| query | `top` | integer ≤20 |  | default 5 |

### `GET /api/reports/activities`
List report activities
*Needs permission `reports.read`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `type` | "CLIENT_CREATED" \| "CLIENT_UPDATED" \| "CLIENT_APPROVED" \| "SPOC_ADDED" \| "SPOC_UPDATED" \| "SPOC_REASSIGNED" \| "NOTE_ADDED" \| "LOCATION_ADDED" \| "TECHNOLOGY_UPDATED" \| "DOCUMENT_ADDED" \| "FINANCIALS_UPDATED" \| "PROGRAMS_ADDED" \| "PROGRAMS_UPDATED" \| "OUTREACH_GENERATED" \| "STEP_RUN_STARTED" \| "STEP_RUN_FINISHED" \| "STEP_RUN_FAILED" \| "SPOC_APPROVED" \| "SPOC_REJECTED" \| "OUTREACH_UPDATED" \| "CLIENT_ASSIGNED" \| "NOTE_UPDATED" \| "TASK_ADDED" \| "TASK_UPDATED" \| "TASK_CLOSED" \| "SALES_STATUS_CHANGED" \| "INTERACTION_LOGGED" |  |  |
| query | `actorId` | string (uuid) |  |  |
| query | `clientId` | string (uuid) |  |  |
| query | `spocId` | string (uuid) |  |  |
| query | `from` | string |  |  |
| query | `to` | string |  |  |
| query | `page` | integer ≤9007199254740991 |  | default 1 |
| query | `limit` | integer ≤100 |  | default 25 |
## search

### `GET /api/search`
permission checks per section happen in the controller
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `q` | string ≤100 | yes |  |
| query | `limit` | integer ≤20 |  | default 5 |
## ai

### `GET /api/ai/me`
me
*Signed-in user.*

### `PUT /api/ai/me/preference`
Set ai preference
*Signed-in user.*

### `GET /api/ai/insights`
COMMAND
*Signed-in user. AI mode COMMAND must be on for the user.*

### `POST /api/ai/command/local`
Log local command
*Signed-in user. AI mode COMMAND must be on for the user.*

### `POST /api/ai/command`
Run command
*Signed-in user. AI mode COMMAND must be on for the user.*

### `POST /api/ai/canvas/generate`
CANVAS
*Signed-in user. AI mode CANVAS must be on for the user.*

### `POST /api/ai/canvas/run`
Run
*Signed-in user. AI mode CANVAS must be on for the user.*

### `GET /api/ai/canvas/templates`
List templates
*Signed-in user. AI mode CANVAS must be on for the user.*

### `POST /api/ai/canvas/templates`
Save template
*Needs permission `ai_assistant.canvas_save_template`. AI mode CANVAS must be on for the user.*

### `DELETE /api/ai/canvas/templates/{id}`
Delete template
*Signed-in user. AI mode CANVAS must be on for the user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/ai/canvas/export`
exports are for the super admin only
*Super admin only. AI mode CANVAS must be on for the user.*

### `POST /api/ai/assist`
THREADS — saved conversations (follow-ups, explain, memory). Same guards as canvas.
*Signed-in user. AI mode CANVAS must be on for the user.*

### `POST /api/ai/threads/ask`
Ask
*Signed-in user. AI mode CANVAS must be on for the user.*

### `GET /api/ai/threads`
List
*Signed-in user. AI mode CANVAS must be on for the user.*

### `POST /api/ai/threads`
Create from spec
*Signed-in user. AI mode CANVAS must be on for the user.*

### `GET /api/ai/suggestions`
Suggestions
*Signed-in user. AI mode CANVAS must be on for the user.*

### `GET /api/ai/threads/{id}`
Open
*Signed-in user. AI mode CANVAS must be on for the user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PATCH /api/ai/threads/{id}`
Patch
*Signed-in user. AI mode CANVAS must be on for the user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `DELETE /api/ai/threads/{id}`
Remove
*Signed-in user. AI mode CANVAS must be on for the user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PUT /api/ai/threads/{id}/spec`
Edit spec
*Signed-in user. AI mode CANVAS must be on for the user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `GET /api/ai/settings`
Get settings
*Needs permission `ai_assistant.settings_manage`.*

### `PUT /api/ai/settings`
Update settings
*Needs permission `ai_assistant.settings_manage`.*

### `PUT /api/ai/settings/quotas`
Upsert quotas
*Needs permission `ai_assistant.settings_manage`.*

### `POST /api/ai/settings/overrides`
Upsert override
*Needs permission `ai_assistant.settings_manage`.*

### `DELETE /api/ai/settings/overrides/{id}`
Delete override
*Needs permission `ai_assistant.settings_manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/ai/settings/pricing`
Add pricing
*Needs permission `ai_assistant.settings_manage`.*

### `GET /api/ai/settings/templates`
List command templates
*Needs permission `ai_assistant.settings_manage`.*

### `PATCH /api/ai/settings/templates/{id}`
Patch command template
*Needs permission `ai_assistant.settings_manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `GET /api/ai/usage`
Get usage
*Needs permission `ai_assistant.usage_view`.*

### `GET /api/ai/usage/export`
Export usage
*Super admin only.*
## recycle-bin

### `GET /api/recycle-bin`
List bin
*Needs permission `recycle_bin.read`.*

### `GET /api/recycle-bin/categories`
Bin categories
*Needs permission `recycle_bin.read`.*

### `POST /api/recycle-bin/batches/{id}/undo`
Undo batch
*Needs permission `recycle_bin.restore`.*

### `POST /api/recycle-bin/{id}/restore`
Restore one entry
*Needs permission `recycle_bin.restore`.*
## tickets

### `GET /api/tickets`
List tickets
*Signed-in user.*

### `POST /api/tickets`
Create ticket
*Signed-in user.*

### `GET /api/tickets/{id}`
Get ticket
*Signed-in user.*

### `PATCH /api/tickets/{id}`
Update ticket
*Needs permission `support.manage`.*

### `GET /api/tickets/{id}/attachments/{aid}`
Get attachment
*Signed-in user.*

### `POST /api/tickets/{id}/attachments`
Add recording
*Signed-in user.*

### `POST /api/tickets/{id}/comments`
Add comment
*Signed-in user.*

### `POST /api/tickets/{id}/request-repro`
Request repro
*Needs permission `support.manage`.*

### `POST /api/tickets/{id}/diagnose`
Diagnose ticket
*Needs permission `support.diagnose`.*
## platform

### `POST /api/platform/auth/login`
Platform login
*No sign-in.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `email` | string (email) | yes |  |
| body | `password` | string | yes |  |

### `POST /api/platform/auth/logout`
Platform logout
*No sign-in.*

### `GET /api/platform/auth/me`
Platform me
*Enterprise console sign-in (platform admin).*

### `GET /api/platform/overview`
Get platform overview
*Enterprise console sign-in (platform admin).*

### `POST /api/platform/tenants`
Create tenant
*Enterprise console sign-in (platform admin).*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `name` | string ≤120 | yes |  |
| body | `slug` | string | yes |  |
| body | `legalName` | string ≤200 \| null |  |  |
| body | `plan` | "TRIAL" \| "STANDARD" \| "ENTERPRISE" |  | default "STANDARD" |
| body | `maxUsers` | integer ≤100000 \| null |  |  |
| body | `admin` | object | yes |  |
| body | `templateTenantId` | string (uuid) \| null |  |  |

### `GET /api/platform/tenants/{id}`
Get tenant
*Enterprise console sign-in (platform admin).*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `PATCH /api/platform/tenants/{id}`
Update tenant
*Enterprise console sign-in (platform admin).*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `name` | string ≤120 |  |  |
| body | `legalName` | string ≤200 \| null |  |  |
| body | `plan` | "TRIAL" \| "STANDARD" \| "ENTERPRISE" |  |  |
| body | `maxUsers` | integer ≤100000 \| null |  |  |
| body | `status` | "ACTIVE" \| "SUSPENDED" |  |  |

### `GET /api/platform/tenants/{id}/users`
List tenant users
*Enterprise console sign-in (platform admin).*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/platform/tenants/{id}/users/{userId}/invite`
Resend invite
*Enterprise console sign-in (platform admin).*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| path | `userId` | string (uuid) | yes |  |

### `GET /api/platform/alerts`
List platform alerts
*Enterprise console sign-in (platform admin).*

### `PATCH /api/platform/alerts/{id}/resolve`
Resolve platform alert
*Enterprise console sign-in (platform admin).*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `GET /api/platform/services`
List platform services
*Enterprise console sign-in (platform admin).*

### `GET /api/platform/audit`
List platform audit
*Enterprise console sign-in (platform admin).*
## svc

### `GET /api/svc/health`
*Engines only (X-Service-Key) — not for the frontend.*

### `GET /api/svc/step-runs/{id}`
Get run input
*Engines only (X-Service-Key) — not for the frontend.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/svc/step-runs/{id}/events`
Post run event
*Engines only (X-Service-Key) — not for the frontend.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `status` | string |  |  |
| body | `progress` | integer ≤100 |  |  |
| body | `note` | string \| null |  |  |
| body | `message` | string \| null |  |  |

### `POST /api/svc/step-runs/{id}/results`
Post run results
*Engines only (X-Service-Key) — not for the frontend.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `status` | "DONE" \| "EMPTY" \| "FAILED" \| "STOPPED" | yes |  |
| body | `summary` | object |  |  |
| body | `viewData` | object |  |  |
| body | `error` | object |  |  |
| body | `costUsd` | number ≤100000 \| null |  |  |
| body | `credits` | object |  |  |
| body | `data` | object |  |  |
## views

### `GET /api/views`
List views
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `module` | string ≤50 |  |  |

### `POST /api/views`
Create view
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `module` | string ≤50 | yes |  |
| body | `name` | string ≤100 | yes |  |
| body | `config` | object | yes |  |
| body | `isDefault` | boolean |  |  |
| body | `isShared` | boolean |  |  |

### `PATCH /api/views/{id}`
Update view
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `module` | string ≤50 |  |  |
| body | `name` | string ≤100 |  |  |
| body | `config` | object |  |  |
| body | `isDefault` | boolean |  |  |
| body | `isShared` | boolean |  |  |

### `DELETE /api/views/{id}`
Delete view
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
## column-access

### `GET /api/column-access/{table}/mine`
Get my hidden columns
*Signed-in user.*

### `GET /api/column-access/{table}`
Get column access
*Needs permission `roles.read`.*

### `PUT /api/column-access/{table}/{roleId}`
Save column access
*Needs permission `roles.assign_permissions`.*
## faqs

### `GET /api/faqs`
List faqs
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| query | `search` | string |  |  |
| query | `category` | string |  |  |
| query | `module` | string |  |  |
| query | `includeUnpublished` | "true" \| "false" |  |  |

### `POST /api/faqs`
Create faq
*Needs permission `help.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| body | `question` | string ≤300 | yes |  |
| body | `answer` | string ≤10000 | yes |  |
| body | `category` | string ≤100 | yes |  |
| body | `module` | string ≤50 \| null |  |  |
| body | `order` | integer ≤9007199254740991 |  |  |
| body | `isPublished` | boolean |  |  |

### `GET /api/faqs/categories`
List faq categories
*Signed-in user.*

### `PUT /api/faqs/{id}`
Update faq
*Needs permission `help.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `question` | string ≤300 |  |  |
| body | `answer` | string ≤10000 |  |  |
| body | `category` | string ≤100 |  |  |
| body | `module` | string ≤50 \| null |  |  |
| body | `order` | integer ≤9007199254740991 |  |  |
| body | `isPublished` | boolean |  |  |

### `DELETE /api/faqs/{id}`
Delete faq
*Needs permission `help.manage`.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |

### `POST /api/faqs/{id}/feedback`
any logged-in reader
*Signed-in user.*

| in | field | type | required | notes |
|---|---|---|---|---|
| path | `id` | string (uuid) | yes |  |
| body | `helpful` | boolean | yes |  |
