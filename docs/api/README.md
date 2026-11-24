# SFJBS CRM API — how we work

**Backend + phone app** are built in `crm-core-service` (this repo) and `crm-mobile`.
**Web frontend** (`crm`) is built by the frontend team against this API.
This folder is the contract between the two. If it is not written here, it does not exist yet.

## The files

| File | What | Who writes it |
|---|---|---|
| [CONVENTIONS.md](./CONVENTIONS.md) | Sign-in, response envelope, errors, paging, filters, dates, money | backend (rarely changes) |
| [ENDPOINTS.md](./ENDPOINTS.md) | Every endpoint: method, path, who may call it, every path / query / body field | **generated from the code** — never edit |
| [openapi.json](./openapi.json) | The same, as OpenAPI 3.1 (for tools and AI assistants) | **generated** |
| [CHANGELOG.md](./CHANGELOG.md) | What was added / changed / removed, newest first; breaking changes marked | backend, every change |

Live, always current (on the shared dev backend): `<backend>/api/docs` (explorer, with links to all of these), `<backend>/api/docs/README.md`, `…/CONVENTIONS.md`, `…/CHANGELOG.md`, `…/endpoints.md`, `…/openapi.json`.

## The pipeline

```
1. REQUEST   frontend opens a GitHub issue "API request" (template) — one per need
2. BUILD     backend builds it, adds tests where it matters
3. DOCUMENT  npm run docs:api  +  a CHANGELOG.md entry (same commit)
4. SERVE     live on the shared dev backend at once; on the deployed API after the next deploy
5. CLOSE     backend replies on the issue: endpoint(s), example call, CHANGELOG line
```

Rules that keep it quiet:

- **One request = one issue**, written with the template. If something is unclear, the question goes on the issue — not in chat.
- **Before asking, search** ENDPOINTS.md: most lists already take filters (`?status=`, `?assignedTo=me`, `?search=` …).
- **Additive by default.** Existing endpoints and fields keep their meaning. A breaking change is announced in CHANGELOG.md under **⚠ Breaking** with what to change, at least one working day before it lands.
- **Permissions are the backend's job.** The frontend hides what the user can't do (`GET /api/me/permissions`), but the API always checks.
- **Response field shapes** follow the TypeScript types in `crm/src/types/*.ts` (kept in step by the backend). If a field you need is missing, request it.

## For AI coding assistants (Claude etc.) working on the frontend

Give your assistant this folder. Instructions to paste:

> Use only endpoints listed in `docs/api/ENDPOINTS.md` / `openapi.json`, with the rules in `docs/api/CONVENTIONS.md`.
> Never invent an endpoint, field or query parameter. If what the screen needs is not there, stop and write an
> "API request" (template: `.github/ISSUE_TEMPLATE/api_request.md`) instead of guessing.
> Check `docs/api/CHANGELOG.md` for recent changes before using an endpoint.
