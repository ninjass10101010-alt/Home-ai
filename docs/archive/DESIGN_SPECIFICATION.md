# Consuela Dashboard — Design Specification

**Status:** Authoritative — Supersedes all design package documents
**Last Updated:** 2026-05-23
**Tech Stack:** Next.js 16 · React 19 · Tailwind CSS 4 · TypeScript
**Single Source of Truth:** This file + `src/` source code override all previous design docs

---

## §1 Design Philosophy

The Consuela dashboard embodies **Apple-like clarity** built on glass morphism and motion:

- **Clarity** — Minimal, intuitive interfaces that surface information without clutter
- **Depth** — Layered translucent surfaces create visual hierarchy (glass: 20px blur, tiered opacity)
- **Motion** — Smooth, purposeful CSS keyframe animations and Tailwind transitions provide feedback without distraction
- **Accessibility** — Dark/light modes, high-contrast toggle, WCAG AA contrast ratios, keyboard navigation, `prefers-reduced-motion` support
- **Consistency** — Unified design system across all pages through CSS custom properties

**Every color must use a CSS custom property.** No hardcoded hex values in components.

```
/* Correct */
background-color: var(--color-surface-0);
color: var(--color-accent-nori);

/* Incorrect */
background-color: #0f1117;
color: #3b82f6;
```

---

## §2 Animation Protocol

### 2.1 Canon: CSS Keyframes + Tailwind Transitions

The entire application uses **one animation framework**: **CSS keyframes** (for continuous/repeating motion) combined over **Tailwind transition utilities** (for state transitions). No JavaScript animation libraries are permitted.

| Layer | Mechanism | Use When |
|-------|-----------|----------|
| **CSS Keyframes** (`@keyframes`) | Continuous/repeating motion, multi-step sequences | `.floating` icon loop, gradient orb float, emoji keyframes, theme-toggle rotate |
| **Tailwind Transitions** | Hover/active/ctx state transitions | Button press, card hover, color fade, theme change |

**Why this framework:**
- Zero JS overhead — GPU compositor thread only
- Zero additional bundle cost — keyframes already in `globals.css`; Tailwind transitions compile to standard CSS
- Native `prefers-reduced-motion` support via media query — no JS detection
- Fully compatible with CSS custom properties and `data-theme` / `data-contrast` attribute switching

### 2.2 Animation Timing Tokens

All durations and easings use these canonical tokens. Never use ad-hoc values.

```
FAST (0.15s)         STANDARD (0.3s)          SLOW (0.5s)
├─ Button press       ├─ Card hover            ├─ Theme toggle
├─ Icon state change  ├─ Color fade            ├─ Page entry
├─ Checkbox toggle    ├─ Dropdown open         └─ Large element move
└─ Simple fade        └─ Element scale         Easing (all layers):
                                               cubic-bezier(0.4, 0, 0.2, 1)
                                                [Material Design Standard]
```

| Animation | Layer | Duration | Easing |
|-----------|-------|---------|--------|
| `.floating` (icon loop) | CSS keyframe | 6s infinite | ease-in-out |
| Gradient orb float | CSS keyframe | 20s staggered | ease-in-out |
| Isometric card hover | Tailwind | 0.3s | cubic-bezier(0.4, 0, 0.2, 1) |
| Button hover | Tailwind | 0.2s | cubic-bezier(0.4, 0, 0.2, 1) |
| Button active | Tailwind | 0.1s | cubic-bezier(0.4, 0, 0.2, 1) |
| Theme toggle rotate | CSS keyframe | 0.5s | cubic-bezier(0.4, 0, 0.2, 1) |
| Color transition | Tailwind | 0.3s | cubic-bezier(0.4, 0, 0.2, 1) |
| Checkbox strikethrough | Tailwind | 0.3s | ease-out |
| Frenchie ear wiggle | CSS keyframe | 2.4s | ease-in-out |
| Poodle bounce + tail wag | CSS keyframe | 3.0s | ease-in-out |
| Fish swim + tail flip | CSS keyframe | 2.0s | ease-in-out |
| Soccer ball roll | CSS keyframe | 1.5s | ease-in-out |
| Plate & utensils clink | CSS keyframe | 1.8s | ease-in-out |

### 2.3 Accessibility (Reduced Motion)

```css
/* Globally disable all animation when user has enabled reduced motion */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
  }
}
```

### 2.4 Animation State Machine

```
.floating
  └─ Applied to any <div className="... floating"> wrapper
  └─ Keyframe: translateY 0 → -12px → 0 over 6s ease-in-out infinite
  └─ Used for: Icon3D instances on Home quick actions, AnimatedEmoji in meal cards

.isometric-card
  └─ Applied via class for card hover interactions
  └─ Transition: scale(1) → scale(1.02) over 0.3s, cubic-bezier(0.4, 0, 0.2, 1)
  └─ border-color: accent/8% → accent/20%, box-shadow grows

.gradient-orb
  └─ Decorative animated background blobs
  └─ Keyframe: float 20s ease-in-out infinite; staggered 0s/2s/4s/6s delays
  └─ Opacity pulse: 0.3 → 0.5 → 0.3
  └─ z-index: -10; behind all content

Themify:0.4, 0, 0.2, 1); "transform: scale(0.95)" → scale 1.0) ease-out 0.4s cubic-bezier(0.4, 0, 0.2, 1)
```

---

## §3 Color System

### 3.1 Dark Mode Palette

```
SURFACES (8 depths, 0 = base → 7 = deepest)
--color-surface-0: #0f1117    ← Main background
--color-surface-1: #181c24
--color-surface-2: #1e2330
--color-surface-3: #252c3a
--color-surface-4: #2d3548
--color-surface-5: #323b4d
--color-surface-6: #3a4456
--color-surface-7: #434e60    ← Deepest for depth

TEXT
--color-text-primary:   #f0f4ff    ← Main body text
--color-text-secondary: #8892aa    ← Labels, captions
--color-text-muted:     #4e5a72    ← Disabled / placeholder
--color-text-dim:       #363e50    ← Very faint text
```

### 3.2 Light Mode Palette

```
SURFACES (8 depths, 0 = base → 7 = darkest)
--color-surface-0: #ffffff    ← Main background
--color-surface-1: #f8f9fb
--color-surface-2: #f0f2f7
--color-surface-3: #e7ebf3
--color-surface-4: #dde3ed
--color-surface-5: #d3dae7
--color-surface-6: #c9d1e0
--color-surface-7: #bfc6d8    ← Deepest for depth

TEXT
--color-text-primary:   #1a1a1a    ← Main body text
--color-text-secondary: #5a5a5a    ← Labels, captions
--color-text-muted:     #8a8a8a    ← Disabled / placeholder
--color-text-dim:       #ababab    ← Very faint text
```

### 3.3 Accent Colors (6 Options × 2 Themes)

```
ACCENT (dark mode / light mode)
--color-accent-nori:    #3b82f6 / #2563eb  ← Default, primary brand (trust)
--color-accent-violet:  #7c6ff7 / #7c3aed  ← Premium, special features
--color-accent-rose:    #f43f5e / #e11d48  ← Urgent, alerts, emergencies
--color-accent-cyan:    #06b6d4 / #0891b2  ← Information, secondary
--color-accent-mint:    #4ade80 / #059669  ← Success, confirmations
--color-accent-amber:   #f59e0b / #d97706  ← Warnings, pending
```

### 3.4 High Contrast Mode

Activated by `data-contrast="boost"` on `<html>` (set by `useTheme.tsx` when `contrastBoost === true`):

```
--color-text-primary:   #000000 or #ffffff  (pure black/white — 21:1)
--color-text-secondary: #2d2d2d or #666666
--all-borders:           2px (up from 1px)
--opacity-floor:         70% (no element below 70% opacity)
```

### 3.5 CSS Variable Naming Convention

```css
--color-{category}-{shade}

/* Examples */
--color-surface-0              /* Background depth layer 0 */
--color-text-primary           /* Primary body text */
--color-accent-mint            /* Mint accent color (default dark variant) */
```

Light-mode accent dyes apply the same `--color-accent-{name}` variable name — different value is set via `[data-theme="light"]` override:

```css
[data-theme="light"] {
  --color-accent-nori: #2563eb;   /* Darker variant for light mode contrast */
  --color-accent-mint: #059669;
  /* ... */
}
```

---

## §4 Component Design System

### 4.1 Glass Morphism (3 Variants)

All variants use `background-color: var(--color-surface-N)` with `backdrop-filter: blur(20px)`.

```
STANDARD (.glass)              STRONG (.glass-strong)        SUBTLE (.glass-subtle)
Background:   50% opacity       Background:   75% opacity     Background:   35% opacity
Blur:         20px              Blur:         20px             Blur:         12px
Border:       1px 8% white      Border:       1px 30% white     Border:       1px 5% white
Shadow:       0 8px 32px        Shadow:       0 8px 32px        Shadow:       0 4px 16px
Padding:      1rem              Padding:      1rem              Padding:      0.75rem
Radius:       1.5rem            Radius:       1.5rem            Radius:       1.5rem

Used for: Cards, sections      Used for: Buttons, modals,    Used for: Badges,
                                 TopBar, interactive cards     pills, subtle backgrounds
```

Hover state (standard + strong):
```
border-color-opacity:  8% → 20%
box-shadow:            increase (additive 4px)
scale:                 1.02
transition:            0.3s cubic-bezier(0.4, 0, 0.2, 1)
```

### 4.2 Button Component (5 Variants × 5 States)

**Sizes:**
```
xs:   32px height, 0.75rem padding, 0.875rem text
sm:   36px height, 0.875rem padding, 0.875rem text
md:   40px height, 1rem padding,   1rem text    (default)
lg:   48px height, 1.25rem padding, 1.125rem text
icon: 40×40px square, centered icon
```

**Variants:**

| Variant | Background | Text | Border | Use Case |
|---------|-----------|------|--------|---------|
| **Primary** | `.glass-strong` + accent | white | none | CTAs, main buttons |
| **Secondary** | Transparent | accent | 1px accent | Secondary actions |
| **Ghost** | Transparent | text-primary | none | Theme toggle, tertiary |
| **Danger** | `.glass-strong` + rose | white | none | Emergency, destructive |
| **Success** | `.glass-strong` + mint | white | none | Confirmations |

**States:** Default → Hover (scale 1.05, shadow +8px, 0.2s) → Active (scale 0.98, opacity +20%, 0.1s) → Disabled (opacity 50%, cursor not-allowed, no transition)

### 4.3 BottomNav Component

**8 items (per AGENTS.md §1.1 — reflects built UI):**

| Label | Route | Notes |
|-------|-------|-------|
| Home | `/` | Dashboard with weather, events, quick AI, meals preview |
| Ask Consuela | `/chat` | Speech bubble icon, primary (filled active) |
| Calendar | `/calendar` | Calendar grid |
| Meals | `/meals` | Pot/plate icon, weekly planner |
| Tasks | `/tasks` | Checklist icon, chore list with points |
| Grocery | `/grocery` | Shopping cart icon, smart list |
| Emergency | `/emergency` | Shield icon — non-critical reference page only |
| Settings | `/settings` | Gear icon — theme/family/emergency config |

Layout: Fixed bottom bar, glass-strong background, 20px blur. Safe-area aware. Active item = accent color + heavier stroke weight. Transition 0.2s ease.

### 4.4 Typography Scale

```
H1 (Page title):    32px, Bold (700), letter-spacing 0
H2 (Section head):  24px, Semibold (600), letter-spacing -0.5px
H3 (Subsection):    20px, Semibold (600)
Body headline:      16px, Semibold (600)
Body text:          14px, Regular (400)
Caption label:      12px, Medium (500)
Tiny helper:        11px, Regular (400)

Font:  Geist Sans (primary), Geist Mono (code)
Line height:  1.5 (body), 1.2 (headings)
```

---

## §5 Page Designs

### 5.1 Home (`/`)

Sections top-to-bottom:
1. **Family avatars row** — 40px circular avatars with emoji/initials, member-accent colors, max 4 visible
2. **Date pill** — "Mon, May 20", subtle pill with border, real-time
3. **Greeting + weather** — "Good morning/afternoon/evening, {Family}!", current time, temp/condition widget
4. **Meal plan card** — Mon–Fri strip, today's meal highlighted with accent glow, emoji + name
5. **Today's events** — Left border color = member's accent, red badge if urgent
6. **Pending tasks** — Sorted by points, left border = priority color, strikethrough on complete
7. **Gradient orb background** — 4 animated orbs, z-index -10, staggered pulse

### 5.2 Calendar (`/calendar`)

Portrait month view. Event dots on days with items. Tap day for detail. Swipe left/right to change month. Color-coded by member accent. "Today" jump button.

### 5.3 Chat (`/chat`)

Conversational interface. User bubbles (right, accent bg, white text), assistant bubbles (left, surface-2 bg, text-primary). Input area at bottom. Typing indicator animation. Message timestamps. Quick action chips above input.

### 5.4 Emergency (`/emergency`)

Non-critical quick-reference page. Contact list with phone/email. Status indicator. The serious alerts fire from the floating red shield button on Home, not from this page.

### 5.5 Grocery (`/grocery`)

Checklist grouped by category (Produce, Dairy, Pantry, etc.). Expandable sections with headers. Tap to check off. Swipe to delete/edit quantity. Manual override toggle prevents auto-sync from overwriting. Sort/filter options. Share list button.

### 5.6 Meals (`/meals`)

Weekly meal plan grid (7-day horizontal strip). Drag & drop to rearrange. Tap meal to view recipe/ingredients. "+" add custom meal. "Sync Pantry & Grocery" button (or per-item sync). Nutrition info summary. Dietary restriction filters.

### 5.7 Settings (`/settings`)

Profile section (avatar, name, email, edit/sign out).
**Theme & Appearance** (primary section):
- Display Mode — 3 radio options (Light / System / Dark)
- Accent Color — 6 swatches (40×40px, 12px gap)
- Preview card — live real-time preview of current selection
- High Contrast toggle — switch, draggable 44×24px
Notifications, Calendar & Integrations, About sections below.

### 5.8 Tasks (`/tasks`)

Kanban columns: To Do · In Progress · Done. Priority left-border color. Drag & drop between columns. Tap to edit. Assign to family member. Due date. Recurring task support. Points badge.

---

## §6 Backend Architecture

### 6.1 Comparative Analysis

Five approaches evaluated:

| Approach | Score | Strengths | Weaknesses |
|----------|------:|-----------|-----------|
| **Client-First (localStorage)** | 8/40 | Cheap, zero-server | No persistence, no SMS, no sync, no auth |
| **Next.js Server-Rendered (current)** | 22/40 | Working frontend, correct stack | In-memory DB resets, no real-time, no auth, drizzle-orphaned |
| **Next.js + PocketBase** ⭐ | **34/40** | Auth + real-time + file storage + auto-API, self-host, TS SDK | One-time migration effort |
| **Pure SPA + PocketBase API** | 27/40 | PocketBase features | Loses Next.js SSR, image optimization |
| **Next.js + Supabase** | 30/40 | Managed, real-time | Lock-in, pricing scale, not self-host-first |

**Score criteria (40 pts total):** Feature Density 10 + UI/UX 10 + DB Compatibility 10 + (10 - Complexity).

**Winner: Next.js + PocketBase** — highest combined score, self-hostable (matches family-server deployment pattern), embedded TypeScript SDK requires no graph API buildout, real-time subscriptions directly power `mealSyncService` without polling.

### 6.2 Recommended Architecture

```
                    NEXT.JS 16 + POCKETBASE
                    ────────────────────────
  Frontend           API Layer           Backend
  ─────────          ────────            ───────
  ┌──────────┐      ┌──────────┐      ┌─────────────────────┐
  │ Next.js  │◄─────│ pocket   │      │  PocketBase          │
  │ App      │      │ base SDK │      │  (collections)       │
  │ Router   │      │ (TypeScript)     │                     │
  └──────────┘      └──────────┘      │  members             │
  React 19             │               │  meal_plan_entries   │
  Tailwind CSS         │               │  pantry_items        │
  globals.css          │               │  grocery_list_items  │
  useTheme.tsx         WS push ───────►│  emergency_contacts  │
                       Real-time        │  purchase_history    │
                       Auth flow        │  recipes             │
                       ─────────         └─────────────────────┘
                       (standardized)
```

PocketBase replaces:
- `src/db/index.ts` (in-memory seed) → collection initialization / server-init hook
- `src/db/migrate.ts`, `scripts/run_migrations.js` → PocketBase native auto-migration
- Hardcoded `emergencyContactsData` / `membersData` / `eventsData` → PocketBase collections
- `drizzle-orm` query builder → `pocketbase` npm SDK

### 6.3 PocketBase Schema (7 Collections)

Auth managed by PocketBase natively — no custom auth middleware required.

```
COLLECTIONS (PocketBase)
──────────────────────────────────────────────────

members/
  id              string (auto)
  name            string  (required)
  emoji           string
  color           string
  role            enum (parent / child)
  age             number
  joined          date
  created         date
  updated         date

meal_plan_entries/
  id              string (auto)
  day_of_week     enum (Mon / Tue / Wed / Thu / Fri / Sat / Sun)
  meal_name       string  (required)
  emoji           string
  prep_minutes    number
  servings        number
  calories        number
  macros          { protein, carbs, fat }  [JSON field]
  tags            string[]
  instructions    text
  autoGenerated   bool   (default false)
  lastSyncedAt    date
  memberId        string (FK → members)

pantry_items/
  id              string (auto)
  name            string  (required)
  quantity        number
  unit            string
  location        string  (fridge / pantry-shelf{1-3})
  purchaseDate    date
  pricePaid       number
  expirationDate  date
  embeddingVector number[]  [AI phase — OpenAI, optional]
  predictedExpiration date [ML phase — optional]

grocery_list_items/
  id              string (auto)
  name            string  (required)
  quantityNeeded  number
  aisle           string
  priority        enum (low / medium / high)
  checked         bool   (default false)
  manualOverride  bool   (default false)
  source          enum (meal-plan / pantry-low / manual)
  addedFromMealPlanId string
  addedAt         date
  suggestedStore  string

purchase_history/
  id              string (auto)
  ingredientName  string  (required)
  quantity        number
  unit            string
  pricePaid       number
  store           string
  purchaseDate    date
  displayPriority number

emergency_contacts/
  id              string (auto)
  name            string  (required)
  phone           string  (required, E.164 format)
  email           string  (required)
  relationship    string
  isPrimary       bool   (default false)
  [EMPTY at migration — per user decision]

events/
  id              string (auto)
  title           string  (required)
  date            date    (required)
  time            string
  assignedTo      string  (FK → members.id)
  color           string
  urgent          bool   (default false)
```

### 6.4 Migration Steps — drizzle-orm → PocketBase

```
Phase 1 — Provision
  1. Download PocketBase binary; pb init; start on port 8090
  2. Create 7 collections (members, meal_plan_entries, pantry_items,
     grocery_list_items, purchase_history, emergency_contacts, events)
  3. Sets admin account credentials for service-account API routes

Phase 2 — SDK Layer
  4. npm install pocketbase @types/pocketbase
  5. src/lib/pb.ts       → PocketBase client singleton
  6. src/lib/pb-auth.ts  → ensureAuth / admin auth helper
  7. Remove src/db/index.ts (in-memory seed replaced by PB)
  8. Remove src/db/migrate.ts + scripts/run_migrations.js
  9. Remove drizzle-orm + drizzle-kit from package.json

Phase 3 — API Routes
  10. src/app/api/emergency/route.ts → pb.collection('emergency_contacts')
      .getFullList() using admin auth
  11. Members/events endpoints → pb queries
  12. Test: curl -X POST http://localhost:3000/api/emergency confirms
      empty contact list returns proper 500 error (as implemented)

Phase 4 — Meal Sync
  13. src/lib/mealSync.ts → pb.collection('X').subscribe('*', cb)
  14. Real-time replaces polling; deduplication via lastSyncedAt

Phase 5 — Docs
  15. DESIGN_SPECIFICATION.md (§3-§6 finalized per this document)
  16. MEAL_SYSTEM_ARCHITECTURE.md → PocketBase references corrected
  17. EMERGENCY_SETUP.md / TEST_EMERGENCY.md → npm run dev
  18. AGENTS.md §1.4 → PocketBase §Active Integrations
```

**Rollback at any phase:** `pb export` → `pb import` restores collections. Drizzle schema in git history. Archived files in `docs/archive/`.

### 6.5 SDK Integration Patterns

| Pattern | Use Case | Code Shape |
|---------|---------|------------|
| `pb.authStore` | Session init | Set in layout/ThemeProvider on mount |
| `pb.admins.authWithPassword()` | Admin routes | `src/lib/pb-auth.ts ensureAuth()` |
| `pb.collection('X').getFullList()` | List page | Replaces `db.select().from()` |
| `pb.collection('X').getOne(id)` | Detail | Replaces drizzle joins |
| `pb.collection('X').subscribe('*', cb)` | Real-time sync | Meal sync, pantry live updates |
| `pb.collection('X').create(data)` | POST create | Add meal, grocery item, member |
| `pb.collection('X').update(id, data)` | PATCH | Update meal, checkbox toggle |

---

## §7 Accessibility Requirements

### 7.1 Color Contrast (WCAG AA Minimums)

| Element | Dark Mode | Light Mode |
|---------|-----------|------------|
| Body text on background | 15:1 | 18:1 |
| Secondary text on background | 8:1 | 8:1 |
| Interactive element border | 3:1 min | 3:1 min |
| Focus outline | 2px solid accent | 2px solid accent |

### 7.2 Focus States

```css
:focus-visible {
  outline: 2px solid var(--color-accent-selected);
  outline-offset: 2px;
}
```

Every interactive element: `<button>`, `<a>`, `<input type="radio">`, color swatch, toggle.

### 7.3 High Contrast Mode

`html[data-contrast="boost"]` activates:
- All borders: 2px (up from 1px)
- All text: pure black (#000) / pure white (#fff)
- Opacity floor: 70%

### 7.4 Semantic HTML

- `<button>` for all clickable elements — never `<div>` with `onClick`
- `<input type="radio">` with `<label>` for theme mode selector
- Associated `<label>` with `htmlFor` on form controls
- `<fieldset>` + `<legend>` for grouped radio options

### 7.5 ARIA Attributes

| Role | Required Attributes |
|------|-------------------|
| Icon-only button | `aria-label` |
| Toggle button | `role="switch"`, `aria-checked` |
| Color swatch | `role="button"`, `aria-pressed`, `aria-label` |
| Emergency floating shield | `aria-label`, role-alert accessible |
| Real-time updates | `aria-live="polite"` on live regions |

---

## §8 Responsive Design

```
MOBILE         TABLET           DESKTOP
< 640px        640-1024px       > 1024px
─────────      ─────────        ────────
Single col.     2 columns        2-3 columns
Full-width      Flexible          Dense info
Stacked UI      Centered          Max-width 1200px


Safe area:      env(safe-area-   env(safe-area-
Notch-aware     inset-*)          inset-*)
Touch ≥44×44    Touch ≥44×44     Touch ≥44×44
```

Grid layout across breakpoints:
- Settings page color swatches: 2 rows × 3 (mobile) → 1 row × 6 (tablet/desktop)
- Settings columns: 1 column → 2 columns → 3 columns
- Cards: full-width (mobile) → side-by-side (tablet/desktop)

---

## §9 Implementation Checklist

**Phase 1 — Theme Infrastructure** ✅ DONE
- [x] `src/hooks/useTheme.tsx` — React Context, localStorage persistence, `matchMedia` system detection
- [x] `src/lib/theme-config.ts` — `ThemeMode`, `AccentColor` types, `THEME_STORAGE_KEY`, `defaultThemeConfig`
- [x] `src/app/layout.tsx` — `ThemeProvider` wrapper, inline anti-FOUC script

**Phase 2 — Core Components**
- [x] `src/components/ui/ThemeToggle.tsx` — Sun/moon sunburst SVG, 180° rotation
- [ ] `src/components/ui/Card.tsx` — 3 glass variants documented here (check implementation matches spec)
- [ ] `src/components/ui/Button.tsx` — 5 variants × 5 states (verify exact dimensions and transition tokens)
- [ ] `src/components/ui/Badge.tsx` — default/accent/outline/status variants
- [ ] `src/components/3d/Icon3D.tsx` — 8 variants with gradients + animated prop
- [ ] `src/components/ui/AnimatedEmoji.tsx` — 5 animated SVG emoji (Frenchie, Poodle, Fish, Soccer, Plate)

**Phase 3 — PocketBase Migration** ⬜ TODO
- [ ] Provision PocketBase server, create 7 collections (emergency_contacts = empty)
- [ ] `src/lib/pb.ts` — PocketBase client singleton
- [ ] `src/lib/pb-auth.ts` — Service account admin auth helper
- [ ] `src/app/api/emergency/route.ts` — PB-query migration (admin getFullList)
- [ ] `src/lib/mealSync.ts` — Replace drizzle calls, add pb.subscribe real-time
- [ ] Remove drizzle-orm from `package.json` + clean install
- [ ] Remove `src/db/` directory (in-memory DB replaced by PB)

**Phase 4 — Animations & Polish**
- [x] `.floating` class in `globals.css` — 6s ease-in-out translateY infinite
- [x] `@keyframes float` — gradient orb 20s staggered
- [ ] `@keyframes theme-toggle-rotate` — 180° over 0.5s (confirm it matches this spec)
- [ ] Staggered page-entry animations

**Phase 5 — Accessibility Testing**
- [ ] Dark mode contrast WebAIM verified
- [ ] Light mode contrast WebAIM verified
- [ ] Focus states on all interactive elements
- [ ] Keyboard navigation (Tab through full app)
- [ ] Screen reader (VoiceOver / NVDA)
- [ ] `prefers-reduced-motion` — animations disabled

---

## Appendix A — Design Token Tables

### A.1 Complete Hex Code Reference

```
┌───────────────┬──────────────────────┬──────────────────────┐
│   Token       │       Dark Mode      │     Light Mode       │
├───────────────┼──────────────────────┼──────────────────────┤
│ Surface-0     │ #0f1117              │ #ffffff              │
│ Surface-1     │ #181c24              │ #f8f9fb              │
│ Surface-2     │ #1e2330              │ #f0f2f7              │
│ Surface-3     │ #252c3a              │ #e7ebf3              │
│ Surface-4     │ #2d3548              │ #dde3ed              │
│ Surface-5     │ #323b4d              │ #d3dae7              │
│ Surface-6     │ #3a4456              │ #c9d1e0              │
│ Surface-7     │ #434e60              │ #bfc6d8              │
├───────────────┼──────────────────────┼──────────────────────┤
│ Text Primary  │ #f0f4ff              │ #1a1a1a              │
│ Text Secondary│ #8892aa              │ #5a5a5a              │
│ Text Muted    │ #4e5a72              │ #8a8a8a              │
│ Text Dim      │ #363e50              │ #ababab              │
├───────────────┼──────┬───────────────┼──────┬───────────────┤
│ Accent Nori   │ #3b82f6              │ #2563eb              │
│ Accent Violet │ #7c6ff7              │ #7c3aed              │
│ Accent Rose   │ #f43f5e              │ #e11d48              │
│ Accent Cyan   │ #06b6d4              │ #0891b2              │
│ Accent Mint   │ #4ade80              │ #059669              │
│ Accent Amber  │ #f59e0b              │ #d97706              │
└───────────────┴──────┴───────────────┴──────┴───────────────┘

HIGH CONTRAST BOOST (both themes):
  --color-text-primary:   #000000 or #ffffff
  --color-text-secondary: #2d2d2d or #666666
  Border width:           2px (all borders, up from 1px)
  Opacity floor:          70% (no element below 70%)
```

### A.2 Spacing & Touch Targets

```
Base unit:           4px
Small gap:           8px
Caption spacing:     12px
Standard padding:    16px  (all cards)
Section gap:         24px
Large gap:           32px
Page margin:         48px

Min touch target:    44 × 44px  (WCAG AA)
Button height:       40px  (md), 48px  (lg)
Theme toggle button: 40×40px  + 8px padding = 48×48px contact area
Color swatch size:   40×40px
Border radius:       24px  (all cards, 1.5rem)
```

### A.3 Shadow Reference (Dark Mode)

| Size | Box-shadow |
|------|-----------|
| Small | `0 2px 8px rgba(0, 0, 0, 0.12)` |
| Medium | `0 4px 16px rgba(0, 0, 0, 0.16)` |
| Large | `0 8px 32px rgba(0, 0, 0, 0.24)` |

Light-mode shadows use equivalent but lighter opacity values.

### A.4 Font Loading

```
Font stack:  Geist Sans (body) · Geist Mono (code / monospace)
Weights:     400 (regular) · 500 (medium) · 600 (semibold) · 700 (bold)
Sizes:       11px → 32px
```

### A.5 Backend Tech Stack (Post-Migration)

```
Frontend  Source of truth → package.json
  next             ^16.1.3     App Router
  react            ^19.2.3     Server Components + Client Components
  react-dom        ^19.2.3
  tailwindcss      ^4.1.17     Utility-first CSS + custom properties
  typescript       ^5.9.3

Backend  (migrate from drizzle-orm)
  pocketbase       ?.?.?       Self-hosted BaaS — auth, real-time, auto-API

External services  (unchanged)
  @google/generative-ai   LLM / AI chat
  nodemailer              Gmail SMTP relay for emergency SMS/email
```

### A.6 Key File Map

```
src/
├── lib/
│   ├── theme-config.ts       ← ThemeMode/AccentColor types, THEME_STORAGE_KEY
│   ├── useTheme.ts           ← Theme hook (exports ThemeProvider wrapper)
│   ├── pb.ts                 ← PocketBase client singleton (NEW)
│   └── pb-auth.ts            ← Authenticated PB helpers (NEW)
├── hooks/
│   └── useTheme.tsx          ← localStorage save/load, data-theme + data-contrast set
├── app/
│   ├── layout.tsx            ← ThemeProvider + anti-FOUC theme script
│   ├── globals.css           ← CSS custom properties, glass classes, all @keyframes
│   └── api/
│       ├── emergency/route.ts← PocketBase admin query
│       └── chat/route.ts     ← OpenClaw WebSocket proxy
├── components/
│   ├── 3d/Icon3D.tsx         ← 8 gradient icon variants
│   ├── ui/
│   │   ├── AnimatedEmoji.tsx ← 5 keyframe-animated SVG emoji
│   │   ├── ThemeToggle.tsx   ← Sun/moon SVG rotate
│   │   ├── Card/Button/Badge ← Glass variants
│   │   └── BottomNav.tsx     ← 8-item tab navigation
│   └── meals/MealsUnified.tsx← Weekly meal grid
```

---

**End of Design Specification**

This document is the authoritative single source. All previous design package documents
(DELIVERY_SUMMARY.md, DESIGN_REVIEW_SUMMARY.md, DESIGN_INDEX.md, DESIGN_PACKAGE_SUMMARY.md,
COMPLETE_VISION.md, QUICK_REFERENCE_CARD.md, DESIGN_VISUAL_REFERENCE.md) are archived
in `docs/archive/` for reference only and must not be edited or referenced from code.
For living operational behavior, see `AGENTS.md`.
