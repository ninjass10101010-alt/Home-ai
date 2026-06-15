# Consuela Dashboard — Agent Operational Manual

> **For the AI Coding Agent (Kilo) only.**  
> This is your single source of truth when a user asks how to **use**, **configure**, **troubleshoot**, or **extend** the live Consuela family dashboard.  
> Always start here before answering operational questions. Cross-reference the linked deep docs.  
> **Mandatory:** After any code change that touches UI, navigation, meals, emergency, or integrations, update this file in the same session.

**Current Dashboard Snapshot** (maintain on every relevant change)  
- **Last Updated:** 2026-06-15 | Home logout + session timer surfaced + spacing rhythm — visible sign-out icon button with confirm modal in Home header, 30-min auto-logout now shows an `mm:ss` idle pill in the header and a "tap to stay" toast in the last 30s, Home card rhythm standardized (stat tiles gap-3, family strip gap-3, section card stack space-y-6, action row gap-3, header pb-6, greeting mt-6)
- **Last major UI refresh:** 2026-06-15 — Tasks & Leaderboard v2: week-scoped points system with automatic Monday resets, real consecutive-day streak tracking, full transaction history log, undo completion with PIN verification, recurring task auto-regeneration, parental approval gate for large rewards (>100pts), confetti animation on task completion, level-based progression with progress bars, achievement badges, animated champion crown, and Home page task sync from shared localStorage.
- **Active integrations:** Meals ↔ Pantry ↔ Grocery bidirectional sync (`mealSyncService`), Emergency SMS + Email (free Gmail + carrier gateways), AI Chat ("Ask Consuela"), full theme system (3 modes + **10 accent colors** + high-contrast)
- **IMPORTANT BUILD NOTE:** After every `npm run build`, the CSS chunks can go out of sync (Next.js 16.2.6 bug). If the dashboard loads with broken layout (big icons, wrong nav styles), **restart the container**: `docker restart consuela-dashboard`. This is faster than a rebuild.
- **IMPORTANT BUILD NOTE:** After every `npm run build`, the CSS chunks can go out of sync (Next.js 16.2.6 Turbopack bug). If the dashboard loads with broken layout (big icons, wrong nav styles), **restart the container**: `docker restart consuela-dashboard`. This is faster than a rebuild.
- **Navigation model:** Persistent bottom tab bar (Home, Ask Consuela, Calendar, Meals, Tasks) + More menu for Grocery, Emergency, Settings, plus always-visible floating red Emergency shield button on Home
- **Tech surface for ops:** Next.js 16 + React 19 + Tailwind CSS 4, in-memory database (`src/db/index.ts`), API routes under `src/app/api/`, custom SVG animations (no framer-motion)
- **PocketBase migration:** Planned but not started. See `DESIGN_SPECIFICATION.md` §6 for the full migration plan.

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

- 2026-06-15 — feat(infra): PocketBase migration scaffolding landed. Replaced the openclaw proxy with a real PocketBase container on :8090 with a `pb_data` volume, dropped `NEXT_PUBLIC_OPENCLAW_BRIDGE_URL` from the Dockerfile, added a standalone `Dockerfile.deploy`, and introduced `src/lib/pb.ts` (singleton client), `src/lib/pb-auth.ts` (cached superuser auth, 1h TTL), `src/lib/pb-seed.ts` + `scripts/pb-seed.mjs` (idempotent collection bootstrap for members / meal_plan_entries / recipes / grocery_items / pantry_items / schedule_items / task_transactions), and `src/db/pb-db.ts` (safe read-through with in-memory fallback). The in-memory db is untouched; consumers continue to read from `src/db/index.ts` until individual modules are ported.
- 2026-06-15 — feat(tasks): leaderboard world-building landed as two commits — a toolkit commit (types, utils, podium/your-card/row/member-sheet/level-up-modal/share-card/daily-quest/streak-saver/catch-up-nudge/treasure-path/family-goal/achievement-wall/hall-of-fame/trophy-case + `useLeaderboardData` hook) and a Tasks page rewrite that wires the toolkit into Pending / Completed / Leaderboard / Rewards / Penalties tabs with confetti completion animation, parental approval gate, animated champion crown, and Home sync. The auth context now exposes `sessionRemainingMs`, `sessionWarning`, and `extendSession()` so the Home header can show a tappable inactivity countdown. `SwipeableRow` dedupes pointer/touch events so Cancel no longer reopens the PIN modal. `SectionCard` gained an `action` prop. `ProgressRing` clamp/format polished.
- 2026-06-15 — feat(meals): planner reliability + motion removal. `RecipeModal` targets meal vs catalog via a `mode` prop; `MealsTab` adds a collapsed `RecipeCatalogStrip` with one-tap slot insertion; `usePantry` writes to the DB and exposes a 'Grocery items waiting to be restocked' panel (delete is two-tap, no modal); `useGrocery` accepts `plannedMeals` so sync reflects the actual plan and includes units on quantities; manual add supports qty/notes + Auto category + duplicate handling; `useRecipes` normalizes and dedupes on save; `Meal` interface gains `mealType` / `protein` / `carbs` / `fat` / `instructions`. All planner tabs (Meals / Grocery / Pantry / Recipes) had float/bob/scale/translate animations removed.
- 2026-06-15 — feat(ui): layout, chat, and design-system polish. Wrapped the app in `LayoutProvider` so the Settings Layout & display card can read the home widget config anywhere. Theme init script is now a plain inline `<script>` (the previous `next/script strategy="beforeInteractive"` was a no-op in the app router). Added kid-friendly CSS animations for the leaderboard world: confetti-fall, crown-glow, badge-sparkle, rank-pulse, progress-fill, level-up-pop, podium-shine, rank-arrow-bounce, widget-row-glow, number-roll, session-pill-warning — all with prefers-reduced-motion overrides. `_design-system` DayStrip demo no longer drops its click handler.
- 2026-06-15 — fix: Layout & display reorder broken. Settings → Layout & display now reflects the user's saved order (was iterating the static `ALL_WIDGETS` master list), the ↑/↓ disabled state is computed from the user's position (was using the static index), and hidden widgets have their reorder controls disabled. Added Visible / Hidden grouping, a ⋮⋮ native drag-and-drop handle, toast feedback on every action, debounced (250ms) localStorage persistence with `pagehide` flush, suppressed rehydration while on `/settings`, and `loadLayoutConfig` validation that drops unknown ids and self-heals missing defaults. Weather is no longer pinned to the top of the Home page — it now respects the user's chosen position via a regular switch case. The duplicate "Reset layout" button was removed from Data & sync. `src/lib/layout-config.ts` gained `moveWidgetTo`, `getVisibleWidgets`, `getHiddenWidgets`. `src/hooks/useHomeLayout.tsx` gained `reorder`, `visibleWidgets`, `hiddenWidgets`, `setSuppressRehydrate`. Help modal copy updated to match the new contract.
- 2026-06-15 — feat: Home logout button + inactivity countdown surfaced + spacing rhythm. Replaced the hidden `onDoubleClick={logout}` avatar gesture with a visible `IconButton` (door + arrow, glass, sm) in the top-right Home header that opens a confirm `Modal` ("Sign out of {name}?"). Tapping the avatar itself now opens the PIN flow to switch profile. `useAuth` now exposes `sessionRemainingMs`, `sessionWarning`, and `extendSession()`; the Home header shows a small `⏳ mm:ss` pill after 60s of idle, amber-pulsing in the last 30s with a tappable "tap to stay" `Toast`. Home spacing standardized: stat-tile row `gap-2→gap-3`, family strip `gap-2→gap-3`, section card stack `space-y-5→space-y-6`, action row `gap-2→gap-3`, header `pb-5→pb-6`, greeting `mt-5→mt-6`. New `.session-pill-warning` keyframe in `globals.css` (reduced-motion safe). No new dependencies. *(Split across the leaderboard toolkit + Tasks rewrite commits above on 2026-06-15.)*
- 2026-06-15 — feat: Tasks & Leaderboard v2. Major refactor delivering week-scoped points, real consecutive-day streak tracking, transaction history log, undo completion with PIN, recurring task auto-regeneration at week start, parental approval gate for large rewards (>100pts), confetti completion animation, level-based progression with progress bars, achievement badges, animated champion crown, and Home page task sync. New files: `src/types/tasks.ts`, `src/lib/task-utils.ts`. Updated: `src/app/tasks/page.tsx`, `src/app/page.tsx`, `src/app/globals.css`. Fixed 23 logic issues (critical, contradictions, missing, edge cases). *(Now actually landed on `warm-glass-v2` as the two `feat(tasks):` commits above.)*
- 2026-06-15 — fix: Meal/recipe/grocery/pantry reliability + planner motion removal. *(Landed on `warm-glass-v2` as the `feat(meals):` commit above.)* `RecipeModal` now targets either meal or catalog via `mode` prop (was always saving as meal, corrupting meal state when editing catalog recipes). Recipes added from the modal go to the catalog only — assign to a slot later from Meals or Recipes tab. `MealsTab` gets a collapsed `RecipeCatalogStrip` above the day strip so users can browse the catalog while planning, with "Add to {activeDay} as {next empty slot}" one-tap insertion. `usePantry` now writes to the real DB (adds `db.deletePantryItem` to `src/db/index.ts` + `src/db/pb-db.ts`), merges DB + localStorage on load, and accepts `groceryItems` to power a "Grocery items waiting to be restocked" panel with one-tap "Add to pantry". Pantry delete is two-tap with a 3s confirmation window (no modal). `useGrocery` accepts `plannedMeals` from `useMeals` so `mealSyncService.syncMealPlanToGrocery` reflects what the user actually planned (was reading stale `db.selectMeals()`), and sync quantities now include units (`"1 cup"`, `"1 lb"`, etc.). Manual grocery add supports qty/notes inputs, "✨ Auto category" option, and friendly duplicate handling ("already on your list" toast + keep existing row). `useRecipes` normalizes tags/ingredients on save and dedupes by id then name. `GroceryTab`, `PantryTab`, `RecipesTab`, and `MealsTab` had all float/bob/scale/translate animations removed (color transitions, focus rings, and progress bars remain). `src/services/types.ts` `Meal` interface updated with `mealType`, `protein`, `carbs`, `fat`, `instructions`. `emptyRecipe` in `src/data/meals.ts` now includes `mealType`.

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
