# MUSE inbound API

MUSE is the inbound API identity for the Consuela dashboard. A trusted agent (or
operator) exchanges a long-lived **key** for a short-lived **bearer token** and
then reads family context and calls the guarded assistant tools over HTTP.

> **LAN / Tailscale only.** The dashboard is not exposed to the public internet.
> Every call below is expected to originate from the home network or a
> Tailscale device. Do not port-forward the dashboard.

- **Base URL (examples):** `http://<dashboard-host>:3000`
- **Auth scheme:** most routes take `Authorization: Bearer <token>` — the tool
  surface (`/api/muse/whoami`, `/api/muse/tools`, `/api/muse/tool`,
  `/api/muse/context`) and the no-op `POST /api/muse/auth/logout`. This is **not**
  universal: the operator routes (`/api/muse/settings*`, `/api/muse/log`) are
  **not** bearer-authenticated (see the gate table below), and
  `GET /api/muse/docs` is public.
- **Content type:** requests with a body are `application/json`; responses are
  JSON except `GET /api/muse/docs` (markdown)

### Endpoint gates

| Endpoint | Gate |
| --- | --- |
| `POST /api/muse/auth/login` | Public-surface, key-authenticated + rate limited |
| `POST /api/muse/auth/logout` | Bearer (no-op) |
| `GET /api/muse/whoami` / `tools` / `tool` / `context` | Bearer |
| `GET /api/muse/docs` | Public (protocol docs only, no family data) |
| `/api/muse/settings`, `settings/rotate`, `settings/revoke-tokens`, `log` | **Adult dashboard session** (parent), the server-only `ADMIN_SECRET`, or a parent PIN via `x-admin-pin` — never the MUSE bearer token |


---

## Authentication

### 1. Log in with the key

```
POST /api/muse/auth/login
Content-Type: application/json

{ "key": "muse_…" }
```

The key is minted by an operator in the dashboard (Settings → MUSE). The
plaintext key is shown **exactly once** at creation and at every rotation; only
its SHA-256 hash is stored.

```bash
curl -sS -X POST http://<dashboard-host>:3000/api/muse/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"key":"muse_REPLACE_WITH_KEY"}'
```

Success (`200`):

```json
{
  "token": "v1.<payload>.<signature>",
  "expiresAt": "2026-09-16T12:00:00.000Z",
  "scopes": ["tools"],
  "admin": false
}
```

The token is an HMAC-signed, stateless credential with a **24-hour lifetime**.
It is not stored server-side.

### 2. Call the API

```bash
TOKEN='v1.…'   # from the login response
curl -sS http://<dashboard-host>:3000/api/muse/whoami \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Rotation / revocation semantics

- **Rotate key** — issues a new plaintext key and bumps the identity `version`.
  Every live bearer token dies **instantly** (verification compares the token's
  embedded version to the live row's version).
- **Revoke tokens** — bumps the identity `version` **without** changing the key.
  Every live bearer token dies instantly; the next login with the same key
  mints a fresh token.
- **Disable the identity** — turns the MUSE identity off; login is refused and
  live tokens fail with `muse_disabled`.
- **Logout** is client-side: tokens are stateless, so logging out is discarding
  the token. Use revoke-tokens to kill all outstanding tokens at once.
- **`hasKey`** — the settings envelope returned to the dashboard reports `true`
  only once a key has actually been generated. Creating the singleton row (which
  happens the first time any settings/login path touches the identity) is not a
  key: an unkeyed row honestly reports `hasKey: false`.

> Rotate / revoke are **operator actions** in the dashboard UI (adults only) —
> they are not reachable through the MUSE bearer token itself.

**Known gaps (v1).** Rotate and revoke-tokens are operator actions in the
dashboard settings surface and are **not** written to the MUSE audit log —
`consuela_muse_log` records login attempts, tool calls, auth failures and
rate-limit rejections only. The dashboard's `rotatedAt` timestamp (visible in
Settings → MUSE) is the operator-side record of the last rotation.

---

## Endpoints

### `POST /api/muse/auth/login`

Exchange the key for a bearer token. Unauthenticated. See above.

Errors: `400 invalid_body`, `401 invalid_key`, `429 rate_limited` / `locked`,
`500 server_error`.

### `POST /api/muse/auth/logout`

Deliberate no-op — tokens are stateless and there is no server-side session to
delete. Always `200 { "ok": true }`.

```bash
curl -sS -X POST http://<dashboard-host>:3000/api/muse/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

### `GET /api/muse/whoami`

Introspect the current bearer token.

```bash
curl -sS http://<dashboard-host>:3000/api/muse/whoami \
  -H "Authorization: Bearer $TOKEN"
```

Response:

```json
{
  "ok": true,
  "enabled": true,
  "admin": false,
  "scopes": ["tools"],
  "expiresAt": "2026-09-16T12:00:00.000Z",
  "lastUsedAt": "2026-09-15T11:00:00.000Z"
}
```

### `GET /api/muse/tools`

The tool catalog. This is the authority for what the token may call — always
fetch it rather than hard-coding tool names. Admin tools appear **only** when
the token is admin (the intersection of the token's `adm` claim and the live
row's settings toggle).

```bash
curl -sS http://<dashboard-host>:3000/api/muse/tools \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "ok": true, "tools": [ { "type": "function", "function": { "name": "get_weather", "description": "…", "parameters": { } } } ] }
```

### `POST /api/muse/tool`

Execute one catalog tool. Unknown names are `400`; names that exist but are not
permitted for this token (admin tools on a non-admin token) are `403
tool not allowed`.

```bash
curl -sS -X POST http://<dashboard-host>:3000/api/muse/tool \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"get_weather","args":{"location":"home"}}'
```

Response (success):

```json
{ "ok": true, "result": { "…": "tool-specific payload" } }
```

A tool may self-report a failure while still returning HTTP `200`:

```json
{ "ok": false, "error": "…" }
```

### `GET /api/muse/context?scope=meal|task|schedule|all`

A live snapshot of the family's dashboard state plus a ready-to-inject prompt.

- `scope=meal` — roster, calendar, meals, pantry, grocery, weather
- `scope=task` — roster, pending tasks, rewards, last archived week
- `scope=schedule` — roster, calendar, routines, weather
- `scope=all` (default when omitted) — merges all three into one pack; zones
  are taken from the first scope that defines them and `unavailable` is the
  union of the three

```bash
curl -sS 'http://<dashboard-host>:3000/api/muse/context?scope=all' \
  -H "Authorization: Bearer $TOKEN"
```

Response:

```json
{ "ok": true, "scope": "all", "pack": { }, "prompt": "Consuela live context pack — …" }
```

An unknown scope is `400 invalid_scope`.

### `GET /api/muse/docs`

This document, as `text/markdown; charset=utf-8`. **Unauthenticated** — it
describes the protocol only and contains no family data.

```bash
curl -sS http://<dashboard-host>:3000/api/muse/docs
```

---

## Error codes

| HTTP | `error`            | Meaning                                                             |
| ---- | ------------------ | ------------------------------------------------------------------- |
| 400  | `invalid_body`      | Malformed JSON or a payload missing/invalid fields                 |
| 400  | `invalid_scope`     | `GET /api/muse/context` got a scope other than meal/task/schedule/all |
| 400  | `payload_too_large` | `POST /api/muse/tool` body exceeded the 16 KiB limit               |
| 400  | `unknown tool`      | `POST /api/muse/tool` named a tool that is not in the catalog at all |
| 401  | `unauthorized`      | Missing / malformed / expired / revoked bearer token               |
| 401  | `invalid_key`       | `auth/login` key did not match (or no identity exists)             |
| 403  | `muse_disabled`     | The MUSE identity is switched off                                   |
| 403  | `tool not allowed`  | A tool that exists but is not permitted for this token (admin tool on a non-admin token) |
| 429  | `rate_limited`      | Login or per-key request budget exceeded                           |
| 429  | `locked`            | Login temporarily locked after repeated failures from this IP      |
| 500  | `server_error`      | Unexpected server failure (details are never leaked)               |

`400 unknown tool` and `403 tool not allowed` are distinct on purpose: the
allowlist is checked before the tool registry, so naming an admin tool on a
non-admin token can never reach its handler.

A tool whose handler itself throws returns HTTP `500` with an honest shape that
carries the (host-scrubbed) handler message rather than a generic failure:

```json
{ "ok": false, "error": "connect ECONNREFUSED [internal]" }
```

Credentials and internal service hostnames are never echoed back; error text is
scrubbed of internal hosts (`localhost`, the known internal containers, and any
`192.168.x.x` address become `[internal]`).


---

## Tool catalog

`GET /api/muse/tools` is the single source of truth for the callable surface —
it returns OpenAI-shaped function definitions (name, description, JSON schema).
Fetch it before each session. Admin tools
(`check_for_update`, `trigger_update`, `get_container_status`,
`restart_container`, `check_pocketbase`) are listed only for an admin token.

---

## Invariants

These hold regardless of what the tool catalog appears to allow:

- **PIN-gated actions stay human.** MUSE may **propose** point adjustments, but
  it can never apply them — a proposal is an inert confirmation chip that only
  executes when a parent taps it and verifies their PIN. Task approvals also
  stay in the UI; a tool call can queue a completion for approval but never
  awards points.
- **Memory tools share the family memory bank.** Reads and writes go to the
  same PocketBase-backed memory the family sees. MUSE has no private memory
  store.
- **Admin tools require the settings toggle.** The admin tools are available
  only when the operator has enabled the MUSE admin toggle *and* the token was
  minted while it was on.
- **LAN / Tailscale only.** The dashboard is a private network service; do not
  expose it to the internet.
