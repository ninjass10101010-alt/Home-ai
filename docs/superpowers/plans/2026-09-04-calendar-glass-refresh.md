# Calendar Glass Refresh (Route A) Implementation Plan

> **For agentic workers:** implement via superpowers:subagent-driven-development. Steps use checkbox tracking.

**Goal:** Restyle the `/calendar` month-grid card + Calendar/Schedule tabs in the approved glass-calendar direction (big animated month title, ghost chevrons, day strip with gradient selection pill, gradient selected day) — zero feature loss, zero new deps.

**Architecture:** CSS-only tokens/keyframes in `globals.css`; one JSX region change in `src/app/calendar/page.tsx` (grid card header + new day strip inside the card); SegmentedControl untouched (already has `emphasize`).

**Spec:** `docs/superpowers/specs/2026-09-04-calendar-glass-refresh-design.md`

**Tech Stack:** Next.js 16 app router, Tailwind v4 + custom tokens, vitest.

## Global Constraints

- **NO git commits/stash/reset.** Anti-repo rule: the tree is the user's WIP. Do NOT commit anything, ever.
- No new dependencies; no framer-motion, no date-fns, no lucide.
- Colors via `var(--color-accent-*)` / `color-mix` only; no raw palette literals. The reference's pink→orange gradient is explicitly NOT used.
- Motion is CSS-only; every new keyframe/transition is in the `prefers-reduced-motion` kill block.
- 11px text floor everywhere; AA contrast in light AND dark AND `data-contrast="boost"`.
- Dev server on :3000 is the user's — never kill/restart. Tests: `npx vitest run tests/unit/`; the weather-widget fusion test failure is the user's own WIP — never touch weather files or tests.
- Do NOT edit AGENTS.md/DESIGN.md (separate docs pass handles records).

---

### Task 1: CSS — glass strip + gradient selected day + animated month title

**Files:**
- Modify: `src/app/globals.css` (calendar block ~lines 2171–2245; reduced-motion kill block — find the existing `@media (prefers-reduced-motion: reduce)` section and report its line if ambiguous)
- Test: `tests/unit/compact-type-floor.test.tsx` (extend — it's the project's class-contract test file; follow its existing assertion style)

**Interfaces:**
- Consumes: `--color-accent-button`, `--color-accent-selected`, `--ease-settle` (both exist in tokens), `.calendar-day-btn`, `.calendar-month-title`.
- Produces: `.calendar-day-strip-wrap`, `.calendar-day-strip`, `.calendar-strip-day`, `.calendar-strip-day.is-selected`, `.calendar-strip-day.is-today`, `@keyframes calendarMonthSettle`, updated `.calendar-day-btn.is-selected`, `.calendar-month-title.is-animating`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/compact-type-floor.test.tsx` (read the file first and follow its existing patterns exactly):

```tsx
it("month title uses the settle animation class", () => {
  const g = require("fs").readFileSync("src/app/globals.css", "utf8");
  expect(g).toContain("@keyframes calendarMonthSettle");
  expect(g).toContain(".calendar-month-title.is-animating");
});
it("strip + selected-day classes exist", () => {
  const g = require("fs").readFileSync("src/app/globals.css", "utf8");
  for (const c of [".calendar-day-strip-wrap", ".calendar-day-strip", ".calendar-strip-day", ".calendar-strip-day.is-selected", ".calendar-strip-day.is-today"]) expect(g).toContain(c);
});
```

Run: `cd Home-ai && npx vitest run tests/unit/compact-type-floor.test.tsx -t "calendar"` → expect FAIL (classes missing).

- [ ] **Step 2: Implement the CSS**

In `globals.css`, inside the calendar block (immediately after `.calendar-month-year`'s rule):

```css
@keyframes calendarMonthSettle {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.calendar-month-title.is-animating { animation: calendarMonthSettle .24s var(--ease-settle) both; }

/* Day strip inside the grid card */
.calendar-day-strip-wrap { overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; padding: .1rem .85rem .45rem; border-bottom: 1px solid rgba(255,255,255,.05); }
.calendar-day-strip-wrap::-webkit-scrollbar { display: none; }
.calendar-day-strip { display: flex; gap: .45rem; min-width: max-content; }
.calendar-strip-day {
  display: flex; flex-direction: column; align-items: center; gap: .15rem;
  padding: .4rem .6rem; border-radius: 1rem; border: 1px solid transparent; background: transparent;
  color: var(--color-text-secondary); cursor: pointer; min-width: 2.6rem;
  transition: background .18s var(--ease-settle), color .18s var(--ease-settle);
}
.calendar-strip-day .wd { font-size: .62rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .62; }
.calendar-strip-day .num {
  width: 1.9rem; height: 1.9rem; border-radius: 999px; display: flex; align-items: center; justify-content: center;
  font-size: .82rem; font-weight: 600;
}
.calendar-strip-day:hover { background: rgba(255,255,255,.06); color: var(--color-text-primary); }
:root[data-theme="light"] .calendar-strip-day:hover { background: rgba(0,0,0,.05); }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .calendar-strip-day:hover { background: rgba(0,0,0,.05); } }
.calendar-strip-day.is-today .num { border: 1.5px solid color-mix(in srgb, var(--color-accent-selected) 60%, transparent); }
.calendar-strip-day.is-selected .num {
  background: linear-gradient(135deg, var(--color-accent-button, var(--color-accent-selected)), color-mix(in srgb, var(--color-accent-button, var(--color-accent-selected)) 72%, #111827));
  color: #fff; box-shadow: 0 6px 16px color-mix(in srgb, var(--color-accent-selected) 30%, transparent);
}
```

Replace the gray `.calendar-day-btn.is-selected` rule body (globals.css:2210–2215) with the accent-gradient pill (keep `.is-selected:hover` and the light `is-selected.is-today` override — just swap their backgrounds to the same gradient):

```css
.calendar-day-btn.is-selected {
  color: #fff;
  background: linear-gradient(135deg, var(--color-accent-button, var(--color-accent-selected)), color-mix(in srgb, var(--color-accent-button, var(--color-accent-selected)) 70%, #111827));
  border-color: color-mix(in srgb, var(--color-accent-button, var(--color-accent-selected)) 62%, rgba(255,255,255,.35));
  transform: scale(1.06);
  box-shadow: 0 12px 32px color-mix(in srgb, var(--color-accent-selected) 32%, transparent);
  z-index: 1;
}
```

And in the light-theme block (globals.css:2234-2237) replace the muted `is-selected.is-today` background with the same gradient.

Add `calendarMonthSettle` to the existing `prefers-reduced-motion` kill block (same line as the other calendar entries).

- [ ] **Step 3: Run the test** — `npx vitest run tests/unit/compact-type-floor.test.tsx` → green.
- [ ] **Step 4: No commit.** Record the change in the report.

---

### Task 2: JSX — month header settle + day strip inside the grid card

**Files:**
- Modify: `src/app/calendar/page.tsx` (grid-card header region ~lines 760–815 visible in the read; `selectedDay`/`today`/`month`/`year`/`MONTHS`/`DAYS` state already in scope)
- Test: `tests/unit/compact-type-floor.test.tsx` (add DOM-contract assertions) — if the page-level render harness for calendar is awkward, add a new focused test `tests/unit/calendar-glass-refresh.test.tsx` following the patterns in `tests/unit/plan-tab-members-swap.test.tsx`.

**Interfaces:**
- Consumes: `selectedDay`, `setSelectedDay`, `month`, `year`, `today` (const, page.tsx:259-ish), `MONTHS`, `DAYS`, `goToToday`, `prevMonth`, `nextMonth`, `.calendar-strip-day*` classes from Task 1.
- Produces: no exported API. Strip buttons are plain `<button type="button">` units; no new state.

- [ ] **Step 1: Write the failing test** — assert: (1) the grid card's month title carries `is-animating` when the month changes (key on `${year}-${month}`); (2) a strip renders with exactly one `.calendar-strip-day.is-selected` and it matches `selectedDay`; (3) clicking a strip day updates the same `selectedDay` the grid uses (assert the grid day-cell gets `is-selected` too — shared state is the contract). Use `tests/unit/calendar-glass-refresh.test.tsx` if the harness is easier; follow existing page-test patterns.

- [ ] **Step 2: Implement** in `calendar/page.tsx`:

Month title (keep `<h2>`, same text): give it `key={`${year}-${month}`}` + `className="calendar-month-title is-animating"` so the settle re-runs on month change.

Insert the strip between the `.calendar-month-nav` header row and the `.calendar-weekday-row`:

```tsx
<div className="calendar-day-strip-wrap">
  <div className="calendar-day-strip" role="group" aria-label="Jump to day">
    {Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const isT = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      const sel = d === selectedDay;
      const weekday = new Date(year, month, d).getDay();
      return (
        <button
          key={d}
          type="button"
          onClick={() => setSelectedDay(d)}
          aria-label={`${MONTHS[month]} ${d}`}
          aria-pressed={sel}
          className={`calendar-strip-day${sel ? " is-selected" : ""}${isT ? " is-today" : ""}`}
        >
          <span className="wd">{DAYS[weekday].charAt(0)}</span>
          <span className="num">{d}</span>
        </button>
      );
    })}
  </div>
</div>
```

Also: when the selected day changes via the strip and the strip overflows, scroll the selected button into view horizontally on its own axis only: add `ref` via callback `onClick` then a small `useEffect` keyed on `selectedDay` calling `document.querySelector(".calendar-strip-day.is-selected")?.scrollIntoView({ block: "nearest", inline: "center" })` guarded so it only runs when `activeTab === "calendar"` and inside a cleanup-safe effect; skip entirely under reduced motion (`matchMedia("(prefers-reduced-motion: reduce)")` → `behavior: "auto"`).

Note the strip does NOT change month navigation — selection stays within the current month, matching the grid's own behavior.

- [ ] **Step 3: Run tests** — `npx vitest run tests/unit/calendar-glass-refresh.test.tsx` green; then full suite `npx vitest run tests/unit/` (expect all green except the user's known weather WIP failure).

- [ ] **Step 4: Lint + typecheck** — `npm run typecheck` && `npm run lint` → no new errors on the touched files.

---

### Task 3: Verify + record

**Files:** none to modify besides a docs record.
- [ ] Playwright probe at 390x844 and 1280x800, dark + light + `data-contrast="boost"`: (a) month title settles on month switch, grid header row height unchanged (measured via boundingBox before/after); (b) strip selection pill matches grid selection on tap both ways; (c) Today circle intact; (d) event dots keep per-calendar colors (probe with existing Google events if available; otherwise assert the `colorHex`→dot path is unchanged); (e) no horizontal page overflow at 390px beyond the strip container (strip itself scrolls internally — `scrollWidth > clientWidth` on `.calendar-day-strip-wrap`, `scrollWidth === clientWidth` on `document.documentElement`); (f) reduced-motion → no settle animation on title. Script in `/tmp/sdd/probes/calendar-glass.mjs`.
- [ ] Contrast measured from computed styles: strip selected day label ≥4.5:1 in dark and light.
- [ ] Detector: `node /Users/garciafam/Documents/Dashboard/.agents/skills/impeccable/scripts/detect.mjs src/app/calendar/page.tsx src/app/globals.css` — no new findings beyond the documented `--ease-spring` exemptions.
- [ ] AGENTS.md: add ONE UI Change Record dated 2026-09-04 following the mandated delta format (Added/Changed files, Visual/Motion, Color sources, User-facing description in the warm family voice). Update DESIGN.md's "Dashboard world" note only if the phrase "day strip" isn't already there.
- [ ] Report the final suite numbers + build result (`npm run build`) in the report file `/tmp/sdd/reports/calendar-glass-report.md`.
