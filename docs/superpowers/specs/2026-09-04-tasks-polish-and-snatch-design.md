# Tasks page polish + "Snatch the task" — design doc

**Date:** 2026-09-04 · **Surface:** `/tasks` (`src/app/tasks/page.tsx` + leaderboard components + task-utils + claim route) · **Mode:** Operate · **Type:** Polish of the incumbent warm-glass world + one additive feature. No visual world changes.

## Decisions (user-locked, 2026-09-04)

- Scope: full pack — P1 honesty + P2 composition + P3 copy + the snatch feature.
- Pets (Rocco, Rico) are excluded from task assignment and the member filter strip.
- Desktop page width: 768px content column (matches Settings), not full-bleed.
- Stat tiles (Pending / Completed / Earned) all follow the member filter; "All" and "Up for grabs" show family totals.
- Stealable tasks become snatchable the **day after** their due date (day precision matches the existing date-only `due` field).
- Snatch = **points transfer only**: the snatcher earns the task's points; the original assignee loses nothing.

## Findings that motivate this (evidence from live probe, 390px + 1280px, seeded data)

1. **Honesty:** when the Hermes call fails or returns no parseable actions, `generateAiTasks`/`generateAiRewards` inject 4 hardcoded suggestions (with real family names hardcoded) into "Consuela suggests", masquerading as Consuela's ideas. Violates the dashboard's honest-empty-state contract.
2. **Honesty/composition:** at the start of a week (all members 0 pts) the champion card crowns the first member "This week's champion — 0 pts" with an empty 0% ring and an active Share button.
3. **Layout:** `PageShell` is `lg:max-w-none`; Tasks inherits it, so rows stretch to ~1240px on desktop (every other form/list surface caps at 512–768px).
4. **Semantics:** Pending tile follows the member filter; Completed + Earned are family totals — three adjacent tiles silently report different scopes.
5. **Touch targets:** row action buttons render at 36px (`IconButton size="sm"`); champion Share is 33×16px. (Documented deferred item from the 2026-09-03 critique.)
6. **Bug:** DailyQuestCard "Go" calls `adoptSuggestion(quest)` where quests are real pending tasks → creates a **duplicate** task. (Verified by reading both call sites; quests = `myPendingQuests` = real tasks.)
7. **Copy:** "Google" button label is cryptic; filtered empty lists claim "All caught up" globally.
8. **Consistency:** pets are assignable to tasks and appear in the filter strip, while leaderboard and claim flows exclude them — points assigned to a pet vanish.
9. Stagger entrance delay on task rows is unbounded (`idx * 0.05s`).

## Part 1 — Polish (incumbent world preserved)

### 1.1 Honest AI suggestions
- `generateAiTasks` / `generateAiRewards`: delete both hardcoded fallback arrays.
- Failure or unparsable response → toast: "Consuela couldn't come up with ideas right now — try again in a bit." The existing honest `EmptyState` ("No suggestions yet") stays. Loading spinners unchanged.
- Rename the Google button label "Google" → "Sync Google Tasks" (existing honest toasts untouched).

### 1.2 Fresh-week champion state
- When `familyTotal === 0`: the champion Surface renders a "new week" card: 👑 + "This week's crown is up for grabs" + "First completed task takes the lead." No champion name, no ProgressRing, no Share, no Stats grid.
- When points exist: current card, but the tiny "Share" text link becomes a real ghost `SoftButton size="sm"` (↗ Share) in the top-right corner (min 44px effective hit target).

### 1.3 Desktop width
- Wrap `PageHeader` + the content column in `<div className="lg:max-w-3xl lg:mx-auto w-full">`. `PageShell` is not modified (other pages unaffected). Modals (portaled to body) unaffected.

### 1.4 Filter-aware stat tiles
- Pending: unchanged source (`pending.length`, already filtered), detail "Open tasks".
- Completed: count of this week's completed tasks **in the current filter scope** ("Up for grabs" → universal tasks completed this week).
- Earned: `weekData.points[selectedMember]` when a person is selected; family total otherwise. Detail stays "This week's points".
- Tile labels/icons/tones unchanged.

### 1.5 Touch targets
- New utility in `globals.css`: `.hit-44` = `position: relative` + `::before { content:""; position:absolute; inset:-4px; }` extending small controls to ≥44px effective (the documented photo-remove pattern, promoted to a shared utility).
- Apply to: suggestion dismiss ×, completed-row undo ↩, reward edit ✎, penalty apply ⚠️ and edit ✎. Visual sizes unchanged.
- Also add `aria-label` to the Share button; row `role="button"`s already labeled.

### 1.6 Daily Quests fix
- `DailyQuestCard` "Go" → now opens the task's PIN-complete flow (`openPinEntry(quest.id)`) instead of `adoptSuggestion` (removes the duplicate-task bug and makes the quest one-tap actionable).
- Button label "Go" → "Do it", `aria-label={"Do " + quest.title}`.
- The `setAiSuggestions(prev => prev.filter(...))` side effect in the handler is removed (it was a no-op for real tasks).

### 1.7 Copy + micro-polish
- Filtered empty state: when the filter is a person and nothing is pending → description "Nothing pending for {firstName} right now." "All" keeps "All caught up / No pending tasks right now"; the guest-sync honest 🔐 state is untouched.
- Row stagger: `animationDelay: Math.min(idx, 8) * 0.05`.
- Pets excluded from: Add/Edit assignee select, member filter strip. `emptyTask` default = first non-pet member. Claim select already excludes pets. Pet-assigned legacy tasks remain visible under "All".

### Out of scope (documented, not touched)
- Global h1→h3 heading fix in `SectionCard` (shared component; documented deferred, needs its own pass).
- Home↔Tasks widget counts live on the Home surface.
- Home layout/filmstrip code.

## Part 2 — "Snatch the task" (steal-on-late)

### Concept
Opt-in per-task competition: any task can be marked "⏰ Up for grabs when late". When its due date passes uncompleted, it joins the shared race — anyone can claim it with their PIN and take the points. The assignee keeps their existing points (transfer only).

### Data model
- `Task.stealable?: boolean` (default false/absent).
- `toSnatchable(t) = !!t.stealable && !t.completed && t.due < todayISO()` (pure helper in `task-utils.ts`, unit-tested).
- PB persistence: `syncTasksToPB` writes `stealable`; `pb-seed.ts` adds a `stealable` bool field to `tasks`; gateway sanitizer allowlist accepts `stealable`.
- Snapshot/restore paths already copy unknown fields through (`...t`), so no restore changes needed.

### Add/Edit form
- New `Toggle` under "Universal task": label "⏰ Up for grabs when late", description "If it's not done after the due date, anyone can grab it for the points."
- Universal + stealable together are allowed (independent flags; universal = claimable anytime, stealable = claimable once late).

### Where stealable tasks surface
- **"Up for grabs 🤝" filter**: universal tasks + past-due stealable tasks.
- **"My Tasks"**: steals of other members' tasks appear (so a sibling sees the opportunity) with meta line "was due {label}".
- **Row meta line**: for stealable-and-late rows, meta becomes `{assignee} · was due {label} · {category}` and a tiny "⏰ up for grabs" text marker replaces no other content.
- Pending section order unchanged otherwise.

### Snatch flow (reuses the universal claim path)
- Client: tapping a past-due stealable row opens the same PIN modal with the "Claim for" select (default = signed-in member via `pickDefaultClaimMember`). Claim writes same as universal: assignee → claimant, completed, points to claimant, confetti, honest conflict toasts.
- Server (`/api/tasks/claim`): eligibility guard extends from `universal !== false` to `universal !== false OR (stealable === true AND due < currentLocalDate)`. Day precision: `due` is a `YYYY-MM-DD` date; "late" = due strictly before today (America/Detroit via existing `todayISO()` semantics — the route computes its own local date, same day-precision as the client).
- All existing claim-route guarantees kept: server-trusted points, done-task rejection, lost-update detection, full completion fields on the task row.
- Transaction description: `Snatched late: {title} (+{pts}pts)` so the Recent Activity log reads honestly.

### Undo interplay
- Undoing a snatched completion is the existing undo flow (same-week, PIN, reverses points, releases the claim guard). No changes.

## Error handling
- Claim route rejection reasons extended: stealable-not-yet-due claims never occur from the UI (rows only act stealable when late), but the server guard independently rejects them — honest 400.
- All new fetch paths reuse existing honest-toast behavior; no new silent failures introduced.

## Testing (TDD)
- `task-utils` additions: `toSnatchable` (due today vs yesterday, completed, universal independence, missing due).
- Page tests: fresh-week champion state (0 pts → "up for grabs" copy, no Share), fallback-free AI failure (toast + empty state), filtered empty copy, tile scope switching, quest "Do it" opens PIN modal without duplicating tasks, stealable row appears in Up for grabs only when past due.
- Route tests: claim route accepts stealable+past-due, rejects stealable+not-yet-due, keeps universal behavior.
- Existing suites must stay green (task claim, guest sync state, roster refresh, cross-device refresh).

## Verification before done
- `tsc` clean, eslint clean on touched files, vitest suite green (no new failures), production build clean.
- Playwright probes at 390×844 and 1280×800: both tabs, fresh-week state, populated week, stealable row states, modal flows; 0 page errors, no horizontal overflow.
- Impeccable detector on touched files: no new findings beyond the documented pre-existing ones.
- AGENTS.md updated in the same session (snapshot + UI Change Record + journeys), per project rule.
