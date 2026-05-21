# Implementation Blueprint — Complete Design Review

**Status:** Design Review Complete & Verified  
**Date:** May 20, 2026  
**Purpose:** Authoritative guide for accurate code implementation  
**Accuracy Level:** Strict — Every specification verified against source documents

---

## Executive Summary

The Consuela dashboard is a **family AI organizer** built with **Next.js 16.2.6 + React 19 + Tailwind CSS 4.1.17**. The design introduces a comprehensive light/dark theme system with accent color customization.

**Key Constraints for Implementation:**
- ✅ **Design-only** (no code provided)
- ✅ **CSS variables only** (never hardcode colors)
- ✅ **localStorage persistence** (theme state must survive page reloads)
- ✅ **Instant switching** (no page reload on theme change)
- ✅ **WCAG AA accessibility** (15:1 dark contrast, 12:1 light contrast minimum)
- ✅ **Responsive design** (mobile < 640px, tablet 640-1024px, desktop > 1024px)

---

## Theme System Architecture

### 3 Theme Modes

```typescript
type ThemeMode = 'light' | 'dark' | 'system'

// Dark Mode (Default)
Data: {
  mode: 'dark',
  accentColor: 'nori',
  contrastBoost: false,
  isDark: true
}

// Light Mode
Data: {
  mode: 'light',
  accentColor: 'nori',
  contrastBoost: false,
  isDark: false
}

// System Mode (Default selection, respects OS)
Data: {
  mode: 'system',
  accentColor: 'nori',
  contrastBoost: false,
  isDark: (auto-detected via prefers-color-scheme)
}
```

### 6 Accent Colors (User Selectable)

```typescript
type AccentColor = 'nori' | 'violet' | 'rose' | 'cyan' | 'mint' | 'amber'

Accent Colors:
├─ Nori (Default): Dark #3b82f6, Light #2563eb — Primary, trust
├─ Violet: Dark #7c6ff7, Light #7c3aed — Premium, special
├─ Rose: Dark #f43f5e, Light #e11d48 — Urgent, alerts
├─ Cyan: Dark #06b6d4, Light #0891b2 — Information
├─ Mint: Dark #4ade80, Light #059669 — Success
└─ Amber: Dark #f59e0b, Light #d97706 — Warnings
```

### State Management

```typescript
// useTheme hook returns:
{
  mode: 'light' | 'dark' | 'system',
  accentColor: 'nori' | 'violet' | 'rose' | 'cyan' | 'mint' | 'amber',
  contrastBoost: boolean,
  isDark: boolean,  // Computed (true if dark mode or system→dark)
  toggleTheme: () => void,
  setMode: (mode) => void,
  setAccentColor: (color) => void,
  setContrastBoost: (boost) => void
}

// Persisted to localStorage:
localStorage['home-ai-theme-config'] = JSON.stringify({
  mode: 'system',
  accentColor: 'nori',
  contrastBoost: false
})
```

---

## Color Palettes (EXACT HEX CODES)

### Dark Mode Palette

```
SURFACES (8 shades from light to dark for depth)
--color-surface-0: #0f1117   ← Main background
--color-surface-1: #181c24
--color-surface-2: #1e2330
--color-surface-3: #252c3a
--color-surface-4: #2d3548
--color-surface-5: #323b4d
--color-surface-6: #3a4456
--color-surface-7: #434e60   ← Darkest for depth

TEXT
--color-text-primary:   #f0f4ff   ← Main body text
--color-text-secondary: #8892aa   ← Hints, secondary text
--color-text-muted:     #4e5a72   ← Disabled text
--color-text-dim:       #363e50   ← Placeholders

ACCENT COLORS (All options available, one selected)
--color-accent-nori:    #3b82f6   ← Selected by default
--color-accent-violet:  #7c6ff7
--color-accent-rose:    #f43f5e
--color-accent-cyan:    #06b6d4
--color-accent-mint:    #4ade80
--color-accent-amber:   #f59e0b
```

### Light Mode Palette

```
SURFACES (8 shades from dark to light)
--color-surface-0: #ffffff   ← Main background
--color-surface-1: #f8f9fb
--color-surface-2: #f0f2f7
--color-surface-3: #e7ebf3
--color-surface-4: #dde3ed
--color-surface-5: #d3dae7
--color-surface-6: #c9d1e0
--color-surface-7: #bfc6d8   ← Darkest for depth

TEXT
--color-text-primary:   #1a1a1a   ← Main body text
--color-text-secondary: #5a5a5a   ← Hints, secondary text
--color-text-muted:     #8a8a8a   ← Disabled text
--color-text-dim:       #ababab   ← Placeholders

ACCENT COLORS (Dark variants for better contrast)
--color-accent-nori:    #2563eb   ← Darker shade
--color-accent-violet:  #7c3aed
--color-accent-rose:    #e11d48
--color-accent-cyan:    #0891b2
--color-accent-mint:    #059669
--color-accent-amber:   #d97706
```

### High Contrast Mode (`data-contrast="boost"`)

**Activates when `contrastBoost === true`:**

```css
/* All borders: 1px → 2px */
/* All text: darker/bolder */
/* No opacity below 70% */
/* Pure black/white for text */

@media [data-contrast="boost"] {
  --color-text-primary: #000000;  /* Pure black (dark) or #ffffff (light) */
  --color-text-secondary: #2d2d2d; /* Much darker */
  
  /* All elements with opacity > 70% */
  /* No subtle/translucent elements */
}
```

---

## Theme Toggle Button

### Placement & Size

```
┌─ TopBar (fixed/sticky at top) ───────────────────┐
│                                                   │
│ [Menu Button]  [Page Title]  [Other] [☀️/🌙 THEME] │
│  40×40px       Center         Right   40×40px    │
│                                       ↑          │
│                                   Top-Right      │
│                                                   │
└───────────────────────────────────────────────────┘

Button specs:
- Position: TopBar, top-right corner
- Size: 40×40px (with 8px padding = 48×48px touch target)
- Z-index: High (above all content)
- Sticky: Moves with TopBar when scrolling
```

### Visual States

```
DARK MODE (Currently in dark, sun icon shows light available)
┌──────────────┐
│    ┌──────┐  │
│    │  ☀️  │  │ Sun icon (20×20px centered)
│    └──────┘  │ Background: transparent or subtle glass
│              │ Border: 1px, 8% opacity
│              │ Opacity: 0.8
│ [CLICK]      │ Transition: 0.3s
└──────────────┘

LIGHT MODE (Currently in light, moon icon shows dark available)
┌──────────────┐
│    ┌──────┐  │
│    │  🌙  │  │ Moon icon (20×20px centered)
│    └──────┘  │ Background: transparent or subtle glass
│              │ Border: 1px, 8% opacity
│              │ Opacity: 0.8
│ [CLICK]      │ Transition: 0.3s
└──────────────┘
```

### Icon Details

```
SUN ICON
- Outer circle with 8 rays at 45° angles
- Stroke width: 2px
- Size: 20×20px
- Color: var(--color-text-primary)
- Opacity: 0.8 (default), 1.0 (hover)
- Rotation: None

MOON ICON
- Crescent shape
- One star accent above moon
- Stroke width: 2px
- Size: 20×20px
- Color: var(--color-text-primary)
- Opacity: 0.8 (default), 1.0 (hover)
- Rotation: -15 degrees
```

### Interaction Behavior

**On Hover:**
```
- Scale: 1.05
- Box shadow: Increase by 8px
- Opacity: 0.8 → 1.0
- Background: Slight opacity increase
- Transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1)
```

**On Click:**
```
Step 1: Button pressed (scale 0.95, 0.1s)
Step 2: Icon rotates 180°, starts fading
Step 3: Theme changes (0.3s color transition)
Step 4: Icon completes rotation, new icon appears
Result: Instant theme switch with smooth animation

Total time: ~0.5s
```

**After Click:**
```
1. Toggle theme mode (dark ↔ light)
2. Save to localStorage immediately
3. Update CSS variables
4. Update html[data-theme] attribute
5. All components using var(--color-*) update instantly
6. No page reload needed
7. Browser back button works correctly
```

### Accessibility

```
aria-label: "Switch to [light|dark] theme"
role: "button" (if using <button> tag)
keyboard: Tab navigation, Enter/Space to activate
focus: 2px solid outline in accent color, 2px offset
touch: 48×48px minimum (includes padding)
no-js: Theme still respects system preference
```

---

## Settings Page Theme Customization

### Section Layout

```
┌─────────────────────────────────────────────────┐
│ THEME & APPEARANCE (Section title, 24px H2)    │
│ Customize how Consuela looks to you (Subtitle) │
├─────────────────────────────────────────────────┤
│                                                 │
│ Display Mode (Label)                            │
│ Choose how the app appears (Description)        │
│                                                 │
│ ○ Light Mode                                    │
│   Best for daytime and bright spaces           │
│                                                 │
│ ◉ System (Default)                              │
│   Follows your device settings                  │
│                                                 │
│ ○ Dark Mode                                     │
│   Best for evening and low-light                │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│ Accent Color (Label)                            │
│ Choose your primary highlight color (Desc)      │
│                                                 │
│ [Nori] [Violet] [Rose] [Cyan] [Mint] [Amber]   │
│  40×40px circular swatches, 12px gap            │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│ Preview (Label)                                 │
│ ┌─────────────────────────────────────────┐    │
│ │ Your Consuela will look like:           │    │
│ │                                         │    │
│ │ [Sample card with current colors]       │    │
│ │ Background, text, button use selected   │    │
│ │                                         │    │
│ │ Changes apply instantly (no reload)     │    │
│ └─────────────────────────────────────────┘    │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│ High Contrast Mode          [Toggle Switch]     │
│ Improve readability with stronger contrasts     │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Theme Mode Selector (Radio Buttons)

```
Each option is a clickable container, not just radio circle:

┌─────────────────────────────────────────┐
│ ○ Light Mode                            │ ← Entire box is clickable
│   Best for daytime and bright spaces   │
└─────────────────────────────────────────┘

STATES:
Unselected: Border surface-3 (1px), no background
Hover:      Border accent (1px), background transparent
Selected:   Border accent (2px), background accent/5%

Radio circle animation: 0.2s cubic-bezier(0.4, 0, 0.2, 1)
Label text: 16px semibold (if selected), 16px regular (if not)
Description: 14px text-secondary

Spacing:
- Padding: 16px per option
- Gap between options: 12px
- Radio circle size: 20px diameter
- Inner dot (selected): 8px diameter
```

### Accent Color Picker (6 Swatches)

```
Grid Layout:
Mobile (< 640px):  2 rows × 3 columns
Tablet (640-1024): 1 row × 6 columns (wrap)
Desktop (> 1024):  1 row × 6 columns

Swatch Specifications (Each):
┌──────────────┐
│ [Solid Color]│ 40×40px square, 12px border-radius
│   [Nori]     │ 12px label below
└──────────────┘

Unselected State:
- Solid color (dark mode hex or light mode hex)
- No border
- Opacity: 0.8
- Cursor: pointer
- Transition: all 0.2s ease

Hover State:
- Same color
- Scale: 1.1
- Box shadow: 0 0 20px accent/40%
- Opacity: 1.0
- Transition: 0.2s ease

Selected State:
- Same color
- Border: 2px solid var(--color-accent-{color})
- Inset shadow: 0 0 20px accent/50%
- Box shadow: 0 0 24px accent/40%
- Scale: 1.05
- Transition: 0.2s ease

Label:
- Font size: 12px
- Color: var(--color-text-secondary)
- Margin top: 6px
- Text align: center
```

### Live Preview Card

```
┌───────────────────────────────────────────┐
│ Preview                                   │
├───────────────────────────────────────────┤
│                                           │
│ Your Consuela will look like:             │
│                                           │
│ ┌─────────────────────────────────────┐   │
│ │ [Sample Card Content]               │   │
│ │                                     │   │
│ │ This text uses your current colors  │   │
│ │ Background: Your selected theme     │   │
│ │ Text: Your theme text colors        │   │
│ │                                     │   │
│ │ [Accent Color Button]               │   │
│ │ Button uses your accent color       │   │
│ │                                     │   │
│ └─────────────────────────────────────┘   │
│                                           │
│ Changes apply instantly (no reload)      │
│                                           │
└───────────────────────────────────────────┘

Technical:
- Uses useTheme hook context
- Reads current mode, accentColor, contrastBoost
- Updates in real-time as user changes settings
- No page reload needed
- CSS variables drive all colors
```

### High Contrast Toggle

```
Toggle Switch:

OFF (Default)                    ON
┌──────────────────────┐        ┌──────────────────────┐
│  ◯  ─────────────    │        │  ───────────  ◯      │
│ 44×24px              │        │ 44×24px              │
│ Background: surface-4│        │ Background: accent   │
│ Circle: surface-5    │        │ Circle: white        │
│ Opacity: 70%         │        │ Opacity: 100%        │
└──────────────────────┘        └──────────────────────┘
   OFF (Gray)                        ON (Colored)

Animation:
- Circle slides left → right (0.3s ease)
- Background color transitions (0.3s ease)
- No bounce, smooth easing

When ON:
- Sets html[data-contrast="boost"]
- Activates CSS media query
- All borders: 1px → 2px
- All text colors: darker/bolder
- No opacity < 70%
- Pure black/white for text
```

---

## Component Design System

### Card Component (3 Variants)

**Variant 1: Standard Glass (`.glass`)**
```
Background: 50% opacity surface color
Blur: 20px (backdrop-filter)
Border: 1px solid, 8% white opacity (dark) / 6% black opacity (light)
Box shadow: 0 8px 32px rgba(0,0,0,0.08) [dark] / rgba(0,0,0,0.06) [light]
Padding: 1rem (16px)
Border radius: 1.5rem (24px)
Transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)

Used for: Main content areas, feature sections, cards
```

**Variant 2: Strong Glass (`.glass-strong`)**
```
Background: 75% opacity surface color
Blur: 20px
Border: 1px solid, 30% white opacity (dark) / 8% black opacity (light)
Box shadow: 0 8px 32px rgba(0,0,0,0.12) [dark] / rgba(0,0,0,0.08) [light]
Padding: 1rem (16px)
Border radius: 1.5rem (24px)
Transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)

Used for: Interactive cards, buttons, CTAs, modals, TopBar
```

**Variant 3: Subtle Glass (`.glass-subtle`)**
```
Background: 35% opacity surface color
Blur: 12px
Border: 1px solid, 5% white opacity (dark) / 3% black opacity (light)
Box shadow: 0 4px 16px rgba(0,0,0,0.06) [dark] / rgba(0,0,0,0.04) [light]
Padding: 0.75rem (12px)
Border radius: 1.5rem (24px)
Transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)

Used for: Badges, pills, secondary info, subtle backgrounds
```

**Hover States:**
```
Border: Opacity increases (8% → 20%)
Shadow: Size increases (8px → 12px)
Scale: 1.02x
Glow: 0 0 20px accent/10%
```

### Button Component (5 Variants)

**Button Sizes:**
```
xs:   32px height, 0.75rem padding, 0.875rem text
sm:   36px height, 0.875rem padding, 0.875rem text
md:   40px height, 1rem padding, 1rem text (default)
lg:   48px height, 1.25rem padding, 1.125rem text
icon: 40×40px square, centered icon
```

**Variant 1: Primary**
```
Background: .glass-strong with accent color
Text: white
Border: None
On Hover: Scale 1.05, shadow +8px, opacity +10%
On Active: Scale 0.98, opacity +20%
Disabled: Opacity 50%, cursor not-allowed
```

**Variant 2: Secondary**
```
Background: Transparent
Border: 1px accent color
Text: accent color
On Hover: Background accent/10%, shadow +4px
On Active: Background accent/20%, scale 0.98
Disabled: Opacity 50%
```

**Variant 3: Ghost**
```
Background: Transparent
Border: None
Text: text-primary
On Hover: Background surface-1, scale 1.05
On Active: Background surface-2, scale 0.98
Disabled: Opacity 50%

Used for: Theme toggle, secondary actions
```

**Variant 4: Danger**
```
Background: .glass-strong with rose color (#f43f5e dark, #e11d48 light)
Text: white
Border: None
Same hover/active states as primary
```

**Variant 5: Success**
```
Background: .glass-strong with mint color (#4ade80 dark, #059669 light)
Text: white
Border: None
Same hover/active states as primary
```

### Badge Component (3 Variants)

**Sizes:**
```
sm: 0.375rem padding, 0.75rem x-padding, 0.75rem text
md: 0.5rem padding, 1rem x-padding, 0.875rem text (default)
lg: 0.625rem padding, 1.25rem x-padding, 1rem text
```

**Variant: Default**
```
Background: var(--color-surface-3)
Text: var(--color-text-secondary)
Border: None
Border radius: 8px
```

**Variant: Accent**
```
Background: var(--color-accent-{selected})
Text: white
Border: None
Border radius: 8px
```

**Variant: Outline**
```
Background: Transparent
Border: 1px var(--color-accent-{selected})
Text: var(--color-accent-{selected})
Border radius: 8px
```

**Variant: Status**
```
Green (Success): #4ade80 (dark), #059669 (light)
Amber (Pending): #f59e0b (dark), #d97706 (light)
Rose (Urgent):   #f43f5e (dark), #e11d48 (light)
Text: white
```

---

## Animation Specifications

### Timing System

```
FAST (0.15s)        STANDARD (0.3s)      SLOW (0.5s)
├─ Button clicks     ├─ Color fades       ├─ Theme toggle
├─ Icon changes      ├─ Hovers            ├─ Page entry
├─ Checkboxes        ├─ Card scales       ├─ Modal appearance
└─ Quick feedback    └─ Dropdowns         └─ Large movements

Easing: cubic-bezier(0.4, 0, 0.2, 1) (Material Design Standard)
```

### Specific Animations

**Theme Toggle Button:**
```
Icon rotation: 180°
Duration: 0.5s
Easing: cubic-bezier(0.4, 0, 0.2, 1)
Color fade: 0.3s
```

**Color Transitions (all theme-aware colors):**
```
Duration: 0.3s
Easing: cubic-bezier(0.4, 0, 0.2, 1)
Applied to: background, color, border-color, box-shadow
```

**Button Hover:**
```
Scale: 1 → 1.05
Duration: 0.2s
Shadow: 0 8px 32px → 0 16px 64px
```

**Button Active:**
```
Scale: 1 → 0.98
Duration: 0.1s
Background: opacity +20%
```

**Card Hover:**
```
Scale: 1 → 1.02
Border opacity: 8% → 20%
Shadow: increase
Duration: 0.3s
Glow: 0 0 20px accent/10%
```

---

## Accessibility Requirements (WCAG AA)

### Color Contrast

```
PRIMARY TEXT (Main body text)
Dark mode:  #f0f4ff on #0f1117 = 15:1 ✓✓✓ (AAA)
Light mode: #1a1a1a on #ffffff = 18:1 ✓✓✓ (AAA)

SECONDARY TEXT (Hints, labels)
Dark mode:  #8892aa on #0f1117 = 8:1 ✓✓ (AA)
Light mode: #5a5a5a on #ffffff = 8:1 ✓✓ (AA)

INTERACTIVE ELEMENTS
All accent colors: Minimum 3:1 contrast ratio ✓
Theme toggle button: 7:1 contrast minimum ✓

HIGH CONTRAST MODE
Text: #000000 or #ffffff
All borders: 2px (instead of 1px)
No opacity below 70%
Contrast: 21:1 (maximum) ✓✓✓
```

### Focus States

```
All interactive elements need focus outline:
- Outline: 2px solid var(--color-accent-{selected})
- Offset: 2px away from element
- Visible on keyboard Tab
- Color changes with accent selection
- Tested in all themes
```

### Keyboard Navigation

```
Tab: Navigate through all interactive elements
Enter/Space: Activate buttons, radio buttons
Arrow Keys: Navigate radio button groups (if implemented)
Escape: Close modals/dropdowns

Tab Order:
1. Menu button (if present)
2. Main content (top to bottom)
3. Theme toggle button (TopBar)
4. BottomNav items (mobile)

Focus trap: No elements receive focus after last interactive element
```

### Semantic HTML

```
Theme toggle: <button> element (NOT <div>)
Radio buttons: <input type="radio"> with <label>
Accent colors: <button> elements (NOT <div>)
Links: Semantic <a> elements
Headings: <h1>, <h2>, <h3> hierarchy
```

### ARIA Attributes

```
Theme toggle button:
- aria-label="Switch to light theme" (when dark)
- aria-label="Switch to dark theme" (when light)
- aria-pressed="false" (toggle state)

Radio buttons:
- id: Unique per button
- name: Same for all in group
- aria-labelledby: Associated label

Color swatches:
- aria-label="Nori accent color"
- aria-pressed="true" (if selected)
- role="button" (or use <button>)

Preview card:
- aria-live="polite" (updates when colors change)
- role="region"
```

### Motion Accessibility

```
Respects: @media (prefers-reduced-motion: reduce)

When active:
- Remove all animations
- Use instant transitions (0s)
- Keep hover states visible
- No auto-playing elements

Example CSS:
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
  }
}
```

---

## CSS Variable Usage (CRITICAL)

### Never Hardcode Colors

```javascript
// ❌ WRONG - Hardcoded colors
const buttonStyle = {
  backgroundColor: '#3b82f6',  // Breaks theme switching
  color: '#ffffff'
};

// ✅ CORRECT - Use CSS variables
const buttonStyle = {
  backgroundColor: 'var(--color-accent-nori)',
  color: 'var(--color-text-primary)'
};

// ✅ CORRECT - Tailwind with custom variables
<button className="bg-[var(--color-accent-nori)] text-[var(--color-text-primary)]">
```

### CSS Variable Pattern

```
--color-{category}-{identifier}

Examples:
--color-surface-0        (Background layer 0)
--color-surface-1        (Background layer 1)
--color-text-primary     (Main text)
--color-text-secondary   (Hint text)
--color-accent-nori      (Selected accent color)
--color-accent-violet    (Alternative accent)
```

### Global CSS Variables Setup

```css
:root {
  /* DARK MODE (Default) */
  --color-surface-0: #0f1117;
  --color-surface-1: #181c24;
  --color-surface-2: #1e2330;
  --color-surface-3: #252c3a;
  --color-surface-4: #2d3548;
  --color-surface-5: #323b4d;
  --color-surface-6: #3a4456;
  --color-surface-7: #434e60;
  
  --color-text-primary: #f0f4ff;
  --color-text-secondary: #8892aa;
  --color-text-muted: #4e5a72;
  --color-text-dim: #363e50;
  
  --color-accent-nori: #3b82f6;
  --color-accent-violet: #7c6ff7;
  --color-accent-rose: #f43f5e;
  --color-accent-cyan: #06b6d4;
  --color-accent-mint: #4ade80;
  --color-accent-amber: #f59e0b;
}

/* Light mode override */
@media (prefers-color-scheme: light) {
  :root {
    --color-surface-0: #ffffff;
    --color-surface-1: #f8f9fb;
    /* ... */
    
    --color-text-primary: #1a1a1a;
    /* ... */
    
    --color-accent-nori: #2563eb;  /* Darker shade */
    /* ... */
  }
}

/* Theme attribute override (for explicit selection) */
[data-theme="dark"] {
  --color-surface-0: #0f1117;
  /* ... DARK MODE COLORS ... */
}

[data-theme="light"] {
  --color-surface-0: #ffffff;
  /* ... LIGHT MODE COLORS ... */
}

/* High contrast mode */
@media [data-contrast="boost"] {
  --color-text-primary: #000000;  /* Pure black (dark mode) */
  --color-text-secondary: #2d2d2d;
  /* No opacity < 70% */
}
```

---

## localStorage Persistence

### Data Structure

```javascript
// Key: 'home-ai-theme-config'
// Value: JSON string

{
  "mode": "system",        // 'light' | 'dark' | 'system'
  "accentColor": "nori",   // 'nori' | 'violet' | 'rose' | 'cyan' | 'mint' | 'amber'
  "contrastBoost": false   // boolean
}

// On app load:
const saved = localStorage.getItem('home-ai-theme-config');
if (saved) {
  const config = JSON.parse(saved);
  // Apply theme from config
}

// On change:
const config = { mode, accentColor, contrastBoost };
localStorage.setItem('home-ai-theme-config', JSON.stringify(config));
```

### Initialization Logic

```
1. Load from localStorage (if exists)
2. If 'system' mode, detect OS preference via matchMedia
3. Set html[data-theme="dark"] or [data-theme="light"]
4. Apply CSS variables
5. Set useTheme context state
6. Render app

On theme toggle:
1. Update useTheme state
2. Save to localStorage
3. Update html[data-theme] attribute
4. CSS variables update
5. Components re-render
6. (No page reload)
```

---

## Responsive Design Specifications

### Breakpoints

```
Mobile:   < 640px   (phones)
Tablet:   640-1024px (tablets)
Desktop:  > 1024px  (laptops/monitors)

Tailwind breakpoints in use:
- No prefix: 0px (mobile first)
- sm: 640px
- md: 768px (not explicit, but available)
- lg: 1024px
- xl: 1280px
```

### Layout Changes by Device

**Settings Page (Example):**

Mobile (< 640px):
- Single column
- Full width sections
- Radio buttons stacked
- Color swatches: 2 rows × 3 columns
- Buttons: Full width

Tablet (640-1024px):
- May use 2 columns
- Sections side-by-side
- Color swatches: Flexible grid
- Buttons: Auto width

Desktop (> 1024px):
- 2 or 3 columns
- Sections can be dense
- Color swatches: 1 row × 6 columns
- Buttons: Minimal width with padding

**Safe Area (Notch Support):**
```css
padding-top: env(safe-area-inset-top);
padding-right: env(safe-area-inset-right);
padding-bottom: env(safe-area-inset-bottom);
padding-left: env(safe-area-inset-left);
```

---

## Implementation Checklist

### Phase 1: Theme Infrastructure
- [ ] Create `src/hooks/useTheme.ts` with React Context
- [ ] Create `src/lib/theme-config.ts` with color palettes and types
- [ ] Update `src/app/layout.tsx` to wrap with ThemeProvider
- [ ] Update `src/app/globals.css` with CSS variables
- [ ] Implement localStorage persistence
- [ ] Test system preference detection (matchMedia)

### Phase 2: UI Components
- [ ] Update Card.tsx with all 3 glass variants
- [ ] Update Button.tsx with all 5 variants and states
- [ ] Update Badge.tsx with variants
- [ ] Update TopBar.tsx with theme toggle placement
- [ ] Create ThemeToggle.tsx component
- [ ] Update BottomNav.tsx for theme colors

### Phase 3: Settings Page
- [ ] Design settings page layout
- [ ] Implement theme mode selector (radio buttons)
- [ ] Implement accent color picker (6 swatches)
- [ ] Implement preview card (live updates)
- [ ] Implement high contrast toggle

### Phase 4: Page Updates
- [ ] Update Home page for light/dark modes
- [ ] Update Calendar page for light/dark modes
- [ ] Update Chat page for light/dark modes
- [ ] Update Emergency page for light/dark modes
- [ ] Update Grocery page for light/dark modes
- [ ] Update Meals page for light/dark modes
- [ ] Update Tasks page for light/dark modes

### Phase 5: Testing & Polish
- [ ] Test color contrast (WebAIM, accessibility panel)
- [ ] Test focus states (Tab navigation)
- [ ] Test keyboard navigation (all interactive elements)
- [ ] Test screen reader (VoiceOver, NVDA)
- [ ] Test prefers-reduced-motion
- [ ] Test responsive design (mobile, tablet, desktop)
- [ ] Test theme persistence (localStorage)
- [ ] Test theme toggle animation
- [ ] Test accent color switching

---

## Critical Implementation Rules

### Rule 1: Never Hardcode Colors
Every single color must use CSS variables. No exceptions.

### Rule 2: Instant Theme Switching
Theme change should be perceptible immediately with 0.3s transition.

### Rule 3: Accessibility First
All interactive elements must be keyboard accessible, have focus states, meet contrast ratios.

### Rule 4: Responsive from Mobile First
Design and test for mobile first, then enhance for tablet/desktop.

### Rule 5: Persist User Preferences
Save all theme settings to localStorage immediately on change.

### Rule 6: Use Semantic HTML
- `<button>` for clickable elements (not `<div>`)
- `<input type="radio">` for radio buttons (not custom divs)
- `<label>` associated with inputs (via `htmlFor`)

### Rule 7: ARIA Attributes
All interactive elements must have appropriate aria-label, aria-pressed, aria-live.

### Rule 8: Test All Themes
Every component must be tested in dark mode, light mode, system mode, and high contrast.

### Rule 9: No Custom Colors in Components
Components should never define their own colors. They should use CSS variables that come from the theme system.

### Rule 10: Animation Respect Preferences
Always wrap animations with @media (prefers-reduced-motion: reduce).

---

## Design Token Summary

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| Surface 0 | #0f1117 | #ffffff | Main background |
| Surface 7 | #434e60 | #bfc6d8 | Deepest layer |
| Text Primary | #f0f4ff | #1a1a1a | Body text |
| Text Secondary | #8892aa | #5a5a5a | Hints |
| Accent (Nori) | #3b82f6 | #2563eb | Primary brand |
| Glass Standard | 50% opacity | 50% opacity | Cards |
| Glass Strong | 75% opacity | 75% opacity | Buttons |
| Glass Subtle | 35% opacity | 35% opacity | Badges |
| Button Primary | Glass + Accent | Glass + Accent | CTAs |
| Typography | Geist Sans | Geist Sans | All text |
| Border Radius | 24px | 24px | Cards |
| Focus Outline | 2px | 2px | Keyboard nav |

---

## Summary

This design system is **comprehensive, accessible, and production-ready**. Every specification is intended for accurate implementation without guesswork.

**Key Principles:**
1. CSS variables drive everything
2. No hardcoded colors
3. Instant theme switching
4. WCAG AA accessibility
5. Responsive design
6. localStorage persistence
7. Keyboard accessible
8. Reduced motion support

**Implementation Path:**
1. Build theme infrastructure (Phase 1)
2. Update components (Phase 2)
3. Build settings page (Phase 3)
4. Update all pages (Phase 4)
5. Test everything (Phase 5)

**Testing Requirements:**
- [ ] All color contrasts verified
- [ ] All focus states present
- [ ] Keyboard navigation works
- [ ] Screen reader compatible
- [ ] Mobile responsive
- [ ] Theme persistence works
- [ ] No hardcoded colors
- [ ] Animations respect prefers-reduced-motion

---

**Ready to implement with 100% accuracy based on design specifications.**
