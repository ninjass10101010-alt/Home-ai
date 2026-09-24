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
- **Last Updated:** 2026-09-23 | **Server-authoritative task approvals** — NEW `src/app/api/tasks/approve/route.ts` (approve/approve-all/send-back; parent PIN via `verifyPinFromPB`, snapshot-primary lookup, `withWeekLedgerLock` → snapshot keyed lock, pay `pendingApproval.points`, per-payee `taskId+member` idempotency, crew send-back strips `checkedInAt`, approve-all fail-closed on unknown ids); `src/lib/snapshot-tasks.ts` gains shared `persistSnapshotWeek` (claim now imports it); `src/lib/task-utils.ts` B1 fix; middleware exempts `/api/tasks/approve`; client `submitApproval` POSTs and adopts server `weekData` (offline keeps local). Tests: NEW `task-approve-route` + extended pending-flow/approve-all/middleware-exempt. Contracts in the 2026-09-23 UI Change Record.
- **Last Updated:** 2026-09-21 | **Ops: Hermes container upgraded to v0.21.3 and every agent moved to OpenCode Go `deepseek-v4-flash`.** The NAS `hermes-agent-2` container (s6-overlay, `nousresearch/hermes-agent:latest`) was upgraded **v0.20.4 → v0.21.3** (image pull + container recreate; `/share/Container/Hermes` → `/opt/data` volume preserved; rollback twin `hermes-agent-2-old` kept stopped; config backups at `/share/Container/hermes-backup-20260921-111204/`). All four Hermes gateway profiles now run the same brain — `provider: opencode-go`, `default: deepseek-v4-flash` — with `OPENCODE_GO_API_KEY` set to one Go key in each profile's `.env`: **default/drogon (:8643), consuela (:8642 — the route the dashboard uses), finance/alex (:8644), rubio (:8646)** (key/token VALUES never recorded — names only). Why the upgrade mattered: OpenCode Go requires the `x-opencode-session` header, which v0.20.4 never sent (`HTTP 400 MissingSessionID`); v0.21.3 sends it natively, so the temporary custom-provider "bridge" workaround was removed (drogon's 5 agent cron jobs repointed to `opencode-go`). The upgrade also flipped `API_SERVER_PORT` precedence — a profile's own `.env` now beats `config.yaml platforms.api_server.extra.port` — which briefly shuffled the ports and left default `fatal: Port 8642 in use`; fixed by pinning each profile's `API_SERVER_PORT` in its own `.env` (consuela 8642 / default 8643 / finance 8644 / rubio 8646 — all `api_server: connected`, health 200). Verified: `hermes gateway list` all four green, one-shot chat `ok` on all four, consuela `:8642` `/v1/chat/completions` `ok`. **Ops runbook + gotchas live in `memories/hermes-gateway-setup.md`** (the API_SERVER_PORT precedence rule, the `x-opencode-session` version floor, the container recreate command, key NAMES only). Admin-tool allowlist (`consuela-dashboard`, `pocketbase`, `hermes-agent-2`) unchanged.
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

