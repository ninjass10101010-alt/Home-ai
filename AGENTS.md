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
- **Last Updated: 2026-10-05 | Task-page integrity wave: tasks run on the family clock again, child penalties/adjusts now work, and the 1 MiB snapshot incident is fixed** — 🚨 **The production container ran on the UTC axis** (the parent compose carried no `TZ`; Saturday-night points rolled Sunday 20:00 ET) — now pinned `TZ=America/Detroit` with a fail-loud zone validator. 🚨 **Every member-assigned "add task" failed live** with `snapshot_write_failed`: the snapshot `data` JSON sat at ~960 KB of PocketBase's 1 MiB cap, because each task copied the assignee's roster emoji — which are 105–246 KB photo data URLs (~98% of the blob). Fixed four ways: snapshot emojis now slim to `👤` at write time (rendering is live-roster-first, so photos still show), `maxSize: 400_000` became a coherent 4 KiB, `pb-seed` declares+heals `consuela_data_snapshots.data` to 8 MiB (raise-only), and the silent catches now log status + redacted body. **Money honesty:** penalties/adjusts against a child were impossible (one field was PIN subject + parent gate + debit target while the UI printed "the family server confirms") — the ledger command now carries actor + `targetMemberName`; undo reverses the week that HOLDS the earn and can reverse crew completions (previously nobody could); archived-week replays can't double-pay. **Week machinery:** crews are paid before culls, the rollover archives every older week (skipped weeks no longer vanish from all-time), editing a prize no longer rewrites frozen Hall-of-Fame text, and one malformed `crew` value can't brick every reconcile forever. **Outbox:** cancel can't retract a change the server already applied, terminal failures release the optimistic row, same-task commands serialize. **UI:** ~70 measured fixes — tied ranks no longer print `#0`, "Alex" no longer matches "Alexandra", guest roles no longer see reward/penalty editing, every PIN dialog announces its error via `role="alert"`, `SoftButton` secondary measured 1.88–3.42:1 dark → 6.99–10.84:1 across all ten accents. Entries: CHANGELOG (2026-10-05); open items: `docs/superpowers/plans/2026-10-04-audit-wave-open-findings.md` §0. **Ops:** NAS `npm run pb:seed` → redeploy → delete the leftover `PROBE-POINTS-1789853187732` task via the app's own delete. **Verification:** `tsc` clean · **6,530/6,530 tests / 555 files** · build clean · targeted lint clean · 16 new RED-first suites.
- **Last Updated: 2026-10-05 | Photos: the wall becomes family-tunable + the 100 MB upload cap** — A `photo_settings` singleton (shared family-wide, parent-only PATCH) drives the Photos wall tile: seconds-per-photo slider + Fast/Normal/Slow presets, transition choice, order, and caption toggle; `GET` is any-session and never 5xxs (degraded defaults instead of a blank wall). One shared `MAX_ORIGINAL_BYTES = 100 MB` replaces four drifting copies; a new field-reconcile in the feature migration patches the live `photos.original.maxSize` (editing the schema alone changes nothing on an existing collection — `createCollection` skips it). Also in the same pass: the feed no longer silently caps at the newest 60 records, the `/photos` grid no longer runs wall curation on its management view, moderation PATCH re-reads live PB identity (a 7-day cookie could have flipped a photo), and the wall refresh/abort/retry paths recover instead of stranding an always-on panel. Entries: CHANGELOG (2026-10-05). **Ops:** `npm run migrate:features` on the NAS (creates `photo_settings` + reconciles `original.maxSize`), ordinary redeploy.
> 📜 Older snapshot entries + the legacy UI Change Records live in **CHANGELOG.md**.
>
> **Task-authority contracts are not in this snapshot.** The points-integrity remediation
> (Wave 1 authority + outbox, Wave 2 identity, Wave 3 adjacent writers, and the 2026-09-28
> **Option B** decision) changed contracts, not layout, so its entry is superseded here and
> its content lives where it is read: the command-seam / outbox / honest-null / Option B
> contracts in `docs/ARCHITECTURE.md` §5.6, its UI record in `docs/DESIGN.md`, and the
> shipped history in `CHANGELOG.md`.

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

## UI Contracts (hard rules — 2026-09-26 audit)

Authoritative copy lives in `docs/DESIGN_SYSTEM.md` §6–8; these are the parts agents break most often.

- **Navigation is manifest-driven, and there is exactly one navigation surface.** `CapsuleNav`
  (the bottom dock) is the only nav on every device, width and role — **it is not a phone-only
  affordance**, so it never gets an `md:hidden` sibling or a second fixed side column; a proposed
  second nav *replaces* it rather than sitting beside it. `src/lib/nav-items.ts` owns every
  destination, its role list, its icon key and its group (`primary` = the dock caps, `more` = the
  Home `More…` sheet); `NavIcon` is the only nav icon set and `--color-nav-active*` the only
  active ink. `PageShell` is not a nav surface and reads nothing from the manifest. A new route
  needs a manifest entry **or** an `EXEMPT_ROUTES` entry with a reason —
  `tests/unit/nav-items.test.ts` fails otherwise (that is what makes "no unreachable route" hold).
  Never add a nav list, an icon set or an active-item check inside a component. `SidebarNav.tsx`
  was deleted 2026-09-29; it and its suite stay deleted. **The dock must be reachable on every
  route AND on every route interruption:** a parent-reachable destination that renders no
  `PageShell` is a dead end and fails `tests/unit/route-shell-contract.test.ts`, which walks every
  `src/app/**/page.tsx`, follows `@/…` imports (depth-capped) to find the shell, and requires a
  reasoned `SHELL_EXEMPT` entry otherwise. The same walk covers `error.tsx`, `loading.tsx` and
  `settings/layout.tsx` under `SEGMENT_SHELL_EXEMPT` — a boundary *replaces* the route it
  interrupts, so a shell-less fallback strands the family precisely when they need the dock.
  `global-error.tsx` is the only segment exemption (Next replaces the root layout there: no
  `AuthProvider` for `CapsuleNav`, no `globals.css`) and must keep its plain
  `<a href="/">` full-document escape, which the test pins. Page exemptions, all justified in
  that file: `design-system`, `grocery`, `screensaver`, `meals/archive`, `settings/[section]`.
  A nested route is only its parent's section if it is one: `OWN_DESTINATION_ROUTES` in
  `nav-items.ts` lists standalone screens that share a URL prefix — currently `/meals/archive`,
  which must not light up the Meals cap or pass for a manifest-covered route.
  **Seven dock caps for every role** —
  `Rewards` is `KID_ROLES` and `House` is `guest`+`parent`, so exactly one of the pair is always
  present; the `More…` sheet is 7 (parent) / 6 (kid) / 4 (wall) — `/photos` joined it in
  `03af7b2` and the old 6/5/4 counts were stale. The dock also waits for `hydrated` from
  `useAuth` before painting caps, so a kid never sees the parent's `House` cap flash.
  `docs/DESIGN.md` §1.1 holds both tables.

- **Type floor is 12px (0.75rem / `text-xs`).** This *replaces* the 11px floor that earlier
  change records and plan docs cited — those are history, do not follow them for new work.
  Arbitrary px text (`text-[10px]`, `text-[11px]`, …) is banned outright in `src/**`: it
  defeats the rem Dynamic-Type scale. Locked by
  `tests/unit/warm-glass-contracts.test.tsx` (contract B), `tests/unit/compact-type-floor.test.tsx`.
- **Tap targets ≥44×44.** The bar is **44**, not WCAG 2.5.8's 24 (that is the AA *minimum*;
  it is not the house standard — do not cite it as if it were). Visual size may stay compact when
  the element carries **`.hit-44`** (guarantees a centred 44px hit box via `::before`, no layout
  change) or an equivalent documented `after:-inset-*` region. Glyph-only controls need an
  `aria-label`. The primitives are covered by contract C
  (`tests/unit/warm-glass-contracts.test.tsx`); **hand-rolled `<button>` elements are covered by
  `tests/unit/tap-target-contract.test.ts`**, which scans `*.tsx` class strings — jsdom reports
  `0×0` rects, so a measured `<44` assertion would pass vacuously. A new sub-44 button must carry
  `.hit-44` or earn an allowlist entry with a written reason; the allowlist may only shrink, and a
  stale entry fails the suite.
- **Text contrast must clear WCAG AA (4.5:1 body, 3:1 large) in dark AND light.**
  `--color-text-muted` / `--color-text-dim` are the only sub-primary levels and both clear AA;
  to add emphasis change weight or size, never colour, and never re-lighten text with a local
  override.
- **Primitives.** The canonical set is `docs/DESIGN_SYSTEM.md` §3 (`Surface`, `SoftButton`,
  `IconButton`, `Toggle`, `SegmentedControl`, `Chip`, `ListRow`, `SwipeableRow`, `TextField`,
  `Stepper`, `EmptyState`) plus `Modal` (34 call sites). `Card`, `Button` and `Badge` still
  exist as **legacy** leftovers of the pre-warm-glass shadcn recipe (8 files import them) and
  `Input` is deleted — do not add new call sites to the legacy three; converging them is
  Phase 5 of `docs/UI_AUDIT_2026-09.md`.
- **Raw CSS counts for the floor.** Contract B only reads `*.tsx` class strings, so the two
  live stylesheets (`src/app/globals.css`, `src/modes/modes.css` — the only ones `layout.tsx`
  loads) are guarded separately in the same file by contract B2: no `font-size` below
  `0.75rem` / `12px`. Everything else under `src/styles/` (`animations`, `tokens`, `materials`,
  `components`) is **dead** — nothing imports it, B2 asserts it stays that way, and edits there
  change nothing on screen. Put new CSS in `globals.css`.

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


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
