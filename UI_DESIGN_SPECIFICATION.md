# Consuela Dashboard — UI/Theme Design Specification

**Status:** Design Phase (No Implementation)  
**Date:** May 20, 2026  
**Project:** Home-ai (Family AI Organizer)  
**Tech Stack:** Next.js 16.2.6 + React 19 + Tailwind CSS 4.1.17 + TypeScript

---

## 1. Design Principles

The Consuela dashboard should embody **Apple-like aesthetics** with a focus on:

- **Clarity** — Minimal, intuitive interfaces that surface information without clutter
- **Depth** — Glass morphism and layered surfaces create visual hierarchy
- **Motion** — Smooth transitions and subtle animations provide feedback
- **Accessibility** — Dark/light modes, high contrast options, semantic HTML
- **Consistency** — Unified design system across all pages and features

---

## 2. Theme System Overview

### 2.1 Theme Modes

**Three theme options available to users:**

1. **Dark Mode** (Default)
   - Background: Deep navy-to-gray gradient (`#0f1117` → `#434e60`)
   - Text: Light blue-tinted whites (`#f0f4ff`)
   - Glass: Semi-transparent dark overlays (50% dark surface, 20px blur)
   - Best for: Evening use, low-light environments, OLED screens

2. **Light Mode**
   - Background: Clean whites and subtle grays (`#ffffff` → `#bfc6d8`)
   - Text: Deep near-blacks (`#1a1a1a`)
   - Glass: Semi-transparent white overlays (60% white, 20px blur)
   - Best for: Daytime use, bright environments, accessibility

3. **System Mode** (Default option)
   - Automatically follows OS/browser preference
   - Respects `prefers-color-scheme` media query
   - Users can override at any time
   - Persists to localStorage for next session

### 2.2 Accent Colors (6 Total)

Users can choose one primary accent color for highlights, interactive elements, and emphasis:

| Accent | Dark Mode | Light Mode | Use Case |
|--------|-----------|-----------|----------|
| **Nori** (Default) | `#3b82f6` | `#2563eb` | Primary brand, trust, navigation |
| **Violet** | `#7c6ff7` | `#7c3aed` | Special events, premium features |
| **Rose** | `#f43f5e` | `#e11d48` | Urgent/important, alerts |
| **Cyan** | `#06b6d4` | `#0891b2` | Information, secondary actions |
| **Mint** | `#4ade80` | `#059669` | Success, completed tasks |
| **Amber** | `#f59e0b` | `#d97706` | Warnings, pending items |

---

## 3. Theme Toggle Button

### 3.1 Button Placement & Visibility

**Location:** Top-right corner of TopBar component

```
┌─────────────────────────────────────┐
│  [Home] [Calendar] [Tasks] [Settings] [☀️/🌙] │
└─────────────────────────────────────┘
```

**Accessibility:**
- Always visible and accessible
- Works on mobile and desktop
- Clear visual feedback on interaction
- Keyboard navigable (Tab key)

### 3.2 Button Design

**Visual Style:**
- **Size:** 40×40 pixels (touch target)
- **Icon:** 
  - Sun icon (☀️) when in dark mode → indicates switching to light
  - Moon icon (🌙) when in light mode → indicates switching to dark
- **Background:** Transparent or subtle glass (`glass-subtle` class)
- **Border:** Thin 1px, theme-aware opacity
- **Hover State:** 
  - Slight lift/shadow increase (3D effect)
  - Background opacity increase
  - Icon color shift toward accent color
- **Active State:** 
  - Scale slightly (0.95x)
  - Filled background

**Icon Specifications:**
```
Sun Icon (Light Mode Available):
- Stroke width: 2px
- Size: 20×20px inside button
- Color: var(--color-text-primary)
- Rotation: No rotation
- Opacity: 0.8 default, 1.0 hover

Moon Icon (Dark Mode Available):
- Stroke width: 2px
- Size: 20×20px inside button
- Color: var(--color-text-primary)
- Rotation: Slightly tilted (-15deg)
- Opacity: 0.8 default, 1.0 hover
```

### 3.3 Button Interactions

**On Click:**
- Immediately toggle between dark/light
- Animate icon rotation (180° spin)
- Fade out old theme, fade in new (150ms)
- Save preference to localStorage
- Trigger CSS variable refresh
- No loading state (instant)

**Accessibility:**
```
aria-label: "Switch to [light/dark] theme"
role: "button"
keyboard: Accessible via Tab + Enter/Space
```

---

## 4. Color Token System

### 4.1 Color Variables (CSS Custom Properties)

All colors use CSS variables for theme switching. Variables follow this naming convention:

```css
--color-{category}-{shade}
```

**Categories:**
- `nori` — Primary brand color (11 shades: 50, 100, 200, ... 950)
- `surface` — Background layers (8 shades: 0-7)
- `text` — Text colors (4 levels: primary, secondary, muted, dim)
- `accent-{color}` — Accent color options (6 colors)
- `gradient-{start/end}` — Animated gradients

**Example Usage:**
```css
background-color: var(--color-surface-1);
color: var(--color-text-primary);
border-color: var(--color-accent-violet);
```

### 4.2 Color Palettes

**Dark Mode (Default):**
```
Surface:      #0f1117 #181c24 #1e2330 #252c3a #2d3548 #323b4d #3a4456 #434e60
Text Primary: #f0f4ff
Text Secondary: #8892aa
Text Muted:   #4e5a72
Text Dim:     #363e50
```

**Light Mode:**
```
Surface:      #ffffff #f8f9fb #f0f2f7 #e7ebf3 #dde3ed #d3dae7 #c9d1e0 #bfc6d8
Text Primary: #1a1a1a
Text Secondary: #5a5a5a
Text Muted:   #8a8a8a
Text Dim:     #ababab
```

**High Contrast Mode:**
- Text Primary: #000000 (dark) or #ffffff (light)
- Text Secondary: #2d2d2d / #666666
- Applied when `data-contrast="boost"`

---

## 5. Component Design System

### 5.1 Card Component (Glass Morphism)

**Three Variants:**

#### Variant 1: Standard Card (`.glass`)
```
Background: 50% opacity surface color
Blur: 20px
Border: 1px solid, 8% white opacity (dark) / 6% black opacity (light)
Shadow: 0 8px 32px, 8% black opacity (dark) / 6% opacity (light)
Padding: 1rem (16px)
Border Radius: 1.5rem (24px)
Transition: All 0.3s ease
```

Used for: Main content areas, feature sections, daily highlights

#### Variant 2: Strong Card (`.glass-strong`)
```
Background: 75% opacity surface color
Blur: 20px
Border: 1px solid, 30% white opacity (dark) / 8% black opacity (light)
Shadow: 0 8px 32px, 12% black opacity (dark) / 8% opacity (light)
Padding: 1rem
Border Radius: 1.5rem
```

Used for: Interactive cards, buttons, primary CTAs, modals

#### Variant 3: Subtle Card (`.glass-subtle`)
```
Background: 35% opacity surface color
Blur: 12px
Border: 1px solid, 5% white opacity (dark) / 3% black opacity (light)
Shadow: 0 4px 16px, 6% black opacity (dark) / 4% opacity (light)
Padding: 0.75rem
Border Radius: 1.5rem
```

Used for: Badges, pills, secondary info, background layers

### 5.2 Button Component

**Button Sizes:**
- `xs`: 32px height, 0.75rem padding, 0.875rem text
- `sm`: 36px height, 0.875rem padding, 0.875rem text
- `md`: 40px height, 1rem padding, 1rem text (default)
- `lg`: 48px height, 1.25rem padding, 1.125rem text
- `icon`: 40×40px, centered icon

**Button Variants:**
- `primary` — Solid color, full background (glass-strong)
- `secondary` — Outlined, border only
- `ghost` — Transparent background, text/icon only (theme toggle)
- `danger` — Rose/red accent (emergency actions)
- `success` — Mint/green accent (confirmations)

**States:**
- **Default**: Full opacity, normal scale
- **Hover**: Opacity +10%, scale 1.05, shadow increase
- **Active**: Scale 0.98, background opacity +20%
- **Disabled**: Opacity 50%, no hover/active states, cursor not-allowed
- **Loading**: Spinner animation, pointer-events none

### 5.3 Badge Component

**Sizes:**
- `sm`: Padding 0.375rem 0.75rem, text 0.75rem
- `md`: Padding 0.5rem 1rem, text 0.875rem (default)
- `lg`: Padding 0.625rem 1.25rem, text 1rem

**Variants:**
- `default` — Surface-3 background with text-secondary
- `accent` — Accent color background with white text
- `outline` — Transparent, accent color border and text
- `status` — Predefined colors (green=done, amber=pending, rose=urgent)

### 5.4 TopBar Component

**Layout (Horizontal):**
```
┌─────────────────────────────────────────────┐
│ [Logo/Menu]  [Title]      [Weather] [Theme] │
└─────────────────────────────────────────────┘
```

**Elements:**
- **Menu Button** (left): Hamburger icon, 40px, opens navigation
- **Page Title** (center): Large, bold, accent-colored
- **Weather Widget** (right): Compact weather + temp, 60px width
- **Theme Toggle** (far right): Sun/Moon icon button, 40px
- **Safe Area**: Respects `safe-area-inset-*` on notched devices

**Styling:**
- Background: `glass-strong` card style
- Height: 64px (including safe area padding)
- Sticky: Stays at top while scrolling
- Shadow: Subtle drop shadow when scrolled

### 5.5 BottomNav Component

**Mobile Navigation (5 Items, equally spaced):**
```
┌──────┬──────┬──────┬──────┬──────┐
│ Home │ Cal  │ Chat │ Meal │ Task │
└──────┴──────┴──────┴──────┴──────┘
```

**Styling:**
- Background: `glass-strong` with `backdrop-filter`
- Height: 60px + safe area padding
- Items: Centered icon + label (mobile) or icon only (small screen)
- Active Item: Accent color, slightly larger scale
- Transitions: 0.2s ease for all changes

---

## 6. Page Designs

### 6.1 Home Page (`/`)

**Sections (top to bottom):**

1. **Family Avatars Row**
   - Circular avatars (40px) with member initials/emoji
   - Clickable to open member profile
   - Max 4 visible, overflow into "more" button
   - Colors: Each member has fixed accent color

2. **Date Pill**
   - Displays: Mon, May 20
   - Style: Subtle pill with border
   - Updates in real-time
   - Click to open calendar date picker

3. **Greeting Section**
   - Dynamic greeting: "Good morning/afternoon/evening, {Family}!"
   - Current time below
   - Weather widget (temp, condition, icon)
   - No card background, just text

4. **Gradient Orb Background**
   - 4 animated orbs using radial gradients
   - Colors: Lavender, Coral, Mint, Amber
   - Slow floating animation (6s cycle)
   - Behind all content (`z-index: -10`)
   - Different delays for each orb

5. **Meal Plan Card**
   - Weekly meal grid (Mon-Fri)
   - Today's meal highlighted with accent color
   - Each meal shows emoji + name
   - Tap to view full details/recipes

6. **Today's Events Section**
   - List of events with time and member assigned
   - Left border color = member's accent color
   - Red badge if urgent/RSVP needed
   - Tap to edit or mark done

7. **Quick Action Buttons**
   - 4 buttons in grid: "What's for dinner?", "Add event", "Plan week", "Grocery"
   - Primary variant buttons
   - Larger touch targets

8. **Pending Tasks**
   - Sorted by priority (points)
   - Left border color = priority level
   - Checkboxes to mark complete
   - Smooth strikethrough animation

9. **Family Schedule**
   - Today's schedule timeline (8am - 8pm)
   - Color-coded by member
   - Compact horizontal cards

### 6.2 Calendar Page (`/calendar`)

**Design:**
- Large calendar month view (portrait)
- Event dots/badges on days with events
- Tap day to see events for that day
- Swipe left/right to change month
- Family member legend with accent colors
- "Today" button to jump to current date
- All-day events at top of day view
- Timed events in scrollable timeline

**Color Coding:**
- Each member's events = their accent color
- Green highlight = today
- Current month = full opacity, other months = 30% opacity

### 6.3 Chat Page (`/chat`)

**Design:**
- Conversational interface
- Input area at bottom with send button
- Messages in bubbles (user right, assistant left)
- Typing indicator animation
- Message timestamps
- Scroll to latest message on new message
- Voice input button (mic icon in input)
- Quick action chips above input

**Styling:**
- User messages: Accent color background, white text
- Assistant messages: Surface-2 background, text-primary
- Input: Strong glass card at bottom, keyboard-aware safe area

### 6.4 Emergency Page (`/emergency`)

**Design:**
- Large red emergency button (prominent)
- Status indicator (ready, testing, armed)
- Contact list with phone/email
- Recent emergency log
- Settings toggle for auto-alerts
- Test mode to practice

**Color:**
- Primary accent: Rose/Red
- Background: Warning color overlay (subtle)
- Button: Large, pulsing animation when armed

### 6.5 Grocery Page (`/grocery`)

**Design:**
- Checklist of grocery items
- Grouped by category (Produce, Dairy, Pantry, etc.)
- Tap to check off
- Swipe to delete or edit quantity
- Add new item button at bottom
- Sort/filter options
- Share list button
- Calculate estimated cost

**Styling:**
- Checked items: Strikethrough + 50% opacity
- Unchecked: Full opacity, interactive
- Categories: Expandable sections with headers
- Buttons: Small secondary buttons for actions

### 6.6 Meals Page (`/meals`)

**Design:**
- Weekly meal plan grid (7 days)
- Drag & drop to rearrange
- Tap meal to view recipe/ingredients
- Add meal button (+ icon)
- Meal suggestions based on pantry
- Nutrition info summary
- Dietary restriction filters

**Styling:**
- Each day: Card with meal name, emoji, prep time
- Today's meal: Highlighted with accent glow
- Empty slot: Dashed border, lighter opacity

### 6.7 Settings Page (`/settings`)

**Design:**
- User profile section (avatar, name, email)
- Family members list (add/remove)
- Theme settings:
  - Mode selector (Dark/Light/System) with radio buttons
  - Accent color picker (6 color swatches)
  - High contrast toggle
  - Preview of current theme
- Notification settings
- Calendar integration
- About & version info

**Styling:**
- Settings grouped into sections with headers
- Toggle switches for boolean settings
- Color swatches: 40×40px, rounded, border highlight on selection
- Preview card: Live update as settings change

### 6.8 Tasks Page (`/tasks`)

**Design:**
- Task list with priority indicators
- Grouped by status (To Do, In Progress, Done)
- Drag & drop between columns
- Tap to edit task details
- Add new task button
- Assign to family member
- Set due date and priority
- Recurring task support

**Styling:**
- Status columns: Light background sections
- Tasks: Cards with left border (priority color)
- Points badge: Small badge showing point value
- Done tasks: Strikethrough, 40% opacity
- Drag preview: Semi-transparent while dragging

---

## 7. Animation & Motion Specifications

### 7.1 Global Transitions

**Default transition timing:**
```css
transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
/* Easing: Material Design "standard" easing */
```

**Fast transitions (UI feedback):**
```css
transition: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
/* Used for: Button states, color changes, simple movements */
```

**Slow transitions (emphasis):**
```css
transition: 0.5s cubic-bezier(0.4, 0, 0.2, 1);
/* Used for: Page changes, large element movements, theme toggle */
```

### 7.2 Specific Animations

**Gradient Orbs** (Background)
- Animation: `float 20s infinite ease-in-out`
- Each orb has different `animation-delay`: 0s, 2s, 4s, 6s
- Movement: ±50px in X and Y directions
- Opacity pulse: 0.3 → 0.5 → 0.3

**Page Entry**
- Opacity: 0 → 1 (0.4s)
- Transform: `translateY(10px)` → `translateY(0)`
- Staggered: Each card delays +50ms

**Button Hover**
- Scale: 1 → 1.05
- Shadow: Increase by 8px Y offset
- Duration: 0.2s

**Card Glow** (Interactive cards)
- Border color: Accent/20% → Accent/40%
- Box-shadow: Inner glow effect (0 0 20px accent/10%)
- Duration: 0.3s

**Theme Toggle Icon**
- Rotation: 0deg → 180deg (0.5s)
- Opacity: 1 → 0.7 → 1
- Scale: 1 → 0.8 → 1

**List Item Checkboxes**
- Unchecked → Checked: Scale 0.8 → 1, opacity 0 → 1 (0.3s)
- Checked text: Strikethrough animation with `text-decoration-line: line-through`

---

## 8. Accessibility Requirements

### 8.1 Color Contrast

**Minimum ratios (WCAG AA):**
- Text primary on surface-0: 15:1 (dark), 12:1 (light)
- Text secondary on surface-1: 8:1
- Interactive elements: 3:1 minimum for focus indicators

### 8.2 Focus States

All interactive elements must have visible focus indicators:
```css
:focus-visible {
  outline: 2px solid var(--color-accent-nori);
  outline-offset: 2px;
}
```

### 8.3 High Contrast Mode

When `prefers-contrast: more`:
- All borders and outlines: 2px (from 1px)
- Text: #000000 or #ffffff (no gradients)
- Opacity: No elements below 70% opacity (except disabled)
- Animations: Reduced motion respected

### 8.4 Reduced Motion

When `prefers-reduced-motion: reduce`:
```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; }
  * { transition: none !important; }
}
```

### 8.5 Semantic HTML

- Buttons: `<button>` or `<a role="button">` (never `<div>` for clickables)
- Images: Proper `alt` text for all non-decorative images
- Forms: Associated labels, `aria-label` for icon buttons
- Headings: Logical hierarchy (no skipping h1→h3)
- Lists: Use semantic `<ul>`, `<ol>`, `<li>`

### 8.6 ARIA Attributes

Required on all interactive elements:
- `aria-label`: For icon-only buttons (theme toggle, menu, etc.)
- `aria-pressed`: For toggle buttons
- `aria-disabled`: For disabled buttons
- `role`: For custom button/link implementations
- `aria-live`: For status updates (theme change notification)

---

## 9. Responsive Design

### 9.1 Breakpoints

- **Mobile**: < 640px (single column, full-width cards)
- **Tablet**: 640px - 1024px (2-column layout options)
- **Desktop**: > 1024px (3-column+ layouts)

### 9.2 Safe Area Padding

Respect notched devices:
```css
padding-top: calc(1rem + env(safe-area-inset-top));
padding-bottom: calc(1rem + env(safe-area-inset-bottom));
padding-left: env(safe-area-inset-left);
padding-right: env(safe-area-inset-right);
```

### 9.3 Touch Targets

Minimum size: 44×44px for all interactive elements (including padding)

---

## 10. Implementation Checklist (Design Only)

### Phase 1: Theme Infrastructure ✓
- [x] CSS variable system (light/dark palettes)
- [x] React Context for theme state
- [x] localStorage persistence
- [x] System preference detection
- [ ] Theme Toggle button component (ready to implement)

### Phase 2: Component Updates
- [ ] Update Card component with light mode opacity values
- [ ] Update Button component with all variants and states
- [ ] Update Badge component with accent color support
- [ ] Update TopBar with theme toggle placement
- [ ] Update BottomNav with light mode styling

### Phase 3: Page Redesigns
- [ ] Home page gradient orbs and layout
- [ ] Calendar page visual design
- [ ] Chat page bubble styling
- [ ] Emergency page with large button
- [ ] Grocery page with category grouping
- [ ] Meals page with weekly grid
- [ ] Settings page with theme picker
- [ ] Tasks page with Kanban columns

### Phase 4: Animations & Polish
- [ ] Gradient orb animations
- [ ] Page entry animations
- [ ] Button hover/active states
- [ ] Theme toggle animation
- [ ] Smooth color transitions

### Phase 5: Accessibility
- [ ] Contrast ratio testing
- [ ] Focus state testing
- [ ] High contrast mode validation
- [ ] Reduced motion support
- [ ] Keyboard navigation audit
- [ ] Screen reader testing

---

## 11. Design Assets & References

**Color Inspiration:**
- Dark mode derived from GitHub's dark color scheme (trust, modern)
- Light mode: Clean, minimalist (Apple-inspired)
- Accent colors: Vibrant but not overwhelming

**Typography:**
- Font family: Geist Sans (primary), Geist Mono (code)
- Font weights: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)
- Sizes: 12px (caption) → 32px (h1)

**Spacing System:**
- Base unit: 4px
- Common sizes: 4, 8, 12, 16, 24, 32, 48px
- Card padding: 16px
- Section margins: 24px

**Shadows (Dark Mode):**
- Small: `0 2px 8px rgba(0, 0, 0, 0.12)`
- Medium: `0 4px 16px rgba(0, 0, 0, 0.16)`
- Large: `0 8px 32px rgba(0, 0, 0, 0.24)`

---

## 12. Design System Files Location

```
src/
├── app/
│   └── globals.css          [CSS variables, glass effects]
├── lib/
│   └── theme-config.ts      [Type definitions, color exports]
├── hooks/
│   └── useTheme.ts          [Theme context & persistence]
├── components/
│   └── ui/
│       ├── Card.tsx         [Glass morphism cards]
│       ├── Button.tsx       [Button component + variants]
│       ├── Badge.tsx        [Badge component + variants]
│       ├── TopBar.tsx       [App header + theme toggle]
│       ├── BottomNav.tsx    [Mobile navigation]
│       └── ThemeToggle.tsx  [Sun/Moon toggle button]
└── app/
    ├── layout.tsx           [Theme provider wrapper]
    ├── page.tsx             [Home page design]
    ├── calendar/page.tsx    [Calendar design]
    ├── chat/page.tsx        [Chat design]
    ├── emergency/page.tsx   [Emergency design]
    ├── grocery/page.tsx     [Grocery design]
    ├── meals/page.tsx       [Meals design]
    ├── settings/page.tsx    [Settings + theme picker]
    └── tasks/page.tsx       [Tasks design]
```

---

## 13. Notes for Implementation Team

1. **No hardcoded colors** — Use `var(--color-*)` for all colors
2. **Always include both states** — Dark AND light mode colors in globals.css
3. **Test accessibility** — Use browser dev tools: DevTools → Accessibility panel
4. **Mobile first** — Design for mobile first, expand to tablet/desktop
5. **Preserve existing logic** — Only update styling and component shells
6. **Git workflow** — Single feature branch, small PRs for each component

---

**End of Design Specification**
