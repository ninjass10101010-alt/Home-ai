# Consuela Dashboard — Agent Operational Manual

> **For the AI Coding Agent (Kilo) only.**  
> This is your single source of truth when a user asks how to **use**, **configure**, **troubleshoot**, or **extend** the live Consuela family dashboard.  
> Always start here before answering operational questions. Cross-reference the linked deep docs.  
> **Mandatory:** After any code change that touches UI, navigation, meals, emergency, or integrations, update this file in the same session.

**Current Dashboard Snapshot** (maintain on every relevant change)  
- **Last Updated:** 2026-06-18 | **PocketBase migration complete.** All 8 phases of the localStorage→PB migration have been implemented. PB is now the primary data source. localStorage is retained as per-device cache/fallback. A global `CacheRefresher` component polls PB every 60s and on visibility change for cross-device sync. **18 PB collections** auto-created with idempotent field-aware seeding (`seedCollections` patches missing fields on existing collections). Key changes per phase: (2) member writes now re-fetch from PB, (3) `CacheRefresher` for events/schedules/emergency, (4) grocery/pantry init flipped to PB-first, (5) meals/recipes wired to PB writes, (6) tasks/weekData/rewards/penalties/goals/HOF sync to structured PB collections every 5s, (7) auth sessions persist to PB for cross-device login restore, (8) emergency contacts refresh from PB. | **Google Calendar integration** remains live & verified. Google Tasks + Reminders still paused (Device Flow allowed-scopes excludes tasks API). **20/20 unit tests pass** (12 encryption + 8 device-flow). `tsc --noEmit` clean, `npm run lint` clean, `npm run build` clean.
- **Last major UI refresh:** 2026-06-15 — Tasks & Leaderboard v2: week-scoped points system with automatic Monday resets, real consecutive-day streak tracking, full transaction history log, undo completion with PIN verification, recurring task auto-regeneration, parental approval gate for large rewards (>100pts), confetti animation on task completion, level-based progression with progress bars, achievement badges, animated champion crown, and Home page task sync from shared localStorage.
- **Active integrations:** Meals ↔ Pantry ↔ Grocery bidirectional sync (`mealSyncService`), Emergency SMS + Email (free Gmail + carrier gateways), AI Chat ("Ask Consuela"), **Google Calendar** (real API, Device Flow, encrypted tokens in PB, 5-min polling) + **Google Tasks + Reminders** wired but paused (Google's Device Flow allowed-scopes list doesn't include the Tasks API), full theme system (3 modes + **10 accent colors** + high-contrast)
- **IMPORTANT BUILD NOTE:** After every `npm run build`, the CSS chunks can go out of sync (Next.js 16.2.6 bug). If the dashboard loads with broken layout (big icons, wrong nav styles), **restart the container**: `docker restart consuela-dashboard`. This is faster than a rebuild.
- **IMPORTANT BUILD NOTE:** After every `npm run build`, the CSS chunks can go out of sync (Next.js 16.2.6 Turbopack bug). If the dashboard loads with broken layout (big icons, wrong nav styles), **restart the container**: `docker restart consuela-dashboard`. This is faster than a rebuild.
- **Navigation model:** Persistent bottom tab bar (Home, Ask Consuela, Calendar, Meals, Tasks) + More menu for Grocery, Emergency, Settings, plus always-visible floating red Emergency shield button on Home
- **Tech surface for ops:** Next.js 16 + React 19 + Tailwind CSS 4, PocketBase-backed database (`pb-db.ts` + `db/index.ts`), API routes under `src/app/api/`, custom SVG animations (no framer-motion)
- **PocketBase migration:** **Complete (2026-06-18).** All 8 phases of the localStorage→PB migration have been implemented. PB is now the primary data source for members, events, schedules, grocery, pantry, meals, recipes, tasks, rewards, penalties, week data, family goals, hall of fame, emergency contacts, and auth sessions. localStorage is retained as a per-device cache/fallback. A global `CacheRefresher` component (in `layout.tsx`) polls PB every 60s and on visibility change to keep cross-device state in sync. The PB seed defines 18 collections total (6 original + 12 new).

---

## 1. User Interface (UI) Navigation

### 1.1 Current Layout & Navigation Model

The dashboard is a mobile-first, glass-morphism, bottom-nav app with a persistent floating action for emergencies.

**Bottom Tab Bar (always present, `BottomNav.tsx`):**

| Label          | Route          | Icon (active = heavier stroke / filled)          | Primary Notes |
|----------------|----------------|--------------------------------------------------|---------------|
| Home           | `/`            | House                                            | Dashboard with weather, today's events, quick AI ask, weekly meals preview, tasks |
| Ask Consuela   | `/chat`        | Speech bubble with 3 dots (primary, filled when active) | Main conversational interface |
| Calendar       | `/calendar`    | Calendar grid                                    | Events + schedule |
| Meals          | `/meals`       | Pot / plate                                      | Weekly recipe-style meal planner + pantry sync + grocery generator |
| Tasks          | `/tasks`       | Checklist                                        | Chore list with points |
| Grocery        | `/grocery`     | Shopping cart                                    | Smart list with manual overrides and sync status |
| Emergency      | `/emergency`   | Shield                                           | **Non-critical** quick reference page (minor issues + contact list). Serious alerts use the floating button |
| Settings       | `/settings`    | Gear                                             | Theme (dark/light/system + 6 accents + high-contrast), family members, emergency contacts config |

**Floating Emergency Button (always on Home, `EmergencyButton.tsx`):**
- Fixed position: `top-4 right-4`, `z-50`
- Red rose-500 circle with white shield + exclamation SVG
- Taps → modal with 4 serious types: 🔥 Fire, 💧 Water Leak, 🤕 Injury, 🚨 General
- On selection → POST `/api/emergency` → dual notification (SMS via carrier email-to-SMS + HTML email via Gmail App Password)
- Success state: green check + "Alert Sent" + auto-close after 3s + count of successful deliveries
- Failure: red X + "Try Again" + advice to call 911 directly

**Recent Visual Language (as of adbe770):**
- Glass / translucent surfaces with 20px blur
- Isometric cards with perspective hover lift (`isometric-card` class)
- Gradient orbs as decorative background elements (pulse + melt animations)
- Safe-area insets respected for iOS notch / home indicator

**How to document future UI updates (mandatory for the agent):**
Use this exact delta format in the "What's New" area and update 1.5 journeys:

```markdown
### UI Change Record — 2026-06-12 — Liquid Glass cards for Today / Daily Schedule / Tasks
- Added / Changed: `src/app/page.tsx` (Today + Tasks items), `src/components/ui/ScheduleDisplay.tsx` (Schedule items + empty state)
- Visual / Motion: New `.liquid-glass` class in `src/app/globals.css`. Each row is now a 3D "bubble": color-tinted linear-gradient frosting (rgba 0.32 → 0.16 across 135°), 20px backdrop blur, 1.25rem squircle radius, bright `inset 0 1px 0` top highlight + soft `inset 0 -1px 0` bottom edge, 0/8/24 drop shadow that deepens to 0/14/32 on hover with a 3px lift. Light-mode variant swaps the inner highlight to a brighter 0.85 white edge and softens the drop shadow. Accent bar shrunk from w-1 to w-0.5 and given an 8px currentColor glow. Member / points pills moved from solid `surface-3` to `glass-subtle`. Reduced-motion disables the lift.
- Color frosting sources: Today events use the event color (mint/violet/amber/cyan/rose/nori). Tasks use priority (rose > 15pts, amber > 10pts, mint default). Daily Schedule uses the schedule item color.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "On the Home screen the Today events, Daily Schedule, and Tasks cards now feel like little 3D bubbles — each row has a frosted glass surface with a light frosting of its existing color, a bright top highlight, and a soft drop shadow that lifts the card off the background. Hover to see them gently rise."
- Added / Changed: <component or page>
- Visual / Motion: <describe exactly what user sees, file paths, CSS classes>
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "On the Home screen the chat bubble now gently floats up and down..."
```

### UI Change Record — 2026-06-14 — Warm Glass v2 design system rollout
- Added / Changed: `src/lib/theme-config.ts`, `src/hooks/useTheme.tsx`, `src/lib/design-tokens.ts`, `src/app/globals.css`, `src/components/ui/*`, `src/components/patterns/*`, `src/app/_design-system/page.tsx`, `src/app/page.tsx`, `src/app/tasks/page.tsx`, `src/app/meals/page.tsx`, `src/app/settings/page.tsx`, `src/app/more/page.tsx`, `src/components/ui/BottomNav.tsx`, `docs/DESIGN_SYSTEM.md`
- Visual / Motion: Warm Glass v2 adds a warm canvas, glass cards, neumorphic raised/pressed/flat surfaces, tactile soft buttons, icon buttons, toggles, segmented controls, chips, list rows, swipe rows, text fields, steppers, empty/error states, progress rings, bottom-sheet modals, skeletons, pull-to-refresh wrappers, and toasts. Shared patterns add page headers, section cards, stat tiles, day strips, form fields, and More menu rows. Motion stays CSS-only via keyframes and Tailwind transitions; reduced-motion remains respected.
- Color sources: Ten accent colors now include `apricot` and `sage`. Warm Glass surfaces use `--color-canvas`, `--glass-tint-*`, `--border-frost-*`, `--neu-*`, `--warm-shadow-*`, `--warm-elevation-*`, and `--warm-duration-*` variables.
- Navigation: Bottom nav now uses five primary tabs (Home, Ask Consuela, Calendar, Meals, Tasks) plus a More menu for Grocery, Emergency, and Settings. The Home emergency shield remains fixed at `top-4 right-4`.
- Agent action required: Update this section + Common Journeys + affected SOPs. For visual QA, open `/_design-system` in development to review primitives and patterns in dark and light themes.
- User-facing description (copy-paste ready for responses):
  > "The dashboard now uses a warmer glass-and-neumorphism design system. Cards feel softer and more tactile, controls are easier to tap, the bottom nav is simplified to five primary tabs plus More, and the theme palette now includes apricot and sage accents."

### UI Change Record — 2026-06-15 — Schedule form + Home widget now use 12-hour AM/PM time
- Added / Changed: `src/app/calendar/page.tsx` (schedule form), `src/app/globals.css` (time picker styles), `src/components/ui/ScheduleDisplay.tsx` (home widget formatter)
- Visual / Motion: The "Add Schedule Item" / "Edit Schedule Item" form on the Calendar page no longer takes a free-text "Time (HH:MM)" military-time input. The Time field is now a 3-part picker: a numeric Hour (1–12), a numeric Minute (00–59), and a vertical AM/PM toggle pair. The active AM/PM button is filled with `--color-accent-button` and gets a soft accent glow that matches the rest of the calendar's accent system. The Home page "Daily Schedule" widget (and every other consumer of `ScheduleDisplay`) now runs every schedule time through a `displayTime12h` helper, so both freshly created 12-hour items and any pre-existing 24-hour data ("08:00") are rendered consistently as "8:00 AM". The time cell on the widget grew from `w-12` to `w-16` to fit "12:00 PM" cleanly.
- Persistence: New schedule items are stored in 12-hour format ("8:00 AM"). The Calendar schedule form's default empty value changed from `"08:00"` to `"8:00 AM"`. `parseTimeToMinutes` (in both `src/app/calendar/page.tsx` and `src/components/ui/ScheduleDisplay.tsx`) was extended to support both "H:MM AM/PM" and "HH:MM" so sort, category bucketing, and past-item filtering keep working regardless of which format the stored value is in. Existing 24-hour entries will display as 12-hour without any migration step.
- Color sources: AM/PM active state uses `--color-accent-button` and the calendar's `--calendar-accent-rgb` for the glow, so the picker picks up whatever accent the user has chosen in Settings → Accent Studio.
- Agent action required: Update this section + Common Journeys if describing schedule entry.
- User-facing description (copy-paste ready for responses):
  > "When you add a routine on the Calendar → Schedule tab, the time field is now a friendly 12-hour picker: a numeric hour (1–12), a minute input, and a vertical AM/PM toggle. The Home screen's Daily Schedule widget shows the time the same way (e.g. 8:00 AM or 7:30 PM) so it always matches what you typed."

### UI Change Record — 2026-06-15 — AtmosphericBridge follows the weather widget
- Added / Changed: `src/app/page.tsx`
- Visual / Motion: The 18px gradient + drifting-particles strip (`<AtmosphericBridge />`) used to be rendered exactly once at the top of the widget stack (`{widgets.length > 0 && <AtmosphericBridge />}` above the `widgets.map(...)`). Because the weather widget became freely reorderable on 2026-06-15, the bridge animation stayed pinned to the top of the stack while the weather card slid down — visually disconnecting the spillover from the widget it was supposed to bleed out of. Fix: the bridge is now rendered inside the `case "weather"` switch case, directly below `<WeatherWidget />` inside the same wrapper `<div className="relative z-10">`. The strip's `marginTop: -2px / marginBottom: -4px` overlap still flows the gradient and the seasonal particles (cherry blossoms in spring, leaves in autumn, fireflies in summer, snowflakes in winter — driven by `theme.particleEmoji`) into whatever widget sits immediately below the weather widget in user order. Move weather to position 3 → the bridge follows to position 3.
- The fullscreen `FogBackground` (Vanta 3D fog at `position: fixed; inset: 0`) is intentionally untouched — it is page-wide ambient atmosphere, not a per-widget effect.
- Color sources: Unchanged — bridge still reads `theme.bridgeGradient`, `theme.bridgeGlow`, `theme.atmosphereOpacity`, and `theme.particleEmoji` from the page-level `AtmosphericProvider`.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log if describing weather widget reordering or atmospheric effects.
- User-facing description (copy-paste ready for responses):
  > "The weather widget's background animation (the soft gradient wash with drifting petals / leaves / snowflakes / fireflies that spills out of the bottom) now follows the widget when you move it in Settings → Layout & display. Before, the animation was stuck at the top of the page even if you moved Weather to the bottom; now it stays attached to the weather card wherever you place it."

### UI Change Record — 2026-06-15 — Pantry tab restyled to match grocery list design language
- Added / Changed: `src/components/meals/PantryTab.tsx` (section filter, preset staples, preset items, add form, pantry grid, imports)
- Visual / Motion: The Pantry tab had several sections that were visually inconsistent with the grocery tab and cramped on desktop:
  - **Section filter** (All / Plenty / Running Low / Out) was a `flex gap-3 overflow-x-auto` horizontal scroll of 4 rounded-pill buttons (`px-3.5 py-1.5 text-xs font-bold`). Now a `grid grid-cols-2 gap-2.5` of glass cards matching the grocery category filter: emoji in a colored circle (`h-8 w-8 rounded-xl`; accent-selected fill when active, surface-2 when inactive), label + count subtitle (e.g. "4 stocked", "1 out"), accent-selected border + glow on active, glass surface + hover on inactive. 2×2 grid so all 4 sections are visible at once.
  - **Preset staples** (Baking / Grains & Pasta / Canned Goods / Condiments / Spices) was a `flex gap-1.5 overflow-x-auto` horizontal scroll of tiny pills (`text-[10px]`). Now a `grid grid-cols-2 gap-2.5` of glass cards matching the grocery Quick Add category grid: emoji (`text-xl`), group name (`text-sm font-semibold`), item count badge, accent-button fill on active.
  - **Preset items** was a `flex gap-2 flex-wrap` of small chips (`size="sm"`, `h-7`). Now a `grid grid-cols-2 gap-2` of glass cards matching the grocery Quick Add preset grid: emoji (`text-lg`), name (`text-sm font-medium`), "+" add button (opacity-40→100 on hover), checkmark for already-added items. `PRESETS_PER_PAGE` dropped 10→6.
  - **Add to Pantry** form was raw `<input>`, `<select>`, `<button>` in a plain `<div className="glass">`. Now uses `SectionCard` (icon="➕", title="Add to Pantry", description="Track what you have on hand") with `TextField` and `SoftButton` matching the grocery Add Item card.
  - **Pantry item grid** was `grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`, cramming cards into 4 columns on desktop. Capped at `grid gap-3 sm:grid-cols-2` so cards are always readable with comfortable width at any viewport.
- Layout: Pantry tab now shares the same 2-col glass card + accent-selected visual language as the grocery tab's category filters and Quick Add grids, creating a consistent design language across the Kitchen tabs.
- Color sources: Unchanged — uses `--color-accent-button`, `--color-accent-selected`, `--color-accent-mint`/`amber`/`rose` for status, and `--color-surface-*` tokens. Matches the grocery tab exactly.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "The Pantry tab now matches the Grocery tab's design language. The section filter (All / Plenty / Running Low / Out) is a 2×2 grid of glass cards with emoji, name, and count subtitle instead of a cramped horizontal scroll. The preset staples (Baking, Grains, etc.) are now proper 2-column glass cards with emoji, name, and item count badge. Preset items are 2-column tappable cards with emoji, name, and '+' add. The 'Add to Pantry' form uses the same SectionCard + TextField + SoftButton treatment as the Grocery 'Add Item'. Pantry items cap at 2 columns so they don't cram on desktop."

### UI Change Record — 2026-06-15 — Grocery category filter restyled to match grocery list SectionCard headers
- Added / Changed: `src/components/meals/GroceryTab.tsx` (category filter row between Add Item card and grocery list)
- Visual / Motion: The grocery category filter row (All / Produce / Dairy / Meat / Pantry / Frozen / Snacks / Beverages / Household) was a `grid grid-cols-3 gap-2` of small flat buttons with inline emoji text + tiny count badge (`text-[10px] rounded-full`). It felt visually disconnected from the grocery list SectionCards below, which use emoji-in-circle icon headers (`h-10 w-10 rounded-2xl bg-[var(--color-accent-selected)]/15`), bold titles, and "N/M picked up" count text.
  - **Redesigned** the filter cards to match the grocery list style: each card now uses the same emoji-in-circle treatment (scaled to `h-8 w-8 rounded-xl`; accent-selected background when active, `surface-2` when inactive), the category name on its own line (`text-sm font-semibold`), and a subtitle line showing "N picked up" or "N/M picked up" (`text-[11px] text-text-muted`). Selected cards get a `border-2 border-[var(--color-accent-selected)]/40 bg-[var(--color-accent-selected)]/15` acrylic fill with a subtle `shadow-[0_0_20px_var(--color-accent-selected)]/10]` glow — matching the visual weight of a SectionCard header. Inactive cards get the standard glass surface + hover treatment.
  - **Layout** changed from 3 columns to 2 columns (`grid-cols-2 gap-2.5`) so each card has room for the two-line title + subtitle layout. Removed the count badge pill and replaced it with inline subtitle text, matching the SectionCard action count style.
  - **"All" card** uses 🛒 in the circle and shows "2 of 14 picked up" (total-only label when the whole list is shown) instead of "0/14" format.
- Color sources: Unchanged — uses `--color-accent-selected`, `--color-surface-0`, `--color-surface-2`, `--color-text-*` tokens. Matches the SectionCard/ListRow visual language already used for the grocery items below.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "The category filter row on the grocery page (All / Produce / Dairy / etc.) now looks like the grocery list cards below — each category has its emoji in a colored circle, a name, and a '2 picked up' count, with a highlighted glow on the selected one. It's laid out as a 2-column grid so the cards have room to breathe, and the visual style matches the glass-card treatment used by the actual grocery items."

### UI Change Record — 2026-06-15 — Grocery category filter row redesigned as 3-column grid
- Added / Changed: `src/components/meals/GroceryTab.tsx` (category filter row between the Add Item card and the grocery list)
- Visual / Motion: The row that filters the actual grocery list (not the Quick Add presets — that's the separate grid above) used to be a `flex gap-2 overflow-x-auto -mx-4 px-4 no-scrollbar` of `Chip size="md"` pills — 9 chips (All + 8 categories: Produce, Dairy, Meat & Seafood, Pantry, Frozen, Snacks, Beverages, Household) crammed into an 8px gap, only 3-4 visible at a time on mobile, and the user had to swipe horizontally to see all of them. Redesign: replaced the horizontal scroll with a `grid grid-cols-3 gap-2` of proper glass cards, matching the visual language of the Quick Add grid above. Each card shows the emoji (`text-base`), the category name (`text-sm font-semibold`), and a small picked/total count badge (e.g. `2/12`, hidden when 0) that uses `bg-white/20 text-white` on the selected card and `bg-[var(--color-surface-2)] text-text-muted` on unselected cards. The "All" card gets a 🛒 emoji to match the visual weight of the other cards. The selected card uses the existing accent-button fill + shadow treatment; unselected cards use the glass surface + border + hover-to-accent treatment. `active:scale-[0.98]` on tap.
- Layout: 3 columns × 3 rows = all 9 cards visible at once on mobile. On wider screens (xl breakpoint) the main content column narrows to `1fr` (sidebar takes 280px), so 3 columns stays the right density. `min-w-0 truncate` on the name so "Meat & Seafood" doesn't overflow on a 375px viewport. Removed the `-mx-4 px-4 no-scrollbar` negative-margin bleed since the grid no longer needs edge-to-edge scroll.
- Color sources: Unchanged — uses existing `--color-accent-button`, `--color-accent-selected`, and `--color-surface-*` tokens. Matches the Quick Add grid above it for visual consistency.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "The grocery list filter row (the row that shows All / Produce / Dairy / Meat / Pantry / Frozen / Snacks / Beverages / Household and decides which items appear below) used to be a cramped horizontal scroll of tiny pills — you could only see 3 or 4 at a time on a phone. It's now a proper 3-column grid of glass cards with the emoji, category name, and a little picked/total counter, so all 9 categories are visible at once and the selected one is clearly highlighted."

### UI Change Record — 2026-06-15 — Grocery Quick Add redesigned as 2-column category + preset grids
- Added / Changed: `src/components/meals/GroceryTab.tsx` (Quick Add section), `PRESETS_PER_PAGE` 12→6
- Visual / Motion: The Quick Add section under "Add Item" was cramped and hard to scan — 8 category pills sat in a horizontal scroll with `gap-1.5` (6px) and `text-[11px]`, so only 3–4 were visible at a time on mobile and the user had to swipe to see Produce / Dairy / Meat / Pantry / Frozen / Snacks / Beverages / Household. Below that, the preset chips used `Chip size="sm"` (h-7, text-[11px]) in a tight `gap-2` wrap, which didn't feel like a proper "browse by category" list. Redesign:
  - **Category grid** is now a `grid grid-cols-2 gap-2.5` of proper glass cards. Each card shows the emoji (`text-xl`), the category name (`text-sm font-semibold`), and a small count badge with the number of presets in that category (hidden when 0). The selected card uses the existing accent-button fill + shadow treatment; unselected cards use the glass surface + border + hover-to-accent treatment. `active:scale-[0.98]` on tap.
  - **Preset grid** is now a `grid grid-cols-2 gap-2` of larger glass cards. Each card shows the emoji (`text-lg`), the preset name (`text-sm font-medium`), and a "+" add affordance (dimmed at 40% opacity, 100% on hover). Full card is clickable, with `hover:border-accent/40` and `hover:bg-surface/50`. `active:scale-[0.98]` on tap.
  - **Empty state**: if the selected category has no presets (Frozen, Household), show a dashed-border helper card: "No quick-add presets for this category yet — use the form above to add items."
  - **`PRESETS_PER_PAGE` 12 → 6** so the initial view is 3 rows of 2 cards with a "Show N more ↓" toggle. Categories with 7+ presets (Produce 12, Pantry 8, Dairy 7) get the toggle; smaller categories show everything.
  - `text-[11px]` tracking and `min-w-0 truncate` on the name so long category/preset names never overflow the card on a 375px viewport.
- Color sources: Unchanged — uses existing `--color-accent-button`, `--color-accent-selected`, and `--color-surface-*` tokens. The count badge on an unselected card uses `bg-[var(--color-surface-2)]` so it reads against the card background; on a selected (accent-filled) card it uses `bg-white/20` so it reads against the accent.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "The Quick Add section on the grocery page is easier to browse now. The category buttons are a proper 2-column grid of glass cards (Produce, Dairy, Meat, etc.) with a little count badge showing how many quick-add items are in each, so you can see all categories without scrolling. Tap a category to see its presets, which are now larger 2-column cards with the emoji, name, and a '+' add button — no more cramped little chips."

### UI Change Record — 2026-06-15 — Grocery add no longer wipes the list (state-clobber + PB schema fix)
- Added / Changed: `src/hooks/useGrocery.ts` (addGroceryItem, syncMealToGrocery, syncPantryToGrocery, new mergeFreshIntoState helper), `src/lib/pb-seed.ts` (seedCollections now patches missing schema fields on existing collections)
- Data / Persistence: Two compounding root causes were producing the "I clicked Add and nothing appeared, and my list went away" symptom.
  1. **State clobbering in `addGroceryItem`** (the user-visible bug). After `db.upsertGroceryItem`, the hook did `setGroceryItems(fresh.length ? fresh : [...groceryItems, ...])` — a ternary that **replaced the entire UI state with the PocketBase cache** whenever the cache was non-empty. Because the 11 default items in `initialGroceryItems` are local-only (never written to PB), the cache was always smaller than the UI state, so every add wiped most of the list.
  2. **PocketBase `grocery_list_items` collection had no schema fields.** The collection was created but its schema fields (`name`, `category`, `emoji`, `aisle`, `quantity`, `priority`, `needed`, `manualOverride`, `source`) were never added. PB silently dropped every field on `create()` and returned only `{id, collectionId, collectionName}`. Mapped through `mapDbToGrocery`, the new item came back as `{name: undefined, emoji: "📦", category: "pantry", aisle: "1"}` — and the cache's 1-item length made the ternary in (1) fire, so the broken item replaced the whole list.
- **Fix.** `addGroceryItem` now uses functional `setGroceryItems(prev => [...prev, newItem])` and builds the new item from the local `name` / `category` / `emoji` / etc. that the caller passed in — the PB write is still attempted in the background for persistence, but the UI no longer trusts PB's data-less response. `syncMealToGrocery` and `syncPantryToGrocery` now go through a new `mergeFreshIntoState` helper that merges DB items into the existing state by normalized name (matching items get the fresh data, new items get appended, local-only items are preserved). The duplicate-check branch of `addGroceryItem` keeps using `setGroceryItems(prev => prev.map(...))` which was already correct.
- **PB schema patch.** `seedCollections` previously skipped a collection whose name already existed, so re-running the seed didn't add the missing fields. It now reads the live collection, computes the diff between `live.schema` and the seed schema, and calls `pb.collections.update({ schema: merged })` to add only the missing fields. Logs the patched field list, e.g. `grocery_list_items (patched +9 fields: name, emoji, category, aisle, quantity, priority, needed, manualOverride, source)`. Re-running the seed is now idempotent and self-healing.
- **Net effect.** Adding a grocery item via the "Add" button (or a preset chip) immediately appends a fully-populated row to the list — correct name, emoji, category, aisle, quantity, notes, priority, `source: "manual"`. The "🛒 Added X" toast fires and the row is visible in the correct category section. The 11 defaults survive. After re-running the PB seed, the schema is correct and items persist across reloads.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "Adding items to the grocery list works again. When you tap Add (or a preset chip), the new item shows up in the right category with the right name, emoji, and quantity — and your existing items stay put. Behind the scenes the PocketBase grocery collection was missing its schema fields, so the seed now patches them on next run and items will persist across reloads."

### UI Change Record — 2026-06-15 — Consuela chat input box now sits above the bottom nav
- Added / Changed: `src/app/chat/page.tsx` (input area wrapper)
- Visual / Motion: The Ask Consuela message box used to render inside the BottomNav's footprint. Root cause: the input wrapper had `paddingBottom: "calc(env(safe-area-inset-bottom) + 4.5rem)"` (~72px + safe area), but the 6-tab BottomNav is actually `mb-3` (12) + `py-4` (32) + `h-14` (56) = ~100px tall above the safe area, so the input pill was sitting **inside** the nav's vertical band. The wrapper also had no `z-index`, so the `BottomNav` (`fixed bottom-0 z-50`, rendered after the input in the DOM) painted on top of the pill. Fix: raised the inline `paddingBottom` from `4.5rem` to `7rem` (128px) so the input pill's bottom edge clears the nav by ~12px on every device, and added `z-50` to the wrapper so its glass surface paints above the nav (the gradient still fades to transparent at the top, so the nav's glass blur reads correctly). The input pill, mic, and send button are now always visible and tappable on the chat screen.
- Color sources: Unchanged — uses the existing chat pill gradient (`rgba(124,111,247,0.22) → 0.10`).
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "On the Ask Consuela chat screen the message box used to slide under the bottom navigation buttons. It now sits cleanly above the nav with a small breathing-room gap, and its glass surface paints over the nav so the input is always visible and tappable."

### UI Change Record — 2026-06-15 — Mobile responsiveness fixes for Home + Chat
- Added / Changed: `src/app/page.tsx` (Home header), `src/app/chat/page.tsx` (top bar)
- Visual / Motion: **Home greeting** no longer truncates. The h1 + 👋 emoji pair dropped from `text-3xl` to `text-2xl sm:text-3xl`, the parent row switched from `items-center` to `items-start` with `flex-1` on the text column, and `truncate` was replaced with `break-words`. On a 375px viewport the greeting now wraps to 2 lines ("Good afternoon," / "Garcia family") instead of cutting to "Good aftern…". The emoji is `shrink-0` and `mt-1` so it stays anchored to the first line.
- **Chat top bar** tightened. Outer padding dropped from `mx-4 px-4 gap-3` to `mx-3 sm:mx-4 px-3 sm:px-4 gap-2 sm:gap-3`. The "Consuela" h1, "AI Family Assistant" status line, and green status dot all got `truncate` / `shrink-0` so they can yield under pressure. Speaker switcher name span grew from `max-w-[48px]` to `max-w-[64px]` — "Rebecca" now reads fully instead of "Rebec…".
- Verified at 320, 375, and 414px viewports via Playwright; no horizontal scroll, no overflow on any dashboard route.
- Agent action required: Update this section if describing mobile / responsive behavior.
- User-facing description (copy-paste ready for responses):
  > "On a phone the Home greeting now wraps to two lines so you can read the full 'Good afternoon, Garcia family' (it was getting cut off at 'Good aftern…'), and the Chat top bar now shows the full speaker name like 'Rebecca' in the pill instead of 'Rebec…'."

### UI Change Record — 2026-06-15 — Home greeting + family strip respond to login state
- Added / Changed: `src/app/page.tsx` (greeting emoji + family member row)
- Visual / Motion: **Greeting emoji** left of "Good {timeOfDay}, {name}" used to be a hard-coded 👋 for everyone. Now it reads from `dashboardCurrentUser.emoji` (the signed-in member's avatar emoji, e.g. 🐱 for Rebecca) when `isLoggedIn` is true, and falls back to 👋 only when no one is signed in — so a logged-in kid sees their own character greeting them.
- **Family member strip** (the horizontal avatar row under the greeting) used to always render `familyMembers.slice(0, 6)` + the `＋` add-member chip, regardless of auth. Now it filters to a single avatar matching the signed-in member (using the existing `memberMatchesName(m, dashboardCurrentUser.name)` helper) and the `＋` chip is hidden when `isLoggedIn` — the rest of the family stays in Settings where you manage them. When nobody is signed in the strip falls back to all 6 family members + the `＋` chip, so a fresh device still feels like a family dashboard instead of an empty shell.
- Verified at 375px via Playwright in both states (signed in as Rebecca, and signed out). Logged-in state: greeting shows 🐱, strip shows 1 avatar (Rebecca), no `＋` chip. Signed-out state: greeting shows 👋, strip shows 6 avatars + `＋` chip. Typecheck and lint clean.
- Agent action required: Update this section if describing the Home greeting or family strip.
- User-facing description (copy-paste ready for responses):
  > "On the Home screen the emoji next to 'Good afternoon' now matches whoever is signed in (so a kid logged in as Caspian sees Caspian's avatar instead of a generic 👋), and the family avatar row below the greeting only shows the active member when someone is logged in. Sign out and the full family strip comes back, since it's a family dashboard."

### UI Change Record — 2026-06-15 — Home greeting emoji removed + Sign out button made discoverable
- Added / Changed: `src/app/page.tsx` (greeting row + sign-out button)
- Visual / Motion: The greeting no longer has any emoji to the left of "Good {timeOfDay}, {name}" — the `<span>` wrapper around 👋 / `dashboardCurrentUser.emoji` is gone, so the row is just text + the colored name. Cleaner look, no surprise from an emoji that doesn't match the page theme.
- **Sign out** was previously a tiny `IconButton size="sm" variant="glass"` (a 36×36 round button with a door+arrow icon, glass background). The button was there, but the icon-only design with the glass surface made it easy to miss — especially when the header is busy. Replaced with a visible pill button: same door+arrow icon, plus the literal text "Sign out", in a `rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-3 py-1.5 text-xs font-semibold` glass surface with `hover:bg-[var(--color-surface-0)]/55 hover:text-text-primary` and `active:scale-95`. Same confirm `Modal` ("Sign out of {first name}?") still fires on tap.
- Verified at 375px via Playwright in both states. Logged in: greeting is text-only, "Sign out" pill + avatar are clearly visible in the header. Signed out: greeting is text-only, just the family avatar. Typecheck and lint clean.
- Agent action required: Update this section if describing the Home sign-out flow or greeting layout.
- User-facing description (copy-paste ready for responses):
  > "The little waving-hand (or member) emoji that used to sit to the left of 'Good evening, Rebecca' is gone — the greeting is just text now. And the sign-out button is no longer a tiny round icon you have to hunt for; it's a clear pill that says 'Sign out' right next to your avatar at the top right of Home."

### UI Change Record — 2026-06-15 — Home widget spacing (Quick ask → Today gap)
- Added / Changed: `src/app/page.tsx` (Leaderboard and Today widgets)
- Visual / Motion: The default Home layout puts Quick ask (Consuela ask) above Leaderboard above Today's Events (the 📅 calendar-events card). The `space-y-6` parent only gave them 24px between each card, which felt cramped — the Leaderboard widget was nearly touching Quick ask. Wrapped the Leaderboard case in `<div className="mt-3">` (adds 12px on top of the existing 24px = 36px above Leaderboard) and gave the Today SectionCard `className="mt-4"` (adds 16px on top of the 24px = 40px above Today). The Quick ask → Leaderboard → Today stack now breathes naturally. Works regardless of the user's saved widget order — the extra margin travels with each widget, not with the slot.
- Verified at 375px via Playwright — the three widgets now have 36px / 40px gaps (was 24px / 24px) and feel visually separated.
- Agent action required: Update this section if describing Home widget rhythm.
- User-facing description (copy-paste ready for responses):
  > "On the Home screen the Quick ask card, the Leaderboard, and the Today's Events (calendar) card now have a little more breathing room between them — they were sitting too close together before."

### UI Change Record — 2026-06-15 — Kitchen tabs no longer overflow on mobile
- Added / Changed: `src/components/meals/GroceryTab.tsx`, `src/components/meals/MealsTab.tsx`, `src/components/meals/PantryTab.tsx`
- Visual / Motion: **Root cause** — the two-column grids in Grocery / Meals / Pantry used `grid gap-5/6 xl:grid-cols-[…] / lg:grid-cols-[…]` without a `grid-cols-1` base. On a 375px viewport the grid resolved to implicit columns sized by content (form `<select>` elements have a native `min-width` that `<div className="flex-1">` can't override), pushing each grid child to ~552–786px wide. The Surface around the sync buttons clipped the overflow, so "Sync from Meals", "Sync from Pantry", and "Mark all as needed" rendered as "Sync fr…" on the right edge.
- **Fix.** Added `grid-cols-1` to the outer grid on all three tabs, added `min-w-0` to both grid children (lets them shrink below content size), and added `shrink-0` to the form `<select>` / "Add" button rows in Grocery and Pantry so the flex-1 input actually gets the slack. The edit-item form in Grocery got the same `min-w-0` / `shrink-0` treatment on its Name / Qty pair.
- Verified at 375px via Playwright — "Sync from Meals" and "Sync from Pantry" now read fully, "Mark all as needed" is visible, the "0 of 2 picked up" subtext in Shopping progress is no longer cut off, and `document.documentElement.scrollWidth` equals the viewport (no page-level horizontal scroll).
- Agent action required: Update this section if describing Kitchen / Meals / Grocery / Pantry mobile behavior.
- User-facing description (copy-paste ready for responses):
  > "The Kitchen tabs (Meals, Grocery, Pantry) now fit cleanly on a phone — 'Sync from Meals', 'Sync from Pantry', and 'Mark all as needed' all show in full, and the right-side widgets (Shopping progress, sync buttons) no longer get clipped on the right edge."

### UI Change Record — 2026-06-15 — Layout & display reorder fixed end-to-end
- Added / Changed: `src/lib/layout-config.ts`, `src/hooks/useHomeLayout.tsx`, `src/app/settings/page.tsx`, `src/app/page.tsx`
- Visual / Motion: Settings → Layout & display now reflects the user's saved order. The card is split into a **Visible** group (rendered in user order, count of on-Home widgets shown) and a **Hidden** group (master order, with a thin divider + label). Every visible row carries a ⋮⋮ drag handle that supports native HTML5 drag-and-drop with a ring highlight on the drop target and a 50% opacity on the source row. Hidden rows are dimmed (opacity 0.55) and have their ↑/↓ disabled. The Help modal copy was updated to match the new contract, and the duplicate "Reset layout" button was removed from Data & sync.
- Persistence: `useHomeLayout` now debounces `saveLayoutConfig` at 250ms and flushes any pending write on `pagehide` so a quick tab close after a reorder does not drop the latest move. The Settings page calls `setSuppressRehydrate(true)` on mount and `false` on unmount, so the focus/visibilitychange rehydrate no longer clobbers in-flight edits on `/settings`. `loadLayoutConfig` now validates stored ids against `ALL_WIDGETS` (unknown ids are dropped) and appends any default ids that are missing — schema changes self-heal for existing users.
- Weather pinned-to-top bug fixed: `src/app/page.tsx` no longer special-cases the Weather widget outside the `widgets.map(...)` switch. Weather is now a regular switch case that respects the user's chosen position. The page-level `AtmosphericProvider` is the only one in the tree (the previous Weather-scoped provider was removed). `<AtmosphericBridge />` is rendered once, just above the first visible widget, so the bridge still anchors the widget stack regardless of order.
- Feedback: Every reorder/toggle now shows a toast (`↕️ Moved X up/down`, `↕️ Reordered X`, `✅ Showing X`, `🚫 Hiding X`).
- Agent action required: Update this section + Common Journeys if describing layout customization.
- User-facing description (copy-paste ready for responses):
  > "Settings → Layout & display is now actually a working reorder UI. Widgets are listed in your saved order at the top under **Visible**; hidden widgets fall into a **Hidden** group below. Drag the ⋮⋮ handle onto another row, or use the ↑ and ↓ buttons. The first row appears first on the Home dashboard — even Weather is free to move now, no longer pinned to the top."

### UI Change Record — 2026-06-14 — Leaderboard champion share ring
- Added / Changed: `src/app/tasks/page.tsx`
- Visual / Motion: The “This week’s champion” card now calculates the champion ring from the visible leaderboard points instead of the empty earned-points bucket. It shows the champion’s share of family points, so the default leaderboard no longer displays a misleading 0% ring.
- Color sources: Uses the existing Warm Glass champion card surface and `--color-accent-selected` ProgressRing stroke.
- Agent action required: Update this section + Common Journeys if describing the Tasks leaderboard.
- User-facing description (copy-paste ready for responses):
  > "The leaderboard champion card now shows Caspian’s share of the family points instead of a 0% ring, so the champion box matches the visible leaderboard."

### UI Change Record — 2026-06-15 — Tasks & Leaderboard v2: week-scoped points, real streaks, kid-friendly redesign
- Added / Changed: `src/types/tasks.ts` (new), `src/lib/task-utils.ts` (new), `src/app/tasks/page.tsx` (major refactor), `src/app/page.tsx` (Home task sync), `src/app/globals.css` (kid-friendly animations)
- Visual / Motion: **Leaderboard** now shows a glowing champion crown (👑 with `crown-glow` animation), rank badges (🥇🥈🥉 with `rank-pulse` on #1), real consecutive-day fire streaks (🔥Xd), level progression bars (gradient fill with `progress-fill` animation from current level to next), achievement badge sparkles (`badge-sparkle` animation), and a "Recent Activity" transaction log. **Task completion** triggers a confetti burst of colored particles falling from center screen. **Completed tasks** now show an undo button (↩) that opens a PIN-verified undo modal. **Rewards >100pts** require a parent PIN approval gate first. **Stat tiles** now show accurate "This week" counts instead of all-time totals. **Home page** tasks now sync from the same localStorage source as the Tasks page.
- Color sources: Amber/gold for champion crown and rank #1, warm emerald for earned points, rose for penalties/deductions, existing accent colors for progress bars, multi-color confetti particles (amber/red/green/blue/purple/pink/teal)
- Agent action required: Update this section + Common Journeys if describing task completion or leaderboard
- User-facing description (copy-paste ready for responses):
  > "The Tasks page now has a whole new leaderboard! Each week starts fresh every Monday, your streak counts real days in a row, and you level up through Rookie → Scout → Champ → Star → Master → Legend. Completing a task fires off a confetti celebration! Big rewards need a parent to approve them first. And if you accidentally mark the wrong task done, you can undo it with your PIN."

- Logic fixes delivered:
  - **23 issues resolved** across critical, contradictions, missing, and edge-case categories
  - Week-scoped points with automatic Monday reset + 12-week archive history
  - Real consecutive-day streak tracking (replaced fake `Math.floor(points / 10)`)
  - Transaction log records every point event (earn, redeem, penalty, adjust) with timestamp and reason
  - Recurring tasks auto-regenerate at week start (one-time per week via regeneration tracker)
  - Completed tasks cannot be re-completed (undo flow instead)
  - Undo completion with PIN verification reverses points
  - Parental approval gate for reward redemptions over 100 points
  - "Done this week" stat now shows actual weekly count (not all-time)
  - "Earned" stat now shows this week's points (not all-time)
  - Home page tasks now read from same localStorage as Tasks page (fixed two-source split)
  - 0-point tasks no longer show confusing "+0pts" message
  - Manual point adjust reason is now recorded in transaction log
  - Level-based progression with 6 tiers, progress bars, and achievement badges

### UI Change Record — 2026-06-15 — Home logout button, inactivity countdown, spacing rhythm
- Added / Changed: `src/hooks/useAuth.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Visual / Motion: **Logout is now discoverable.** Home header gets a small `IconButton` (door + arrow glyph, `glass` variant, `sm` size) immediately to the left of the logged-in avatar. Tap → confirm `Modal` ("Sign out of {first name}?") with Cancel + Sign out footer. The previous hidden `onDoubleClick={logout}` gesture is removed; tapping the avatar itself now opens the PIN flow to **switch profile** instead. Guest (not-logged-in) state unchanged. **Inactivity timer is surfaced.** A small `⏳ mm:ss` pill in the Home header shows time remaining until the existing 30-min auto-logout fires; it only renders after 60s of idle so it never distracts active use. When ≤30s remain, the pill flips to amber with the new `.session-pill-warning` keyframe (1.6s amber pulse, `prefers-reduced-motion` safe) and a `Toast` appears at the top: "You'll be signed out in {N}s — tap to stay." Tapping the toast (or any normal activity) calls the new `extendSession()` from `useAuth` and resets the timer to 30:00. **Spacing rhythm standardized.** Header `pt-10 pb-5 → pt-10 pb-6`, greeting → family strip `mt-5 → mt-6`, family member strip `gap-2 → gap-3`, stat-tile row `gap-2 → gap-3`, section card stack `space-y-5 → space-y-6`, bottom action button row `gap-2 → gap-3`.
- Color sources: pill uses existing `--color-surface-0` glass surface for neutral; warning state uses amber-500/10 with amber-200 text. Toast uses the existing `neutral` tone (surface-0/80, white/10 border). New `.session-pill-warning` keyframe uses amber-500 alpha pulse.
- Agent action required: Update this section + Common Journeys (added "How do I log out?" and "Why is there a countdown?").
- User-facing description (copy-paste ready for responses):
  > "You can now sign out from the Home screen with a single tap — there's a small sign-out icon right next to your avatar that opens a confirm sheet. Consuela also tells you when it's about to sign you out: a small clock in the header counts down, and you'll get a top-of-screen warning 30 seconds before the 30-minute auto-logout fires (just tap it to stay signed in)."

### UI Change Record — 2026-06-15 — Leaderboard world-building + Home widget
- Added: `src/components/leaderboard/HomeLeaderboardWidget.tsx`, `Podium.tsx`, `YourCard.tsx`, `MemberSheet.tsx`, `LeaderboardRow.tsx`, `RankArrow.tsx`, `LevelUpModal.tsx`, `DailyQuestCard.tsx`, `StreakSaverBanner.tsx`, `CatchUpNudge.tsx`, `TreasurePath.tsx`, `FamilyGoal.tsx`, `AchievementWall.tsx`, `HallOfFame.tsx`, `TrophyCase.tsx`, `ShareCard.tsx`, `hooks/useLeaderboardData.ts`
- Added: `src/types/tasks.ts` (Task, Transaction, WeekData, LeaderboardEntry, Badge, FamilyGoal, HallOfFameEntry, WeekGraphPoint types + LEVELS const)
- Added: `src/lib/task-utils.ts` (week management, streaks, transactions, archives, recurring regen, daily quests, streak saver, family goal, hall of fame, week graph helpers)
- Changed: `src/app/tasks/page.tsx` — full leaderboard refactor with week-scoped points, real streaks, transaction log, undo completion, parental approval gate, confetti animation, member sheet, podium, your card, daily quests, streak saver, catch-up nudge, treasure path, family goal, achievement wall, hall of fame, level-up modal, share card, trophy case
- Changed: `src/lib/layout-config.ts` — added `"leaderboard"` to WidgetId, ALL_WIDGETS, DEFAULT_LAYOUT at position 3
- Changed: `src/app/page.tsx` — added leaderboard widget case + localStorage task sync
- Changed: `src/app/globals.css` — added animations: confetti-fall, crown-glow, badge-sparkle, rank-pulse, progress-fill, level-up-pop, podium-shine, rank-arrow-bounce, widget-row-glow, number-roll + reduced-motion rules
- Changed: `src/components/patterns/SectionCard.tsx` — added `action` prop
- Visual / Motion: Home page now shows a compact leaderboard widget (top-3 podium + "You" indicator). Tasks page has full world-building: treasure path, family goal progress, achievement wall with badge grid, hall of fame for past weekly champions, trophy case for champion badges, share card modal, level-up celebration modal (auto-dismiss 4s), daily quest suggestions, streak saver banner, catch-up nudge. All animations respect prefers-reduced-motion.

### UI Change Record — 2026-06-14 — Pending Tasks swipe action fix
- Added / Changed: `src/components/ui/SwipeableRow.tsx`, `src/app/tasks/page.tsx`
- Visual / Motion: Pending task rows still use the same Warm Glass swipe affordances, but the swipe primitive now supports both pointer and touch gestures without holding pointer capture. Right swipe opens the PIN completion modal; left swipe opens edit. Tapping a pending row also opens the PIN completion modal as a fallback. Duplicate pointer/touch finish events are ignored so Cancel does not immediately reopen the PIN box.
- Color sources: Existing pending action colors remain — emerald check on the left and rose X on the right.
- Agent action required: Update this section + Common Journeys if describing how to complete a pending task.
- User-facing description (copy-paste ready for responses):
  > "Pending Tasks can now be completed with the same swipe gesture: drag the row to the right to open the PIN screen, or just tap the row if you prefer a direct completion flow."

- Visual / Motion: Bottom nav now uses a clearer glass treatment with stronger backdrop blur (`24px`), light/dark-specific black tint opacity, brighter white edge borders, and an inset highlight for more depth. Light mode keeps contrast with a dark glass tint while feeling more transparent. The active rainbow rim now uses a real 2px border-gradient instead of a masked radial ring, keeping it aligned to the button edge and reducing jagged/pixelated edges.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "The bottom navigation keeps its glass look, but the bar is a little clearer and smoother now. In light mode it uses a subtle dark tint plus blur so it still stands out against white backgrounds, and the active rainbow rim sits right on the button edge without looking pixelated."

### UI Change Record — 2026-06-12 — Settings Accent Studio
- Added / Changed: `src/app/settings/page.tsx`
- Visual / Motion: The old Accent Customization color-picker block is now a glass `Accent Studio` panel. Users can tap a target pill (`Selected`, `Glow`, `Button`, `Border`), choose from curated palette chips, or use a custom color picker for the selected target. A small live preview card shows the selected gradient, glow halo, button card, and border treatment. `Sync button + border` and `Reset` actions sit in the panel header for quick recovery.
- Color sources: Existing 8 accent presets remain (`nori`, `violet`, `rose`, `coral`, `lavender`, `cyan`, `mint`, `amber`). Presets update all four target variables at once: selected hex, glow rgba, button hex, and border rgba.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "Settings → Theme & Appearance now has an Accent Studio panel. You can tap a polished palette, then tap Selected, Glow, Button, or Border to fine-tune just that part with a cleaner custom color picker and live preview."

### UI Change Record — 2026-06-12 — Accent Studio layout and readability refresh
- Added / Changed: `src/app/settings/page.tsx`
- Visual / Motion: Accent Studio section now has more breathing room throughout. Section padding increased from `p-5` to `p-6 sm:p-8`. Grid gaps increased from `gap-5` to `gap-8`. Color targets: swatches taller (`h-14`), labels bumped to `text-sm font-semibold` (was `text-xs`), descriptions use `text-text-secondary text-xs` instead of `text-text-muted text-[11px]` for better contrast, gap below swatch reduced from `mb-4` to `mb-3`. Section headings use `text-[13px]` with `tracking-[0.15em]` for easier reading. Curated palettes: switched from overlaid gradient cards with "Selected" badge to a cleaner stacked layout — full-width gradient swatch on top with the palette name centered below in `text-sm font-medium`. Custom color picker row uses `p-5` (was `p-4`), larger color swatch (`h-14 w-14`), and `text-sm` for both label and helper text. Live preview: removed the forced `lg:mt-10` offset, increased grid gaps, simplified preview card copy, and bumped all card text to `text-sm`. Header: title bumped to `text-lg font-bold`, action buttons use `text-sm font-medium` with `rounded-xl`.
- Color sources: Existing `accentOptions` light/dark values.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "Accent Studio is a little cleaner now: the color target buttons have larger swatches and clearer text underneath, while the curated palette row keeps big color previews without extra labels."

### UI Change Record — 2026-06-12 — Accent Studio live preview integrated
- Added / Changed: `src/app/settings/page.tsx`
- Visual / Motion: The Live Preview pane no longer wraps in its own heavy inner card. Replaced the `rounded-[1.75rem] border bg-surface-2/40` sub-card with a relative column that uses a soft `radial-gradient` of the active accent glow behind it and a thin vertical accent-border divider line on its left (desktop only). Grid columns rebalanced from `1.2fr_0.8fr` to `1.1fr_1fr` with `lg:gap-10`, and the 2x2 target preview grid tightened from `gap-4` to `gap-3`. Mobile / tablet fall back to the same stacked flow but without the inner card. The preview now feels like a continuation of the Accent Studio widget instead of a nested panel.
- Color sources: Live accent `glow` and `border` values from `useTheme` accentHex.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "The Accent Studio live preview no longer looks like a separate widget. The preview pane now flows as part of the studio with a soft accent glow behind it and a thin accent divider separating it from the color controls, so everything feels like one cohesive panel."

### UI Change Record — 2026-06-12 — Settings page wider container
- Added / Changed: `src/app/settings/page.tsx`
- Visual / Motion: Settings page `PageShell` now widens to `md:max-w-3xl` (768px) on tablet/desktop, overriding the default mobile `max-w-lg` (512px). This gives the Accent Studio 4-column color targets, 4-column curated palettes, and the controls + live preview 2-column layout enough horizontal room to breathe. Mobile (<768px) keeps the original 512px width so the bottom-nav mobile experience is unchanged. The wider container also makes the season selector, holiday grid, and family/emergency list rows easier to read on larger screens.
- Color sources: Unchanged — pure layout reflow.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "The Settings page now uses a wider container on tablet and desktop, so the Accent Studio color targets, palettes, and live preview all have room to sit side by side without feeling cramped. Mobile is unchanged."

### UI Change Record — 2026-06-12 — Settings Control Deck
- Added / Changed: `src/app/settings/page.tsx`, `src/app/globals.css`
- Visual / Motion: The whole Settings page now uses a unified glass control-deck treatment. Each dashboard control area is wrapped in a rounded `settings-control-card` with a consistent icon badge, title, helper copy, live badge, translucent surface, backdrop blur, soft shadow, and subtle accent halo. Inner groups like the display mode radio stack and weather preview use `settings-control-panel` so they feel connected to Accent Studio without losing their own section identity. Section dividers were replaced with spacing so each control card stands on its own.
- Color frosting sources: Existing theme tokens (`--color-surface-*`, `--color-text-*`, `--color-accent-selected`, `--color-accent-button`) plus light/dark variants in `globals.css`.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "Settings now has a cleaner control-deck layout: every dashboard section is its own polished glass card with matching headers, badges, and soft accent glow, so the page feels consistent while still separating Weather, Theme, Family, Emergency, Layout, and Data controls."

### UI Change Record — 2026-06-12 — Accent Studio rollout to primary actions
- Added / Changed: `src/components/ui/Button.tsx`, `src/app/settings/page.tsx`, `src/app/calendar/page.tsx`, `src/app/tasks/page.tsx`, `src/app/meals/page.tsx`, `src/components/meals/MealsTab.tsx`, `src/components/meals/GroceryTab.tsx`, `src/components/meals/PantryTab.tsx`, `src/components/meals/RecipesTab.tsx`, `src/components/meals/RecipeModal.tsx`
- Visual / Motion: Primary CTAs now use `--color-accent-button`, while selected tabs, active days, filters, focus rings, and active states use `--color-accent-selected`. The shared `Button` primary variant now reads from `--color-accent-button`, so Settings, Calendar, Tasks, and Meals buttons respond to Accent Studio customizations immediately.
- Color sources: Custom Accent Studio palette values from `home-ai-theme-config` via `useTheme`.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "Accent Studio now drives the main buttons across Settings, Calendar, Tasks, and Meals. Pick your accent in Settings and the primary action buttons use the Button color while active tabs and selected states use the Selected color."

### UI Change Record — 2026-06-12 — BottomNav button halo and rainbow ring
- Added / Changed: `src/components/ui/BottomNav.tsx`
- Visual / Motion: The active nav indicator no longer uses the sliding active pill. The active button now has three layers: a soft radial outer halo pushed outside the button, a tight rainbow ring wrapped around the button edge, and the tab-specific glass fill behind the icon.
- Color sources: Per-tab active color map in `BottomNav.tsx` for the outer halo and button fill; fixed rainbow conic gradient for the ring.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "The bottom nav active state is cleaner now: the rainbow glow hugs the active button itself, with a softer halo floating just outside it instead of a sliding pill behind the row."

### UI Change Record — 2026-06-12 — Calendar schedule tab redesigned as Family Routines
- Added / Changed: `src/app/calendar/page.tsx`, `src/app/globals.css`
- Visual / Motion: The schedule tab now matches the design project's RoutinesPage layout. Schedule items are grouped by time-of-day categories (Morning, Afternoon, Evening, Night) with gradient icon headers showing the time range. Each item is rendered as a glass `calendar-routine-card` with an icon circle (colored by the item's schedule color), title, time in accent color, type/meal badges, and S M T W T F S day-of-week pills (lit per the item's day scope). Category filter tabs sit above the list and highlight the active filter. The panel title changed from "Daily Schedule" to "Family Routines" and shows total/visible counts. All CRUD functionality preserved (add/edit/delete with form).
- Color sources: `scheduleColorValues` drive icon circles and active day pills; category icons use hardcoded gradients matching the design project (amber->orange for morning, sky->blue for afternoon, orange->rose for evening, indigo->violet for night).
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "The Schedule tab is now laid out as Family Routines, grouped by time of day with colorful category headers. Each routine shows its icon in a colored circle, time, type badge, and day-of-week pills so you can see at a glance which days it runs."
- Added / Changed: `src/app/calendar/page.tsx`, `src/app/globals.css`, `src/components/ui/PageShell.tsx`
- Visual / Motion: The Calendar page now uses a polished glass-dashboard design system. A `.calendar-page-shell` wrapper with dual soft radial gradients, a glass `.calendar-hero-card` with gradient orb, a `.calendar-member-strip` with animated accent chips, a `.calendar-tabs` segmented control with `is-active` pill, a `.calendar-grid-card` with isometric treatment, `.calendar-panel` glass surfaces for today's events / upcoming / schedule lists. Each event card shows an accent left bar with glow, a time column with dot + divider, and a title row with member badge. All interactive elements respond to the atmospheric theme's `--calendar-accent-rgb` CSS variable for consistent coloring across dark and light modes. `calendar-fade-in-up` animation on events for sequential stagger. `scrollbar-hide` utility for smooth horizontal scroll on member strips and upcoming cards. `PageShell` now accepts an optional `style` prop.
- Color sources: Inline `--calendar-accent-rgb` from `accentRgb`, CSS custom properties for event/schedule colors (`--event-color`, `--schedule-color`), existing theme tokens for surfaces and text.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "The Calendar page feels more polished now with a glass dashboard style: hero card with soft gradient glow, accent-tinted member chips, a clean calendar grid with selected day pop, glass panels for events and schedules, and staggered fade-in animations. Everything uses your chosen accent color so it feels like part of the dashboard."

### UI Change Record — 2026-06-12 — Family avatar settings synced with dashboard avatars
- Added / Changed: `src/components/ui/Avatar.tsx`, `src/app/settings/page.tsx`, `src/app/page.tsx`, `src/db/index.ts`
- Visual / Motion: Settings → Family Members now previews and edits avatars through the same `Avatar` component used on the Home family row. The shared size scale is `xs` (28px), `sm` (32px), `md/base` (40px), and `lg` (48px). The glow toggle now applies the same soft color halo to emoji and image avatars. Image data URLs, pasted image URLs, and emoji values all render through the same avatar path on Settings and Home. Home also rehydrates the logged-in user avatar from the latest member data so avatar size and glow reflect after Settings saves, including legacy auth sessions stored with first names.
- Data sources: Family avatar size and glow are saved to `consuela-members` and merged into the in-memory member store so returning to Home reads the same avatar settings. `consuela-auth-user` is refreshed from the latest member data after family settings change.
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "Family avatar changes in Settings now match the dashboard: the same avatar sizes, glow behavior, image handling, and animated emoji rendering are used in Settings and on Home."

### 1.2 Documenting Recent & Future UI Updates

**Current "What's New" (2026-05-26 immersive weather refresh):**
As of the latest build, the Home dashboard weather widget features:
- **Immersive Weather Widget** (`src/components/ui/WeatherWidget.tsx`): Full-bleed glassmorphism backgrounds with seasonal/holiday themes.
- **Season backdrops**: `SpringBackdrop` (cherry blossoms, mist), `SummerBackdrop` (palm silhouettes, heat haze, galaxy stars), `AutumnBackdrop` (bare oak trees, fog), `WinterBackdrop` (aurora borealis, icicles, pine silhouettes).
- **Holiday overlays**: `ChristmasOverlay` (fairy lights, snow), `HalloweenOverlay` (bats, moon, mist), `FireworksOverlay` (4th of July bursts), `ValentinesOverlay` (floating hearts, rose glow), `NewYearsOverlay` (golden sparkles, champagne fizz).
- **Particle system**: `WeatherParticles` component with animated SVG/CSS particles — blossom petals, autumn leaves, fireflies, snowflakes, sparks, hearts.
- **Settings integration**: Holiday/Event Theme selector in Settings (`src/app/settings/page.tsx`) with live preview.
- Users can force-enable any holiday theme or use auto-detection based on date.

### 1.3 Motion & Animated Elements

- **Planner motion stripped (2026-06-15):** Float, bob, scale (`active:scale-*`), and translate (`hover:-translate-y-*`) animations were removed from the Meals, Grocery, Pantry, and Recipes tabs. These sections are for planning — motion can introduce visual instability during input. Color transitions (`transition-colors`), opacity transitions, focus rings, and progress-bar animations remain for accessibility. The `liquid-glass` CSS hover lift is preserved (it's a class-level treatment, not per-element motion). Home screen, chat, and other surfaces keep their animated elements.

See files:
- `src/components/3d/Icon3D.tsx` + `index.ts`
- `src/components/ui/AnimatedEmoji.tsx`
- `src/app/globals.css` (search for `@keyframes float`, `.floating`, isometric hover)

**Agent rule:** When describing the Home screen or chat, mention floating / keyframe motion. When describing the Meals, Grocery, Pantry, or Recipes planner tabs, omit motion — describe them as calm, stable input surfaces.

### 1.4 Theme & Accessibility Controls

- Three modes (dark default, light, system) persisted in `localStorage` under `home-ai-theme-config`
- 10 accent colors (nori, violet, rose, coral, lavender, cyan, mint, amber, apricot, sage)
- High-contrast boost toggle
- All colors via CSS variables (`--color-accent-*`, `--color-surface-*`, etc.)
- Controlled by `useTheme` hook (`src/hooks/useTheme.tsx`) and inline anti-FOUC script in `layout.tsx`

Settings page is the single place users change this. Changes are instant across the entire app.

### 1.5 Common User Journeys (copy-paste ready answers)

**"How do I get to the grocery list?"**  
Tap **More** in the bottom bar, then tap "Grocery" (shopping-cart icon). From Home you can also tap any quick "Grocery list" prompt in the AI chat bubble.

**"Where are Emergency and Settings now?"**  
Tap **More** in the bottom bar, then choose "Emergency" for quick-reference contacts or "Settings" for theme, family, routines, emergency contacts, layout, and data controls.

**"How do I trigger a real emergency alert?"**  
On the Home screen, tap the red shield icon in the top-right corner. Choose one of the four serious types. The system will attempt SMS + email to your configured primary contacts.

**"I just added a custom meal — where does it appear?"**  
It appears immediately in the weekly Meals view on its chosen day. If you tap "Sync with Pantry & Grocery", missing ingredients are added to the Grocery list with the correct aisle and priority.

**"How do I mark a pending task done?"**  
Open the **Tasks** tab, find the item under **Pending**, then swipe the row right or tap the row. Enter the 4-digit PIN to complete it.

**"How do I log out?"**  
On the Home screen, tap the small sign-out icon (door + arrow) in the top-right header, just to the left of the avatar. Confirm in the "Sign out of {name}?" modal. You can also tap the gear-icon **Sign out** row on the Settings page.

**"Why is there a countdown next to my avatar?"**  
For family safety, Consuela signs you out automatically after 30 minutes of no activity. The small `⏳ mm:ss` pill in the Home header shows how much time is left, but only appears once you've been idle for at least a minute (so it doesn't distract active use). In the last 30 seconds, a toast appears at the top of the screen: "You'll be signed out in {N}s — tap to stay." Tap the toast (or just keep using the dashboard) to reset the timer back to 30 minutes.

**"How do I connect Google Calendar + Tasks + Reminders?"**  
Go to **Settings → Integrations → Connect Google account**. The card shows a 6-character code (e.g. `ABCD-1234`) and a button to open `google.com/device`. On any phone or laptop, sign in to the Google account you want Consuela to sync with, enter the code, and grant Calendar + Tasks access. The dashboard polls every 5 seconds; once you grant access, the card flips to "Connected as you@gmail.com · Synced Xs ago". You can then add a reminder on the Tasks tab, and it will appear in Google Tasks under the "Consuela" list. Calendar events added in Google will appear in the Calendar tab within 5 minutes (or tap **Sync now** for an immediate pull).

**"Why don't I see Reminders on the Tasks tab?"**  
You haven't connected Google yet, or the connected account has no tasks with a `due` date. Go to **Settings → Integrations** to connect; once connected, the Reminders section groups by Overdue / Today / Tomorrow / This week / Later.

**"How do I add a reminder?"**  
Open the **Tasks** tab, scroll to the **Reminders** card, tap **+ Add reminder**, type the title, pick the date and time, tap Save. The reminder appears in Google Tasks (under the "Consuela" list) and on any device signed into that Google account within seconds.

---

## 2. Integration Workflows (Step-by-Step Agent Procedures)

### 2.1 Meal / Recipe Management (Setup • Execution • Troubleshooting)

**Setup (one-time or after DB reset):**
1. Ensure the in-memory DB is seeded (see `db:seed-emergency` script or manual population in `src/db/index.ts`).
2. (Optional) Run `npm run db:migrate-node` if using the node migration path.
3. On first load of `/meals`, the default 7-day plan + sample pantry + grocery items are present.

**Daily Execution (what a user actually does in the UI):**
1. Tap **Meals** tab.
2. Scroll the horizontal "This Week's Meals" strip (or tap a day to edit).
3. To add a custom recipe-style meal:
   - Tap the + or "Add custom" control
   - Choose emoji from the food emoji grid (or type custom)
   - Enter name, prep time, servings, calories, macros, tags, full instructions
   - Assign to a weekday
4. Tap the big **Sync Pantry & Grocery** button (or the per-item sync).
5. Switch to **Grocery** tab — new items appear with correct category/aisle/priority. User can toggle "manual override" to prevent future auto-sync from changing them.
6. From Home or Chat, say to Consuela: "Add salmon for Thursday and put missing items on the grocery list."

**Troubleshooting Tree (use this exact flow when user reports problems):**
- Sync button does nothing or shows old data → Check that `mealSyncService` is imported and the button calls the bidirectional sync methods. Verify `lastSyncedAt` timestamps in the in-memory store.
- Grocery items missing after adding meal → Ensure the recipe's `ingredients` array uses names that match pantry/grocery catalog (case-insensitive substring match in current implementation).
- Custom meal disappears on refresh → Currently in-memory only; tell user "Data is demo-only until we persist to real DB."
- Full reset: run the seed script + hard reload.

**Deep reference (read first when answering advanced questions):**  
`MEAL_SYSTEM_ARCHITECTURE.md` (data model, AI-ready fields, sync rules) and `src/app/meals/page.tsx` (the actual UI + service calls).

**Agent copy-paste template for users:**
> "Open the Meals tab, tap the add button, pick an emoji and fill in the details, then hit the Sync button. Your new meal will appear on the chosen day and any missing ingredients will be added to Grocery with the right aisle."

### 2.2 Emergency Protocols (Configuration • Button Deployment • Testing • Fallbacks)

**Configuration (exact steps the agent must walk a user through):**
1. Get a Gmail account with 2FA enabled.
2. Generate a 16-character App Password for "Mail" at https://myaccount.google.com/apppasswords.
3. Add to `.env.local` (or `.env`):
   ```
   GMAIL_USER=your@gmail.com
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```
4. Edit the placeholder contacts in `src/db/index.ts:120` (`emergencyContactsData`):
   - Use real E.164 phone numbers (`+15551234567`)
   - Real email addresses
   - Keep `isPrimary: true` for the ones that should receive alerts
5. (Recommended) Also populate the friendlier list in `src/app/emergency/page.tsx` for the non-critical quick-reference page.

**Button Behavior (what actually happens):**
- Floating red shield (Home only for now) → modal with 4 types.
- Selection calls `fetch("/api/emergency", { method: "POST", body: { type, timestamp } })`.
- Backend (`src/app/api/emergency/route.ts`) looks up primary contacts, sends SMS via carrier gateways (`sendSMSViaEmail` in `src/lib/free-communication.ts`) + HTML email.
- Returns `{ success, message, details: { successful, total } }`.
- UI shows success/failure state and auto-closes on success.

**Testing Procedure (safe, repeatable):**
- In dev: start server, tap the button, choose "General", watch Gmail Sent folder and recipient phone/email.
- Or use the curl in `TEST_EMERGENCY.md`.
- Production: same, but rate-limit yourself (Gmail free tier = 500 emails/day).

**Fallbacks & Limitations (always mention):**
- No real auth on the button yet — anyone with the app can trigger.
- US carriers primarily.
- SMS delivery can take 1–5 min; email is faster.
- If Gmail creds missing → clear error "service not configured".
- Always advise: "For life-threatening situations, call 911 directly."

**Deep references (read before giving config help):**  
`EMERGENCY_SETUP.md` (full Gmail + carrier list + security notes)  
`TEST_EMERGENCY.md` (curl + expected results)  
`src/app/api/emergency/route.ts` and `src/lib/free-communication.ts`

**Agent rule:** Emergency questions are high priority. Never guess. Always say: "First let me read the live Emergency section in AGENTS.md, then we'll follow the exact configuration steps together."

---

## 3. Operational Clarity — Agent Role Definition

### 3.1 Core Responsibilities
- You are the **live dashboard expert**. Every answer about how the app behaves for a human user must be 100% consistent with the "Current Dashboard Snapshot" and the subsections above.
- When a user describes a problem or asks for a how-to, your first internal action is to re-read the relevant part of this file.
- After you help implement or modify any dashboard feature, you are also responsible for updating this manual in the same turn.

### 3.2 Action Triggers & Mandatory Behaviors

| User Request / Situation                        | You MUST Do Immediately                                                                 |
|------------------------------------------------|------------------------------------------------------------------------------------------|
| "How do I navigate to X?" or "What's the new icon?" | Read 1.1–1.3 first. Give exact tab + visual description including motion if applicable. |
| "The emergency button isn't working"           | Read 2.2 in full. Ask for the exact error message, then walk the config checklist.      |
| "I added a meal but grocery didn't update"     | Read 2.1 troubleshooting tree. Never guess at the service logic.                        |
| "I just pushed a new floating animation"       | Update the UI Change Record + 1.3 + any affected journey in this file before replying.  |
| Any question about "the dashboard"             | Open this file first. Only fall back to reading raw source if this doc is insufficient. |

### 3.3 Expected Outcomes & Verification Checklists

Before you send any reply about the dashboard, mentally tick:
- [ ] I referenced the exact current component or file path the user would see.
- [ ] I gave a short, copy-paste-ready instruction the user can follow in the UI.
- [ ] I mentioned the motion/animated elements when describing Home or Meals.
- [ ] I noted whether this file itself now needs an update because of the conversation.
- [ ] I linked the appropriate deep doc (`EMERGENCY_SETUP.md`, `MEAL_SYSTEM_ARCHITECTURE.md`, etc.) for power users.

### 3.4 Anti-Patterns (never do these)
- Never say "look in the code" or "check src/app/page.tsx".
- Never describe the pre-2026-05-21 static emoji experience.
- Never give production deployment advice without the Gmail limits + security warnings.
- Never claim data is persisted when it is still in-memory only.

---

## 4. Standard Operating Procedures (SOPs)

### 4.1 Reusable SOP Template (copy this block when creating new ones)

```markdown
#### SOP-XXX: <Short Descriptive Title> (Lifecycle Phase: Onboard | Daily | Maintain | Incident | Rollout | Retire)

**Purpose**  
One-sentence goal from the human user's perspective.

**Prerequisites**
- What the user or admin must have ready
- Files / env vars to touch (with exact paths)
- Docs the agent must read first (always include the relevant deep doc)

**Step-by-Step** (imperative, one action per line, numbered)
1. Open the Settings tab...
2. ...

**Expected Results / Success Signals**
- UI: "You should now see a green success toast and the new contact in the list."
- Backend / DB: "A new row appears in emergencyContactsData with isPrimary: true"
- Logs / Notifications: "Gmail sent folder contains the alert"

**Rollback / Undo**
- Exact reverse steps or DB edit command

**Agent Notes**
- Verbatim sentence you should say to the user
- When to escalate: "If the above fails, read the full EMERGENCY_SETUP.md §Troubleshooting"
- Related SOPs
```

### 4.2 Initial Lifecycle SOPs (seed examples — expand as features grow)

#### SOP-001: Onboarding a New Family Member (Onboard)
**Purpose:** Add a person to the family roster so they appear in avatars, get assigned tasks, and can be emergency contacts.

**Prerequisites:** Access to `src/db/index.ts` (or the future real DB UI in Settings).

**Step-by-Step:**
1. In `membersData` array add a new object with id, name, emoji, color, etc.
2. (Future) Expose the same form in the Settings → Family section.
3. For emergency: also add an entry to `emergencyContactsData` if they should receive alerts.
4. Hard reload the app or trigger any state reset so the new member appears in Home family row and avatar pickers.

**Expected Results:** New avatar shows in the top family strip on Home. The person can be assigned tasks and appears in the Emergency quick-reference page.

**Agent Notes:** "After adding them in the code, tell the user to pull the latest and hard-refresh. Their emoji will now animate if it matches one of the special cases in AnimatedEmoji.tsx."

#### SOP-002: Daily Morning Dashboard Check (Daily)
**Purpose:** Quick overview of the day using the motion-rich Home screen.

1. Open the app → land on Home.
2. Read the date pill and greeting.
3. Check the floating weather widget.
4. Review today's events (color-coded left borders).
5. Look at the week's meal strip — tap any day to jump to Meals.
6. Use one of the quick AI prompts or the big "Ask Consuela" glass card (the one with the floating chat Icon3D).
7. If anything looks off with meals/grocery, tap the Meals tab and hit Sync.

**Success:** User feels informed in <30 seconds and can act via chat or direct tabs.

#### SOP-003: Rolling Out a New Motion Icon or Animated Emoji (Rollout)
**Purpose:** Add or modify a floating/animated visual element safely.

1. Edit or add a case inside `Icon3D.tsx` (for simple gradient icons) or `AnimatedEmoji.tsx` (for complex keyframe SVGs).
2. Import and place it inside a `div className="... floating"` container on the target page (usually Home or Meals).
3. Update the "What's New" + 1.3 Motion section in this AGENTS.md with the exact visual description and commit.
4. If the emoji is used in meal cards or family avatars, make sure the fallback pop-bounce still works.
5. Test in both light and dark themes + high-contrast mode.

**Agent Notes:** "Every new animated element must be documented here the same day it ships."

(Additional SOPs for Incident Response on emergency false-positive, full data reset after schema change, etc. will be added as they are needed.)

### 4.3 How to Create a New SOP
1. Pick the next SOP-XXX number.
2. Choose the lifecycle phase.
3. Fill the template above.
4. Add it under 4.2.
5. Update the table of contents if you added a new top-level section.
6. Commit the change to this file together with the feature.

---

## 5. Consuela Admin Capabilities (Self-Management)

Consuela has 5 admin-level tools available through the Ask Consuela chat interface. These tools let her manage the dashboard itself — check for updates, deploy new code, restart containers, and verify database health.

### 5.1 Available Admin Tools

| Tool | Description | Use Case | Safety |
|------|-------------|----------|--------|
| `check_for_update` | Checks GitHub for newer commits on `warm-glass-v2` | "Is there a dashboard update available?" | Read-only. Calls `/api/admin/version` internally. |
| `trigger_update` | Pulls latest code + rebuilds Docker container | "Update the dashboard to the latest version" | **Destructive** — restarts the dashboard (brief downtime). Consuela will confirm with the user before running. |
| `get_container_status` | Lists Docker containers and their health | "Is PocketBase running?" / "Check dashboard health" | Read-only. Calls `/api/admin/containers`. |
| `restart_container` | Restarts a Docker container by name | "Restart PocketBase, it's not responding" | **Restart** — brief downtime for that service. Only allowed: consuela-dashboard, pocketbase, hermes-agent-2. |
| `check_pocketbase` | Verifies PocketBase is healthy | "Check if the database is up" | Read-only. Pings PB health endpoint. |

### 5.2 Architecture

The admin tools work via internal HTTP calls from the tool handler (runs inside the Next.js process) to the dashboard's own API routes:

```
User → Ask Consuela → POST /api/hermes/chat
  → Consuela (Hermes agent) decides tool_call
  → Tool handler runs inside Next.js
    → Internal fetch to /api/admin/version, /api/admin/update, /api/admin/containers, /api/admin/restart
  → Results formatted → Sent back to Hermes for natural response
  → User sees natural-language answer
```

**New API routes:**
- `src/app/api/admin/containers/route.ts` — GET: lists three key containers (dashboard, PB, Hermes) with state, status, ports, image
- `src/app/api/admin/restart/route.ts` — POST: restarts a named container from an allow-list

**Env vars needed:**
- `NEXT_PUBLIC_APP_URL=http://localhost:3000` — internal self-referencing URL for tool handler fetches

### 5.3 What Consuela CAN Do

- ✅ Answer questions about today's events, tasks, meals, grocery, pantry, weather, family members
- ✅ Add tasks and grocery items
- ✅ Check for dashboard updates and report version info
- ✅ Trigger dashboard rebuild after user confirmation
- ✅ Check container health (dashboard, PocketBase, Hermes)
- ✅ Restart unhealthy containers
- ✅ Verify PocketBase database connectivity
- ✅ Explain what she can and can't do when asked

### 5.4 What Consuela CANNOT Do

- ❌ Modify events, meals, recipes, or schedule items (read-only for most data)
- ❌ Delete tasks or grocery items (can only add)
- ❌ Reset the leaderboard or modify points directly
- ❌ Edit the physical environment (temperature, locks, lights)
- ❌ Access external APIs beyond Google Calendar (no Spoonacular, no real weather API)
- ❌ Send emergency alerts (human must press the shield button)
- ❌ Access the Docker host or other containers outside the allowed three
- ❌ Run arbitrary commands or shell access
- ❌ Modify her own system prompt or tools

### 5.5 Common Q&A

**"Consuela, can you update the dashboard?"**  
"I can check if an update is available and install it. Want me to check first?"

**"Consuela, PocketBase is acting up"**  
"Let me check PocketBase's health and the container status. I'll let you know what I find."

**"Consuela, what tools do you have?"**  
Full explanation of all 19 tools available (14 daily-life + 5 admin). Read-only, no shell access.

---

## Appendices & Quick References

### Core Operational Docs (read these when the summary here is not enough)
- `EMERGENCY_SETUP.md` — Full Gmail + carrier gateway configuration and security notes
- `TEST_EMERGENCY.md` — Exact curl command and expected Gmail/SMS behavior
- `MEAL_SYSTEM_ARCHITECTURE.md` — Complete data model, sync rules, AI-ready fields for meals/pantry/grocery
- `UI_DESIGN_SPECIFICATION.md` — Design system, all CSS variables, component patterns, accessibility rules
- `UI_DESIGN_VISUAL_REFERENCE.md` + `DESIGN_INDEX.md` — Visual comps and component inventory
- `SETTINGS_PAGE_DESIGN.md` — Theme + family + emergency contact UI details
- `QUICK_REFERENCE_CARD.md` — One-page cheat sheet for humans
- `src/components/3d/Icon3D.tsx` and `src/components/ui/AnimatedEmoji.tsx` — the actual motion source
- `src/components/ui/WeatherWidget.tsx` — immersive weather visuals, season/holiday backdrops, particle system
- `src/hooks/useWidgetTheme.ts` — shared theme hook for weather and other widgets
- `src/lib/weather-config.ts` — weather configuration types and defaults

### Project Scaffolding Recipes (original content preserved for the coding agent)
When users request features beyond the base template, check `.kilocode/recipes/`.

| Recipe       | File                                | When to Use                                           |
| ------------ | ----------------------------------- | ----------------------------------------------------- |
| Add Database | `.kilocode/recipes/add-database.md` | When user needs data persistence (users, posts, etc.) |

**How to use:** Read the recipe → follow steps → update the relevant memory bank.

### Memory Bank Maintenance (still required)
After completing a user request that changes architecture, tech, or goals, update:
- `.kilocode/rules/memory-bank/context.md`
- `.kilocode/rules/memory-bank/tech.md`, `product.md`, `architecture.md` as appropriate
- `.kilo/rules/memory-bank/context.md` (lighter mirror)

---

## Change Log (this manual only)

- 2026-06-15 — feat(ui): Pantry tab restyled to match grocery list design language. `src/components/meals/PantryTab.tsx` — section filter (All/Plenty/Running Low/Out) changed from `flex gap-3 overflow-x-auto` of 4 pill buttons to `grid grid-cols-2 gap-2.5` of glass cards with emoji-in-circle + name + count subtitle + accent glow on active (matching grocery category filter). Preset staples (Baking/Grains/etc) changed from `flex gap-1.5 overflow-x-auto` of tiny pills to `grid grid-cols-2 gap-2.5` of glass cards with emoji + name + count badge (matching grocery Quick Add category grid). Preset items changed from `flex gap-2 flex-wrap` of `Chip size="sm"` to `grid grid-cols-2 gap-2` of glass cards with emoji + name + "+"/checkmark (matching grocery Quick Add preset grid). `PRESETS_PER_PAGE` dropped 10→6. "Add to Pantry" changed from raw `<input>`/`<select>`/`<button>` to `SectionCard` + `TextField` + `SoftButton`. Pantry item grid capped at `sm:grid-cols-2` (was `sm:2 lg:3 xl:4`). `Card` import removed, `SectionCard`/`TextField`/`SoftButton` added. AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — feat(ui): Grocery category filter row restyled to match grocery list SectionCard headers. `src/components/meals/GroceryTab.tsx` — replaced the `grid grid-cols-3 gap-2` of flat buttons (inline emoji text + count badge pill) with a `grid grid-cols-2 gap-2.5` of glass cards that use the same visual language as the grocery list below: emoji in a colored circle (`h-8 w-8 rounded-xl`, accent-selected fill on active, surface-2 on inactive), category name + "N picked up" subtitle (matching the SectionCard header layout), accent-selected border + glow on the selected card, glass surface + hover for others. The "All" card shows "2 of 14 picked up" instead of "0/14". AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — feat(ui): Grocery category filter row redesigned. `src/components/meals/GroceryTab.tsx` — replaced the `flex gap-2 overflow-x-auto` horizontal scroll of 9 `Chip size="md"` pills (All + 8 categories) with a `grid grid-cols-3 gap-2` of glass cards (emoji + name + picked/total count badge). All 9 categories are now visible at once on mobile (3 rows of 3), no horizontal swipe needed, and the selected card uses the same accent-button treatment as the Quick Add grid above it for visual consistency. "All" card gets a 🛒 emoji to match the visual weight of the other cards. Removed the `-mx-4 px-4 no-scrollbar` negative-margin bleed. AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — feat(ui): Grocery Quick Add redesigned. `src/components/meals/GroceryTab.tsx` Quick Add section replaced the 8-pill horizontal scroll (`gap-1.5` tiny pills) + small-chip preset wrap with a `grid grid-cols-2 gap-2.5` of glass category cards (emoji + name + preset count badge) and a `grid grid-cols-2 gap-2` of larger preset cards (emoji + name + "+" add). Each category is now visible without scrolling; presets read as a real "browse by category" list. `PRESETS_PER_PAGE` dropped 12→6 so the initial view is 3 rows of 2 with a "Show N more ↓" toggle. Added an empty-state helper card for categories with 0 presets (Frozen, Household). AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — fix(ui): Home greeting emoji removed + Sign out button made discoverable. Removed the greeting left-of-title `<span>` entirely (was 👋 or `dashboardCurrentUser.emoji`) so "Good {timeOfDay}, {name}" is text-only. Replaced the tiny `IconButton size="sm" variant="glass"` sign-out (a 36px round glass icon, easy to miss in a busy header) with a visible pill: same door+arrow SVG + the literal "Sign out" text in a glass surface (`rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-3 py-1.5 text-xs font-semibold`, `hover:bg-[var(--color-surface-0)]/55`, `active:scale-95`). Same confirm `Modal` ("Sign out of {first name}?") still fires on tap. Verified at 375px via Playwright in both states. AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — fix(ui): Home greeting + family strip respond to login state. Greeting left-of-title emoji used to be a hard-coded 👋; now reads `dashboardCurrentUser.emoji` when `isLoggedIn` (e.g. 🐱 for Rebecca, 👩 for an adult, etc.) and falls back to 👋 when signed out. Family avatar strip below the greeting used to always show all 6 members + `＋` chip; now filters to a single avatar matching the signed-in member (using the existing `memberMatchesName` helper) and hides the `＋` chip when `isLoggedIn`. Signed-out state still shows the full family + `＋` chip so a fresh device reads as a family dashboard. Verified at 375px via Playwright in both states. AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — fix(grocery): adding an item no longer wipes the list. `src/hooks/useGrocery.ts` `addGroceryItem` was replacing the entire UI state with the PocketBase cache via `setGroceryItems(fresh.length ? fresh : [...groceryItems, ...])`; because the 11 default items in `initialGroceryItems` are local-only and the `grocery_list_items` PB collection has no schema fields (PB silently drops `name`/`category`/`emoji` on create and returns only `{id, collectionId, collectionName}`), the new item landed as a nameless 📦 and the rest of the list vanished. Rewrote `addGroceryItem` to use functional `setGroceryItems(prev => [...prev, newItem])` and build the new item from the local input. Added `mergeFreshIntoState` and routed `syncMealToGrocery` / `syncPantryToGrocery` through it so sync paths merge DB items by name instead of replacing local-only items. Extended `seedCollections` in `src/lib/pb-seed.ts` to diff `live.schema` against the seed schema and `pb.collections.update({ schema: merged })` to add only the missing fields — re-running the seed is now self-healing. AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — fix(ui): Home widget spacing (Quick ask → Today gap). Default Home layout puts Quick ask (Consuela ask) above Leaderboard above Today's Events (📅 calendar card); `space-y-6` only gave 24px between each, so the three cards felt cramped. Wrapped the Leaderboard case in `<div className="mt-3">` (36px above Leaderboard) and gave the Today SectionCard `className="mt-4"` (40px above Today). Margins travel with each widget so the spacing holds in any user-reordered layout. Verified at 375px via Playwright. AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — fix(ui): Weather widget atmospheric bridge now follows the widget when reordered. `<AtmosphericBridge />` used to be rendered once at the top of the widget stack (`{widgets.length > 0 && <AtmosphericBridge />}` before the `widgets.map(...)` in `src/app/page.tsx`), so when the user moved Weather away from position 1 the 18px gradient + drifting-particles strip stayed pinned to whatever widget was now first — visually disconnecting the spillover from the weather card it was supposed to bleed out of. Fix: the bridge is now rendered inside the `case "weather"` switch case, directly below `<WeatherWidget />` inside the same `<div className="relative z-10">` wrapper. Bridge `marginTop: -2px / marginBottom: -4px` overlap still flows the gradient and seasonal `theme.particleEmoji` into whatever widget sits immediately below weather in user order. Move weather to position 3 → bridge follows to position 3. The fullscreen `FogBackground` Vanta fog (page-wide ambient, `position: fixed; inset: 0`) is intentionally untouched per user request. AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean (only pre-existing warnings remain).
- 2026-06-15 — fix(ui): Consuela chat input box now sits above the bottom nav. `src/app/chat/page.tsx` input wrapper `paddingBottom` raised from `calc(env(safe-area-inset-bottom) + 4.5rem)` (~72px) to `calc(env(safe-area-inset-bottom) + 7rem)` (128px) so the input pill clears the 6-tab BottomNav (which is `mb-3 + py-4 + h-14` ≈ 100px above the safe area). Added `z-50` to the wrapper so its glass surface paints above the `BottomNav` (`fixed bottom-0 z-50`). The input pill, mic, and send button are now always visible and tappable on the Ask Consuela chat screen. AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — fix(ui): Kitchen tabs mobile overflow. Grocery / Meals / Pantry tab grids all used `grid gap-5/6 xl:grid-cols-[…] / lg:grid-cols-[…]` without a `grid-cols-1` base; on a 375px viewport the implicit grid columns were sized by form content (native `<select>` min-widths blocked the `flex-1` parents from shrinking), pushing each child to ~552–786px and clipping the right-rail widgets. Fixed by adding `grid-cols-1` to the outer grid + `min-w-0` to both grid children in `GroceryTab.tsx`, `MealsTab.tsx`, and `PantryTab.tsx`, plus `shrink-0` on the form `<select>` / "Add" button rows and `min-w-0` on the flex-1 `<input>` fields. Result: "Sync from Meals" / "Sync from Pantry" / "Mark all as needed" all read fully on 375px, "0 of 2 picked up" subtext no longer clipped, no page-level horizontal scroll. AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — fix(ui): schedule time picker. Calendar → Schedule "Add / Edit" form now uses a 3-field 12-hour picker (Hour 1–12, Minute 00–59, AM/PM toggle) instead of a free-text military-time input. New items are stored in `"H:MM AM/PM"` form; the empty default changed from `"08:00"` to `"8:00 AM"`. Home widget `ScheduleDisplay` runs every schedule time through a `displayTime12h` helper, so freshly created 12-hour items and any pre-existing 24-hour data render consistently as 12-hour. `parseTimeToMinutes` in both files now accepts both `"H:MM AM/PM"` and `"HH:MM"`, so sort / category bucketing / past-item filtering keep working regardless of stored format. Time cell on the widget grew from `w-12` to `w-16` to fit "12:00 PM" cleanly. New `.calendar-time-picker`, `.calendar-time-hour`, `.calendar-time-minute`, `.calendar-time-sep`, `.calendar-time-ampm`, `.calendar-time-ampm-btn` rules in `globals.css` (active AM/PM uses `--color-accent-button` and a soft accent glow). AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated. TS / lint clean.
- 2026-06-15 — fix(ui): mobile responsiveness on Home and Chat. Home greeting h1 + 👋 dropped from `text-3xl` to `text-2xl sm:text-3xl`, row switched to `items-start` with `flex-1` on the text column, `truncate` → `break-words`, emoji `shrink-0 mt-1` — greeting now wraps to 2 lines on a 375px viewport instead of cutting to "Good aftern…". Chat top bar tightened (`mx-3 sm:mx-4 px-3 sm:px-4 gap-2 sm:gap-3`), "Consuela" / "AI Family Assistant" / status dot got `truncate` / `shrink-0`, speaker switcher name grew from `max-w-[48px]` to `max-w-[64px]` so "Rebecca" reads fully. Verified at 320 / 375 / 414px viewports via Playwright — no horizontal scroll, no overflow. AGENTS.md "Current Dashboard Snapshot" + new UI Change Record updated.
- 2026-06-15 — feat(infra): PocketBase migration scaffolding landed. Replaced the openclaw proxy with a real PocketBase container on :8090 with a `pb_data` volume, dropped `NEXT_PUBLIC_OPENCLAW_BRIDGE_URL` from the Dockerfile, added a standalone `Dockerfile.deploy`, and introduced `src/lib/pb.ts` (singleton client), `src/lib/pb-auth.ts` (cached superuser auth, 1h TTL), `src/lib/pb-seed.ts` + `scripts/pb-seed.mjs` (idempotent collection bootstrap for members / meal_plan_entries / recipes / grocery_items / pantry_items / schedule_items / task_transactions), and `src/db/pb-db.ts` (safe read-through with in-memory fallback). The in-memory db is untouched; consumers continue to read from `src/db/index.ts` until individual modules are ported.
- 2026-06-15 — feat(tasks): leaderboard world-building landed as two commits — a toolkit commit (types, utils, podium/your-card/row/member-sheet/level-up-modal/share-card/daily-quest/streak-saver/catch-up-nudge/treasure-path/family-goal/achievement-wall/hall-of-fame/trophy-case + `useLeaderboardData` hook) and a Tasks page rewrite that wires the toolkit into Pending / Completed / Leaderboard / Rewards / Penalties tabs with confetti completion animation, parental approval gate, animated champion crown, and Home sync. The auth context now exposes `sessionRemainingMs`, `sessionWarning`, and `extendSession()` so the Home header can show a tappable inactivity countdown. `SwipeableRow` dedupes pointer/touch events so Cancel no longer reopens the PIN modal. `SectionCard` gained an `action` prop. `ProgressRing` clamp/format polished.
- 2026-06-15 — feat(meals): planner reliability + motion removal. `RecipeModal` targets meal vs catalog via a `mode` prop; `MealsTab` adds a collapsed `RecipeCatalogStrip` with one-tap slot insertion; `usePantry` writes to the DB and exposes a 'Grocery items waiting to be restocked' panel (delete is two-tap, no modal); `useGrocery` accepts `plannedMeals` so sync reflects the actual plan and includes units on quantities; manual add supports qty/notes + Auto category + duplicate handling; `useRecipes` normalizes and dedupes on save; `Meal` interface gains `mealType` / `protein` / `carbs` / `fat` / `instructions`. All planner tabs (Meals / Grocery / Pantry / Recipes) had float/bob/scale/translate animations removed.
- 2026-06-15 — feat(ui): layout, chat, and design-system polish. Wrapped the app in `LayoutProvider` so the Settings Layout & display card can read the home widget config anywhere. Theme init script is now a plain inline `<script>` (the previous `next/script strategy="beforeInteractive"` was a no-op in the app router). Added kid-friendly CSS animations for the leaderboard world: confetti-fall, crown-glow, badge-sparkle, rank-pulse, progress-fill, level-up-pop, podium-shine, rank-arrow-bounce, widget-row-glow, number-roll, session-pill-warning — all with prefers-reduced-motion overrides. `_design-system` DayStrip demo no longer drops its click handler.
- 2026-06-15 — fix: Layout & display reorder broken. Settings → Layout & display now reflects the user's saved order (was iterating the static `ALL_WIDGETS` master list), the ↑/↓ disabled state is computed from the user's position (was using the static index), and hidden widgets have their reorder controls disabled. Added Visible / Hidden grouping, a ⋮⋮ native drag-and-drop handle, toast feedback on every action, debounced (250ms) localStorage persistence with `pagehide` flush, suppressed rehydration while on `/settings`, and `loadLayoutConfig` validation that drops unknown ids and self-heals missing defaults. Weather is no longer pinned to the top of the Home page — it now respects the user's chosen position via a regular switch case. The duplicate "Reset layout" button was removed from Data & sync. `src/lib/layout-config.ts` gained `moveWidgetTo`, `getVisibleWidgets`, `getHiddenWidgets`. `src/hooks/useHomeLayout.tsx` gained `reorder`, `visibleWidgets`, `hiddenWidgets`, `setSuppressRehydrate`. Help modal copy updated to match the new contract.
- 2026-06-15 — feat: Home logout button + inactivity countdown surfaced + spacing rhythm. Replaced the hidden `onDoubleClick={logout}` avatar gesture with a visible `IconButton` (door + arrow, glass, sm) in the top-right Home header that opens a confirm `Modal` ("Sign out of {name}?"). Tapping the avatar itself now opens the PIN flow to switch profile. `useAuth` now exposes `sessionRemainingMs`, `sessionWarning`, and `extendSession()`; the Home header shows a small `⏳ mm:ss` pill after 60s of idle, amber-pulsing in the last 30s with a tappable "tap to stay" `Toast`. Home spacing standardized: stat-tile row `gap-2→gap-3`, family strip `gap-2→gap-3`, section card stack `space-y-5→space-y-6`, action row `gap-2→gap-3`, header `pb-5→pb-6`, greeting `mt-5→mt-6`. New `.session-pill-warning` keyframe in `globals.css` (reduced-motion safe). No new dependencies. *(Split across the leaderboard toolkit + Tasks rewrite commits above on 2026-06-15.)*
- 2026-06-15 — feat: Tasks & Leaderboard v2. Major refactor delivering week-scoped points, real consecutive-day streak tracking, transaction history log, undo completion with PIN, recurring task auto-regeneration at week start, parental approval gate for large rewards (>100pts), confetti completion animation, level-based progression with progress bars, achievement badges, animated champion crown, and Home page task sync. New files: `src/types/tasks.ts`, `src/lib/task-utils.ts`. Updated: `src/app/tasks/page.tsx`, `src/app/page.tsx`, `src/app/globals.css`. Fixed 23 logic issues (critical, contradictions, missing, edge cases). *(Now actually landed on `warm-glass-v2` as the two `feat(tasks):` commits above.)*
- 2026-06-15 — fix: Meal/recipe/grocery/pantry reliability + planner motion removal. *(Landed on `warm-glass-v2` as the `feat(meals):` commit above.)* `RecipeModal` now targets either meal or catalog via `mode` prop (was always saving as meal, corrupting meal state when editing catalog recipes). Recipes added from the modal go to the catalog only — assign to a slot later from Meals or Recipes tab. `MealsTab` gets a collapsed `RecipeCatalogStrip` above the day strip so users can browse the catalog while planning, with "Add to {activeDay} as {next empty slot}" one-tap insertion. `usePantry` now writes to the real DB (adds `db.deletePantryItem` to `src/db/index.ts` + `src/db/pb-db.ts`), merges DB + localStorage on load, and accepts `groceryItems` to power a "Grocery items waiting to be restocked" panel with one-tap "Add to pantry". Pantry delete is two-tap with a 3s confirmation window (no modal). `useGrocery` accepts `plannedMeals` from `useMeals` so `mealSyncService.syncMealPlanToGrocery` reflects what the user actually planned (was reading stale `db.selectMeals()`), and sync quantities now include units (`"1 cup"`, `"1 lb"`, etc.). Manual grocery add supports qty/notes inputs, "✨ Auto category" option, and friendly duplicate handling ("already on your list" toast + keep existing row). `useRecipes` normalizes tags/ingredients on save and dedupes by id then name. `GroceryTab`, `PantryTab`, `RecipesTab`, and `MealsTab` had all float/bob/scale/translate animations removed (color transitions, focus rings, and progress bars remain). `src/services/types.ts` `Meal` interface updated with `mealType`, `protein`, `carbs`, `fat`, `instructions`. `emptyRecipe` in `src/data/meals.ts` now includes `mealType`.

- 2026-06-15 — feat(integrations): Real Google Calendar + Tasks + Reminders sync. **Phase 1 of 3** from the API research plan. Replaces the static-JSON stub at `public/google-events.json` and `public/google-tasks.json` with real Google APIs. The previous `/api/google-calendar` route read those JSON files; the new version reads from a new `consuela_google_calendar_events` PB collection populated by `src/lib/google/calendar.ts:listAllEvents` + `syncCalendar`. The same architecture backs Tasks via `consuela_google_tasks`, `consuela_google_tasklists`, `consuela_google_sync_state`, and `consuela_google_api_usage` collections, all created idempotently on first request by `src/lib/google/pb-collections.ts:ensureGoogleCollections` (now uses `fields` + per-type `options` shape, since PB v0.27 silently drops schema fields missing the `options` key). **OAuth via Google Device Flow** (`src/lib/google/device-auth.ts`) so the home-hosted dashboard never needs a public redirect URI — the user signs in at `google.com/device` on any device with a one-time code. Required OAuth client type in Google Cloud Console: **"TVs and Limited Input Devices"** (Client ID + Client Secret). **Tokens are AES-256-GCM encrypted at rest** in `consuela_google_tokens` (`src/lib/google/encryption.ts`, key from `CONSUELA_ENCRYPTION_KEY` env var; 12 unit tests in `scripts/google/test-encryption.mjs`). `src/lib/google/oauth-client.ts` provides a singleton `googleFetch` wrapper that auto-refreshes the access token on 401 with a 30s in-flight lock to prevent thundering-herd refreshes. **5-minute client-side polling** via `useGoogleSync` hook + the `useGoogleReminders` hook on the Tasks page (auto-refreshes on tab visibility change too). New `Settings → Integrations` card (`GoogleConnectCard.tsx`) handles the full lifecycle: unconnected → waiting (code + countdown pill + copy/open buttons) → connected (account email + sync status + Sync now + Disconnect) → error:denied/expired/revoked/config. **Google Tasks is wired but paused** — Google's Device Flow allowed-scopes list does NOT include the Tasks API (confirmed via direct curl: `POST /device/code` with `https://www.googleapis.com/auth/tasks` returns `{"error":"invalid_scope","error_description":"Invalid device flow scope: https://www.googleapis.com/auth/tasks"}`). Calendar and openid/email work fine. Tasks code is complete (auto-creates a "Consuela" tasklist on first connect, Reminders = Tasks with `due` field, `<RemindersSection />` at the top of Pending groups by Overdue/Today/Tomorrow/This week/Later with one-tap complete). The Reminders section shows a "paused — Tasks scope not granted" notice with the upgrade path. To activate Tasks: switch the OAuth client to "Web" type in Google Cloud Console, expose the dashboard over a public HTTPS URL (Tailscale Funnel / Cloudflare Tunnel / ngrok paid tier), add the Tasks scope to `GOOGLE_OAUTH_SCOPES`, and reconnect. New API routes: `/api/google/device-grant`, `/api/google/device-poll`, `/api/google/device-revoke`, `/api/google/state`, `/api/google/sync`, `/api/google/webhook`, `/api/google-tasks`. Webhook route is pre-wired but not used in v1 (no public URL to receive Google's push); falls back to polling. Per-day API quota counter in `consuela_google_api_usage` (soft 50k, hard 100k) to prevent runaway loops from blowing the 1M/day Calendar free tier. Unit tests: 12/12 encryption + 8/8 device-auth passing. `tsc --noEmit` clean, `npm run lint` clean, `npm run build` clean. New env vars in `.env.example`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_SCOPES` (Calendar-only by default), `CONSUELA_ENCRYPTION_KEY`, `GOOGLE_POLL_INTERVAL_MS`. `tsconfig.json` got `allowImportingTsExtensions: true` so the new Google lib files can use `.ts` extensions on relative imports (lets the unit tests run via `node --experimental-strip-types`). `public/google-events.json` and `public/google-tasks.json` are no longer read by anything — deleted. `pb-auth.ts` got a `.ts` extension on its `pb` import for the same reason. **Live verification**: with the user's TVs OAuth client (project `graceful-mile-496715-k7`, client `255734025602-...us.googleusercontent.com`), the `/api/google/device-grant` endpoint returned a real Google `device_code` + `user_code: FFY-KPK-PXNS` (test run, code expired). User can now tap Settings → Integrations → Connect to get their own code. **Common Journey added**: "How do I connect Google Calendar + Tasks + Reminders?", "Why don't I see Reminders on the Tasks tab?", "How do I add a reminder?", "Why is the Reminders section on the Tasks tab showing 'paused'?"
- 2026-06-14 — fix: Leaderboard champion share ring. The “This week’s champion” card now calculates its ProgressRing from the visible leaderboard points, so the default leaderboard shows a meaningful champion share instead of 0%.
- 2026-06-14 — fix: Pending Tasks PIN modal reopens after Cancel. `SwipeableRow` now deduplicates pointer/touch finish events and resets swipe state on cancel/leave, so Cancel closes the modal without immediately reopening it.
- 2026-06-14 — fix: Day strip and swipe slide behavior. DayStrip now honors `value`/label matching, scroll snap, and `aria-pressed`; SwipeableRow now handles pointer/touch gestures, up/cancel/leave, and threshold callbacks for reliable slide actions.
- 2026-06-14 — fix: Tasks leaderboard penalty add/edit flows. Added working Add/Edit modals for rewards and penalties on the Tasks leaderboard, and kept penalty select labels free of raw avatar data URLs.
- 2026-06-14 — fix: Tasks avatar data URL leakage in filters. Filter chips now use safe emoji fallbacks instead of raw member avatar data URLs.
- 2026-06-14 — fix: Tasks page avatar data URL leakage. Member select options now display a safe emoji fallback instead of raw `data:image/...` avatar strings.
- 2026-06-14 — fix: Dark glass review card contrast. Raised the `/_design-system` dark glass sample from near-black to blue-charcoal, forced light text, and verified all review-page glass surfaces are readable.
- 2026-06-14 — fix: Design-system review route. Added public `/design-system` page plus `src/middleware.ts` rewrite so `/_design-system` works despite Next treating underscore folders as private. Cleaned review-page props, stable TextField IDs, and browser-console errors.
- 2026-06-14 — feat: Warm Glass v2 design system rollout. Added Warm Glass tokens, primitives, patterns, a dev-only `/_design-system` review page, simplified 5-tab bottom navigation plus More menu, and redesigned Home, Tasks, Meals, Settings, and More. Added `apricot` and `sage` accents. Verified with `npm run typecheck`, `npm run lint` (warnings only), and `npm run build`.
- 2026-06-13 — fix: Hydration mismatch on the Meals page (the "Who's eating tonight" avatar strip). Root cause: `src/db/index.ts:210-229` hydrates `membersStore` from `localStorage` at module load. On the server, `typeof window === "undefined"` falls back to `membersData` (defaults: 🐱, 🧒, etc.), but on the client it reads localStorage and gets the user's custom avatars (often base64 data URLs like `data:image/webp;base64,UklGR...`). `src/components/meals/MealsTab.tsx:92-95` was calling `db.selectMembersDetailed()` inside a `useMemo(..., [])`, so SSR rendered `🐱` and the client first render rendered the data URL — a React hydration mismatch (`+ data:image/webp...  − 🐱`). Fix: added the established `mounted` pattern (`useState(false)` + `useEffect(() => setMounted(true), [])`) and gated both the `familyMembers` and the `tip` `useMemo`s with it. Until mount, `familyMembers` returns the default emoji list (matches what the server saw) and `tip` returns `smartTips[0]` (deterministic, no `Date.now()`). After mount, both re-pick their real values. Other pages in the app already use this pattern (`tasks/page.tsx:216`, `page.tsx:43`, `chat/page.tsx`, `settings/page.tsx`, etc.) — MealsTab was the only consumer of `db.selectMembersDetailed()` that didn't. Heads up: `tasks/page.tsx:221` and `chat/page.tsx:289` also call `db.selectMembers()` in a `useMemo([], )`, but they are wrapped in an `if (!mounted) return <Loading/>` early return at the top of the component, so the read happens after mount and they are safe.
- 2026-06-13 — fix: Literal `\u2728` (and three sibling escapes) on the Calendar page. Four spots in `src/app/calendar/page.tsx` had unicode-escape strings written as **direct JSX text children** instead of inside a JavaScript expression, so React rendered the six literal characters `\u2728` instead of the ✨ emoji. JSX text is not interpreted as a JavaScript string — only `{`...`}` template literals (or other JS expressions) decode the escape. Fixed lines 507 (`calendar-member-avatar` 👥 in the "All" chip), 607 (`calendar-panel-icon` 📅 in the panel header), 618 (`calendar-empty-icon` ✨ in the "Nothing scheduled" empty state — the one the user reported), and 698 (the 🗑️ delete button label). All four now use the `{`\uXXXX`}` template-literal pattern that the rest of the file already uses (lines 542, 769-777, 798, 808, 838). No other `\uXXXX` JSX-text leaks exist in the codebase.
- 2026-06-13 — fix: Liquid Glass 2.2 — matched Consuela card shell. Tuned `.liquid-glass` in `src/app/globals.css` to share the soft glass shell of `.atmospheric-card` (the one used by the "Ask Consuela" card on the Home page), so the Today / Tasks / Daily Schedule rows (and every other `.liquid-glass` instance) feel like part of the same family while keeping their per-row color frost. Added the `0 0 30px rgba(255,255,255,0.03)` soft outer glow that `.atmospheric-card` has. The whisper of top sheen inside the card went from `0.18` → `0.06` in dark mode (matching `.atmospheric-card`) and from `0.45` → `0.10` in light mode — no longer a visible bright line. The `::before` specular layer was reduced to a breath of light at the top (`0.06` dark / `0.12` light) and trimmed from a 3-stop gradient to a 2-stop fade. Light-mode border softened from `0.30` → `0.20`. Hover state matches the new shell: outer glow `0.05`, top sheen `0.10` (dark), no bright white line. Per-row color frosting is unchanged — events still frost mint/violet/amber/cyan/rose/nori, tasks still frost rose/amber/mint, Daily Schedule rows still use their `item.color` — so the color identity of each row is preserved.
- 2026-06-13 — fix: Liquid Glass 2.1 — minimized white edge. Reduced the visible white frame around `.liquid-glass` cards in `src/app/globals.css` while keeping the glass depth. The 1px border went from `rgba(255,255,255,0.18)` → `0.06` in dark mode and `0.85` → `0.30` in light mode (no longer a hard white outline). The inner top sheen went from `0.55` → `0.18` in dark and `0.95` → `0.45` in light (a soft gradient, not a bright white line). The `::before` specular highlight was dialed back from `0.32` → `0.14` in dark and `0.55` → `0.28` in light. Removed the `inset 0 0 0 1px` inner ring layer entirely (was the source of a faint second white frame on the inside). Hover state matches: border `0.10` (dark), top sheen `0.28` (dark). The glass effect — backdrop blur `26px saturate(1.6)`, drop shadow lift, frosting tint — is unchanged.
- 2026-06-13 — feat: Liquid Glass 2.0. Strengthened `.liquid-glass` in `src/app/globals.css` so the Today / Tasks / Daily Schedule rows (and the chat quick-actions, recipe cards, pantry items, grocery sections that share the class) actually look like glass. Added a real external drop shadow (`0 8px 24px -8px rgba(0,0,0,0.45) + 0 2px 6px -2px rgba(0,0,0,0.25)`) that lifts the card off the background — the previous version was missing it. Bumped `backdrop-filter` from `blur(20px)` to `blur(26px) saturate(1.6)` so the frost tints read more richly. Added a glossy specular highlight via a `::before` radial gradient (white at 20% 0%, fading to 0 at 60% from the top, `mix-blend-mode: screen` in dark mode). Added a subtle bottom ambient via `::after` so the card reads as a chunk of glass, not a tinted rectangle. Strengthened the inner edge: brighter top inset highlight (0.55 in dark / 0.95 in light), a 1px inner ring (`inset 0 0 0 1px rgba(255,255,255,0.04)`) for the "lip of the glass" feel, and a stronger border. Hover now lifts 4px (was 3px) with a deeper drop shadow and brighter inner highlight. Bumped the color frosting on Today rows, Tasks rows, and Daily Schedule rows from `0.32 → 0.16` to `0.40 → 0.20` so the tint sits on the glass more confidently; bumped the Daily Schedule member pill from `0.45 → 0.25` to `0.55 → 0.30` so the pill reads against the stronger glass behind it. Reduced-motion still disables the lift, and the new pseudo-element layers are pointer-events:none so they never block clicks.
- 2026-06-12 — feat: Unified Appearance control (Display Mode + Time of Day merged). The standalone "Display Mode" radio list in Settings → Theme and the separate "Time of Day" segmented control in Settings → Weather are gone. Both are replaced by a single 3-option **Appearance** segmented control in the Weather card: `🌅 Auto` (system + auto, follows the real clock), `☀️ Day` (force light + day), `🌙 Night` (force dark + night). `useWeather.tsx` now resolves `timeOfDay === 'auto'` to the real local day/night before publishing the `__consuelaTod` hint, so the weather widget and the theme read the same clock (eliminates the previous drift where the theme fell back to its own seasonal sunrise/sunset table). `setAppearanceMode` writes both `theme.mode` and `weather.timeOfDay` together. Storage keys (`home-ai-theme-config`, `home-ai-weather-config`) are unchanged, so existing user data migrates automatically: `system + auto` → Auto, `light + day` → Day, `dark + night` → Night; any other combo is normalized to Auto on first render.
- 2026-06-12 — feat: Settings page wider container. `PageShell` in `src/app/settings/page.tsx` now uses `md:max-w-3xl` (768px) on tablet/desktop so the Accent Studio 4-column grids, controls + live preview 2-column layout, season/holiday pickers, and family/emergency rows have room to breathe. Mobile (`<768px`) keeps the original 512px width.
- 2026-06-12 — feat: Accent Studio live preview integrated. Removed the inner bordered card around the live preview pane in `src/app/settings/page.tsx`. The pane now uses a soft radial accent-glow background and a thin vertical accent divider line, with the grid rebalanced to `1.1fr_1fr` and `lg:gap-10`. The 2x2 target preview grid tightened to `gap-3`. The preview now flows as a continuation of the Accent Studio widget instead of looking like a nested panel.
- 2026-06-12 — feat: Calendar schedule tab redesigned as Family Routines. Grouped items by time-of-day categories (Morning/Afternoon/Evening/Night) with gradient icon headers. Each item is now a glass routine card with color-driven icon circle, title, time in accent, type/meal badges, and S-M-T-W-T-F-S day pills lit per day scope. Added category filter pills, active counts. All CRUD preserved.
- 2026-06-12 — feat: Calendar dashboard visual refresh. Refactored `src/app/calendar/page.tsx` with a polished glass-dashboard design system using new CSS classes in `globals.css`. Added `calendar-page-shell` with dual radial gradients, `calendar-hero-card` with gradient orb, `calendar-member-chip` accent pills, `calendar-tabs` segmented control, `calendar-grid-card` with isometric treatment, `calendar-panel` glass surfaces, `calendar-event-card` with accent left bar and time column, `calendar-upcoming-card` horizontal scroll cards, `calendar-fade-in-up` staggered animation, and `scrollbar-hide` utility. Updated `PageShell` to accept an optional `style` prop. All existing functionality preserved (calendar/schedule tabs, event/schedule CRUD, Google sync, member filter).

- 2026-06-12 — feat: BottomNav button halo and rainbow ring. Updated `src/components/ui/BottomNav.tsx` so the active tab no longer uses a sliding pill; the active button now has a tight rainbow edge ring plus a soft radial halo outside the button.
- 2026-06-12 — fix: PIN login now accepts full names and first names. Updated `src/hooks/useAuth.tsx` and `src/app/page.tsx` member matching so avatar sizing fixes do not break authentication PIN lookup.
- 2026-06-12 — fix: Legacy auth names now match family members for avatar sizing. Updated `src/hooks/useAuth.tsx` and `src/app/page.tsx` so Home/auth hydration matches first-name and full-name member records before applying avatar size/glow.
- 2026-06-12 — fix: Family avatar settings now reflect on Home. Updated `src/hooks/useAuth.tsx`, `src/app/page.tsx`, and `src/app/settings/page.tsx` so logged-in Home avatars rehydrate avatar size/glow from the latest member data and auth state refreshes after Settings saves.
- 2026-06-12 — feat: Family avatar settings synced with dashboard avatars. Updated `src/components/ui/Avatar.tsx`, `src/app/settings/page.tsx`, `src/app/page.tsx`, and `src/db/index.ts` so Settings and Home share avatar size scale, glow behavior, image data URL rendering, and emoji rendering.
- 2026-06-12 — feat: Accent Studio rollout to primary actions. Updated `src/components/ui/Button.tsx` and primary/active states across Settings, Calendar, Tasks, and Meals so CTAs use `--color-accent-button` while active states use `--color-accent-selected`.
- 2026-06-12 — feat: Settings Accent Studio. Replaced the Settings accent color-picker block with a glass Accent Studio panel in `src/app/settings/page.tsx`: target pills, curated palette chips, custom color picker, live preview card, sync button + border, and reset action. Existing 8 accent presets still update selected, glow, button, and border variables.
- 2026-06-12 — feat: Chat screen glass modern redesign. Full visual rewrite of `src/app/chat/page.tsx`. Hero greeting state with 200px cinematic glowing orb + dual dotted-ring animation (20s sweep), 2×2 quick-action chips (Add Event / Plan Meals / Assign Chore / Grocery List) using Icon3D, suggested-prompts grid, floating glass-strong top bar, liquid-glass assistant bubbles with violet/lavender frosting, gradient user bubbles, glass-strong floating input bar with mic + send buttons. New `.chat-hero-orb`, `.chat-hero-ring`, `.chat-hero-enter` CSS in `globals.css`. Uses `--color-accent-violet` as default, theme-aware via CSS variables. Reduced-motion disables all hero animations. Quick tag chips above input. All localStorage + API + voice logic preserved.
- 2026-06-12 — feat: Liquid Glass cards for Today / Daily Schedule / Tasks. New `.liquid-glass` class in `globals.css` (color-tinted gradient frosting, 20px backdrop blur, squircle radius 1.25rem, bright top inner highlight, soft drop shadow, 3px hover lift). Applied to Today events (`page.tsx`), Daily Schedule items (`ScheduleDisplay.tsx`), and Tasks items (`page.tsx`). Accent bars shrunk to w-0.5 with glow. Light mode gets a brighter inner highlight.
- 2026-05-30 — feat: Atmospheric Theme Synchronization. Updated ScheduleDisplay, EmergencyButton, CalendarPage, MealsPage, TopBar, and Card to use unified `useAtmosphericTheme` hook with `colors` and `accentRgb` return values. Replaced all hardcoded `nori-500`, `rose-500` with dynamic theme colors. Added `glass` and `isometric-card` classes to surfaces. Added seasonal box-shadow (`0 0 24px ${colors.glow}`) to all interactive elements. Created ui-ux-pro-max skill doc for future reference.
- 2026-05-26 — feat: Immersive Weather Widget Visuals. Full glassmorphism backgrounds with season-specific SVG backdrops (Spring: cherry blossoms, Summer: palm/heat haze, Autumn: oak/fog, Winter: aurora/icicles) and holiday overlays (Christmas: fairy lights, Halloween: bats, 4th of July: fireworks, Valentine's: hearts, New Year's: gold sparkles). Added Holiday/Event Theme selector in Settings with live preview. Fixed CSS reduce-motion query to include all particle animations.
- 2026-05-26 — feat: enhance weather widget with summer/winter particle effects. Added summer (heat waves) and winter (ice crystals) particle effects to weather widget. Updated AGENTS.md to document the change.
- 2026-05-23 — Initial comprehensive operational manual created per quiet-wizard plan. Added full UI navigation (including motion refresh), meal & emergency workflows, agent role definition, SOP template + examples, and appendix of all existing design docs. Preserved original recipe/memory-bank guidance at the bottom.

---

**End of Agent Operational Manual**

Remember: This file + the 2–3 linked deep docs it points to are sufficient for you to give perfect, up-to-date, safe instructions to any user of the Consuela dashboard. When in doubt, re-read this file first.

### Change Log (continued)

- 2026-06-17 — fix(ui): Schedule time picker hour resetting to 12. `src/app/calendar/page.tsx` — switched from controlled `value` + `onFocus/onBlur` to `defaultValue` + `key` (re-mounts on edit switch) + `type="number"` with proper mobile keyboard. Empty value falls back to current time from state instead of "12". Also removed `onBlur` clamping logic (caused the "resets to 12" bug). TS / lint clean.
- 2026-06-17 — feat(infra): Hermes admin tools for dashboard self-management. Added 5 new tools to `src/lib/hermes-tools.ts`: `check_for_update`, `trigger_update`, `get_container_status`, `restart_container`, `check_pocketbase`. Each tool calls the corresponding `/api/admin/*` endpoint via internal HTTP (using `NEXT_PUBLIC_APP_URL`). Created `src/app/api/admin/containers/route.ts` (GET — lists Docker containers consuela-dashboard, pocketbase, hermes-agent-2) and `src/app/api/admin/restart/route.ts` (POST — restarts a named container from an allow-list). Updated `src/app/api/hermes/chat/route.ts` system prompts to inform Consuela of her new admin tools and the confirmation-before-action rule. Added `NEXT_PUBLIC_APP_URL` to `.env.docker` and `docker-compose.yml`. AGENTS.md §5 added with full admin capabilities documentation (what Consuela can/can't do). TS / lint clean.
- 2026-06-18 — feat(db): Full PocketBase migration (all 8 phases). PB is now the primary data source; localStorage is cache/fallback. New collections: `schedules`, `auth_sessions`, `tasks`, `week_data`, `week_archive`, `rewards`, `penalties`, `family_goals`, `hall_of_fame`, `recipes` (all seeded in `pb-seed.ts`). CRUD methods added to `pb-db.ts` for each collection. `db/index.ts` updated with member cache refresh (Phase 2), `CacheRefresher.tsx` global component for 60s/visibility-change PB polling (Phases 3+8). `useGrocery.ts`/`usePantry.ts` flipped to PB-first init (Phase 4). `useMeals.ts`/`useRecipes.ts` wired to PB writes (Phase 5). `task-utils.ts` gains 9 PB sync functions; tasks page syncs structured data every 5s (Phase 6). `useAuth.tsx` persists sessions to PB with boot restore (Phase 7). `selectRecipes`/`upsertRecipe`/`deleteRecipe`/`upsertTask`/`upsertWeekData`/`upsertReward`/`upsertPenalty`/`upsertFamilyGoal`/`insertHallOfFameEntry` pass-through methods added to `db/index.ts`. `tsc --noEmit` clean, `eslint` clean (0 errors), `npm run build` clean.

