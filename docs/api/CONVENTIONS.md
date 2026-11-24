# API conventions

Rules every endpoint follows. Endpoint-by-endpoint detail: [ENDPOINTS.md](./ENDPOINTS.md).

## Base URL

| Where | Base |
|---|---|
| Shared dev backend (the backend developer's PC, via tunnel) | `https://<current>.trycloudflare.com` — ask for the current link |
| Local backend | `http://localhost:5005` |
| Deployed | `https://sift-backend-173405861722.asia-south1.run.app` |

All routes are under **`/api`**: e.g. `GET {base}/api/clients`.

The web app never calls the backend directly: Next.js rewrites `/api/proxy/*` to `NEXT_PUBLIC_API_URL`, so the browser
stays on its own origin and the session cookies are first-party (`crm/src/config/env.ts`: `API_BASE = /api/proxy/api`).
Set `NEXT_PUBLIC_API_URL` to the base above (no trailing `/api`).

## Sign-in

- `POST /api/auth/login` `{ email, password }` → sets httpOnly cookies `accessToken` (8 h) and `refreshToken` (9 h) and
  returns the user + permission map in `data`.
- On **401** with `code: "NO_TOKEN" | "INVALID_TOKEN"` call `POST /api/auth/refresh` once, then retry; if refresh fails,
  send the user to sign-in. (`crm/src/lib/api/client.ts` already does this.)
- `GET /api/auth/me` — who is signed in. `POST /api/auth/logout` — ends **all** of the user's sessions.
- Phone app / scripts: send `X-Client: mobile` on login and refresh to get `{ tokens: { accessToken, refreshToken } }`
  in the body; then `Authorization: Bearer <accessToken>`.
- **Permissions:** `GET /api/me/permissions` → `{ "clients.read": true | "<scope>", … }`. Hide what the user can't do;
  the API still checks every call. Super admins have everything.

## Response envelope

Every JSON response:

```jsonc
// success
{ "success": true, "data": <object | array>, "meta": { "total": 363, "page": 1, "limit": 25, "pages": 15 } }  // meta only on lists
// failure
{ "success": false, "code": "FORBIDDEN", "message": "Missing permission: clients.update" }
```

| Status | When | Body extras |
|---|---|---|
| 400 | Input failed validation | `message: "Validation failed"`, `errors: [{ field, message, code }]` |
| 401 | Not signed in / session expired | `code: NO_TOKEN \| INVALID_TOKEN` → refresh |
| 403 | Signed in, missing the permission | `code: FORBIDDEN` |
| 404 | Not found **or outside the user's scope** (we never confirm a record exists to someone who can't see it) | `code: NOT_FOUND` |
| 409 | Conflict (duplicate, already done) | `code` says which |
| 429 | Rate limited | — |
| 5xx | Server error | `code` when known (`STORAGE_UNAVAILABLE` …) |

Every response carries **`X-Request-Id`** — quote it in bug reports; the server's log for that request can be found with it.

## Lists

- `?page=1&limit=25` — `limit` max **100**. `meta` tells `total` and `pages`.
- `?search=` — free text (each list says which fields it searches).
- `?sortBy=<field>&sortDir=asc|desc` — allowed `sortBy` values are listed per endpoint (enum).
- **Several values:** comma-separated, e.g. `?status=ACTIVE,PENDING&categoryId=<id>,<id>`.
- Shortcuts on clients / SPOCs: `assignedTo=me|team|none|<userId>`, `handledBy=me|team`, `keyAccount=me|any|none`.
- Booleans in queries are the strings `true` / `false`.

## Values

- **IDs:** UUID strings.
- **Dates:** ISO-8601 strings. Date-only fields (`proposalDate`, FY figures) are `YYYY-MM-DD`; timestamps are full
  date-times in UTC (`2026-11-21T04:30:00.000Z`) — show them in IST.
- **Money:** rupees, as a **decimal string** (`"124000000000.00"`), field names end in `Rs`. Format as ₹ crore / lakh in the UI.
- **Financial years:** `"2024-25"`.
- **Pick-lists** (industry, category, sales status …): `{ id, code, label }` from `GET /api/lookups?type=<TYPE>`; send the `id`.
- **Clearing a field:** send `null` (or `""` for text). Leaving a field out of a PATCH/PUT leaves it unchanged.
- **Files:** `multipart/form-data`, field `file` (max 25 MB; PDF, Office, CSV, text, images). Files are read back through
  a short-lived signed URL endpoint (`…/url`), never a raw storage key.

## Multi-company

Every user belongs to one company (tenant); the API scopes everything to it automatically. Nothing to send.
