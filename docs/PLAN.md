# Plan — Consuela (Home-ai)

> How work is planned, tracked, and accepted in this repo. This is the standing pointer; per-feature work follows the dated spec/plan convention. **LLM-to-LLM:** add new standing work items HERE — never to loose root TODO files.

## How work flows

1. **Brainstorm → design spec** — `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (outer Dashboard repo)
2. **Implementation plan** — `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` (task-by-task, TDD where applicable)
3. **Execute** — task-by-task with per-task commits; focused suites green + `npm run typecheck` clean per task
4. **Ship** — CHANGELOG.md entry + parent submodule pointer bump + push-safe + push (see AGENTS.md §6)

## Acceptance gates (every shipped change)

- Focused test suites green, `npm run typecheck` clean, `next build` clean when routes change
- CHANGELOG.md long-form entry appended in the same session
- UI-affecting changes: a `### UI Change Record` in `docs/DESIGN.md` with its **CONTRACTS to keep**
- `bash scripts/security/push-safe.sh` → CLEAN before pushing
- Session ends with clean `git status` in BOTH repos; finish with "Deploy to NAS now?"

## Open items

> **Canonical record for the 2026-10-04 audit wave's unfixed findings is the outer repo:**
> `../docs/superpowers/plans/2026-10-04-audit-wave-open-findings.md`. Read it before doing points,
> money, config/deploy or UI-debt work — it carries the evidence, severity, and what would confirm
> each VERIFY item. Do not re-derive those findings; the original detail files were written to
> `/tmp` and are gone.

### Needs a human decision (cannot be automated)

- [ ] 🚨 **Rotate the burned Telegram bot token at BotFather.** A live token reached
      `origin/warm-glass-v2` in `scripts/restart-consuela.sh:17`; redacted forward-only in `2d14e19`.
      The live `/tmp/new.env` value differs from the committed one, so something rotated before, but
      nothing records it. History rewrite is a human decision (force-push otherwise forbidden).
- [ ] **Dark mode reads indigo, not amber** after `2053257`. The amber traced to a `??` that never
      falls through (`hexToNum` returns `NaN`, not `undefined`), so it was judged an accident — but
      it is the biggest visual change in the wave. A deliberate fog colour is still honoured.
- [ ] **19 Dependabot vulnerabilities** on the default branch (2 critical, 4 high). Related:
      `@google/generative-ai` is an unused prod dep and the `esbuild` override is out of range for
      `drizzle-kit`.
- [ ] **NAS PocketBase volume is `home-ai-app_pocketbase_data`**, not the pinned
      `familydashboard_pocketbase_data`. Harmless for the tar + `docker run` path, but a future
      `docker compose up` would attach an EMPTY volume and the dashboard would look wiped. Reconcile
      before any compose deploy.

### Deferred — points & money

- [ ] **Money-mountain match contract never pays a parent match** (`src/lib/money-mountain.ts:165`
      computes `matchAmount` under `!data.parentId`; `:201` creates the transaction under
      `data.parentId` — mutually exclusive, so money is credited with no ledger row).
      `weeklyMatchTotal` is computed then discarded.
- [ ] **`money-mountain.ts:170-171` week key is local-vs-UTC wrong** —
      `weekStart.setDate(... - getDay())` then `.toISOString()`, so a Monday deposit in a
      negative-offset zone lands in the previous week and the weekly match cap reads the wrong
      bucket. `localWeekStartISO()` in `src/app/api/rewards/redeem/route.ts` is the correct helper.
- [ ] **Two legacy weeks fail `parseCanonicalTransactions` on their `meta`** — `week_data` **and**
      `week_archive`, `weekStart` `2026-09-14` and `2026-06-15`. A write to them throws and maps to a
      misleading `ledger_write_conflict`. **Fails safe**; read path renders both weeks fine; the
      current week is canonical.

### Needs sign-off before it lands

- [ ] **`skill-tree` stores quest completion on the SHARED quest row**, so a sibling is locked out of
      a quest they never did; `start` is bypassable (`status === 'active'` never checked).
- [ ] **Non-timing-safe PIN compare** in `src/lib/member-pins.ts:14` and
      `src/lib/server-auth.ts:260` (`===`). The emergency route now compares hashed digests; these
      two lag.
- [ ] **Unbounded process-local PIN-throttle `Map`** — no eviction, per-process.

### Absorbed from root TODO.md 2026-09-24 — now verified

- [x] ~~Clean up duplicate `useEffect` that deletes `q` from the URL~~ — **already resolved**; exactly
      one site exists (`src/hooks/usePendingChatQuery.ts:29`). Confirmed 2026-10-04.
- [x] ~~Run `npm run lint` and `npm run build` to verify~~ — **done 2026-10-04**: `npm run build`
      clean; lint now 56 real problems (35 errors / 21 warnings) after the `.worktrees/**` phantom
      findings were eliminated (it had been reporting 751).
- [ ] Translate OpenRouter action types into existing local behaviors (insert/update DB/localStorage)
      — old chat action-card TODO. **Still unverified**; nothing in the 2026-10-04 wave touched it.

## Roadmap

Current direction = the newest CHANGELOG entries + the parent repo's `docs/superpowers/specs|plans/`. There is no separate backlog file — deliberately: work items live here until picked up, then become a dated spec/plan pair.
