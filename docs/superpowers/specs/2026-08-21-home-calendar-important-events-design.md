# Design: Home Today widget — later-week important events preview

**Date:** 2026-08-21
**Branch:** warm-glass-v2
**Status:** Approved by user (design), pending implementation plan

## Goal

Add a non-visual-impact preview of up to 3 important events from later in the week to the Home screen Today's Events widget, without changing the card size or existing visuals. Importance is AI-detected from Google Calendar data using title keywords, with scores persisted in PocketBase for feature-proof operation.

## Problem

Home currently shows only today's events in the `todayEvents` SectionCard. Users asked for an option to see important events later in the week as well, integrated without affecting current visuals.

## Decisions (user-confirmed)

1. **Importance source:** AI-detect high impact events via title keywords. Google Calendar is the source; flagging is not manual.
2. **Volume:** Max 3 total later-week important events.
3. **Placement:** Today widget footer / body, non-visual-impact. No card height change.
4. **Approach:** Pre-score importance in PocketBase and store `importanceScore` / `importanceReason` on events. Home reads the pre-scored set for the next 7 days.

## User Story

As a family member on Home, I want to see up to 3 important upcoming events from later in the week inside the Today card, so I can plan ahead without leaving Home.

## Success Criteria

- Today widget shows today's events unchanged.
- Below/adjacent, up to 3 important events from days > today and ≤ 7 days out are shown.
- Scoring uses title keywords only for v1.
- No card height/width change; uses existing SectionCard, ListRow, Chip styles.
- Query uses pre-scored `importanceScore >= threshold` from PocketBase.

## Constraints

- No visual change to Today card chrome: same tone, protruding icon, centered header, footer style.
- Read-only from Google Calendar sync; no writes to Google.
- Must work with existing `db.selectTodaysEvents` pattern and PocketBase `events` collection.
- Max 3 events total.

## Changes

### 1. PocketBase schema — `events` collection

Add fields via `pb-seed.ts` patch:

- `importanceScore` number default 0
- `importanceReason` text optional
- `importanceUpdatedAt` datetime optional

Migration is idempotent: if fields exist, skip.

### 2. Scoring service — `src/lib/calendar/importance.ts`

- Keyword list config, e.g. `doctor, dentist, flight, parent teacher, game, tournament, interview, exam, recital, graduation, surgery, vaccine, birthday`
- Scoring function `scoreEvent(event)` returns 0-100 based on keyword matches + simple heuristics: title contains keyword → +50, keyword at start → +20, event duration > 120 min → +10, multiple members → +10
- Reason string built from matched keywords.

### 3. Cron scorer — `src/app/api/cron/calendar/score-importance/route.ts`

- Authenticated by `CRON_SECRET` bearer.
- Fetches events from Google sync window next 7 days via `db.selectEvents` or PocketBase query `start >= today && start < today+7d`.
- Runs `scoreEvent` for each, updates `importanceScore`, `importanceReason`, `importanceUpdatedAt` with upsert.
- Runs every 5 min alongside existing Google sync cron. Optional manual trigger via Settings → Integrations.

### 4. Home data hook — `src/hooks/useHomeEvents.ts` (new or extend)

- Returns `{ todayEvents, upcomingImportant }`
- `todayEvents` from existing `db.selectTodaysEvents()`
- `upcomingImportant` = PocketBase query `events` where `start >= tomorrow && start < today+7d && importanceScore >= 50`, order by `importanceScore desc, start asc`, limit 3

### 5. Home page render — `src/app/page.tsx` case "todayEvents"

- Keep existing SectionCard structure.
- Add a sub-section under visible events:
  ```
  {upcomingImportant.length > 0 && (
    <div className="pt-3 border-t border-white/10">
      <div className="text-[11px] uppercase tracking-wide text-text-muted mb-2">Upcoming important</div>
      <div className="space-y-2">
        {upcomingImportant.map(event => <ListRow ... />)}
      </div>
    </div>
  )}
  ```
- Styling reuses existing `ListRow` props; leftRailColor from event.color, leading icon, trailing Chip with member.
- Footer remains unchanged: hidden today's events "+N more · See all →" link.

### 6. UI consistency

- SectionCard `compact` mode unchanged.
- No new icons; use existing event.icon.
- Empty state: no upcoming important → render nothing, card height unchanged.

## Out of scope

- Manual importance flagging UI.
- Changing Today's Events list layout or card size.
- Expanding keyword list beyond title keywords for v1.
- Writing importance back to Google Calendar.

## Verification

- `npm run typecheck` clean.
- Vitest unit tests for `scoreEvent` with keyword matches and thresholds.
- Playwright: Home → Today card shows today's events + up to 3 upcoming important events; card height matches baseline at 390/768/1440.
- PocketBase seed patch adds fields without data loss.
- Cron route returns 200 with count of scored events; `importanceScore` persists.

## Risks & Mitigations

- Keyword false positives → tunable list in config, threshold adjustable.
- Event fetch cost → query limited to 7 days, indexed on `start`.
- Stale scores → cron runs every 5 min; `importanceUpdatedAt` for debugging.

## Future

- Expand scoring signals: duration, member count, recurring pattern.
- Allow user feedback to adjust scores.
- Surface reason on hover/tooltip.

