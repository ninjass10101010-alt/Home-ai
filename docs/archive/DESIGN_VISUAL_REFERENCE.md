# Consuela Dashboard — Visual Design Guide

**Quick Reference for UI/Theme Implementation**

---

## Theme Toggle Button — Visual Specification

### Button Anatomy

```
┌─ TopBar (sticky) ─────────────────────────────────┐
│                                                    │
│  [Menu] "Dashboard" [Weather: 72°F] [☀️/🌙 Theme] │
│                                                    │
└────────────────────────────────────────────────────┘

Theme Toggle = 40×40px, Top-Right Corner
```

### Two States (Toggling)

```
DARK MODE (Current)              LIGHT MODE (Available)
┌─────────────┐                  ┌─────────────┐
│  ┌─ ◯ ─┐    │                  │  ┌─ ◯ ─┐    │
│  │  ☀️  │    │                  │  │  🌙  │    │
│  └──────┘    │                  │  └──────┘    │
│ Click → Switch to Light        │ Click → Switch to Dark
└─────────────┘                  └─────────────┘
```

### Icon Specifications

```
SUN ICON (Light Mode Available)
──────────────────────────────
Size: 20×20px inside 40×40 button
┌────────────────┐
│     ◯          │  Outer circle, stroke 2px
│  ╱   ╲         │  8 rays around circle
│ ╱     ╲        │  45° angle spacing
││       │       │  Centered in button
│ ╲     ╱        │  Color: var(--color-text-primary)
│  ╲   ╱         │  Opacity: 0.8 (hover: 1.0)
└────────────────┘

MOON ICON (Dark Mode Available)
───────────────────────────────
Size: 20×20px inside 40×40 button
┌────────────────┐
│      ◑         │  Crescent moon shape
│    ◑    ·      │  Rotated -15 degrees
│  ◑  ·          │  One star accent
│                │  Centered in button
│                │  Color: var(--color-text-primary)
│                │  Opacity: 0.8 (hover: 1.0)
└────────────────┘
```

### Interaction Flow

```
1. USER SEES (Dark Mode)
   ┌──────────────────┐
   │ [☀️ Button]      │ ← Sun icon = "light mode is available"
   └──────────────────┘

2. USER HOVERS
   ┌──────────────────┐
   │ [☀️ Button↑]     │ ← Scale 1.05, opacity 1.0, shadow grows
   └──────────────────┘

3. USER CLICKS
   ┌──────────────────┐
   │ [☀️ Button✓]     │ ← Icon rotates 180°, scale 0.98
   └──────────────────┘

4. THEME CHANGES (150ms)
   ┌──────────────────┐
   │ [🌙 Button]      │ ← Dark theme fade out, light theme fade in
   └──────────────────┘   Background color changes to white
                          Text color changes to black
                          All CSS variables update

5. STATE SAVED
   localStorage['home-ai-theme-config'] = {
     mode: 'light',
     accentColor: 'nori',
     contrastBoost: false
   }
```

---

## Color System at a Glance

### Dark Mode (Default)

```
BACKGROUNDS                 TEXT
Surface 0: #0f1117         Primary:   #f0f4ff ← Main text
Surface 1: #181c24         Secondary: #8892aa ← Hints
Surface 2: #1e2330         Muted:     #4e5a72 ← Disabled
Surface 3: #252c3a         Dim:       #363e50 ← Placeholders
Surface 4: #2d3548
Surface 5: #323b4d
Surface 6: #3a4456
Surface 7: #434e60

ACCENTS (Choose One)
Nori:      #3b82f6 ← Default (Trust, Primary)
Violet:    #7c6ff7 ← Premium events
Rose:      #f43f5e ← Urgent/Important
Cyan:      #06b6d4 ← Information
Mint:      #4ade80 ← Success
Amber:     #f59e0b ← Warnings
```

### Light Mode

```
BACKGROUNDS                 TEXT
Surface 0: #ffffff         Primary:   #1a1a1a ← Main text
Surface 1: #f8f9fb         Secondary: #5a5a5a ← Hints
Surface 2: #f0f2f7         Muted:     #8a8a8a ← Disabled
Surface 3: #e7ebf3         Dim:       #ababab ← Placeholders
Surface 4: #dde3ed
Surface 5: #d3dae7
Surface 6: #c9d1e0
Surface 7: #bfc6d8

ACCENTS (Same as Dark)
Nori:      #2563eb ← Darker shade for contrast
Violet:    #7c3aed
Rose:      #e11d48
Cyan:      #0891b2
Mint:      #059669
Amber:     #d97706
```

---

## Glass Morphism Variants

### Standard Glass (`.glass`)

```
┌─────────────────────────────┐
│ ░░░░░░ Content ░░░░░░       │  Background: 50% opacity surface
│                             │  Blur: 20px
│ Used for: Cards, sections   │  Border: 1px, 8% opacity
└─────────────────────────────┘  Shadow: 0 8px 32px
```

### Strong Glass (`.glass-strong`)

```
┌─────────────────────────────┐
│ ██████ Content ██████       │  Background: 75% opacity surface
│                             │  Blur: 20px
│ Used for: Buttons, modals   │  Border: 1px, 30% opacity
└─────────────────────────────┘  Shadow: 0 8px 32px
```

### Subtle Glass (`.glass-subtle`)

```
┌─────────────────────────────┐
│ ▓▓▓▓▓▓ Content ▓▓▓▓▓▓       │  Background: 35% opacity surface
│                             │  Blur: 12px
│ Used for: Badges, pills     │  Border: 1px, 5% opacity
└─────────────────────────────┘  Shadow: 0 4px 16px
```

---

## Component States

### Button States

```
Default          Hover           Active          Disabled
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Button    │  │   Button↑   │  │   Button✓   │  │   Button    │
│             │  │  Scale 1.05 │  │  Scale 0.98 │  │ Opacity 50% │
│ Opacity 1   │  │  Shadow +8  │  │ Background+ │  │ cursor:not  │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
All 0.2s ease   0.2s ease       0.1s ease       No transition
```

### Card Hover States

```
Default Card              Hovering (Interactive)
┌─────────────────────┐   ┌─────────────────────┐
│                     │   │                     │
│  Content            │   │  Content            │↑
│                     │   │                     │ Scale 1.02
└─────────────────────┘   └─────────────────────┘
Border: 8% opacity      Border: 20% opacity
Shadow: Normal          Shadow: Larger (0 12px 40px)
Transition: 0.3s ease   Glow: Accent color/10%
```

---

## Typography Scale

```
H1 (Page Title):        32px, Bold (700), Letter spacing 0
H2 (Section):           24px, Semibold (600), Letter spacing -0.5px
H3 (Subsection):        20px, Semibold (600)
Headline (Card title):  16px, Semibold (600)
Body (Main text):       14px, Regular (400)
Caption (Labels):       12px, Medium (500)
Tiny (Helpers):         11px, Regular (400)

Font Family: Geist Sans (primary), Geist Mono (code)
Line Height: 1.5 (body), 1.2 (headings)
```

---

## Spacing Scale

```
4px  = Base unit
8px  = Small gaps
12px = Caption spacing
16px = Standard padding (cards)
24px = Section margins
32px = Large gaps
48px = Page margins

Card padding: 16px
Section gap: 24px
Container max-width: 1200px
```

---

## Animation Timings

```
FAST (UI Feedback)       STANDARD (Default)       SLOW (Emphasis)
0.15s ease               0.3s ease                0.5s ease
├─ Button click          ├─ Color transitions     ├─ Theme toggle
├─ Icon changes          ├─ Card hover           ├─ Page entry
├─ Simple fades          ├─ Dropdown open        └─ Large movements
└─ Checkbox toggle       └─ Element scale

Easing function: cubic-bezier(0.4, 0, 0.2, 1) [Material Design Standard]
```

---

## Accent Color Picker (Settings Page)

```
┌─────────────────────────────────────────────────┐
│ Choose Your Accent Color:                       │
│                                                 │
│ [Nori]  [Violet]  [Rose]  [Cyan]  [Mint] [Amber]│
│  ●       ●         ●       ●       ●      ●    │
│ 40×40px each, rounded, gap 16px                │
│                                                 │
│ Selected: Nori (shown with 2px border)         │
│ Preview: Card shows "Your color is: Nori"      │
└─────────────────────────────────────────────────┘

User clicks → Accent color changes across app
All branded elements switch instantly
No page reload needed
```

---

## Accessibility Checklist

```
✓ Theme Toggle Button
  └─ aria-label="Switch to light theme"
  └─ Keyboard: Tab + Enter/Space
  └─ Focus: 2px blue outline
  └─ Touch: 44×44px minimum

✓ Color Contrast
  └─ Text on background: 15:1 (dark), 12:1 (light)
  └─ Interactive elements: 3:1 minimum
  └─ No color-only indicators

✓ Motion Accessibility
  └─ Respects prefers-reduced-motion
  └─ No auto-play animations
  └─ No flashing (< 3/sec)

✓ Semantic HTML
  └─ <button> for theme toggle (not <div>)
  └─ Proper heading hierarchy
  └─ Associated labels on forms
```

---

## Mobile-First Responsive Design

```
Mobile (< 640px)          Tablet (640-1024px)       Desktop (> 1024px)
┌──────────────┐          ┌─────────────────────┐   ┌──────────────────────────┐
│ [Top Bar  ]  │          │ [Top Bar        ]   │   │ [Top Bar             ]   │
│──────────────│          │─────────────────────│   │──────────────────────────│
│              │          │   [Home]  [Chat]    │   │ [Home] [Chat] [Tasks]    │
│  Content     │          │──────────┬──────────│   │────────┬────────┬────────│
│  Single      │          │          │         │   │        │        │        │
│  Column      │          │ Content  │ Sidebar │   │ Main   │Sidebar │Widget  │
│              │          │ (2 col)  │         │   │(3 col)         │        │
│──────────────│          │          │         │   │────────┴────────┴────────│
│  [Bottom Nav]│          │─────────────────────│   │ [Footer Menu]            │
└──────────────┘          └─────────────────────┘   └──────────────────────────┘

SafeArea:                 Safe borders on             Standard desktop
Notch/island support      tablets with notches       padding (48px sides)
Full-width cards          Cards side-by-side         3-column layouts
Full-height sections      Balanced whitespace        Dense info display
```

---

## Example: Home Page Layout

```
DARK MODE                               LIGHT MODE
┌─────────────────────────────┐        ┌─────────────────────────────┐
│ [Menu]  Consuela  [Wea] [☀️]│        │ [Menu]  Consuela  [Wea] [🌙]│
├─────────────────────────────┤        ├─────────────────────────────┤
│                             │        │                             │
│  [👨] [👩] [👦] [👧]        │        │  [👨] [👩] [👦] [👧]        │
│                             │        │                             │
│  Mon, May 20                │        │  Mon, May 20                │
│                             │        │                             │
│ Good morning, Garcia Family!│        │ Good morning, Garcia Family!│
│ 8:34 AM · 72°F Sunny        │        │ 8:34 AM · 72°F Sunny        │
│                             │        │                             │
│ ┌─────────────────────────┐ │        │ ┌─────────────────────────┐ │
│ │ 🍝 Pasta Primavera      │ │        │ │ 🍝 Pasta Primavera      │ │
│ │ Today · 25 min          │ │        │ │ Today · 25 min          │ │
│ └─────────────────────────┘ │        │ └─────────────────────────┘ │
│                             │        │                             │
│ Today's Events              │        │ Today's Events              │
│ ┌─────────────────────────┐ │        │ ┌─────────────────────────┐ │
│ │ ├─ 9:00 AM Team Check-in│ │        │ │ ├─ 9:00 AM Team Check-in│ │
│ │ ├─ 1:30 PM Lunch        │ │        │ │ ├─ 1:30 PM Lunch        │ │
│ │ └─ 4:00 PM Pickup       │ │        │ │ └─ 4:00 PM Pickup       │ │
│ └─────────────────────────┘ │        │ └─────────────────────────┘ │
│                             │        │                             │
│ [What's for dinner?]        │        │ [What's for dinner?]        │
│ [Add event] [Plan week]     │        │ [Add event] [Plan week]     │
│                             │        │                             │
├─────────────────────────────┤        ├─────────────────────────────┤
│ [Home][Cal][Chat][Meal][Tsk]│        │ [Home][Cal][Chat][Meal][Tsk]│
└─────────────────────────────┘        └─────────────────────────────┘

Same layout, inverted colors, CSS variables handle automatically
```

---

## Implementation Priority (Design-Only)

```
PHASE 1: ✓ COMPLETE
├─ CSS variable system (light/dark palettes)
├─ React Context for theme state
├─ localStorage persistence
└─ useTheme hook + ThemeProvider

PHASE 2: NEXT (Design Ready)
├─ Update all UI components
├─ Test light mode rendering
├─ Ensure color contrast
└─ Accessibility validation

PHASE 3: PAGE DESIGNS
├─ Refine home page layout
├─ Calendar visual design
├─ Chat bubble styling
├─ Emergency page
├─ Grocery grouping
├─ Meals grid
├─ Settings panel
└─ Tasks columns

PHASE 4: ANIMATIONS
├─ Gradient orb animations
├─ Page transitions
├─ Button states
└─ Theme toggle icon

PHASE 5: POLISH
├─ Contrast ratio testing
├─ Keyboard navigation
├─ Screen reader testing
├─ Reduced motion support
└─ Performance optimization
```

---

**Design Specification Complete — Ready for Implementation Planning**
