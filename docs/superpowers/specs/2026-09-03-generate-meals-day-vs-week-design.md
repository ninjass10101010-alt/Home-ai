# Generate Meals: Day vs Week Scope — Design

**Date:** 2026-09-03
**Status:** Approved (Option A — one function, scope param)

## Problem

On `/meals` → 🍽️ Plan, the `✨ Generate` button always asks Hermes for a full 28-meal week plan and fills every empty slot across Mon–Sun. The family wants to generate for a single day (the highlighted day card) without touching the rest of the week.

## Decisions (from brainstorming)

- **Which day:** the highlighted day in the weekly strip (`activeDay`) — matches what the user is looking at.
- **Overwrite:** no. Both modes fill empty slots only (existing `occupied`-skip behavior). No replace toggle (YAGNI).
- **UI:** tapping `✨ Generate` opens an option sheet (the shared `Modal`, which now portals above the capsule nav); one tap on an option starts generating.
- **Hook shape:** extend the existing `generateWeeklyPlan` with an optional day-scope param rather than duplicating the fetch/parse/persist block (Option A over separate-function B or client-slice C).

## Design

### `src/hooks/useMeals.ts`

`generateWeeklyPlan(weekOf: string, overwrite = false, days?: string[])`

- When `days` is provided (e.g. `["Wed"]`), the Hermes prompt requests only those days × breakfast/lunch/snack/dinner (4 entries per day) instead of the 28-entry week; the rest of the prompt (family size, macro targets, pantry list, JSON shape) is unchanged.
- After parsing, entries whose `day` is not in `days` are skipped defensively (the model may still return extra days).
- Slot-filling, `occupied` skip, `saveOrQueue` persistence, `setMeals` updates, loading/error state: all unchanged and shared.
- Week mode (`days` omitted) keeps its exact current prompt and behavior.

### `src/components/meals/PlanTab.tsx`

- `✨ Generate` no longer calls the hook directly; it opens a `Modal` (title "Generate meals", description "Consuela fills only empty slots.") with two option cards:
  - **Just {activeDay}** — subtitle: "Fills N empty slots on this day" where N = 4 − meals already planned for `activeDay` in `activeWeek` (slots: breakfast, lunch, snack, dinner). When N = 0 the card is disabled with "This day is already full".
  - **Whole week** — subtitle: "Fills N empty slots across Mon–Sun" (N = 28 − planned slots in `activeWeek`).
- Tapping an option closes the sheet and calls `generateWeeklyPlan(activeWeek, false)` (week) or `generateWeeklyPlan(activeWeek, false, [activeDay])` (day).
- Existing `weeklyPlanLoading` spinner on the Generate button and the `weeklyPlanError` pill are unchanged; the sheet is closed while generating.
- Option cards follow the existing glass-card language (`Surface`/`liquid-glass` rows with `.tap`), ≥44px targets, mobile-friendly.

### Error handling

No new paths — reuses `weeklyPlanError` ("No plan returned — try again", fetch failure) surfaced by the existing pill.

## Testing

- **NEW `tests/unit/meals-generate-scope.test.tsx`** (jsdom, mocked `fetch` + `db`):
  1. Day scope: mocked response containing Wed + Thu + Fri entries → only Wed meals are inserted; prompt body contains the single-day request.
  2. Week mode unchanged: 28-entry response fills empty slots across days; prompt still asks for the full week.
  3. Occupied-slot skip still applies in day mode (existing Wed dinner → only 3 new meals).
- **NEW PlanTab sheet test** (extend or sibling of existing PlanTab tests): Generate opens the sheet; "Just Wed" calls `generateWeeklyPlan` with `["Wed"]`; "Whole week" calls without days; full-day card disabled.
- Full suite + `tsc` + `eslint` on touched files must stay clean.

## Out of scope

- Overwriting/replacing planned meals.
- Multi-day selection (e.g. "weekend").
- Changing the AI prompt content beyond the day list.
