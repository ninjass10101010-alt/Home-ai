# UI / UX Audit — September 2026

**Audit date:** 2026-09-26 · **Branch:** `warm-glass-v2` · **Phase 1 fixes landed same day**
**Supersedes:** `docs/UI_CONSISTENCY_AUDIT.md` (2026-07-20), which audited against the
pre-`warm-glass-v2` shadcn recipe (`<Card>`, `bg-primary`) and is kept for history only.
**Status:** ✅ **Phase 1 shipped** (legibility + contrast + tap targets) · ✅ **Phase 2 shipped**
(honest states) · ✅ **Phase 3 shipped** (navigation & IA — one route manifest, one icon set, one
active rule, no orphaned route) · ⏳ Phases 4–5 open.

Method: (1) static scan of 240 `.tsx` files / 46.9k lines, 29 routes, `globals.css`
(2,852 lines / 296 selectors / 95 keyframes) + `modes.css`; (2) a live Playwright/Chromium
pass at **390×844** and **1440×900** measuring *rendered* font sizes, *measured* hit-target
rectangles, viewport utilisation, running animations and console errors, plus WCAG contrast
math run against the token values in `src/app/globals.css`.

Limitation: the live pass ran signed-out in **family/guest** mode (no PINs used), so
`adult`, `kid` and `wall` layouts were reviewed in code only.

---

## Scorecard

| Dimension | Grade | Evidence |
|---|---|---|
| Tokens / palette discipline | **A−** | 1,343 `var(--color-*)` uses vs 6 stray Tailwind palette classes |
| Colour contrast | **D → B (post-fix)** | `text-muted` was 2.72:1 (dark) / 3.20:1 (light); now AA in both themes |
| Typography & legibility | **D → C+ (post-fix)** | 354 `text-[10px]/[11px]` sites; 9px rendered text measured on `/calendar` |
| Touch targets | **D → C (post-fix)** | measured 33×17, 41×25, 60×28, 72×30, 40×48 controls |
| Visual consistency (radius / surface) | **C** | 12 distinct rendered radii incl. 11.2 / 12.8 / 13.6 / 14.4px; 569 hex + 523 `rgba(` literals in TSX |
| Navigation & IA | **C−** | 3 competing navs; 5 feature routes with zero inbound links |
| Responsive (tablet / wall) | **D** | Tasks, Meals, Chat, Calendar, KidHome contain **0** `md:`/`lg:` utilities |
| States (loading / empty / error) | **C** | `EmptyState` 22 files, `Skeleton` 17, `ErrorState` 5; no `app/error.tsx` or `app/loading.tsx` |
| Modal & focus management | **B+** | `Modal.tsx` is exemplary; but 24 ad-hoc `fixed inset-0` overlays vs 4 `role="dialog"` |
| Motion | **B** | 13 reduced-motion blocks; 42 concurrent animations measured on Home |
| Screen-reader basics | **B−** | 275 `aria-label`, 1 live region + 1 `h1` per page, 0 unlabelled inputs; glyph-only buttons unlabelled |

**Worth keeping (do not regress):** the token layer is real and widely used; `Modal.tsx`
has a correct focus trap / Escape / focus-restore implementation; the anti-FOUC
`data-theme` + `data-contrast` bootstrap; `EmptyState` / `Skeleton` exist and are used;
role-filtered settings (`settingsSectionsForRole`) and a role-aware dock
(`visibleNavItems` swaps House → Rewards for kids); the dock's `--capsule-scale` math.

---

## Phase 1 — shipped 2026-09-26 (legibility · contrast · tap targets)

1. **AA text ramp.** `--color-text-muted` `#4e5a72 → #8892aa` (dark, 2.72 → **6.06:1** on
   canvas, 5.04:1 on `surface-2`) and `#8a8a8a → #6f6f6f` (light, 3.20 → **4.65:1**);
   `--color-text-dim` `#363e50 → #828da6` (1.76 → 5.67:1) and `#ababab → #6f6f6f`
   (2.13 → 4.65:1). Dark mode therefore has **two** readable text levels — hierarchy below
   `text-secondary` must be carried by weight/size, never by colour. Mirrored in
   `src/styles/tokens.css`. Boost mode lifts muted/dim to `#c3cadd`.
2. **Sub-12px text retired (measured: 262 → 0 nodes).** All 354 `text-[10px]` / `text-[11px]`
   sites → `text-xs` (0.75rem, rem-based so it scales with root font size), plus the CSS ramp
   that the class sweep could not reach: `.calendar-strip-day .wd` 11 → `.75rem`;
   `.calendar-today-btn` `.62 → .8rem`;
   `.calendar-sync-btn` `.65 → .8rem`; `.calendar-add-link` `.72 → .8rem`;
   `.calendar-day-number` `.72 → .82rem`; `.calendar-weekday` `.58 → .75rem`;
   `.calendar-hero-kicker` `.68 → .76rem`; `.calendar-panel-subtitle` `.64 → .76rem`;
   `.calendar-upcoming-day-label` `.55 → .75rem`; `.calendar-upcoming-empty` `.6 → .76rem`;
   `.calendar-empty-subtitle` `.7 → .78rem`; `.member-tile-name` `.7 → .78rem`;
   `.calendar-member-chip / .member-chip` `.7 → .78rem` (padding `.42/.72 → .5/.8rem`);
   `AtmosphericBridge` drift particles `8+i*2 px → 12+i*2 px` so even decorative emoji clear
   the floor and the CI sweep can assert “zero sub-12px”.

3. **Dock labels no longer shrink to ~10px.** `--capsule-scale` renders ≈0.73 on a 390px
   phone, which had been shrinking the active pill label; the label now cancels the scale
   (`font-size: clamp(0.9rem, calc(0.85rem / var(--capsule-scale)), 1.35rem)`, CapsuleNav) so
   it paints ≈14px at every width. Wall mode keeps its fixed `text-base`.
4. **`.hit-44` now guarantees 44×44** instead of assuming the control was ≥36px: the pseudo
   box is `max(100%, 44px)` centred on the element, so a 17px-tall link also qualifies.
5. **Measured small controls enlarged:** `.calendar-month-nav .calendar-icon-btn` 36 → 44px;
   `.calendar-today-btn`, `.calendar-sync-btn`, `.calendar-add-link` ≥44px tall (Add keeps
   its text look, gains height + hover fill); Meals `All` / meal-type / `Archive` chips and
   the dashed add tile ≥44px; week `‹ ›` 32 → 44px **and labelled** `Previous/Next week`
   (they had no accessible name); chat Send/Stop 40 → 44px; Home `Sign in` pill ≥44px;
   member sign-in chips gained `min-h-11 min-w-11` (they drive the width). Where the visual
   pill must stay compact, the **hit region** was fixed instead of the paint: `hit-44` now sits
   on `Chip` (so status chips like “Doors & windows closed” qualify), `ThemeToggle`,
   `KitchenFlowCard` collapse, the chat “new conversation” and “Speaking as …” controls, and
   the Home `Quick ask` link; `a.widget-accent-text` (widget footer “See all →” links, previously
   15–17px tall) carries a 44px line box. WCAG 2.2 Target Size measures the hit region, so a
   36px ghost button with `hit-44` passes.
6. **Dead file found:** `src/styles/tokens.css` duplicates the token layer but **nothing
   imports it** — it was updated to stay honest and is a delete candidate in Phase 5.

#### Contract delta this phase deliberately created (approved 2026-09-26)

The repo carried an **11px type floor** since 2026-09-02 (restated in `docs/DESIGN.md` change
records, the 2026-09-04 calendar/tasks plan specs, and locked by `compact-type-floor.test.tsx`
+ Warm Glass contract B, which grandfathered a few `text-[10px]` compacts). The measured sweep
showed that floor was the *cause* of the P0: 238 nodes were rendering at exactly 11px and the
grandfathered ones at 10px. The floor is therefore raised to **12px rem (`text-xs`)** and the
grandfathering is retired:

| Guard | Old contract | New contract |
|---|---|---|
| Warm Glass contract B (`warm-glass-contracts.test.tsx`) | bans `text-[8px]`/`text-[9px]`, allows 10/11px | bans **any** `text-[Npx]` with N < 12 in `src/**/*.tsx` |
| `compact-type-floor.test.tsx` | asserts StatTile detail + DayStrip labels are `text-[11px]` | asserts they are `text-xs` and carry **no** arbitrary px size |
| `settings-safety-section.test.tsx` | “Primary” badge is `text-[11px]` | badge is `text-xs` |
| `AGENTS.md` | floor only implied | new **“UI Contracts (hard rules)”** section: 12px floor, ≥44px targets via size or `.hit-44`, AA text contrast, banned primitives |

Historical change records in `docs/DESIGN.md` are left as written — they are history, and
`AGENTS.md` now says so explicitly so a future agent does not "restore" 11px from them.
Remaining `text-[Npx]` sites in `src` are all ≥13px (weather/display numerals up to 96px) and
therefore legal.

**Verification (re-measured headless, 390×844 + 1440×900, 10 routes × 2 viewports):**

| Metric | Before | After |
|---|---|---|
| Visible text nodes rendering under 12px | **262** | **0** |
| Smallest rendered text | 8px (particles), 9px (calendar) | 12px |
| Interactive rects under 44×44 *with no enlarged hit region* | **77** | **0** |
| …(18 small visual rects remain, every one verified to carry a 44px `hit-44`/`::after` region via computed `::before` size) | | |
| Horizontal overflow | 0 | 0 |
| Inputs without an accessible name | 0 | 0 |
| `<img>` without `alt` | 0 | 0 |
| Routes with an `<h1>` | 10/10 | 10/10 |
| Console errors | 401 noise while signed out (Phase 2) | unchanged |

`npm run typecheck` passed · ESLint on every changed file: **0 errors** (1 pre-existing
`<img>` warning in `meals/recipes/[id]/page.tsx`) · `npm run build` passed (52 routes, only the
documented `middleware` deprecation and Turbopack-root warnings).


---

### Residual pass — same day (measured states were not the whole app)

The first pass declared “sub-12px text 262 → 0” from the headless sweep, but that number only
covered the states the sweep actually opened: 10 routes, signed-out family mode, no modal
sheets. Two guardrails therefore had blind spots, and a follow-up grep found real text under
the floor that neither the class test nor the sweep could see:

1. **Contract B only reads `*.tsx` class strings.** Raw CSS was unguarded, and 13 rules in
   `src/app/globals.css` sat below the floor (they were invisible to the codemod *and* to the
   test that was supposed to lock it in). All 13 raised to ≥ `.75rem`:
   `.calendar-panel-kicker` `.6`, `.calendar-event-time` `.68`, `.calendar-upcoming-event-title`
   `.6`, `.calendar-upcoming-more` `.55`, `.calendar-schedule-time` `.65`,
   `.calendar-schedule-day` `.58`, `.calendar-day-btn` `.72`, `.calendar-time-ampm-btn` `.65`,
   `.calendar-filter-pill` `.68`, `.calendar-category-count` `.62`, `.calendar-routine-time`
   `.68`, `.calendar-routine-day-pill` `.55` (day-pill box `.28 → 1.35rem` so the 12px label fits),
   `.settings-control-badge` `.68`. Note how the last one hid from a hand-written grep too: the
   audit's own scan pattern assumed `.68rem`, not `0.68rem`.
2. **Two controls inside the add-event sheet / filter bar were under 44px** and only appear in
   states the sweep never opened: `.calendar-time-ampm-btn` (AM/PM toggle) and
   `.calendar-filter-pill` now carry `min-height: 2.75rem`. `.calendar-routine-day-pill` is
   presentational — the routine card is the tap target — so it keeps its compact box.
3. **Four of the six stylesheets in `src` are dead.** `src/app/layout.tsx` loads exactly two —
   `./globals.css` and `@/modes/modes.css` — and `globals.css` imports nothing but
   `tailwindcss`. So `src/styles/animations.css` (1283 lines, all 66 of its `@keyframes`
   duplicated in globals; also malformed, it opens mid-rule), `materials.css` (507 lines, 21 of
   24 selectors duplicated), `tokens.css` (183 lines of mirrored tokens) and `components.css`
   (81 lines, every selector duplicated) — 2054 lines in total — are edit traps: changing them
   changes nothing on screen, and their copies have already drifted from the live rules. Each
   file now carries a `⚠️ DEAD FILE` header; deleting all four is Phase 5.
4. **`contract B2`** (same test file) closes the blind spot for good: it fails on any
   `font-size` below 12px in a *live* stylesheet, on any literal inline `fontSize` below 12px in
   `src/**`, and on anyone importing one of the four dead stylesheets. Deliberately out of
   scope, both decorative and `aria-hidden`: the dynamic particle sizes
   (`WeatherParticles` `fontSize: \`${p.size}px\``, 3–8px snowflakes) and SVG `fontSize="…"`
   attributes inside hand-drawn illustrations (`WeatherSeasonArt`, `MountainVisualization`),
   which scale with their viewBox and are not content. The sweep is still state-limited; the
   static guard is what makes “no sub-12px text” a repo-wide claim rather than a sampled one.

Also corrected while writing this up: the Phase-1 list above claimed `.calendar-day-btn`
`.72 → .8rem`, which never happened (only `.calendar-day-number` changed in that commit) — the
button is fixed here instead. And `docs/UI_CONSISTENCY_AUDIT.md` / `AGENTS.md` said
`Card`/`Button`/`Badge` were *deleted*: they are not, they are legacy leftovers still imported
by 8 files, `Modal` is the canonical sheet component, and only `Input` is gone.

## Findings (full list, with evidence)

### P0 — defects for this product's real context (shared family screen, used by kids)

**1. Micro-text everywhere.** `text-[11px]` ×222 + `text-[10px]` ×132 in source; heaviest in
`meals/PlanTab.tsx` (27), `ui/WeatherWidget.tsx` (25), `settings/AiModelsCard.tsx` (25),
`modes/adult/AdultHome.tsx` (24), `modes/kid/KidHome.tsx` (18). Rendered: Home 35 sub-12px
nodes (`Events Today`, `Tasks Pending`, `Days planned`, `NOW`, `5PM`), Calendar 54 nodes with
11 at **9px**, and nine `Empty` labels at 10px on `/meals`. Illegible at wall distance, hostile
to low-vision family members, and `px` arbitrary values defeat the rem-based Dynamic Type the
design system promises. → **Fixed in Phase 1.**

**2. `text-muted` / `text-dim` failed AA — at the smallest sizes.** 383 uses of
`text-text-muted` across 98 files, and **283 of those lines also carried 10–11px text**: the
compounding worst case (2.7:1 *at* 10px) sat on `"Events Today"`, `"Tasks Pending"`,
`"Days planned"`, calendar weekday labels and Meals `"Empty"`. The codebase had already been
patching this *locally* (`.widget-card` and `.kitchen-text` re-scope `--color-text-muted` to
`#8b99b5` / `#4e596b`, with a comment naming the old `2.5:1` failure) — those local overrides
are now redundant with the global token fix and can be retired in Phase 5. → **Fixed in Phase 1.**

**3. Hit targets far below 44×44** (measured DOM rectangles, 390×844): Calendar `+ Add`
**33×17**, `+ Add an event` **85×17**, `Today` 60×28, month `‹ ›` 36×36, `Sync` 72×30; Home
`Sign in` 86×30, member sign-in chips **40×48** wide; Meals filter chips 91–112×34, collapse
chevron 41×25, day arrows 32×32; Chat `Speaking as …` 110×26, `Send` 40×40. 21 failing
controls on Home alone; 82 small `h-N w-N` pairs in source; the design system claims a 44×44
minimum. → **Fixed for the measured controls in Phase 1** (systemic enforcement in Phase 5).

**4. Silent failure: “Empty” is indistinguishable from “broken”.** Every route logs repeated
`401 Unauthorized` while signed out, swallowed by empty catches (`AdultHome.tsx:145
.catch(() => {})`); `ErrorState` is imported in only 5 files; there is **no `app/error.tsx`
and no `app/loading.tsx`** anywhere (only `settings/not-found.tsx`). On a wall display a
network hiccup therefore reads as “nothing on today” — exactly the wrong feedback for a
calendar/chore product. → Phase 2.

### P1 — navigation, IA, layout

**5. Five features are unreachable.** Inbound-link scan across all TSX: `/analytics` **0**,
`/memory` **0**, `/money-mountain` **0**, `/skill-tree` **0**, `/time-capsule` **0**,
`/grocery` **1** (and that one only from the design-system demo page); `/screensaver` 0 —
plausibly fine as a typed wall URL, since `CacheRefresher` special-cases it. Real API,
migration and maintenance surface for screens nobody can navigate to; in an assistant-first
product “unreachable” also means Consuela never surfaces them. → Phase 3: surface or delete,
per route, no orphans left.

**6. Three navs, three icon systems, one dead reference.** `CapsuleNav` (global via
`PageShell`, 7 items, inline SVG, `pathname === item.href`, hard-coded lime
`rgba(120,240,90,…)`), `SidebarNav` (rendered **only inside `AdultHome`**, 6 items, emoji
icons, `startsWith` matching, honours `--color-accent-selected`; its header comment still
credits a deleted `BottomNav`), plus `lucide-react` in 25 files. Consequences: leaving Home
removes the desktop rail entirely while the phone dock stays; the two navs disagree about the
active item on `/settings/me`; the dock ignores the ten-accent Accent Studio the design system
advertises. → Phase 3: one route manifest (`path, label, iconKey, roles, modes, wall`) feeding
one dock + one rail, one icon set, shared `isActive()`, dock glow tokenised as
`--color-nav-active`.

**7. Desktop/tablet is a stretched phone.** `PageShell` is `max-w-lg md:max-w-3xl
lg:max-none`; at 1440×900 `/tasks` still renders one narrow 886px column, and `/calendar`,
`/meals`, `/chat`, `/ha`, `/settings` report identical layout metrics to the 390px run.
`KidHome`, `Meals`, `Calendar`, `Chat`, `Settings` contain **zero** `md:`/`lg:` utilities,
while Home already has real tier work (`WALL_GRID_CLASS`, `homeGridClass(orientation)`) — the
capability exists, it just stops at Home. `/chat` additionally bypassed `PageShell` entirely
(no `<main>`), so it missed the sync banner and `page-settle`. → Phase 4; **4.2 shipped** — chat
now renders through the shell, keeping its narrow thread column and its own dock clearance.

**8. Home depth and density.** 3,859px of content at 390px width (~9.9 screens) with **42**
concurrently running animations, 54 distinct background treatments and 13 `h3`s; adult mode
adds a second dense layout (`OverviewBar` + 2-col grid + 7 integration widgets), so both modes
are scroll-heavy and structurally different. → Phase 4: rank widgets to the first fold, one
`More…` sheet (already modeled by `MoreMenuItem`), cap ambient motion.

### P2 — consistency & maintainability

**9. Radius drift.** Tokens are `10 / 16 / 20 / 28 / 36 / 9999`; rendered radii include
`11.2, 12.8, 13.6, 14.4, 17.6, 24, 32px` (`rounded-2xl` ×335, `rounded-3xl` ×34,
`rounded-[2rem]`, `rounded-[1.25rem]`).
**10. Duplicated surface recipes.** 569 hex + 523 `rgba(` literals in TSX vs one `Surface` /
`--neu-raised` system → themes and Accent Studio cannot retune the app centrally.
**11. Modal adoption 1 : 24.** One excellent `Modal` vs 24 hand-rolled `fixed inset-0`
overlays; only 4 `role="dialog"` / `aria-modal` in the app → Escape, focus-return and
scroll-lock differ per sheet.
**12. Emoji as UI chrome.** The member sign-in rail exposes only `"🐱 👨 👧 …"` as accessible
text; meal tabs (🌅☀️🥨🌙), Settings section icons and the AdultHome stat strip (📅✅🍽️) are
emoji too — platform-dependent rendering, no tinting, no contrast control. Keep emoji for
*content* (food prefs, personalities), use SVG (`HomeWidgetIcon`, `Avatar`) for controls.
**13. Two motion systems.** `DESIGN_SYSTEM.md` says motion is CSS-only, yet `framer-motion`
and `three` are dependencies; there is no user-facing “reduce motion” toggle (OS-level only).
**14. Monolith screens.** `tasks/page.tsx` **2,943** lines / 33 `useState`,
`calendar/page.tsx` 1,358, `KidHome.tsx` 1,354, `WeatherWidget.tsx` 1,753 — the family's
daily driver is the hardest file to change safely.
**15. Two design-system pages.** `src/app/design-system/page.tsx` and
`src/app/_design-system/page.tsx` are near-duplicates (each with its own production gate),
while `DESIGN_SYSTEM.md` §7 claims `_design-system` *rewrites* to `/design-system` — there is
no such rewrite in `next.config.ts`. Two sources of truth means the standard drifts.
**16. `src/styles/tokens.css` is imported by nothing** yet duplicates the whole token layer
(now updated in lockstep, still a delete candidate).
**17. One 2,852-line global stylesheet** (296 selectors, 95 keyframes) → specificity
collisions (`warm-glass-*`, `widget-card`, `material-*`, `tap`, `capsule-*`) and invisible
dead CSS.
**18. Tests cannot protect the UI.** 4 e2e specs, 1 a11y-related assertion, no axe-core.
**19. Doc drift.** `DESIGN_SYSTEM.md` promised 44×44 targets, rem-based type, CSS-only motion,
Modal-for-every-sheet and the `/_design-system` rewrite; the first three are now true, the
rest need Phase 5.

---

## Remaining phases (each independently shippable behind its own commit)

**Phase 2 — honest states (P0-4) — shipped 2026-09-27** in three commits:
`009cda0` (vocabulary), `44ece37` (widgets), plus the closing pass below.
`lib/read-state.ts` is now the single vocabulary (`loading → ready → empty → offline →
unauthorised → error`) with `classifyReadError`, `readMessageFor` and `ReadStatePill`;
`hooks/useSafeFetch.ts` replaces swallow-everything `try/catch`; `app/error.tsx`,
`global-error.tsx`, `loading.tsx` and `not-found.tsx` exist, so a route can no longer render
blank. The closing pass covered the last silent surfaces found while landing it:
**Morning Briefing** (`useMorningBriefing` no longer swallows; the widget renders a failure
card with a Retry instead of returning `null`, and badges a saved copy when a refresh fails
after a good read), **Chat's `FamilyBrief`** (a failed meal or calendar read says so on the
card instead of "Nothing planned yet" / "Quiet rest of day", the compact strip stays visible,
and tapping a failed card re-reads rather than drafting a question built on nothing), and
**`SyncStatusBanner`**, whose dead-end "sign in with your PIN" instruction is now a link to
`/settings` where the PIN dialog actually lives.
Two classification lessons worth keeping: on a self-hosted wall display a dead backboard
surfaces as a `TypeError` whose useful marker (`ECONNREFUSED`, `UND_ERR_*`) is buried in
`error.cause` / `error.code`, so `classifyReadError` walks the cause chain instead of reading
`message` — otherwise an offline-looking browser blames the family's network for our outage;
and a *failed* read must never reuse the *stale* copy, so offline-with-nothing-cached says
"no saved copy on this device" rather than promising one. `npm test` exits 0 again (the
jsdom teardown escape was fixed in `05f1005`).

**Phase 3 — navigation & IA (P1-5, P1-6) — shipped 2026-09-28.** `lib/nav-items.ts` is the single
manifest (`path, label, iconKey, roles, group, wall`) feeding the dock, the rail *and* the new Home
`More…` sheet; `NavIcon` is the one SVG icon set (the dock's inline SVGs and the rail's emoji are
gone); `isPathActive` is the one active-item rule, so `/settings/me` now lights Settings in both
navs; the dock glow is `--color-nav-active*` (the accent system drives it — the active pill is
accent-coloured instead of hard-coded lime, documented in `globals.css` with the one-line revert);
the six orphaned routes were **surfaced, not deleted** — every Home mode mounts the More… sheet,
role-filtered so the wall shows only `/grocery`, `/skill-tree`, `/time-capsule` and `/analytics`
(never the parent-only `/memory` or the finance pages). `tests/unit/nav-items.test.ts` now fails on
any shipped route that is neither in the manifest nor in `EXEMPT_ROUTES` with a reason, so the
"unreachable route" class of bug cannot come back. Shipped in Phase 4 (4.1): the rail now lives in
`PageShell` (`SidebarNav` moved to `src/components/ui/`), so it follows the parent to every route;
Home's widget ranking/`More…` folding is still Phase 4.5.

**Phase 4 — responsive tiers (P1-7, P1-8).**
- ✅ **4.1 — rail on every route:** `SidebarNav` moved to `src/components/ui/`; `PageShell` mounts it
  for parent sessions at `md+`, `md:pl-60` reserves exactly its `w-60`, `data-page-rail` marks the
  wrapper, `AdultHome`'s local mounts removed. Contract: `tests/unit/page-shell-tiers.test.tsx`.
- ✅ **4.2 — `/chat` through `PageShell`:** chat gains `<main>`, the sync banner (its signed-out copy
  passed as `bannerMessage`), the rail and the shared dock, while keeping its `max-w-lg` thread
  (`contentClassName`), its composer's own dock clearance (`bottomInset={false}`) and the document
  scrollport for its sticky top bar/composer (`clip={false}` — the shell's `overflow-hidden` would
  otherwise become their scrollport and freeze sticky).
- ✅ **4.3 — tablet two-column + rail for Tasks / Meals / Calendar / Settings** (rail shipped with
  4.1): every split now uses Home's grid idiom (`grid-cols-1 md:grid-cols-2 gap-6`, `col-span-*`,
  `order-*` at `md:`) instead of one-off breakpoints — Tasks drops its private `lg:max-w-3xl` and
  splits stats/switch left | task board or leaderboard right (`md:col-span-2` stats); Calendar
  pairs month grid | selected-day agenda (`md:col-start-2 md:row-start-1`, week card
  `md:col-span-2`); the meals tabs replace `lg:grid-cols-[1fr_320px]`, `xl:grid-cols-[1fr_280px]`
  and `xl:order-*`/`hidden xl:*` hooks with the md tier; RecipeBox drops `xl:grid-cols-3`; the
  Settings launcher already tiers (`grid-cols-1 sm:grid-cols-2`). Contract:
  `tests/unit/tablet-two-column.test.ts` (5).
- ✅ **4.4 — wall composition per screen** (12ft legibility: ≥16px body, 44px targets, no
  hover-only affordances): Home already swaps its grid to `WALL_GRID_CLASS` when the wall profile
  resolves (contract-pinned) and the data screens inherit the md two-column composition from 4.3;
  `globals.css` now floors body copy (`text-sm`) at **16px** and every smaller utility at 14px
  under `html[data-wall]`, floors **every interactive control at 44×44** (settings keeps its
  stricter 64px — that selector is more specific), and withdraws the one hover-only *action*
  popup — RecipeBox's `hidden group-hover:grid` day-picker — because the wall is touch-only (its
  primary "＋ Add" button remains the working path). Decorative `pointer-events-none` hover glows
  stay hover-lit: they are not affordances. Contract: `tests/unit/wall-composition.test.ts` (4).
- ✅ **4.5 — Home ranking + `More…` folding + ambient-motion budget** (finding 8, shipped — Phase 4
  complete): the phone default order now leads with a ranked first fold —
  `FIRST_FOLD_WIDGETS = [morningBriefing, todayEvents, weather, tasks]` — and stacked layouts
  (phone / tablet portrait, never the wall or desktop) render only `PHONE_WIDGET_FOLD = 4`
  widgets; the rest fold behind Home's existing `More…` sheet via a "Show all widgets" action row
  (`MoreMenuItem` gained an `onSelect` button variant; expanding is session-only). Ambient motion
  runs through `AnimationBudgetProvider` (6 slots on `useAnimationBudget`) — the DayLine now-glow
  and the leaderboard row glows claim a slot for their mount lifetime and render static when the
  budget is spent; outside Home the hook returns true (no behavior change). Contracts:
  `tests/unit/home-first-fold.test.ts` (5), `tests/unit/animation-budget.test.tsx` (3), plus an
  action-row test in `more-sheet.test.tsx`.

**Phase 5 — design-system convergence (P2, findings 9–19).**
- ✅ **5.1 — the four orphaned stylesheets are deleted.** `src/styles/{animations,tokens,materials,components}.css`
  (2,064 lines, every rule duplicated or superseded in `globals.css`, all flagged `⚠️ DEAD FILE` and
  imported by nothing) are gone, and contract B2 now asserts they stay **deleted**, not merely
  unimported (`tests/unit/warm-glass-contracts.test.tsx`).
- ✅ **5.2 — legacy `Card` / `Button` / `Badge` converged, text-token re-scopes retired.** All 13
  importing files (34+ call sites) now render `Surface` / `SoftButton` / `Chip`; `Card`/`Button`
  were already re-export shims, while `Badge` (a real 10-variant component) converged onto `Chip`,
  which grew a static `as="span"` label variant plus `violet`/`cyan` tones — a passive member/type
  label must not be a button with a `hit-44` tap area. The three legacy components are deleted. The
  local `--color-text-secondary` / `--color-text-muted` re-scopes Phase 1 made redundant are gone
  (`.widget-card` dark + light, and the whole `.kitchen-text` block — its class also left the eight
  markup sites, including the three hand-rolled recipe overlays 5.4 will port). Contract:
  `tests/unit/design-system-convergence.test.tsx` (4).
- ⬜ **5.3 — radius + surface tokens.** `rounded-2xl` → `--radius-lg` etc. via `@theme` aliases, ban raw
  `rounded-[…]`, replace `bg-white/[0.03]` / hex clusters (569 hex + 523 `rgba(` literals) with
  `Surface` / `--neu-*`.
- ⬜ **5.4 — modal adoption (1:24).** Port the hand-rolled `fixed inset-0` overlays onto `Modal` /
  `BottomSheet`, adding `role="dialog"` where a sheet must stay custom.
- ⬜ **5.5 — user-facing Reduce-motion toggle** alongside `data-contrast` (OS-level preference is not
  enough for a shared wall).
- ⬜ **5.6 — one design-system page.** The `/_design-system` → `/design-system` rewrite does exist — in
  `src/middleware.ts`, not `next.config.ts`; the two pages are near-duplicates with two production
  gates: keep one and grow it into a live audit (axe-core, min-tap-target, sub-12px sweep,
  inset-shadow ban).
- ⬜ **5.7 — split `tasks/page.tsx`** (2,943 lines, 33 `useState`) by section — the family's daily
  driver is the hardest file in the repo to change safely.
- ⬜ **5.8 — emoji-as-chrome sweep** for the leftovers finding 12 lists: Settings section icons, meal
  tabs, the AdultHome stat strip, the rail's Emergency glyph kept by Phase 3.

**Guardrails to make this stick:** an ESLint rule (or CI grep) rejecting `text-[9|10|11]px`
and unlabelled `h-8/h-9/h-10 w-8/w-9/w-10` without `hit-44`; the Playwright probe as a CI job
asserting *zero* sub-12px nodes, *zero* hit targets <44px and *zero* new `aria-label`-less
controls per release; axe-core wired into `e2e/console-errors.spec.ts`; a PR checklist item
for `DESIGN_SYSTEM.md` + `CHANGELOG.md` + `docs/UI_AUDIT_2026-09.md`.

---

## Appendix — reproduction

```bash
# scratch dir for the sweep (not repo tooling)
mkdir -p /tmp/ui-audit
# audit.cjs  — measures the 10 routes at 390x844 + 1440x900, writes report.json + screenshots
# after.cjs  — same sweep against the fixed build, writes report-after.json
# compare.cjs— prints the before/after table above from report-before.json + report-after.json
# tiny-detail.cjs / ctrl-detail.cjs — per-route "every sub-12px node" / "every sub-44px rect
#                                      with its computed ::before hit box" listings
cd ~/Documents/Dashboard/Home-ai && node /tmp/ui-audit/after.cjs && node /tmp/ui-audit/compare.cjs
```


The probe launches the Playwright-pinned Chromium by executable path (this machine's global
`playwright` browser cache needs `chmod -R a+rX` after install), walks
`/ · /calendar · /tasks · /meals · /chat · /settings · /ha` at 390×844 and 1440×900 signed-out,
and reports rendered font sizes, computed hit targets, viewport utilisation, running
animations, background variants, headings, console errors and token contrast math.
It is a scratch artifact, not repo tooling — Phase 5 promotes it into CI.



