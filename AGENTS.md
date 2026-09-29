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
- **Last Updated:** 2026-09-29 | **Dead code: 11 unwired modules deleted, and the cascade was measured** — Eleven files had **zero importers anywhere** (`src/`, `tests/` *and* `scripts/` checked), so they were compiled, type-checked and linted every run while rendering nothing. `AdultHome` (732) and `FamilyHome` (246) lost their mount in `0f5bb1e` (2026-08-04) — and `modes.css` had been carrying *"FamilyHome/AdultHome remain unwired"* as if it were current fact, which is why this read as deliberate. Owner decision: delete all 8, per the Phase 5.1 dead-stylesheet precedent. **It cascaded, and a single-pass check would have missed it:** re-scanning afterwards surfaced three orphans that were *not* unreferenced before — `ProductSearchWidget`, `TravelTimeCard`, `InstacartButton` were imported only by the `AdultHome` just removed. Verified against the pre-deletion tree first. **1,988 lines across two waves.** The scan was itself wrong twice before it was right (mixed path forms flagged live files; then barrels, `tests/`-only and `scripts/`-only references produced false positives), so the shipped contract is **targeted, not general** — `tests/unit/dead-module-contract.test.ts` (3) is the B2 shape: `existsSync === false` per path, a reason on each, a sweep proving no `from "…/<name>"` import crept back, and `modes.css` not naming deleted files. A general unreferenced-file guard was **deliberately not shipped**: its failure mode is pushing someone to delete working code. **Left for a decision, not a regex:** `useSafeFetch` (180) has a real test and no caller — *ready to wire*, not dead; `modes/adult/SwipeableRow` (156) shares a name with the live `components/ui/SwipeableRow`; `MemberModal`, `db/migrate|schema|seed-emergency` and `db/features/seed` are likely script-driven. ~2,500 lines remain for a per-file audit. Verified: full Vitest **4454/4454 (453 files, exit 0)**, `tsc` clean, `next build` exit 0, `push-safe.sh` CLEAN; no test deleted, no allowlist entry needed removing.
- **Last Updated:** 2026-09-29 | **Cleanup: tap-target debt 3 not 11, one race line, no dead ends, nav doc corrected** — **(1) My own allowlist from the previous entry was wrong.** It excused 9 buttons on overlap grounds; re-measuring showed `RewardSection.tsx:238` and `CreateMountainForm.tsx:195` are 40px in a `gap-2` grid (44px box extends 2px vs a 4px half-gap — **no overlap**) and `PhotoInputButton.tsx:124` **already met 44px** via 24px + `before:-inset-2.5`. Six now carry `.hit-44`; offenders **11 → 3**, `hit-44` buttons **7 → 15**. Only the two emoji pickers in a `grid-cols-8 gap-1` genuinely block it (44px on a 32px cell extends 6px vs a 2px half-gap — a wider grid is a design change), plus the already-compliant photo ✕. **(2)** `3cf9fb7` de-duplicated the race-line *templates* but left both *renders* — a kid read the same sentence twice. The leaderboard copy is gone (it already showed the rank); the hero week card owns it. The old test asserted the week card **contains** the board line, i.e. it *pinned the duplication*; it is replaced by a behavioural pin — rendered exactly once, inside `kid-week-card`. **(3)** `/memory` rendered a bare `bg-background` div with no shell, no dock and no back control while the `More…` sheet linked to it for parents; it now uses `PageShell` + a `← Back to Home` link and `MEMORY_FAMILY_ID` instead of a re-stringed literal. (`demo-family` is the **real** family id, not a placeholder — `/analytics` was never broken and is untouched.) New contract `tests/unit/route-shell-contract.test.ts` (4): every route must **reach** `PageShell` via a depth-capped `@/…` import walk or hold a reasoned `SHELL_EXEMPT` entry; stale exemptions fail. Two false-positive classes were caught only by running it — the settings routes delegate to `SettingsSectionView`, and a bare `\bPageShell\b` search matched a *comment* in `Modal.tsx:105`. **(4)** `docs/DESIGN.md` §1.1 rewritten against the manifest (it still said 6 kid tabs and omitted Rewards). Counts **verified against the real helpers, and my first draft was wrong**: the dock shows **seven** caps for *every* role — eight primary entries exist but `Rewards` is `KID_ROLES` and `House` is `guest`+`parent`, so exactly one is always present; that is the invariant `CapsuleNav` sizes for. The `More…` sheet is 6/5/4 for parent/kid/wall. Verified: full Vitest **4451/4451 (452 files, exit 0)**, `tsc --noEmit` clean, ESLint 0 errors (5 pre-existing `no-img-element` warnings), `next build` exit 0, `push-safe.sh` CLEAN.
- **Last Updated:** 2026-09-29 | **The UTC/local day sweep is closed** — Closes the "deliberately NOT fixed" list from `539999d` (four named siblings) **plus the two it missed**. **Four were real, two were not.** *(A) Due presets + the 31-day due list* (`app/tasks/page.tsx`) had **two** defects: evening skew (from 20:00 Detroit the UTC date had rolled over, so "Tomorrow" was two days out, `thisWeek` ran to +7, and every weekday quick-add was a day ahead — while `getISO.today` was already local, so the row was internally inconsistent) **and** a DST fall-back collision (`+ 86400000` is 24 hours, not a calendar day, so on the clocks-going-back night `isoOffset(1)` returned the **same date** as `isoOffset(0)` — "Tomorrow" became "Today"). Helpers moved verbatim to NEW `lib/due-date-utils.ts` (they were module-private in a 2,825-line page, hence untestable) and now use `setDate` local arithmetic. *(B) The kid's "Done today" card* (`KidHome.tsx:391`) compared UTC-to-UTC, so from 20:00 local a 3pm chore stopped appearing and the points total fell with it. *(B2) `getThisWeeksCompletedTasks`* — found on the same path — compared a full ISO **instant** to **date-only** strings, so `completedAt <= now` was false for *any* same-day completion and an unstamped task never counted as this week's, on both the Tasks board filter and the kid card. *(C) Analytics "overdue"** (twice, same expression) parsed a bare local date as UTC midnight, so **from 20:00 local every task due *tomorrow* read as overdue** and a task due *today* read overdue all day. *(D)* `AdultHome.tsx:151` forecast weekday is real but **unreachable** (zero importers since `0f5bb1e`); fixed for correctness, no user-visible effect. **Do not "fix" the false positives:** `skill-tree.ts:200-201` is local-to-local and already correct (`lastActivityDate` is always a full ISO instant, `toDateString()` is local) — `539999d` wrongly listed it; and the six `weekStart` validators are format round-trips with **both** sides UTC-anchored. **Deliberate non-change:** legacy `due` labels (`"Today"`/`"Later"`, still written by `pb-db.ts:236`) are not dates, were never counted overdue, and stay uncounted — promoting them would inflate every count. Contracts: `tests/unit/{due-date-local-days,this-week-completed-tasks-local-day,kid-home-done-today,schedule-analytics-overdue}` (22; RED 7/3/1/4 respectively). No stored value is rewritten — no data repair. Verified: full Vitest **4447/4447 (451 files, exit 0)**, `tsc --noEmit` clean, ESLint 0, `next build` exit 0, `push-safe.sh` CLEAN.
- **Last Updated:** 2026-09-29 | **Two defect fixes + their contracts** — **(1) Evening streaks.** A `completedAt` is a **UTC instant**; `today` / the week key are **local dates**. `539999d` fixed the week *cursor* but left the *comparison* on the UTC axis, in **two** sites, not one: `getThisWeeksCompletedDates` filtered `d.slice(0,10)` against local `monday`/`now`, and `calculateRealStreak` matched `d.split("T")[0]` against a local `cursor` (so fixing only the filter would have admitted the row and then failed to count it). In `America/Detroit` a completion made **20:00–24:00 local** serialized as tomorrow and was **dropped from the week** — the flame went out through the evening, exactly when chores get finished — while a **Sunday-evening** completion serialized as Monday and was **pulled INTO the new week**, inflating Monday's streak. Tokyo's mirror window is 00:00–09:00 local. The old suite was blind to both by fixture design (`T10:00:00.000Z` = 06:00 Detroit / 19: Tokyo, where the two dates agree). NEW `localDateOf(instantIso)` in `lib/local-date.ts`; both sites now compare local-to-local. Contract: NEW `tests/unit/streak-completion-local-day.test.ts` (6, RED 5 failed/1 passed) alongside the unchanged `streak-week-scope-tz` (7). **Rule: never compare a `slice(0,10)`/`split("T")[0]` of an instant against a local calendar key — convert the instant first.** The wider sweep (`tasks/page.tsx:84-86,135-136`, `KidHome.tsx:401`, `AdultHome.tsx:154`, `schedule-analytics.ts:340,357`, `skill-tree.ts:201`) is still open. **(2) Tap targets.** `7b6ba5a` cited WCAG 2.5.8 (24×24, AA) — correct standard, **wrong bar**: `AGENTS.md` requires **44×44**, met only via `.hit-44` (`globals.css:607`, a centred `max(100%, 44px)` pseudo box, no layout change). It fixed 2 of **11** sub-44px hand-rolled buttons and shipped no test. `.hit-44` added to `CrewTasksCard.tsx:40` (24px ✕) and `DailyQuestCard.tsx:39` (32px "View all tasks"); the 7 remaining files (9 buttons: recipe-sheet ✕/emoji toggles, recipe favourite heart, reward/mountain emoji swatch grids, photo-preview ✕) are **allowlisted with a written reason and still below the floor** — the next honest a11y pass. Contract: NEW `tests/unit/tap-target-contract.test.ts` (3) — a `*.tsx` class-string scan (jsdom reports `0×0` rects, so any measured `<44` assertion would pass vacuously), failing on any NEW sub-44 button, on a **stale** allowlist entry, and asserting the two repaired files are not allowlisted. Verified: full Vitest **4425/4425 (447 files, exit 0)**, `tsc --noEmit` clean, targeted ESLint 0, `next build` exit 0, `push-safe.sh` CLEAN.
- **Last Updated:** 2026-09-29 | **The side rail is removed — the bottom dock is the whole navigation model** — `SidebarNav.tsx` and its suite are **deleted**; `PageShell` no longer mounts a rail, reads no auth/role, and no longer reserves width (`md:pl-60` and `data-page-rail` are gone, along with the wrapper `<div>` that held the offset). The owner's call: a left nav was never wanted, and `docs/superpowers/specs/2026-08-06-responsive-window-adaptation-design.md:14,65` had already ruled it out ("keep the bottom nav bar on desktop, no side rail"). **The bottom dock is not a phone-only affordance** — it is the single nav on every device, every width, every role; never add an `md:hidden` sibling or a second fixed side column (a proposed second nav *replaces* the dock, it does not sit beside it). Two reasons recorded for the 2026-09-28 Phase 4.1 mount were wrong and are corrected: (a) the rail was **not** "Home-only" — `src/modes/adult/AdultHome.tsx` has had zero importers since `0f5bb1e` (2026-08-04) and is dead code, so the rail rendered on **no** route for ~8 weeks and 4.1 *added* it everywhere; (b) the actual defect was **two navs at once** — `CapsuleNav` has no `md:` gate, so parents got rail *and* dock above 768px, and because the dock is viewport-centred at `z-50` over the rail's `z-40`, at **768–931px** it painted over and captured the rail's Emergency link (82px overlap at iPad-mini portrait, 49px at iPad Air — iPad portrait is 820px, well over the `md` threshold). `/emergency` did not orphan: its `EXEMPT_ROUTES` reason now names Settings → Safety and the wall Emergency action, and `nav-items.test.ts` (the no-orphan walk) is green. Contract: `tests/unit/page-shell-tiers.test.tsx` (10) pins the *inverse* of the old one — no rail and no `<aside>` for all four roles, exactly one `<nav>`, no `md:pl-60` in the rendered HTML; the old suite never asserted `hidden md:flex`, so flipping the rail to always-visible passed all 9 of it. Verified: full Vitest 4416/4416 (445 files, exit 0), `tsc --noEmit` clean, targeted ESLint 0, `next build` exit 0 — and the **served bundle** checked, not just source: `md:pl-60`, `data-page-rail` and the rail's brand string return zero matches across `.next/static/chunks/` while the dock is in 20 chunks. Ops: none (no PB/env/secret/`pb:seed`).
- **Last Updated:** 2026-09-28 | **UI audit Phase 4 (complete) + Phase 5 (5.1–5.7 shipped)** — `PageShell` is now the one shell for *every* route. (4.1's desktop rail shipped here and was **removed 2026-09-29** — see the entry above; `PageShell` now owns the dock alone.) `/chat` renders through the shell too: it gained `<main>` + the sync banner (its signed-out thread copy passed via `bannerMessage`) + the dock, while keeping its narrow `max-w-lg` thread (`contentClassName`) and its own composer dock-clearance (`bottomInset={false}` — the composer already pads `env(safe-area-inset-bottom) + 5.5rem`). New shell props: `bannerMessage`, `bannerClassName`, `contentClassName`, `bottomInset`, `clip`. **`clip` matters:** the shell root is `overflow-hidden`, which becomes the scrollport for descendants — a sticky header would pin to that box and scroll away, so chat (sticky top bar + composer) passes `clip={false}` and the document stays its scrollport. **4.3 — tablet two-column on Home's grid idiom:** Tasks (stats `md:col-span-2` over switch | panel, private `lg:max-w-3xl` removed), Calendar (month grid | day agenda via `md:col-start-2 md:row-start-1`, week card `md:col-span-2`), meals Plan/Shop/Stock (`md:grid-cols-2` replaces `lg:grid-cols-[1fr_320px]`, `xl:grid-cols-[1fr_280px]`, `xl:order-*`/`hidden xl:*` hooks; RecipeBox drops `xl:grid-cols-3`); Settings launcher already tiers `sm:grid-cols-2`. **4.4 — wall composition:** under `html[data-wall]`, body copy (`text-sm`) floors at 16px and smaller utilities at 14px, every interactive control floors at 44×44 (settings keeps its stricter 64px), and the only hover-only action popup (RecipeBox `hidden group-hover:grid` day-picker) is withdrawn — decorative `pointer-events-none` glows stay hover-lit; Home's grid still swaps to `WALL_GRID_CLASS`. **4.5 — Home depth:** `FIRST_FOLD_WIDGETS` (`morningBriefing, todayEvents, weather, tasks`) is the ranked prefix of the phone order; stacked layouts render `PHONE_WIDGET_FOLD = 4` widgets and fold the rest behind the More… sheet (`extraItems` action row, `MoreMenuItem` `onSelect` button variant; wall/desktop render all); ambient motion runs through `AnimationBudgetProvider` (6 slots over `useAnimationBudget`) — DayLine's now-glow and the leaderboard row glows go static when the budget is spent, and outside Home the hook is unbounded. Contracts: `tests/unit/page-shell-tiers.test.tsx`, `tests/unit/tablet-two-column.test.ts` (5), `tests/unit/wall-composition.test.ts` (4), `tests/unit/home-first-fold.test.ts` (5), `tests/unit/animation-budget.test.tsx` (3); the four chat suites mock `usePathname` now. **5.1 — the dead stylesheets are deleted:** `src/styles/{animations,tokens,materials,components}.css` (2,064 lines, `⚠️ DEAD FILE`, imported by nothing, duplicated by `globals.css`) are gone, and contract B2 now asserts they stay *deleted* (`existsSync` false), not merely unimported. **5.2 — design-system convergence:** the legacy `Card` / `Button` / `Badge` components are deleted — all 13 importing files (34+ call sites; half imported with single quotes, which the audit's grep had missed) now render `Surface` / `SoftButton` / `Chip`, and `Badge`'s static case became `Chip as="span"` (a span with no `hit-44`: a label is not a control) plus new `violet`/`cyan` tones; the redundant `--color-text-*` re-scopes in `.widget-card` (dark + light) and `.kitchen-text` are gone, and the class left all eight markup sites. Contract: `tests/unit/design-system-convergence.test.tsx` (4). **5.5 — user-facing Reduce motion:** the OS-only `prefers-reduced-motion` blocks never fire on the shared wall, so `reduceMotion` joins the persisted theme config, Settings → Appearance has a "Reduce motion" toggle beside High contrast, and `ThemeProvider` mirrors it to `<html data-reduce-motion="true">` (blanket near-zero-duration CSS + a `consuela-motion-preference-change` event that `usePrefersReducedMotion`/`AnimatedEmoji` react to mid-session). Contract: `tests/unit/reduce-motion-preference.test.tsx` (2). **5.3 — radius + surface tokens:** every `rounded-*` utility resolves to a `--radius-*` token — the off-scale `rounded-3xl` (Tailwind's default 24px next to 36px cards, 39 sites) and the raw `rounded-[2rem]` / `rounded-[1.25rem]` lengths are gone, and the last `bg-white/[0.03]` is a `surface-2` token; the only raw radius left is the screensaver's viewport-scaled `rounded-[3vh]` (allowlisted with a reason). The 556 hex + 512 `rgba(` literals now carry a shrink-only budget contract. Contract: `tests/unit/radius-and-color-tokens.test.ts` (4). **5.6 — one design-system page that audits itself:** the near-duplicate `src/app/_design-system/page.tsx` is deleted (the legacy URL still rewrites to `/design-system` via middleware; the stale `EXEMPT_ROUTES` entry is gone), and the surviving page ends with `DesignSystemSelfAudit`, which runs the four house rules against its own mounted DOM (sub-12px text, <44px tap targets without `hit-44`, unnamed controls, resting inset shadows) with `data-ds-shadow-exempt` / `data-ds-audit-ignore` opt-outs and a Re-scan button — no axe in the app bundle (axe stays an e2e guardrail). Contract: `tests/unit/design-system-self-audit.test.tsx` (4). **5.4 — modal adoption pinned:** the 19 hand-rolled dialogs that must stay custom (full-screen editors, PIN pads, cook mode, weather details, the centered PIN/transaction/mountain forms) now carry `role="dialog"` + `aria-modal="true"` + an `aria-label` (and `RecipeModal` gained Escape); the `fixed inset-0` sites that are not dialogs are classified as layers (**7, not 8** — the rail's classification went with the component on 2026-09-29). `tests/unit/modal-adoption.test.ts` (4) allowlists every hand-rolled overlay with a reason, fails on new ones, and pins the hand-rolled-dialog count as a ceiling that drops with each port to `Modal`. **5.7 — the Tasks page is split by section:** four view blocks moved to `src/components/tasks/` (`TasksStats`, `CrewTasksCard`, `TasksArchive`, `TasksRewardsPanel`) behind typed props; all 33 `useState`, the PB sync flow and the PIN/edit modals stay in the page (2,946 → 2,820 lines), and the entangled task-board body is documented follow-up. Contract: `tests/unit/tasks-sections.test.tsx` (4). Verified: full Vitest 3,373/3,373 (403 files, exit 0) with all 17 `tasks-*` suites unchanged, `tsc --noEmit` clean, targeted ESLint 0 findings, `next build` exit 0.
- **Last Updated:** 2026-09-28 | **Navigation & IA (UI audit Phase 3)** — `src/lib/nav-items.ts` is now the single route manifest (`path, label, iconKey, roles, group, wall`) feeding the dock and a new Home `More…` sheet; one SVG icon set (`NavIcon`) replaced the dock's inline SVGs and the (now-deleted) rail's emoji; one `isPathActive` rule replaced the dock's `pathname === href` vs the rail's `startsWith`, which is why `/settings/me` lit Settings in one nav and nothing in the other; the dock's five hard-coded lime literals and the rail's phantom `--color-accent-selected-rgb` fallback both became `--color-nav-active*` (note: the active dock pill now follows the accent, not lime). All six routes that had no inbound link (`/grocery`, `/skill-tree`, `/time-capsule`, `/analytics`, `/money-mountain`, `/memory`) are reachable from the More… sheet, role-filtered so the wall never shows the parent-only memory bank or finance. `tests/unit/nav-items.test.ts` walks every `src/app/**/page.tsx` and fails on a route that is neither in the manifest nor in `EXEMPT_ROUTES` with a written reason — a new route can no longer ship unreachable. Verified: full Vitest 3,324/3,324 (392 files, exit 0), `tsc --noEmit` clean, targeted ESLint clean, `next build` clean.
- **Last Updated:** 2026-09-25 | **Weather sky re-skin** — the weather card gains a measured dawn/dusk phase axis (night-first skyPhase from sunProgress), machine-AA-verified dawn/dusk SKY washes for clear/cloudy only, rotating sun god-rays on the measured arc + phase-tinted disc, a real phase-lit poster moon (face opacity tracks illumination; craters; dark disc at new moon), 42 cover-dimmable stars + shooting star, per-drop deterministic rain/snow variation (probability drives count only), three-band fog, and a glowed storm bolt beside the kept `mix-blend-overlay` wash. Whole-card sheen (pointer-events-none) + `GLASS`/`GLASS_NIGHT` retuned in place. Keyframe lifecycle +10/−5 with the reduced-motion list updated 1:1; cloud drift still requires wind > 0; dead `WeatherScene.tsx` deleted with its helpers in `src/lib/weather-astro.ts`. New AA-gate + boundary suites; weather-widget tests updated; both probes green; tsc clean.  
- **Last Updated:** 2026-09-25 | **Weather sky re-skin** — the weather card gains a measured dawn/dusk phase axis (night-first skyPhase from sunProgress), machine-AA-verified dawn/dusk SKY washes for clear/cloudy only, rotating sun god-rays on the measured arc + phase-tinted disc, a real phase-lit poster moon (face opacity tracks illumination; craters; dark disc at new moon), 42 cover-dimmable stars + shooting star, per-drop deterministic rain/snow variation (probability drives count only), three-band fog, and a glowed storm bolt beside the kept `mix-blend-overlay` wash. Whole-card sheen (pointer-events-none) + `GLASS`/`GLASS_NIGHT` retuned in place. Keyframe lifecycle +10/−5 with the reduced-motion list updated 1:1; cloud drift still requires wind > 0; dead `WeatherScene.tsx` deleted with its helpers in `src/lib/weather-astro.ts`. New AA-gate + boundary suites; weather-widget tests updated; both probes green; tsc clean.
- **Last Updated:** 2026-09-25 | **Role-aware Settings launcher + focused sections + final review hardening** — `/settings` now opens six parent categories (Me, Family, Safety, Appearance, Home, Connections & System) or the same three safe categories (Me, Safety, Appearance) for guests/children/pets. Six static route entries each own one `next/dynamic` section behind the shared auth/role shell, so `/settings/me` does not request System chunks or System-only APIs. Emergency copy is role-aware and every Emergency action targets `/settings/safety`; wall controls meet 64px, descendant overflow is probe-checked, and Modal excludes effectively disabled controls. Both Playwright probes share one explicit safe env map covering every `.env.example`, literal `src/`, and `SERVICES_REGISTRY` field, reserve OS-assigned ports, and await server/log/temp cleanup. Emergency copy stays neutral until auth hydration. The dedicated `/api/emergency/test` route is parent-authorized, uses live contacts with an in-process duplicate guard, and renders partial channel delivery honestly; the real emergency route uses registry-backed Gmail config and reports house-only/partial delivery. Settings sign-in dismissal is blocked while authentication is pending, and Google token read failures surface as unavailable state rather than false disconnection. Verified in the final-review fix wave: focused matrix passed (16 files/180 tests for auth, members, Settings, and emergency; 16/179 for Google, Home, and Calendar; 9/88 for push, System, and probe hardening, with the System suite repeated in the last group), `verify-settings-launcher.mjs` 51/51, `verify-emergency-settings.mjs` parent/child/pet/guest passed, `tsc --noEmit` clean, targeted ESLint 0 errors with one pre-existing Calendar exhaustive-deps warning. Final verification: full Vitest passed 3,199/3,199 tests across 381 files, with only the two approved pre-existing `tasks-approve-all` teardown errors; the known full-lint baseline remains 64 findings (43 errors, 21 warnings) and is not claimed clean.
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
  route:** a parent-reachable destination that renders no `PageShell` is a dead end and fails
  `tests/unit/route-shell-contract.test.ts`, which walks every `src/app/**/page.tsx`, follows
  `@/…` imports (depth-capped) to find the shell, and requires a reasoned `SHELL_EXEMPT` entry
  otherwise. Current exemptions, all justified in that file: `design-system`, `grocery`,
  `screensaver`, `meals/archive`, `settings/[section]`. **Seven dock caps for every role** —
  `Rewards` is `KID_ROLES` and `House` is `guest`+`parent`, so exactly one of the pair is always
  present; the `More…` sheet is 6 (parent) / 5 (kid) / 4 (wall). `docs/DESIGN.md` §1.1 holds
  both tables.

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
