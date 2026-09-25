# Consuela Dashboard — Agent Operational Manual

> **For the AI Coding Agent (Kilo) only.**  
> This is your single source of truth when a user asks how to **use**, **configure**, **troubleshoot**, or **extend** the live Consuela family dashboard.  
> Always start here before answering operational questions. Cross-reference the linked deep docs.  
> **Update rules (since 2026-09-22):**
> 1. **Every shipped change appends to `CHANGELOG.md`** — one long-form entry at the top of "Long-form entries", same session (`- YYYY-MM-DD — type(scope): summary + details, tests, ops, contract lines`).
> 2. **This manual changes ONLY when a rule, contract, or architecture changes** — not for feature news.
> 3. **The Current Dashboard Snapshot keeps at most the newest 2 entries**; older ones live in CHANGELOG.md.

---

## ⚠️ SECRETS — read before touching anything (HARD RULE)

The dashboard runs against a real home NAS with real family accounts. **NEVER commit or echo a secret to git / GitHub / this file.** The live remotes are public-ish (`github.com/ninjass10101010-alt/*`) and a leaked credential is a permanent burn, not a code review comment.

**Never put these in a committed file (AGENTS.md, .md, source, tests, probes, comments, commit messages, or curl examples):**
- NAS SSH password / `sshpass` helpers, PocketBase admin email/password, `SESSION_SECRET`, `ADMIN_SECRET`, `CRON_SECRET`, `CONSUELA_ENCRYPTION_KEY`
- `GOOGLE_*` OAuth credentials, `TELEGRAM_BOT_TOKEN` / mirror tokens / chat ids
- Any `*_API_KEY`, `*_TOKEN`, `*_SECRET`, VAPID keys, Plex/qBittorrent/Sonarr/Radarr/Prowlarr keys, Hermes/OpenRouter/Groq/OpenCode keys
- The contents of `.env.local`, `.env`, `.env.docker`, or the NAS `/tmp/new.env`

**Where secrets actually live (and their rules):**
- `DEPLOY_NAS_LOCAL.md` — **gitignored**, holds the NAS SSH creds + deploy runbook. ✋ Read it for ops, NEVER copy its contents into any committed file.
- `.env.local` / `.env` / `.env.docker` — **gitignored** (`.env*` with `!.env.example` opt-in). Real values stay on the NAS and this Mac.
- `.env.example` — the ONLY committed env file: variable NAMES and placeholders only, never real values.
- `memories/hermes-gateway-setup.md` — **currently tracked.** It documents the Hermes gateway profiles (default/drogon, consuela, finance, and now rubio) but must never record auth tokens, `.env` contents, or the Telegram bot token literal. If you extend it, reference env-var names and config paths, not values.

**When running commands against the NAS:** redact before quoting output back. Use `sed`/grep to strip token/key/password values, and print only KEY NAMES (e.g. `sed 's/=.*/=[REDACTED]/'`), not values.

**Before any `git add`/`git commit`:** `git status` + `git diff` review — stage only intended files, and check no `.env*` (except `.env.example`), no `DEPLOY_NAS_LOCAL.md`, and no literal secrets slipped into a comment/probe/test.

If you are asked to document or debug something that touches credentials, describe the shape and env-var names, never the values.

---

**Current Dashboard Snapshot** (keep at most the newest 2 entries — full history: `CHANGELOG.md`)  
- **Last Updated:** 2026-09-25 | **Role-aware Settings launcher + focused sections + final review hardening** — `/settings` now opens six parent categories (Me, Family, Safety, Appearance, Home, Connections & System) or the same three safe categories (Me, Safety, Appearance) for guests/children/pets. Six static route entries each own one `next/dynamic` section behind the shared auth/role shell, so `/settings/me` does not request System chunks or System-only APIs. Emergency copy is role-aware and every Emergency action targets `/settings/safety`; wall controls meet 64px, descendant overflow is probe-checked, and Modal excludes effectively disabled controls. Both Playwright probes share one explicit safe env map covering every `.env.example`, literal `src/`, and `SERVICES_REGISTRY` field, reserve OS-assigned ports, and await server/log/temp cleanup. Emergency copy stays neutral until auth hydration. The dedicated `/api/emergency/test` route is parent-authorized, uses live contacts with an in-process duplicate guard, and renders partial channel delivery honestly; the real emergency route uses registry-backed Gmail config and reports house-only/partial delivery. Settings sign-in dismissal is blocked while authentication is pending, and Google token read failures surface as unavailable state rather than false disconnection. Verified in the final-review fix wave: focused matrix passed (16 files/180 tests for auth, members, Settings, and emergency; 16/179 for Google, Home, and Calendar; 9/88 for push, System, and probe hardening, with the System suite repeated in the last group), `verify-settings-launcher.mjs` 51/51, `verify-emergency-settings.mjs` parent/child/pet/guest passed, `tsc --noEmit` clean, targeted ESLint 0 errors with one pre-existing Calendar exhaustive-deps warning. Final verification: full Vitest passed 3,199/3,199 tests across 381 files, with only the two approved pre-existing `tasks-approve-all` teardown errors; the known full-lint baseline remains 64 findings (43 errors, 21 warnings) and is not claimed clean.
- **Last Updated:** 2026-09-23 | **Server-authoritative task approvals** — NEW `src/app/api/tasks/approve/route.ts` (approve/approve-all/send-back; parent PIN via `verifyPinFromPB`, snapshot-primary lookup, `withWeekLedgerLock` → snapshot keyed lock, pay `pendingApproval.points`, per-payee `taskId+member` idempotency, crew send-back strips `checkedInAt`, approve-all fail-closed on unknown ids); `src/lib/snapshot-tasks.ts` gains shared `persistSnapshotWeek` (claim now imports it); `src/lib/task-utils.ts` B1 fix; middleware exempts `/api/tasks/approve`; client `submitApproval` POSTs and adopts server `weekData` (offline keeps local). Tests: NEW `task-approve-route` + extended pending-flow/approve-all/middleware-exempt. Contracts in the 2026-09-23 UI Change Record.
> 📜 Older snapshot entries + the legacy UI Change Records live in **CHANGELOG.md**.

---

## 🤝 LLM-to-LLM: Documentation Structure Contract

> **Every AI agent working in this repo MUST follow this structure.** The same contract exists in the parent `Dashboard` repo's AGENTS.md — keep both consistent.

1. **Session start:** read this AGENTS.md (rules + map below), then only the doc the task needs. This file is the single entry point.
2. **Fixed shape:** `AGENTS.md` = short shared rules + map · `docs/PRODUCT.md` = users, flows, non-goals · `docs/DESIGN.md` = visual direction, tokens, components, UI states + the binding UI Change Records · `docs/ARCHITECTURE.md` = stack, data, APIs, boundaries, risks · `docs/PLAN.md` = ordered tasks + acceptance criteria. `CHANGELOG.md` (repo root) = shipped-change history.
3. **No loose `.md` at repo roots.** New docs go under `docs/`; per-feature brainstorm artifacts go in the dated `docs/superpowers/specs|plans/` convention (outer repo for Home-ai features).
4. **Ship = record:** every shipped change appends a CHANGELOG.md entry in the same session; if a contract/rule/visual standard changed, also update the OWNING doc above. Docs never drift from code.
5. **Link, don't duplicate:** the parent AGENTS.md is the product-level entry; this one is the app manual. Cross-reference between them — never copy content into both.

## Map — where everything lives

| Path | What it holds |
|---|---|
| `AGENTS.md` (this file) | Rules: secrets, update mandate, snapshot, agent role, repo sync, structure contract |
| `CHANGELOG.md` | Full shipped-change history (newest first, long-form entries) |
| `docs/PRODUCT.md` | User journeys + meal/emergency workflows + user-facing SOPs 001–004 |
| `docs/DESIGN.md` | The design system standard + layout/nav model + motion + theme/a11y + **all UI Change Records (binding contracts)** |
| `docs/ARCHITECTURE.md` | API route surface + gates, chat data conventions, admin capabilities + routing truths, SOP authoring conventions, scaffolding recipes |
| `docs/PLAN.md` | How work is planned + acceptance gates + open items |
| `docs/EMERGENCY_SETUP.md`, `docs/TEST_EMERGENCY.md` | Emergency alert configuration + live test procedure |
| `docs/MEAL_SYSTEM_ARCHITECTURE.md` | Meals/pantry/grocery data model + sync rules |
| `docs/PUSH_GITHUB.md` + `scripts/security/push-safe.sh` | GitHub push runbook + the mandatory pre-push secrets gate |
| `docs/muse-api.md` | MUSE inbound API protocol |
| `docs/archive/` | Superseded one-time plans (read-only history) |
| `ai/` (SOUL, TOOLS, IDENTITY, KID) | Consuela's persona + tool manifest |
| `memories/` | Ops runbooks (e.g. `hermes-gateway-setup.md`) |
| `DEPLOY_NAS_LOCAL.md` (gitignored) | NAS SSH creds + deploy runbook — LOCAL ONLY, never commit |
| Parent `../AGENTS.md` + `../docs/` | Product-level entry: vision, deployment architecture, planning hub |

---

## Settings Integration Contracts (2026-09-25)

This entry-point contract preserves the Settings feature's route, role, probe, and hardening rules while the upstream five-file documentation structure remains authoritative.

### Route and role contract
- `/settings` is launcher-only. Parents receive Me, Family, Safety, Appearance, Home, and Connections & System; guests, children, and pets receive only Me, Safety, and Appearance. The old `[section]` slot is only the unknown-route 404 fallback.
- Each `/settings/<section>` is a static route with exactly one `next/dynamic` section entry behind the shared auth/role shell. Never move all six dynamic imports back into the shared shell or Me will load System chunks and System-only APIs.
- Emergency copy stays neutral until authentication hydrates. Parents see Add/Manage contacts; before hydration and for guests, children, and pets afterward, the page says to ask a parent and every action targets `/settings/safety`.
- Focused routes preserve real Back/category navigation, the `data-settings-content="true"` audit wrapper, the wall-mode 64px control floor, global `:focus-visible`, and reduced-motion behavior. The shared Modal excludes effectively disabled controls.

### Security, race, and probe contracts
- Privileged metadata, provider, Google, service-test, HA, and member routes re-read the current live PocketBase identity and parent role before reads, probes, mutations, or credentialed operations. A cookie role is never trusted; PB identity outage fails closed.
- Live members use opaque stable `pbId` values, fallback rows are read-only, and family mutations use ID-first lookup. Member-admin, PIN, and profile writes share the member-admin lock; PIN collisions return `409 pin_collision`, and name checks normalize case and whitespace while requiring an exact full-name match.
- Google selection holds the integration-operation lock through connection checks, collection setup, selection writes, and pruning. Token grants are single-row and canonical, device-flow attempts are server-bound and cancellable, and disconnect clears the direct calendar cache without claiming an alternate provider. Token-store read failures remain unavailable states, not false disconnections.
- Emergency test alerts use live contacts, a parent cooldown, a duplicate-submit guard, and honest partial-channel delivery. The real emergency route uses registry-backed Gmail configuration and fails closed when live contacts cannot be read; cached contact provenance is surfaced, and house-only delivery is never reported as total success.
- `ProfileSheet` ignores stale close/reopen completions and clears PIN, avatar, and timer state on every close path. Local Settings push is limited to grocery, pantry, meals, recipes, events, and routines; tasks, points, and goals remain server-owned.
- Both Playwright probes import the shared explicit safe environment map, neutralize every documented/source/`SERVICES_REGISTRY` key, reserve OS-assigned ports, fail readiness on child failure, await log closure before temp deletion, create a fresh pre-instrumented Me audit context, and inspect the marked content wrapper plus visible descendants for overflow.

### Feature verification
- The focused Settings/Emergency matrix passed 16 files/180 tests, 16/179 tests, and 9/88 tests; `verify-settings-launcher.mjs` passed 51/51, and the Emergency probe passed parent/child/pet/guest.
- Final verification is 3,199/3,199 (3199/3199) tests across 381 files, with only the two approved pre-existing `tasks-approve-all` teardown errors. Typecheck was clean and targeted ESLint reported 0 errors with one pre-existing Calendar exhaustive-deps warning; the full-lint baseline remains 64 findings (43 errors, 21 warnings).

---

## 3. Operational Clarity — Agent Role Definition

### 3.1 Core Responsibilities
- You are the **live dashboard expert**. Every answer about how the app behaves for a human user must be 100% consistent with the "Current Dashboard Snapshot" and the subsections above.
- When a user describes a problem or asks for a how-to, your first internal action is to re-read the relevant part of this file.
- After you help implement or modify any dashboard feature, you are also responsible for updating this manual in the same turn.

### 3.2 Action Triggers & Mandatory Behaviors

| User Request / Situation                        | You MUST Do Immediately                                                                 |
|------------------------------------------------|------------------------------------------------------------------------------------------|
| "How do I navigate to X?" or "What's the new icon?" | Read `docs/DESIGN.md` (layout/nav + motion) first. Give exact tab + visual description including motion if applicable. |
| "The emergency button isn't working"           | Read `docs/PRODUCT.md` §2.2 in full. Ask for the exact error message, then walk the config checklist.      |
| "I added a meal but grocery didn't update"     | Read `docs/PRODUCT.md` §2.1 troubleshooting tree. Never guess at the service logic.                        |
| "I just pushed a new floating animation"       | Add the UI Change Record in `docs/DESIGN.md` + update any affected journey in `docs/PRODUCT.md` before replying.  |
| Any question about "the dashboard"             | Open this file first. Only fall back to reading raw source if this doc is insufficient. |
| Any question about APIs/routes/access gates    | Read `docs/ARCHITECTURE.md` (route table + §5.6 routing truths) — never answer from memory. |
| Any completed code update (committed, gates green) | **Always ask the human partner: "Deploy to NAS now?"** before calling the work done (runbook `DEPLOY_NAS_LOCAL.md`, local-only). Pushing to GitHub is NEVER a deploy. |
| Any push to GitHub (either repo)               | Run `bash scripts/security/push-safe.sh` FIRST (`--nas` to also cross-check NAS secrets) — the remotes are public-ish; a hit means redact + commit + re-run, and if the value ever reached a pushed commit, advise rotation. Flow + rules: `docs/PUSH_GITHUB.md`. |

### 3.3 Expected Outcomes & Verification Checklists

Before you send any reply about the dashboard, mentally tick:
- [ ] I referenced the exact current component or file path the user would see.
- [ ] I gave a short, copy-paste-ready instruction the user can follow in the UI.
- [ ] I mentioned the motion/animated elements when describing Home or Meals.
- [ ] I noted whether this file itself now needs an update because of the conversation.
- [ ] I linked the appropriate deep doc (`docs/EMERGENCY_SETUP.md`, `docs/MEAL_SYSTEM_ARCHITECTURE.md`, etc.) for power users.

### 3.4 Anti-Patterns (never do these)
- Never say "look in the code" or "check src/app/page.tsx".
- Never describe the pre-2026-05-21 static emoji experience.
- Never give production deployment advice without the Gmail limits + security warnings.
- Never claim data is persisted when it is still in-memory only.

## 6. Repo & Sync Workflow (local ↔ GitHub)

The parent `Dashboard` repo (deployment shell: docker-compose, deploy scripts, PocketBase bits, specs + plans in `docs/superpowers/`) tracks two submodules: **Home-ai** (this app, branch `warm-glass-v2`) and **daily-budget**. The per-feature dance — **mandatory, same session**:

1. **Build + verify in Home-ai** — tests green, `npm run typecheck`, then `git status` + `git diff` review (secrets check: no `.env*` except `.env.example`, no `DEPLOY_NAS_LOCAL.md`, no literal tokens).
2. **Commit the feature in Home-ai** — conventional message (`feat|fix|docs|chore(scope): …`), and append the CHANGELOG.md entry in the same session (see the header update rules).
3. **Push Home-ai** — `bash scripts/security/push-safe.sh` then `git push origin warm-glass-v2`.
4. **In the parent Dashboard repo** — write the spec/plan doc for brainstormed features (`docs/superpowers/specs|plans/YYYY-MM-DD-*.md`), then bump the submodule pointer + docs in ONE commit: `git add Home-ai <docs> && git commit -m "chore(submodule): Home-ai -> <short summary>"`. Never `git add .`.
5. **Push the parent** — push-safe scan then `git push origin main`.

**Session-end rule:** `git status --short` must be EMPTY in both repos before the session ends — nothing uncommitted overnight. Intentionally unfinished work gets committed as WIP on a branch; it never sits dirty on the working branch.

**Local-only (gitignored — never commit):** `.env*` (except `.env.example`), `DEPLOY_NAS_LOCAL.md`, `backups/`, `*.log`, `.agents/` (skills — reinstall via the tracked `skills-lock.json`), `.impeccable/`, `.opencode/`, `.superpowers/`, `pb_data/` + `pocketbase_data/` (live DB state), `.DS_Store`.

**Deploy ≠ push:** pushing to GitHub never changes the running NAS container — always end feature work by asking "Deploy to NAS now?" (runbook: `DEPLOY_NAS_LOCAL.md`, local-only).

---

### SOP-005: Safe GitHub Push + Deploy Prompt (Rollout)
**Purpose** Ship committed work to the public-ish GitHub remotes WITHOUT leaking credentials, and never leave the human guessing whether the NAS is current.

**Prerequisites** Code committed on `warm-glass-v2` with gates green (`tsc` + vitest + build). `docs/PUSH_GITHUB.md` has the full flow + where real secrets legitimately live.

**Step-by-Step**
1. `bash scripts/security/push-safe.sh` from each repo root (add `--nas` for the strict check) — prints only key NAMES on hits, exits 1 on any live value in the push range, staged diff, or worktree.
2. If it flags: replace the value with `<REDACTED-NAME>` in tracked files, commit the redaction, re-run. If the value EVER reached a pushed commit → treat as burned: advise rotation (NAS admin password / provider key / PB pass) — history rewrite is human-decision only (force-push forbidden otherwise).
3. `git push origin warm-glass-v2` (Home-ai) → outer repo: stage ONLY the `Home-ai` gitlink (+ own named files), commit `chore(submodule): …`, scan, `git push origin main`. Never `git add .`.
4. ALWAYS end the turn by asking: **"Deploy to NAS now?"** — the push does not change the running container; only deploy via `DEPLOY_NAS_LOCAL.md` (rename-swap + `npm run pb:seed` after) does.

**Expected Results:** push-safe prints `CLEAN`, both remotes updated, human gets the deploy question.
**Rollback:** pushing a redaction commit forward only; never force-push.
**Agent Notes:** `.env.docker` is untracked + gitignored since 2026-09-22 (parent repo) — placeholder values only, ever.


### Memory Bank Maintenance (still required)
After completing a user request that changes architecture, tech, or goals, update:
- `.kilocode/rules/memory-bank/context.md`
- `.kilocode/rules/memory-bank/tech.md`, `product.md`, `architecture.md` as appropriate
- `.kilo/rules/memory-bank/context.md` (lighter mirror)

---

## Change Log

The full history of shipped changes lives in **CHANGELOG.md** (newest first: long-form entries + the legacy UI Change Records + the legacy snapshot block, all moved there 2026-09-22). New entries prepend to CHANGELOG.md in the same session that ships the change. This manual records only rule/architecture changes.

