# Consuela — Triple Dashboard Architecture
### One App. Three Experiences. Every Member of the Family.

**Status:** Design Plan — Ready for implementation
**Date:** July 2026
**Supersedes:** UI_RENEWAL_PLAN.md (absorbs its best ideas)

---

## The Vision

```
              ┌─────────────────────────────┐
              │       CONSUELA APP          │
              │                             │
              │   ┌─────┐ ┌─────┐ ┌─────┐  │
              │   │ 👨‍👩‍👧‍👦 │ │ 👨‍💼 │ │ 🧒  │  │
              │   │FAM  │ │ADULT│ │ KID │  │
              │   └──┬──┘ └──┬──┘ └──┬──┘  │
              │      │       │       │      │
              │   Warm &   Clean &  Bright &│
              │   Welcoming Efficient Playful│
              │                             │
              │   + 🌙 Bedtime Mode         │
              │   + 🏖️ Weekend Mode         │
              └─────────────────────────────┘
```

One app. Three distinct experiences that activate based on **who's signed in**:

| Mode | Trigger | Personality | Think |
|---|---|---|---|
| **👨‍👩‍👧‍👦 Family** | No one logged in | Warm, balanced, inviting | Airport departure board |
| **👨‍💼 Adult** | Parent PIN sign-in | Clean, dense, efficient | Apple Health + Things 3 |
| **🧒 Kid** | Child PIN sign-in | Fun, colorful, gamified | Duolingo + Pokémon GO |

Plus two **cross-cutting modifiers** that shift the mood of *all three*:
- **🌙 Bedtime Mode** — after 8pm, everything calms down
- **🏖️ Weekend Mode** — Sat/Sun, fun takes priority over chores

---

## Why This Is Better Than One Blended Dashboard

The previous plan tried to serve both audiences in one UI. That's a compromise — adults get bored by too much animation, kids get bored by too much data. With three modes:

- **Adults get a power dashboard** — dense information, minimal decoration, fast workflows, swipe actions, calendar grid at a glance
- **Kids get a game dashboard** — points front and center, big buttons, celebrations, their own avatar as the hero, quest-style tasks
- **Family gets a shared view** — weather, today's overview, who's doing what — the "living room TV" of dashboards
- **Switching is instant** — tap avatar → PIN → the whole UI transforms with a smooth transition

---

## Part 1: The Mode System

### 1.1 `useDashboardMode()` Hook

The auth system already tracks `role: 'parent' | 'child' | 'pet'`. We build on that:

```
src/hooks/useDashboardMode.tsx
```

```tsx
type DashboardMode = 'family' | 'adult' | 'kid';

interface DashboardModeContext {
  mode: DashboardMode;
  isBedtime: boolean;        // auto-detected from time
  isWeekend: boolean;        // auto-detected from day
  effectiveMode: DashboardMode; // mode + bedtime/weekend overlay info
}

function useDashboardMode(): DashboardModeContext {
  const { isLoggedIn, currentUser } = useAuth();

  const mode: DashboardMode = !isLoggedIn
    ? 'family'
    : currentUser.role === 'parent'
      ? 'adult'
      : 'kid';  // child or pet → kid mode

  const hour = new Date().getHours();
  const isBedtime = hour >= 20 || hour < 6;

  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 6;

  return { mode, isBedtime, isWeekend, effectiveMode: mode };
}
```

The mode is set on `<html>` as a data attribute, which lets CSS drive the entire visual transformation:

```html
<!-- No login -->
<html data-mode="family">

<!-- Parent signed in -->
<html data-mode="adult">

<!-- Child signed in -->
<html data-mode="kid">

<!-- Kid + bedtime -->
<html data-mode="kid" data-bedtime="true">

<!-- Adult + weekend -->
<html data-mode="adult" data-weekend="true">
```

### 1.2 Mode Transition Animation

When switching profiles, the entire UI doesn't just swap — it *transforms*:

```
TAP AVATAR → PIN MODAL → CONFIRMED → MODE TRANSITION
                                         │
                  ┌──────────────────────┘
                  ▼
          1. Current UI fades to blur (200ms)
          2. New mode's color palette fades in (300ms)
          3. Widgets slide into their new positions (400ms)
          4. Everything settles (total: ~700ms)
```

```css
/* In globals.css or modes.css */
[data-mode] {
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
}

/* The transition class applied during mode switch */
.mode-transitioning * {
  animation: modeShift 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes modeShift {
  0%   { opacity: 1; filter: blur(0); transform: scale(1); }
  30%  { opacity: 0.6; filter: blur(8px); transform: scale(0.98); }
  70%  { opacity: 0.8; filter: blur(2px); transform: scale(1.01); }
  100% { opacity: 1; filter: blur(0); transform: scale(1); }
}
```

---

## Part 2: Family Mode (No Login)

> *"The living room TV" — warm, welcoming, shared context for everyone*

### Visual Identity

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  BACKGROUND:  Warm canvas gradient (current system)  │
│  MATERIALS:   .surface (balanced glass, 60% opacity) │
│  COLORS:      User's accent color + warm neutrals    │
│  ANIMATION:   Moderate — weather art, floating icons │
│  TYPOGRAPHY:  Standard hierarchy                     │
│  TONE:        "Welcome home"                         │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Good afternoon, Garcia Family                 │  │
│  │  🌸 Summer · Fri, Jul 18 · 2:34 PM           │  │
│  │                                                │  │
│  │  [ 👨 Dad ] [ 👩 Mom ] [ 🧒 Caspian ] [ ＋ ]  │  │
│  │                                                │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │  ☀️  78°F  Partly Cloudy                 │  │  │
│  │  │  [seasonal art: summer palms + ocean]    │  │  │
│  │  │  Perfect day for the beach! 🏖️           │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  │                                                │  │
│  │  ┌─── TODAY ──────────────────────────────┐   │  │
│  │  │ 📅 Soccer practice · 4:00 PM · Caspian │   │  │
│  │  │ 📅 Dentist · 10:00 AM · Sofia          │   │  │
│  │  └────────────────────────────────────────┘   │  │
│  │                                                │  │
│  │  ┌─── TONIGHT ────────────────────────────┐   │  │
│  │  │ 🍽️  Taco Tuesday 🌮                     │   │  │
│  │  └────────────────────────────────────────┘   │  │
│  │                                                │  │
│  │  ┌─── FAMILY SCORE ───────────────────────┐   │  │
│  │  │ 🥇 Caspian 45pts  🥈 Sofia 32pts       │   │  │
│  │  │ 🔥 Family streak: 12 days               │   │  │
│  │  └────────────────────────────────────────┘   │  │
│  │                                                │  │
│  │  [💬 Ask Consuela]    [🔐 Sign In]            │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  [ 🏠 Home ] [ 💬 Ask ] [ 🍽️ Meals ] [ ✅ ] [ ⚙️ ] │
└──────────────────────────────────────────────────────┘
```

### Family Mode Characteristics

| Aspect | Treatment |
|---|---|
| **Greeting** | "Good afternoon, Garcia Family" with season emoji |
| **Weather** | Full seasonal art widget (the visual centerpiece) |
| **Family strip** | All member avatars in a row, tap to sign in |
| **Info density** | Medium — overview only, no deep detail |
| **Today's events** | Compact list, max 3 shown |
| **Meal** | Tonight's dinner only (simple, warm) |
| **Leaderboard** | Compact podium (just top 2-3) |
| **Tasks** | NOT shown (kids see their own, adults see all) |
| **CTA** | "Ask Consuela" prominent, "Sign In" visible |
| **Animation** | Weather particles, floating icons, avatar breathing |
| **Sign-in** | Tap any avatar → PIN pad → mode switches |

### Family Mode Widgets

```tsx
// layout-config.ts — new family widget set
export const FAMILY_WIDGETS: WidgetDef[] = [
  { id: "weather",        label: "Weather",          emoji: "⛅" },
  { id: "familyPulse",    label: "Family Today",     emoji: "📋" }, // NEW
  { id: "tonightMeal",    label: "Tonight",          emoji: "🍽️" }, // NEW simplified
  { id: "miniLeaderboard",label: "Family Score",     emoji: "🏆" }, // NEW compact
  { id: "aiQuickAsk",     label: "Ask Consuela",     emoji: "💬" },
];
```

### Family Mode Bedtime

After 8pm, Family Mode becomes:

```
┌──────────────────────────────────────────────┐
│                                              │
│  🌙 Good night, Garcia Family                │
│  Everyone did great today!                   │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  ☀️→🌙  68°F  Clear skies              │  │
│  │  [winter/night backdrop — muted]       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  📋 Tomorrow: Soccer 4PM, School photos      │
│  🏆 Caspian leads with 45pts                 │
│  🔥 12-day family streak                     │
│                                              │
│  Sweet dreams! 💤                            │
│                                              │
└──────────────────────────────────────────────┘
```

- Weather widget shows night backdrop only, no particles
- Events become "Tomorrow" preview
- Leaderboard becomes a single-line summary
- Greeting changes to "Good night" with moon emoji
- Background gradient shifts to deep navy
- All animation speeds halve

---

## Part 3: Adult Mode (Parent Logged In)

> *"The command center" — dense, efficient, no-nonsense beautiful*

### Visual Identity

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  BACKGROUND:  Deep neutral (less gradient, more flat)│
│  MATERIALS:   .surface-subtle (lower opacity = data) │
│  COLORS:      User's accent + monochrome data        │
│  ANIMATION:   Minimal — transitions only, no loops   │
│  TYPOGRAPHY:  Dense, tabular-nums, tight spacing     │
│  TONE:        "Everything under control"             │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Friday, Jul 18                [👩 Mom] [⚙️]   │  │
│  │                                                │  │
│  │  ┌── OVERVIEW ──────────────────────────────┐  │  │
│  │  │  📅 3 events   ✅ 2/5 tasks   🍽️ Taco   │  │  │
│  │  │  🔥 12d streak  🛒 8 items   2:34 PM    │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  │                                                │  │
│  │  ┌── SCHEDULE ──────┐  ┌── TASKS ─────────┐  │  │
│  │  │ 9:00  🏃 Workout  │  │ ☐ Trash duty     │  │  │
│  │  │ 10:00 🦷 Dentist  │  │   Caspian · 10pt │  │  │
│  │  │ 12:00 🍽️ Lunch    │  │ ☑ Dishes        │  │  │
│  │  │ 15:30 📞 Call mom │  │   Sofia · Done   │  │  │
│  │  │ 16:00 ⚽ Soccer   │  │ ☐ Vacuum living  │  │  │
│  │  │ 18:30 🍽️ Dinner   │  │   Caspian · 15pt │  │  │
│  │  │                   │  │ [View all →]     │  │  │
│  │  │ [Full calendar →] │  │                  │  │  │
│  │  └──────────────────┘  └──────────────────┘  │  │
│  │                                                │  │
│  │  ┌── MEAL PLAN ────┐  ┌── FAMILY ────────┐   │  │
│  │  │ Mon: Pasta 🍝    │  │ 🥇 Caspian 45    │   │  │
│  │  │ Tue: Tacos 🌮    │  │ 🥈 Sofia 32      │   │  │
│  │  │ Wed: Stir fry 🥢 │  │ 🥉 Dad 28        │   │  │
│  │  │ Thu: Pizza 🍕    │  │                  │   │  │
│  │  │ Fri: GRILLED 🥩  │  │ [Manage →]       │   │  │
│  │  │ [Plan week →]    │  │                  │   │  │
│  │  └─────────────────┘  └──────────────────┘   │  │
│  │                                                │  │
│  │  ┌── WEATHER ─────────────────────────────┐   │  │
│  │  │  78°F Partly Cloudy · Feels 76°        │   │  │
│  │  │  Mon 82° · Tue 79° · Wed 75° · Thu 80° │   │  │
│  │  └────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Adult Mode Characteristics

| Aspect | Treatment |
|---|---|
| **Greeting** | No greeting. Just the date and status — efficient |
| **Overview bar** | Always-visible stats strip (events, tasks, meal, streak, grocery, time) |
| **Layout** | **2-column grid** — schedule + tasks side by side, meal plan + family side by side |
| **Weather** | Compact horizontal card (no seasonal art — data only) |
| **Calendar** | Time-based schedule list with colored rails |
| **Tasks** | Full list with assignee, points, priority — swipe to complete |
| **Meal plan** | Week overview grid — tap to edit |
| **Family** | Leaderboard with management controls |
| **Grocery** | Quick-count pill in overview, tap for full list |
| **Animation** | Transitions only. No loops. No particles. No floating. |
| **Interaction** | Swipe actions, long-press for quick-add, pull-to-refresh |
| **Font** | Tabular-nums everywhere for data alignment |

### Adult Mode Design Tokens (CSS Overrides)

```css
/* ═══ ADULT MODE ═══ */
[data-mode="adult"] {
  /* Flatter, more professional background */
  --color-canvas: var(--color-surface-0);

  /* Denser spacing */
  --mode-gap: 0.75rem;      /* vs 1.5rem in family/kid */
  --mode-padding: 0.75rem;

  /* Minimal animation */
  --motion-base: 150ms;      /* Faster, snappier */
  --motion-slow: 250ms;

  /* Subtle materials */
  --glass-tint-strong: rgba(255,255,255,0.06);  /* More transparent = more data visible */
  --glass-tint-soft: rgba(255,255,255,0.03);
}

[data-mode="adult"] .floating,
[data-mode="adult"] .gradient-orb,
[data-mode="adult"] .weather-particles {
  animation: none !important;    /* Kill decorative animations */
}

[data-mode="adult"] .weather-backdrop-art {
  display: none;                 /* Hide seasonal SVG art */
}

/* 2-column grid for adult */
[data-mode="adult"] .home-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mode-gap);
}

/* Single column for widgets that should be full-width */
[data-mode="adult"] .home-grid .full-width {
  grid-column: 1 / -1;
}

/* Overview bar always visible */
[data-mode="adult"] .overview-bar {
  position: sticky;
  top: 0;
  z-index: 30;
  backdrop-filter: blur(20px);
}
```

### Adult Mode: Swipe Actions

Every row supports swipe:

```
TASK ROW:
  Swipe left → [✅ Complete] [🗑️ Delete]
  Swipe right → [⏭️ Skip to tomorrow]

EVENT ROW:
  Swipe left → [✅ Done] [✏️ Edit]
  
MEAL ROW:
  Swipe left → [🔄 Swap] [✏️ Edit]

SCHEDULE ROW:
  Swipe left → [✅ Complete] [⏰ Snooze]
```

### Adult Mode: Bedtime

```
┌──────────────────────────────────────────────┐
│  Friday, Jul 18 — 9:14 PM          [👩] [⚙️] │
│                                              │
│  ┌── TOMORROW ────────────────────────────┐  │
│  │ 📅 2 events · ✅ 3 remaining tasks     │  │
│  │ 🍽️ Brunch planned · 10:00 AM          │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌── QUICK NOTES ────────────────────────┐   │
│  │ ☐ Call dentist to reschedule Sofia    │   │
│  │ ☐ Order new soccer cleats for Caspian │   │
│  └────────────────────────────────────────┘  │
│                                              │
│  🌙 Good night. Everything's handled.        │
└──────────────────────────────────────────────┘
```

- Overview becomes "Tomorrow" preview
- Schedule becomes "Quick Notes" (things to remember)
- Add a text input for quick note capture (bedtime brain dump)
- Everything dims, no interactive data

---

## Part 4: Kid Mode (Child Logged In)

> *"Your personal adventure" — colorful, gamified, celebration-heavy*

### Visual Identity

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  BACKGROUND:  Vibrant gradient (accent-heavy)        │
│  MATERIALS:   .surface-elevated (rich, colorful)     │
│  COLORS:      Kid's favorite color + rainbow accents │
│  ANIMATION:   Lively — bounces, sparkles, particles  │
│  TYPOGRAPHY:  Large, friendly, emoji-rich            │
│  TONE:        "You're awesome! Let's go!"            │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                                                │  │
│  │     ┌──────────────────────────────────┐       │  │
│  │     │  🧒 Hey Caspian!                 │       │  │
│  │     │  You have 2 quests today!        │       │  │
│  │     │                                  │       │  │
│  │     │  Level 5  ████████░░  45/50 pts  │       │  │
│  │     │  🔥 7-day streak!                │       │  │
│  │     └──────────────────────────────────┘       │  │
│  │                                                │  │
│  │     ┌──────── YOUR QUESTS ────────────────┐    │  │
│  │     │                                     │    │  │
│  │     │  ┌─────────────────────────────┐    │    │  │
│  │     │  │ 🎯 Take out the trash       │    │    │  │
│  │     │  │    10 pts · Due today        │    │    │  │
│  │     │  │              [ TAP TO DO! ] │    │    │  │
│  │     │  └─────────────────────────────┘    │    │  │
│  │     │                                     │    │  │
│  │     │  ┌─────────────────────────────┐    │    │  │
│  │     │  │ 🎯 Vacuum the living room   │    │    │  │
│  │     │  │    15 pts · Due today        │    │    │  │
│  │     │  │              [ TAP TO DO! ] │    │    │  │
│  │     │  └─────────────────────────────┘    │    │  │
│  │     │                                     │    │  │
│  │     │  ┌─ ✅ DONE ───────────────────┐   │    │  │
│  │     │  │ ✅ Make your bed  +10 pts   │   │    │  │
│  │     │  └─────────────────────────────┘   │    │  │
│  │     └─────────────────────────────────────┘    │  │
│  │                                                │  │
│  │     ┌──────── WHAT'S HAPPENING ───────────┐    │  │
│  │     │  ⚽ Soccer practice at 4:00 PM       │    │  │
│  │     │  🍽️ Taco Tuesday tonight! 🌮        │    │  │
│  │     └─────────────────────────────────────┘    │  │
│  │                                                │  │
│  │     ┌────────🏆 LEADERBOARD ──────────────┐    │  │
│  │     │  🥇 YOU!  45 pts  ← that's #1!      │    │  │
│  │     │  🥈 Sofia  32 pts                    │    │  │
│  │     │  🥉 Dad   28 pts                     │    │  │
│  │     │                                      │    │  │
│  │     │  🎯 5 more pts to Level 6!           │    │  │
│  │     └──────────────────────────────────────┘    │  │
│  │                                                │  │
│  │     ┌──── TODAY'S WEATHER ────────────────┐    │  │
│  │     │  ☀️ 78°F — Perfect for soccer!      │    │  │
│  │     │  [summer art with particles]         │    │  │
│  │     └──────────────────────────────────────┘    │  │
│  │                                                │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  [ 🏠 ] [ 💬 Ask ] [ 🍽️ Meals ] [ 🏆 Points ] [ ⚙️ ]│
└──────────────────────────────────────────────────────┘
```

### Kid Mode Characteristics

| Aspect | Treatment |
|---|---|
| **Greeting** | "Hey Caspian!" with their emoji, level, and streak |
| **Hero** | Their avatar is LARGE and central, with glow + idle animation |
| **Level bar** | Progress bar showing XP to next level (gamification) |
| **Tasks** | Reframed as "Quests" — big buttons, tap-to-complete |
| **Task complete** | 🎉 CONFETTI BURST + points fly up + celebration sound (optional) |
| **Events** | Simple "What's Happening" — friendly language, no times-as-data |
| **Meals** | "Tonight: Taco Tuesday! 🌮" — fun, not data |
| **Leaderboard** | THEY ARE THE HERO — "YOU! That's #1!" — always positive framing |
| **Weather** | Full seasonal art + fun context ("Perfect for soccer!") |
| **Bottom nav** | Tasks → "Quests" (🎯), Leaderboard → "Points" (🏆) |
| **Animation** | Living avatars, task celebrations, streak fire, level-up effects |
| **Language** | Kid-friendly: "Quests" not "Tasks", "Points" not "Leaderboard" |
| **No access to** | Settings (hidden), Grocery, Emergency, member management |

### Kid Mode Design Tokens

```css
/* ═══ KID MODE ═══ */
[data-mode="kid"] {
  /* Vibrant background */
  --color-canvas: var(--color-surface-0);
  
  /* Bigger, bouncier */
  --mode-gap: 1.25rem;
  --mode-padding: 1rem;
  --mode-radius: 1.5rem;  /* Rounder = friendlier */
  
  /* Spring easing for everything */
  --ease-standard: cubic-bezier(0.34, 1.56, 0.64, 1);
  
  /* Bigger touch targets */
  --touch-target: 52px;  /* vs 44px default */
  
  /* Brighter materials */
  --glass-tint-strong: rgba(255,255,255,0.14);
}

/* Kid-specific: bigger avatars */
[data-mode="kid"] .avatar-hero {
  width: 120px;
  height: 120px;
  animation: avatar-breathe 3s ease-in-out infinite;
}

/* Kid-specific: quest cards are tappable full-width */
[data-mode="kid"] .quest-card {
  min-height: 72px;
  border-radius: 1.25rem;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

[data-mode="kid"] .quest-card:active {
  transform: scale(0.95);
}

/* Kid-specific: level-up celebration */
@keyframes levelUpBurst {
  0%   { transform: scale(0); opacity: 1; }
  50%  { transform: scale(1.3); opacity: 0.8; }
  100% { transform: scale(1); opacity: 1; }
}

/* Kill all decorative animation in bedtime */
[data-mode="kid"][data-bedtime="true"] .quest-card {
  animation: none;
}
```

### Kid Mode: Quest Completion Flow

```
TAP QUEST → CONFIRMATION → CELEBRATION → UPDATE
    │              │              │            │
    ▼              ▼              ▼            ▼
 Quest scales    "Did you do    🎉 Confetti   Points fly
 down slightly   it?" modal     burst          up as
 with spring                    + points      golden
 easing                         fly up        numbers
                                + streak
                                fire grows
```

```tsx
function QuestCard({ task, onComplete }) {
  const [completing, setCompleting] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const handleTap = () => {
    setCompleting(true); // Shows "Did you do it?" modal
  };

  const handleConfirm = async () => {
    setCelebrating(true); // Triggers confetti + points fly
    await onComplete(task);
    setTimeout(() => setCelebrating(false), 1500);
  };

  return (
    <>
      <div
        className={`quest-card tap ${celebrating ? 'reaction-pop' : ''}`}
        onClick={handleTap}
      >
        <span className="text-2xl">{task.emoji || '🎯'}</span>
        <div>
          <h3>{task.title}</h3>
          <p>{task.points} pts · Due {task.due}</p>
        </div>
        <span className="text-accent font-bold">TAP!</span>
      </div>

      {celebrating && <CelebrationBurst points={task.points} />}
    </>
  );
}
```

### Kid Mode: Bottom Navigation

```
ADULT NAV:                    KID NAV:
[ 🏠 ] [ 💬 ] [ 🍽️ ] [ ✅ ] [ ⚙️ ]    [ 🏠 ] [ 💬 ] [ 🍽️ ] [ 🏆 ] [ 👤 ]
  Home   Ask    Meals  Tasks  Settings    Home   Ask    Meals  Points  Me
```

- "Tasks" becomes **"Quests"** (🎯 icon)
- "Settings" becomes **"Points"** (🏆 icon) — shows full leaderboard, rewards shop
- Last item becomes **"Me"** (👤 icon) — their profile, avatar customization
- Settings is only accessible from the "Me" page (with parent PIN for protected settings)

### Kid Mode: Bedtime

```
┌──────────────────────────────────────────────┐
│                                              │
│     ┌──────────────────────────────────┐     │
│     │  🌙 Great job today, Caspian!    │     │
│     │                                   │     │
│     │  You earned 25 pts today! 🎉     │     │
│     │  Level 5  ████████░░  45/50      │     │
│     │  🔥 7-day streak!                │     │
│     │                                   │     │
│     │  Sweet dreams! See you tomorrow.  │     │
│     │  🌟⭐✨💤                         │     │
│     └──────────────────────────────────┘     │
│                                              │
│     ┌──────── TOMORROW ────────────────┐     │
│     │  ⚽ Soccer practice               │     │
│     │  📸 School pictures               │     │
│     │  🍽️ Breakfast for dinner! 🥞     │     │
│     └───────────────────────────────────┘     │
│                                              │
│     🏆 You're still in 1st place!            │
│                                              │
└──────────────────────────────────────────────┘
```

- All animations slow to 50% speed
- Colors shift to deep purple/navy
- Quest completion is disabled (can't do chores at bedtime!)
- "Tomorrow" preview instead of "Today"
- Leaderboard shows "You're still in 1st place!" (positive reinforcement)
- Stars and moon particles drift slowly
- Optional: a "Good night" message from Consuela

---

## Part 5: Weekend Mode (Cross-Cutting)

Applies to all three modes on Saturday/Sunday.

### Family + Weekend
- "Weekend Vibes" replaces standard greeting
- Fun activity suggestion widget appears
- Meal plan shows "weekend specials"

### Adult + Weekend
- Schedule shows only essentials (no weekday routines)
- "Weekend Projects" section replaces task list
- Grocery list moves higher priority

### Kid + Weekend
- "Weekend Adventure!" greeting
- Bonus quests appear (special weekend challenges with extra points)
- "Fun Activities" from parents show as bonus quests
- Streak counter gets a "weekend warrior" badge

```css
[data-weekend="true"] .weekend-badge {
  display: inline-flex;
  animation: badge-sparkle 2s ease-in-out infinite;
}

@keyframes weekend-glow {
  0%, 100% { box-shadow: 0 0 20px rgba(251, 191, 36, 0.2); }
  50%      { box-shadow: 0 0 40px rgba(251, 191, 36, 0.4); }
}
```

---

## Part 6: Implementation Architecture

### 6.1 File Structure

```
src/
├── hooks/
│   ├── useDashboardMode.tsx      ← NEW: mode detection + context
│   ├── useAuth.tsx                ← Existing (already has role)
│   └── useBedtime.tsx            ← NEW: bedtime detection
│
├── modes/                         ← NEW directory
│   ├── family/
│   │   ├── FamilyHome.tsx         ← Family mode home page
│   │   ├── FamilyWidgets.tsx      ← Family-specific widget set
│   │   └── family.css             ← Family mode overrides
│   ├── adult/
│   │   ├── AdultHome.tsx          ← Adult mode home page
│   │   ├── AdultWidgets.tsx       ← Adult-specific widget set
│   │   ├── OverviewBar.tsx        ← Sticky stats bar
│   │   ├── SwipeActions.tsx       ← Swipe-to-complete system
│   │   └── adult.css              ← Adult mode overrides
│   └── kid/
│       ├── KidHome.tsx            ← Kid mode home page
│       ├── KidWidgets.tsx         ← Kid-specific widget set
│       ├── QuestCard.tsx          ← Gamified task component
│       ├── LevelBar.tsx           ← XP progress bar
│       ├── CelebrationBurst.tsx   ← Confetti + points animation
│       └── kid.css                ← Kid mode overrides
│
├── components/
│   ├── ui/
│   │   ├── ModeTransition.tsx     ← Animated mode switch wrapper
│   │   ├── BedtimeOverlay.tsx     ← Nighttime visual modifier
│   │   └── WeekendBadge.tsx       ← Weekend indicator
│   └── shared/                    ← Widgets shared across modes
│       ├── WeatherWidget.tsx      ← Renders differently per mode
│       ├── MealWidget.tsx         ← Compact (adult) vs fun (kid)
│       └── LeaderboardWidget.tsx  ← Data (adult) vs game (kid)
│
├── app/
│   └── page.tsx                   ← Router that picks the right mode
```

### 6.2 Home Page Router

The main `page.tsx` becomes a thin router:

```tsx
// app/page.tsx
"use client";

import { useDashboardMode } from "@/hooks/useDashboardMode";
import { FamilyHome } from "@/modes/family/FamilyHome";
import { AdultHome } from "@/modes/adult/AdultHome";
import { KidHome } from "@/modes/kid/KidHome";
import { ModeTransition } from "@/components/ui/ModeTransition";

export default function HomePage() {
  const { mode } = useDashboardMode();

  return (
    <ModeTransition mode={mode}>
      {mode === "family" && <FamilyHome />}
      {mode === "adult" && <AdultHome />}
      {mode === "kid" && <KidHome />}
    </ModeTransition>
  );
}
```

### 6.3 Shared Widgets, Mode-Aware Rendering

Components like WeatherWidget receive a `mode` prop and render differently:

```tsx
function WeatherWidget() {
  const { mode } = useDashboardMode();

  if (mode === "adult") {
    return <CompactWeather />;     // Just data, no art
  }

  return <FullWeather />;          // Seasonal art + particles (family + kid)
}
```

### 6.4 Settings: Parent-Gated

```
ADULT SETTINGS:                    KID SETTINGS:
┌────────────────────────┐         ┌────────────────────────┐
│ ⚙️ Settings             │         │ 👤 My Profile           │
│                         │         │                         │
│ 👤 Family Management    │         │ 🎨 Change my emoji      │
│ 🎨 Appearance          │         │ 🏆 My points history    │
│ 🧩 Dashboard Layout    │         │ 🎁 Reward shop          │
│ 🔗 Integrations        │         │                         │
│ 📦 Data & Sync         │         │ 🔒 Parent Settings      │
│ 🔄 Updates             │         │    [Requires parent PIN] │
└────────────────────────┘         └────────────────────────┘
```

Kids can customize their emoji and see their points, but family management, layout, and system settings require a parent PIN unlock.

---

## Part 7: Mode Comparison Matrix

| Feature | 👨‍👩‍👧‍👦 Family | 👨‍💼 Adult | 🧒 Kid |
|---|---|---|---|
| **Greeting** | "Good afternoon, Garcia Family" | Date + stats bar | "Hey Caspian! 🧒" |
| **Layout** | Single column, balanced | 2-column, dense | Single column, big cards |
| **Background** | Warm gradient | Deep neutral | Vibrant gradient |
| **Animation** | Moderate (weather art) | None (transitions only) | Lively (bounces, sparkles) |
| **Tasks** | Hidden | Full list, swipe actions | "Quests", tap-to-complete |
| **Calendar** | Today only, compact | Full schedule, time-based | "What's Happening" (simple) |
| **Meals** | Tonight's dinner | Full week plan grid | "Tonight: Tacos! 🌮" |
| **Leaderboard** | Compact podium | Data table with management | "YOU'RE #1! 🎉" |
| **Weather** | Full art widget | Compact data card | Full art + fun context |
| **Level/XP** | Not shown | Not shown | Level bar + XP progress |
| **Points** | Compact score | Points as data | Points as CURRENCY |
| **Swipe** | No | Yes (all rows) | No (tap instead) |
| **Settings** | Sign-in prompt | Full settings | Profile + reward shop |
| **Bedtime** | "Good night" + tomorrow | Tomorrow summary + notes | "Sweet dreams" + no quests |
| **Weekend** | Activity suggestions | Weekend projects | Bonus quests |
| **Emergency** | FAB accessible | Long-press in nav | Hidden (parent only) |
| **Grocery** | Not shown | Overview pill + list | Not shown |

---

## Part 8: Implementation Phases

### Phase 1 — Mode Infrastructure (Week 1) — 16h

```
[1.1] Create useDashboardMode() hook                      (2h)
[1.2] Create ModeTransition component + CSS               (3h)
[1.3] Set up data-mode attribute on <html>                (1h)
[1.4] Create mode-specific CSS token overrides             (3h)
[1.5] Refactor page.tsx → mode router                      (2h)
[1.6] Create 3 skeleton home pages (Family/Adult/Kid)      (3h)
[1.7] Move existing Home → FamilyHome as baseline          (2h)
```

### Phase 2 — Adult Mode (Week 2) — 20h

```
[2.1] Build OverviewBar (sticky stats strip)               (3h)
[2.2] Build 2-column grid layout                           (3h)
[2.3] Build compact WeatherWidget (data-only variant)      (2h)
[2.4] Build schedule list with swipe actions               (4h)
[2.5] Build task list with swipe-to-complete               (3h)
[2.6] Build meal plan week grid                            (2h)
[2.7] Adult mode bedtime variant                           (2h)
[2.8] Weekend variant for adult                            (1h)
```

### Phase 3 — Kid Mode (Week 3) — 24h

```
[3.1] Build hero avatar section with level bar             (3h)
[3.2] Build QuestCard component with tap-to-complete       (4h)
[3.3] Build CelebrationBurst (confetti + points fly)       (4h)
[3.4] Build kid-friendly leaderboard ("You're #1!")        (2h)
[3.5] Build "What's Happening" widget                      (2h)
[3.6] Build "My Profile" page (emoji, points, rewards)     (3h)
[3.7] Kid mode bottom nav (Quests, Points, Me)             (2h)
[3.8] Kid mode bedtime + weekend variants                  (3h)
[3.9] Living avatar animations per role                    (1h)
```

### Phase 4 — Family Mode Polish (Week 4) — 12h

```
[4.1] Build FamilyPulse widget (shared overview)           (3h)
[4.2] Build Tonight meal widget (simplified)               (2h)
[4.3] Build mini leaderboard (compact podium)              (2h)
[4.4] Family mode bedtime variant                          (2h)
[4.5] Weekend variant for family                           (1h)
[4.6] Sign-in flow polish (avatar → PIN → mode switch)    (2h)
```

### Phase 5 — Cross-Cutting Features (Week 5) — 14h

```
[5.1] Bedtime mode system (time detection + CSS overlay)   (4h)
[5.2] Weekend mode system (day detection + widget swaps)   (3h)
[5.3] Mode transition animation polish                     (2h)
[5.4] Shared component audit (mode-aware rendering)        (3h)
[5.5] Performance pass (memo, animation budget)            (2h)
```

### Phase 6 — Foundation Cleanup (Week 6) — 10h

```
[6.1] Consolidate glass → 3 materials                      (3h)
[6.2] Unify radii → 3 values                               (1h)
[6.3] Split globals.css                                    (3h)
[6.4] Split WeatherWidget.tsx                              (3h)
```

```
──────────────────────────────────────────────────────────
TOTAL: ~96 hours (~12 working days across 6 weeks)
```

---

## Part 9: The Mode-Switching UX

### How It Works for the User

```
SCENARIO: Dad picks up the tablet

1. Dashboard shows FAMILY MODE
   → "Good afternoon, Garcia Family"
   → Weather, events, everyone's avatars

2. Dad taps his avatar [ 👨 ]
   → PIN pad slides up
   → Dad enters 4-digit PIN

3. DASHBOARD TRANSFORMS (700ms)
   → Blur transition
   → Colors shift to deeper, calmer palette
   → Layout reflows from 1-column to 2-column
   → Overview bar slides in at top
   → Widgets rearrange to data-dense layout

4. Dad is now in ADULT MODE
   → Full control, all data, swipe actions
   → Can manage family, meals, settings

5. Dad taps his avatar again → "Sign out"
   → Blur transition back
   → FAMILY MODE restored

────

SCENARIO: Caspian (8 years old) picks up the tablet

1. Dashboard shows FAMILY MODE

2. Caspian taps his avatar [ 🧒 ]
   → PIN pad slides up
   → Caspian enters his PIN (or uses emoji PIN for younger kids)

3. DASHBOARD TRANSFORMS (700ms)
   → Colors burst into vibrancy
   → His avatar grows large with a bounce
   → Level bar fills with animation
   → Quest cards slide in with spring easing
   → "Hey Caspian! You have 2 quests today!"

4. Caspian is now in KID MODE
   → Can see his quests, points, leaderboard
   → Tap quests to complete them (confetti!)
   → Can't access settings or family management

5. After 30 min inactivity → auto sign-out → FAMILY MODE
```

### Security Model

| Mode | Can Access | Cannot Access |
|---|---|---|
| Family | Weather, events overview, sign-in | Tasks, settings, member management |
| Adult | Everything | Nothing (full access) |
| Kid | Own tasks, points, leaderboard, meals view | Settings, family management, emergency, grocery |

---

## Part 10: Design Principles

1. **Modes are identities, not themes.** Each mode is a fundamentally different experience. The transition between them should feel like entering a different room, not changing a color palette.

2. **Shared data, personal lens.** The underlying data (events, tasks, meals, points) is identical across all three modes. What changes is how it's *presented* — a parent sees a schedule, a kid sees "what's happening", the family sees "today at a glance."

3. **The kid's dashboard should make them excited to open it.** If completing chores feels like playing a game, the product works. Level-ups, streaks, celebrations, and positive framing ("You're #1!") are not gimmicks — they're motivation.

4. **The adult's dashboard should save them time.** Every second of animation removed is a second of efficiency gained. Data density, swipe actions, and overview-at-a-glance patterns are the goal.

5. **The family dashboard should feel like home.** It's what you see when you walk past the tablet on the counter — a warm, inviting summary of your family's day. It should make everyone feel included.

6. **Bedtime mode is a family ritual.** It signals "the day is done" across all three experiences. Kids see "sweet dreams", adults see "everything's handled", family sees "good night." It's the dashboard tucking everyone in.

7. **Transitions are magic.** The 700ms mode-switch animation is the moment where the product shows its personality. It should feel smooth, surprising, and delightful — like the dashboard is alive and responding to who you are.

---

*This plan transforms Consuela from a single dashboard trying to serve everyone into three purpose-built experiences that share data but speak different languages — the language of efficiency for parents, the language of play for kids, and the language of togetherness for the family.*
