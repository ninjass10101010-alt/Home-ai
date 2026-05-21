# Consuela Dashboard — Complete UI/Theme Design Package

**Status:** Design Phase Complete (Ready for Implementation)  
**Date:** May 20, 2026  
**Project:** Home-ai (Family AI Organizer)  
**Created By:** Design Team

---

## Overview

This design package contains **complete specifications** for the Consuela dashboard UI refresh, including:
- Light/Dark/System theme support
- Theme toggle button (sun/moon icons)
- Accent color customization (6 colors)
- All page layouts and component designs
- Accessibility and mobile responsiveness
- Animation and transition specifications

**⚠️ DESIGN PHASE ONLY** — No code has been implemented. Use these documents as the blueprint for implementation.

---

## Design Documents Created

### 1. **UI_DESIGN_SPECIFICATION.md** (Primary Reference)
   - **Contains:** Complete design system overview, all components, all pages, animations, accessibility requirements
   - **Use for:** Understanding the complete vision, reference during implementation
   - **Length:** ~13 sections, comprehensive coverage
   - **Key sections:** 
     - Theme system (dark/light/system modes + 6 accent colors)
     - Component design system (Card, Button, Badge, TopBar, BottomNav)
     - All 8 page designs (Home, Calendar, Chat, Emergency, Grocery, Meals, Settings, Tasks)
     - Animation timings and motion specs
     - Accessibility requirements (WCAG AA, ARIA, focus states)

### 2. **DESIGN_VISUAL_REFERENCE.md** (Quick Reference)
   - **Contains:** Visual mockups, ASCII diagrams, quick color charts, component states
   - **Use for:** Quick lookups, visual inspiration, understanding button/card states
   - **Length:** Compact, highly visual
   - **Key sections:**
     - Theme toggle button anatomy and states
     - Dark/Light color palettes at a glance
     - Glass morphism variants
     - Component state examples
     - Typography and spacing scales
     - Responsive design breakpoints
     - Example: Home page layout in both themes

### 3. **SETTINGS_PAGE_DESIGN.md** (Detailed Page Design)
   - **Contains:** In-depth settings page specification with theme picker, accent color selector, preview
   - **Use for:** Settings page implementation reference
   - **Length:** ~12 sections, very detailed
   - **Key sections:**
     - Full page layout
     - Profile section design
     - Theme mode selector (Light/Dark/System radio buttons)
     - Accent color picker (6 color swatches with preview)
     - High contrast toggle
     - Other settings sections (Notifications, Calendar, About)
     - Interaction flows (how each setting works)
     - Mobile/Tablet/Desktop responsive variations
     - Technical implementation notes (using useTheme hook)
     - Accessibility specifications
     - Design tokens (fonts, spacing, colors)

---

## Key Design Features

### Theme Modes (3 Options)

```
Dark Mode (Default)       Light Mode              System (Auto)
#0f1117 background        #ffffff background      Follows OS preference
#f0f4ff text             #1a1a1a text            Auto-detects
15:1 contrast            12:1 contrast           System.prefers-color-scheme
Glass: Dark blur         Glass: White blur       Switches automatically
```

### Accent Colors (6 Options)

| Color | Dark | Light | Use |
|-------|------|-------|-----|
| Nori (Default) | #3b82f6 | #2563eb | Primary, trust |
| Violet | #7c6ff7 | #7c3aed | Premium, special |
| Rose | #f43f5e | #e11d48 | Urgent, alerts |
| Cyan | #06b6d4 | #0891b2 | Info, secondary |
| Mint | #4ade80 | #059669 | Success, done |
| Amber | #f59e0b | #d97706 | Warnings, pending |

### Theme Toggle Button

```
Location: Top-right of TopBar (always visible)
Size: 40×40px
Icon: Sun (☀️) when in dark mode OR Moon (🌙) when in light mode
Click: Instantly switches between dark/light
Animation: Icon rotates 180°, colors fade transition (0.3s)
Accessible: aria-label, keyboard navigation, 44×44 touch target
```

---

## Component Designs Included

| Component | Variants | Pages |
|-----------|----------|-------|
| Card | Standard, Strong, Subtle (glass morphism) | All |
| Button | Primary, Secondary, Ghost, Danger, Success | All |
| Badge | Default, Accent, Outline, Status | Home, Tasks, Calendar |
| TopBar | Logo, Title, Weather, Theme Toggle | All |
| BottomNav | 5 navigation items | All (mobile) |
| Avatar | 4 sizes, emoji/initials | Home, Profile |
| ThemeToggle | Sun/Moon icons, animated | TopBar |
| RadioButtons | Light/Dark/System mode selector | Settings |
| ColorSwatches | 6 accent colors, selectable | Settings |
| PreviewCard | Live theme preview | Settings |
| ToggleSwitch | High contrast mode | Settings |

---

## Page Designs Included

### 1. Home Page (`/`)
- Family avatars row
- Date pill
- Greeting section with weather
- Animated gradient orb backgrounds
- Weekly meal plan (highlighted today)
- Today's events with color-coded members
- Quick action buttons
- Pending tasks with priority
- Family schedule timeline

### 2. Calendar Page (`/calendar`)
- Month view calendar
- Event dots/badges
- Tap to view day details
- Swipe to change month
- Color-coded by member
- "Today" quick button

### 3. Chat Page (`/chat`)
- Conversational bubbles
- User vs. assistant styling
- Typing indicator
- Voice input option
- Quick action chips

### 4. Emergency Page (`/emergency`)
- Large red emergency button
- Status indicator
- Contact list
- Emergency log history
- Test mode toggle

### 5. Grocery Page (`/grocery`)
- Checklist with categories
- Swipe to delete
- Tap to check off
- Add new item button
- Sort/filter options
- Share list button

### 6. Meals Page (`/meals`)
- Weekly meal grid (7 days)
- Drag & drop reorder
- Tap to view recipe
- Nutrition summary
- Meal suggestions
- Dietary filters

### 7. Settings Page (`/settings`)
- Profile section (edit, sign out)
- **Theme settings** (mode selector, accent color picker, preview)
- High contrast toggle
- Notifications toggles
- Calendar integrations
- About & version info

### 8. Tasks Page (`/tasks`)
- Kanban columns (To Do, In Progress, Done)
- Drag & drop between columns
- Priority color-coding
- Due date & assignment
- Recurring task support

---

## Animation Specifications

### Timing Buckets

```
Fast (UI Feedback)       0.15s cubic-bezier(0.4, 0, 0.2, 1)
├─ Button clicks
├─ Icon changes
└─ Color transitions

Standard (Default)       0.3s cubic-bezier(0.4, 0, 0.2, 1)
├─ Card hovers
├─ Dropdown opens
└─ Element scale

Slow (Emphasis)          0.5s cubic-bezier(0.4, 0, 0.2, 1)
├─ Theme toggle
├─ Page entry
└─ Large movements
```

### Specific Animations

- **Gradient Orbs:** Float 20s infinite, staggered delays (0s, 2s, 4s, 6s)
- **Page Entry:** Fade in + translateY (0.4s)
- **Button Hover:** Scale 1.05, shadow increase (0.2s)
- **Card Glow:** Border color shift, inner glow (0.3s)
- **Theme Toggle Icon:** Rotate 180°, scale pulse (0.5s)
- **Checkbox:** Scale 0.8→1, strikethrough (0.3s)

---

## Accessibility Standards

### Color Contrast (WCAG AA)
- Text primary on surface: 15:1 (dark), 12:1 (light)
- Text secondary: 8:1 minimum
- Interactive elements: 3:1 minimum for borders

### Focus States
```css
:focus-visible {
  outline: 2px solid var(--color-nori);
  outline-offset: 2px;
}
```

### High Contrast Mode
- Respects `prefers-contrast: more`
- All borders: 1px → 2px
- All text: darker/bolder
- No opacity below 70%

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; }
  * { transition: none !important; }
}
```

### Semantic HTML & ARIA
- `<button>` for all clickables
- `aria-label` for icon buttons
- Proper heading hierarchy
- Associated form labels
- `role="switch"` for toggle buttons
- `aria-pressed` for state buttons

---

## Responsive Design

### Breakpoints

```
Mobile:  < 640px   (Single column, full-width cards)
Tablet:  640-1024px (2-column layouts)
Desktop: > 1024px   (3-column layouts, dense info)
```

### Safe Areas
- Respects `env(safe-area-inset-*)` for notched devices
- Notch-aware padding on all pages
- Full-width layouts on mobile
- Centered, max-width layouts on desktop

### Touch Targets
- Minimum 44×44px for all interactive elements
- Theme toggle: 40×40px + padding = 48×48px
- Buttons: 40px height minimum
- Color swatches: 40×40px each

---

## Design System Tokens

### Colors (CSS Variables)

**Dark Mode:**
- Surface: `#0f1117` to `#434e60` (8 shades)
- Text Primary: `#f0f4ff`
- Text Secondary: `#8892aa`
- Text Muted: `#4e5a72`
- Text Dim: `#363e50`

**Light Mode:**
- Surface: `#ffffff` to `#bfc6d8` (8 shades)
- Text Primary: `#1a1a1a`
- Text Secondary: `#5a5a5a`
- Text Muted: `#8a8a8a`
- Text Dim: `#ababab`

### Typography

- **Font:** Geist Sans (primary), Geist Mono (code)
- **Scale:** 11px → 32px
- **Weights:** 400, 500, 600, 700

### Spacing

- **Base:** 4px
- **Common:** 8, 12, 16, 24, 32, 48px
- **Card padding:** 16px
- **Section margin:** 24px

### Shadows (Dark Mode)

- Small: `0 2px 8px rgba(0, 0, 0, 0.12)`
- Medium: `0 4px 16px rgba(0, 0, 0, 0.16)`
- Large: `0 8px 32px rgba(0, 0, 0, 0.24)`

---

## Implementation Roadmap (Phase Plan)

### Phase 1: ✓ Complete (Already Done)
- CSS variable system (light/dark palettes)
- React Context for theme state
- localStorage persistence
- useTheme hook
- ThemeProvider component

### Phase 2: Component Updates (Ready to Implement)
- Update Card with light mode opacity
- Update Button with all variants
- Update Badge styling
- Update TopBar with theme toggle placement
- Update BottomNav for light mode

### Phase 3: Page Redesigns
- Implement home page layout
- Implement calendar page
- Implement chat page
- Implement emergency page
- Implement grocery page
- Implement meals page
- **Implement settings page** (with theme picker)
- Implement tasks page

### Phase 4: Animations & Polish
- Gradient orb animations
- Page entry animations
- Button state animations
- Theme toggle animation

### Phase 5: Accessibility & Testing
- Contrast ratio validation
- Focus state testing
- Keyboard navigation audit
- Screen reader testing
- High contrast mode testing
- Reduced motion testing

---

## Quick Reference Links

| Document | Purpose | When to Use |
|----------|---------|------------|
| [UI_DESIGN_SPECIFICATION.md](UI_DESIGN_SPECIFICATION.md) | Complete design system | Implementation guide, reference |
| [DESIGN_VISUAL_REFERENCE.md](DESIGN_VISUAL_REFERENCE.md) | Visual mockups & quick lookups | Quick color reference, state examples |
| [SETTINGS_PAGE_DESIGN.md](SETTINGS_PAGE_DESIGN.md) | Settings page deep dive | Implementing settings with theme picker |

---

## Color Palette Preview

### Dark Mode
```
┌─────────────────────────────────────┐
│ Surface:  ■■■■■■■■■■■■■■■■■■      │
│ Text:     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓      │
│ Accents:  ■ ■ ■ ■ ■ ■             │
│           B V R C M A             │
│           (6 colors available)     │
└─────────────────────────────────────┘
```

### Light Mode
```
┌─────────────────────────────────────┐
│ Surface:  □□□□□□□□□□□□□□□□□□      │
│ Text:     ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒      │
│ Accents:  ■ ■ ■ ■ ■ ■             │
│           B V R C M A             │
│           (Same 6 colors, darker)  │
└─────────────────────────────────────┘
```

---

## File Structure (After Implementation)

```
src/
├── app/
│   ├── globals.css              [CSS variables + glass effects]
│   ├── layout.tsx               [ThemeProvider wrapper]
│   ├── page.tsx                 [Home page redesigned]
│   ├── calendar/page.tsx        [Calendar page redesigned]
│   ├── chat/page.tsx            [Chat page redesigned]
│   ├── emergency/page.tsx       [Emergency page redesigned]
│   ├── grocery/page.tsx         [Grocery page redesigned]
│   ├── meals/page.tsx           [Meals page redesigned]
│   ├── settings/page.tsx        [Settings with theme picker] ⭐
│   └── tasks/page.tsx           [Tasks page redesigned]
│
├── lib/
│   └── theme-config.ts          [Theme types & color exports]
│
├── hooks/
│   └── useTheme.ts              [Theme context hook] ✓
│
└── components/
    └── ui/
        ├── Card.tsx             [Updated for light mode]
        ├── Button.tsx           [Updated variants]
        ├── Badge.tsx            [Updated colors]
        ├── TopBar.tsx           [Updated with theme toggle]
        ├── BottomNav.tsx        [Updated for light mode]
        ├── Avatar.tsx           [Color support]
        ├── ThemeToggle.tsx      [Sun/Moon button] ✓
        ├── PageShell.tsx        [Updated styling]
        └── [Other components...]
```

**✓** = Already implemented
**⭐** = Most important for theme feature

---

## Next Steps for Implementation Team

1. **Review all three design documents** to understand the complete vision
2. **Start with Phase 2:** Update existing UI components for light mode support
3. **Then implement Phase 3:** Redesign pages using new component variants
4. **Add Phase 4 animations** for polish and smooth transitions
5. **Validate Phase 5 accessibility** before considering complete

Each phase should be in its own feature branch, with pull requests for review.

---

## Design System Philosophy

**"Apple-like Clarity with Glass Morphism"**

- **Clarity:** Minimal, uncluttered interfaces that surface information without distraction
- **Depth:** Glass layers and subtle shadows create visual hierarchy
- **Motion:** Smooth, purposeful animations provide feedback without distraction
- **Accessibility:** Dark/light modes, high contrast options, semantic HTML, ARIA
- **Consistency:** All pages and components follow the same design system

---

## Contact & Questions

For implementation questions about the design:
1. Check the specific design document (see Quick Reference Links above)
2. Look for ASCII diagrams and visual examples
3. Refer to design tokens section for exact values
4. Check Settings page design for theme-specific implementation details

---

**End of Design Package Summary**

**Status:** ✓ DESIGN PHASE COMPLETE  
**Ready for:** IMPLEMENTATION  
**Total Documents:** 3 comprehensive specifications  
**Total Pages:** ~50 pages of design details and mockups  
**Last Updated:** May 20, 2026
