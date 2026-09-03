# Ledger Integration — Design Spec

**Date:** 2026-09-02
**Status:** Approved direction (user-reviewed in chat), pending spec review
**Owner surfaces:** Home widget + new `/ledger` page + middleware + proxy config

## 1. Problem / Goal

The family's finances are managed by **Alex**, the Hermes `finance` agent. The user drops bank statements into Google Drive; Alex parses them into the canonical ledger and rebuilds a magazine-styled finance app — **"The Ledger — Personal Finance, Vol. XI"** — served by the `finance-dashboard` container on the NAS.

Goal: the Ledger becomes accessible **from within the Consuela family dashboard**, with its **existing UI untouched**, and **visible to the parents (Rebecca, Jeffery) only**.

Requirements (confirmed with user):

1. Keep the Ledger UI exactly as-is — no changes to Alex's app, pipeline, or container config.
2. Access the full Ledger UI from inside the family dashboard (embedded page).
3. An at-a-glance **Home widget** (balances / month summary) that deep-links into the embedded page.
4. **Adults-only.** Kids (and nobody-signed-in guests) must not see the widget, the page, or the data. A signed-in adult session is sufficient — **no PIN step-up** (user decision).
5. Self-hosted constraint holds: everything LAN-local; no new paid third-party services.

## 2. Discovery findings (verified 2026-09-02)

| Fact | Evidence |
|---|---|
| Ledger app is a Vite React SPA behind nginx, title "The Ledger — Personal Finance, Vol. XI" | `GET http://192.168.0.28:9080/` |
| Container `finance-dashboard` (local image), `9080->80`, network: **bridge only** | `docker ps` / `docker inspect` on NAS |
| `consuela-dashboard` rides `familydashboard_consuela-net` only; `hermes-agent-2` rides both bridge + consuela-net (precedent for dual membership) | `docker ps` |
| **Container → host-IP 9080 times out** on this QNAP | `docker exec consuela-dashboard wget http://192.168.0.28:9080/health` → timeout |
| `finance-dashboard` **not resolvable by name** from the dashboard container (different networks) | `docker exec` wget → `bad address` |
| Ledger HTTP surface: `GET /api/data/dashboard` (~306 KB JSON), `POST /api/ofx/discover/preview` + `/confirm` (statement import), `GET /health` → `healthy` | live curl probes |
| HTML loads hashed bundles at `/assets/index-*.js` + `/assets/index-*.css` | index.html |
| nginx sends `X-Frame-Options: SAMEORIGIN` (+ nosniff, XSS, Referrer-Policy) → **cross-origin iframe blocked**, same-origin framing allowed | response headers |
| No client-side router detected in the bundle (no react-router markers) — single-view app | bundle grep |
| `/api/data/dashboard` shape: `{ yearData: { "YYYY-MM": { period, ledger{totalBudgeted,totalSpent,...}, incomeSources[], expenses[], savings[], bills[], debts[], accounts[]{name,institution,type:Checking|Savings|Loan,balance}, transactions[], balanceSnapshots[]{name,category:"Loan"|"Checking",balance,lastUpdated}, goals[], investments[], editorialNote, familyBreakdown, shareFunding } }, selectedMonthKey }` | live payload inspection |
| Consuela session cookie `consuela_session` is HMAC-signed and carries `{ memberId, name, role, iat, exp }`; `verifySession()` is edge-safe (`crypto.subtle`) | `src/lib/session.ts` |
| Middleware gates `/api/:path*` for session only; matcher today = `["/api/:path*", "/_design-system"]` | `src/middleware.ts` |
| Role semantics: members have `role` ("Parent"/"Child"; lowercase `"child"` in sessions). Adults = `role !== "child"`. Existing adult-only precedent: House tab hidden for `role === "child"` (`CapsuleNav.visibleNavItems`), admin routes 403 `adult_only` | `CapsuleNav.tsx`, `src/lib/admin-auth.ts` |
| Dashboard has no `/assets/*` or `/api/data*`/`/api/ofx*` usage — proxy path prefixes are collision-free | repo grep |

The QNAP network quirk (container → host-published-port times out) is the single hard infrastructure constraint: **server-side proxying requires `finance-dashboard` to join `familydashboard_consuela-net`.**

## 3. Rejected alternatives

- **Link-out only** (open `192.168.0.28:9080` in a new tab): leaves the dashboard experience; protection is cosmetic (any LAN device can open the URL). Doesn't meet "inside the dashboard" goal.
- **Loosen ledger nginx** (drop/relax `X-Frame-Options`) to allow a cross-origin iframe: modifies Alex's app (violates requirement 1) and weakens the ledger's own hardening.
- **Browsers reach 9080 directly, no proxy:** same cosmetic-protection problem as link-out, and XFO still blocks the iframe.

## 4. Architecture

```
Browser (parent)                  consuela-dashboard (Next.js, :3000)
   │  GET /ledger                    ├─ /ledger            → page (iframe shell)
   │  iframe /ledger-app/            ├─ /ledger-app/*      ──┐ rewrites (proxy)
   │  loads /assets/index-*.js       ├─ /assets/*          ──┤
   │  fetch /api/data/dashboard      ├─ /api/data/*        ──┤   ▼
   │  POST /api/ofx/discover/*       └─ /api/ofx/*         ──┘  http://finance-dashboard/*
```

- **Proxy:** declarative `rewrites()` in `next.config.ts` — no hand-rolled proxy code. GETs and POSTs both flow through (OFX statement import keeps working inside the embed).
- **Upstream from env:** `FINANCE_DASHBOARD_URL`
  - NAS compose: `http://finance-dashboard` (container name, after the network attach below).
  - Local dev default (dev server runs on the Mac, which is on the LAN): `http://192.168.0.28:9080`.
- **One-time NAS ops:** `docker network connect familydashboard_consuela-net finance-dashboard` (same dual-network pattern as `hermes-agent-2`), recorded in `DEPLOY_NAS_LOCAL.md` so container recreation re-applies it.
- **XFO:** iframe URL is same-origin with the dashboard → `SAMEORIGIN` satisfied without touching Alex's nginx.

## 5. Access control (server-enforced, not cosmetic)

`src/middleware.ts` gains an **adult-only** gate next to the existing session gate:

- New matcher entries: `/ledger`, `/ledger-app/:path*`, `/assets/:path*`. (`/api/data/*` + `/api/ofx/*` are already under the `/api/:path*` matcher.)
- New rule for those prefixes: `verifySession()` must succeed **and** `session.role === "parent"` (allowlist). NOTE (final-review correction 2026-09-03): the original `role !== "child"` was a security defect — the roster has a third role `"pet"` (Rocco/Rico, default PIN `0000`, login-unfiltered) that would have passed a `!== "child"` deny and read the whole ledger. Only `parent` is admitted.
  - `/ledger` (page navigation) → `307` redirect to `/`.
  - Asset/data paths → `403 { error: "adult_only" }` (matches the existing admin-auth vocabulary).
- Defense in depth: `/ledger` page also checks `useAuth()` client-side and renders a "Parents only 🔒" locked state if a child/guest render ever occurs (kid reaches it via cached client nav, etc.).
- Widget visibility: renders **only** for a signed-in parent — kid sessions and guests never see the card (same mechanism as the House tab).
- No PIN step-up. The existing 30-min inactivity auto-logout remains the shared-device safety net.
- **Honest limitation (documented, not hidden):** port `9080` stays open on the LAN exactly as today; this feature gates access *through the dashboard*. Optional follow-up (out of scope): bind 9080 to localhost so only the proxy can reach it.

## 6. UI design

### 6.1 Home widget — "The Ledger" card

- New widget id `financeLedger` in `src/lib/layout-config.ts` (added to `ALL_WIDGETS` + default layouts; existing self-heal appends it for stored layouts). Reorder/hide works like every other widget via Settings → Layout & display (row caption notes "Parents only").
- Component: `src/components/finance/LedgerWidget.tsx` — standard `WidgetCard` warm-glass shell, money-green tone `#22c55e`, protruding 📒 icon.
- Render gate: `isLoggedIn && role !== "child"` → otherwise `null` (no placeholder for kids/guests).
- Data: `GET /api/data/dashboard` (goes through the adult gate; 403s for non-adults — widget simply doesn't fetch when hidden). Computations live in pure, unit-tested `src/lib/finance/ledger-summary.ts`:
  - **Cash** — sum of `accounts[]` (latest month = max `yearData` key) where `type` is `Checking`/`Savings`.
  - **Debt** — sum of `balanceSnapshots[]` where `category === "Loan"` (superset: mortgage, Tesla, cards).
  - **This month** — latest month's `ledger.totalSpent` vs `totalBudgeted` (`$x of $y`).
  - **Freshness** — "Balances as of {date}" from max `balanceSnapshots[].lastUpdated` (tolerates both `M/D/YYYY` and `YYYY-MM-DD`).
- Footer row: freshness left, "Open The Ledger →" right (links to `/ledger`). Whole card is also tappable.
- States: loading skeleton; honest error state if the container is down ("Ledger unreachable — Try again"); no fabricated numbers.
- Mobile-first; participates in all three layout buckets (phone/tablet/desktop).

### 6.2 `/ledger` page — the embed

- `src/app/ledger/page.tsx` — PageShell with a slim header (back chevron, "The Ledger", subtitle "Alex's finance tracker", and an "Open full size ↗" link to `/ledger-app/` targeting a new tab).
- `<iframe src="/ledger-app/" title="The Ledger">` fills the remaining viewport height; rounded corners to sit inside the warm-glass world.
- Loading shimmer until iframe `load`; if the iframe fails (proxy 502 / network), an honest error card with "Try again" + "Open in new tab" fallback.
- Locked state for child/guest: 🔒 "The Ledger is for parents only. Sign in as Mom or Dad."

### 6.3 Entry points

- The widget is the door (tap → `/ledger`). **No 8th capsule-nav item** — seven items is the phone-comfortable maximum; the capsule stays untouched.
- No Settings entry (one obvious place, no duplication).

## 7. File-by-file change list

| File | Change |
|---|---|
| `next.config.ts` | `rewrites()` for `/ledger-app/:path*`, `/assets/:path*`, `/api/data/:path*`, `/api/ofx/:path*` → `${FINANCE_DASHBOARD_URL}/:path*` (default `http://192.168.0.28:9080`) |
| `src/middleware.ts` | adult-only prefix list + role check; extend `config.matcher` with `/ledger`, `/ledger-app/:path*`, `/assets/:path*` |
| `src/lib/finance/ledger-summary.ts` | NEW — pure: payload parse + cash/debt/month/freshness computations (tolerant of missing pieces → honest empties) |
| `src/components/finance/LedgerWidget.tsx` | NEW — Home widget (fetch, states, links) |
| `src/app/ledger/page.tsx` | NEW — embed page (iframe shell, locked state, error state) |
| `src/lib/layout-config.ts` | register `financeLedger` widget id + default positions |
| `src/app/page.tsx` | widget switch case; role-gated render |
| `src/app/settings/page.tsx` | Layout & display row caption "Parents only" for this widget (copy touch) |
| `docker-compose.yml` (both root + Home-ai) | `FINANCE_DASHBOARD_URL=http://finance-dashboard` env |
| `.env.example` / `ENV_TEMPLATE.txt` | document `FINANCE_DASHBOARD_URL` + local-dev default |
| `DEPLOY_NAS_LOCAL.md` | ops step: `docker network connect familydashboard_consuela-net finance-dashboard` (+ re-apply on recreate) |
| `AGENTS.md` | snapshot/nav/architecture updates per repo rule |
| `PRODUCT.md` | surfaces list gains the Ledger (parents-only) |

Types: `LedgerDashboardPayload` + friends defined in `src/lib/finance/ledger-summary.ts` (local, no new deps).

## 8. Testing (TDD)

- `tests/unit/ledger-summary.test.ts` — cash/debt/month/freshness math on a recorded fixture (real payload shape), missing-field tolerance, both date formats.
- `tests/unit/middleware-ledger-gate.test.ts` — matrix: guest / child / parent × `/ledger`, `/ledger-app/x`, `/assets/x`, `/api/data/dashboard` → redirect/403/allow. Mirrors existing `middleware-gate` test harness.
- `tests/unit/ledger-widget.test.tsx` — renders for parent; `null` for child & guest; error state on fetch failure; links to `/ledger`.
- `tests/unit/ledger-page.test.tsx` — iframe src `/ledger-app/`; locked state for child role.
- Live verification (Playwright, NAS): parent sign-in → widget visible → `/ledger` shows the app → kid session sees neither → guest 403 on `/api/data/dashboard`; OFX import still works through the embed.

## 9. Rollout / ops

1. Land code on `warm-glass-v2`; unit suite green.
2. NAS: `docker network connect familydashboard_consuela-net finance-dashboard`.
3. Deploy dashboard per `DEPLOY_NAS_LOCAL.md` (env now includes `FINANCE_DASHBOARD_URL=http://finance-dashboard`).
4. Smoke: `docker exec consuela-dashboard wget -qO- http://finance-dashboard/health` → `healthy`; `curl -H cookie… /ledger` 200 for parent session, redirect for guest.
5. Update AGENTS.md snapshot + UI Change Record.

## 10. Out of scope (explicit YAGNI / future options)

- PIN step-up to open the ledger (declined by user).
- Binding port 9080 off the LAN (noted as optional hardening follow-up).
- Any change to Alex's app, nginx, pipeline, or Google Drive flow.
- Ledger data in Consuela chat tools / suggestions (could be a future, separately-spec'd feature).
- Editing ledger data from the dashboard (the embed is the full editor; no new writes introduced).
