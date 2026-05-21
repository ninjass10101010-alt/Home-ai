# Settings Page — Detailed Design Specification

**Status:** Design Phase  
**Component:** `/src/app/settings/page.tsx`  
**Focus:** Theme settings with light/dark/system mode selector and accent color picker

---

## 1. Settings Page Layout

### Overall Structure

```
┌─────────────────────────────────┐
│ [Menu] Settings          [Theme] │  ← TopBar
├─────────────────────────────────┤
│                                 │
│ ▓▓▓ PROFILE SECTION             │  ← Glass card
│                                 │
│ ▓▓▓ THEME SETTINGS              │  ← Focus area
│                                 │
│ ▓▓▓ NOTIFICATIONS               │
│                                 │
│ ▓▓▓ CALENDAR & INTEGRATIONS     │
│                                 │
│ ▓▓▓ ABOUT & APP INFO            │
│                                 │
├─────────────────────────────────┤
│ [Home][Cal][Chat][Meal][Task]   │  ← BottomNav
└─────────────────────────────────┘
```

**Scroll behavior:** Vertical scroll, sections stack on mobile

---

## 2. Profile Section (Top)

### Design

```
┌─────────────────────────────────────────┐
│  Your Profile                           │
├─────────────────────────────────────────┤
│                                         │
│  [Profile Avatar]   Name: Garcia Family │
│  Large emoji/initials  Email: jgarcia@  │
│                        Member ID: main  │
│                                         │
│  [Edit Profile Button]  [Sign Out]      │
│                                         │
└─────────────────────────────────────────┘
```

**Components:**
- Avatar: Large 64×64px, circular, with initials/emoji
- Name: H3 heading, text-primary
- Email: Small text, text-secondary
- Buttons: Secondary variant, side-by-side on desktop, stacked on mobile
- Background: `.glass` card variant

---

## 3. Theme Settings Section (MAIN FOCUS)

### Section Title

```
┌─────────────────────────────────────────┐
│  Theme & Appearance                     │
├─────────────────────────────────────────┤
│                                         │
│  Customize how Consuela looks to you    │  ← Subtitle
│                                         │
└─────────────────────────────────────────┘
```

**Styling:**
- Title: H2 heading, 24px, text-primary
- Subtitle: 14px, text-secondary, margin-bottom 24px

---

### 3.1 Theme Mode Selector

#### Label & Description

```
┌─────────────────────────────────────────┐
│ Display Mode                            │
│ Choose how the app appears              │
├─────────────────────────────────────────┤
```

#### Radio Button Options (3 choices)

```
┌─────────────────────────────────────────┐
│ ○ Light Mode                            │  ← Option 1
│   Best for daytime and bright spaces   │
│                                         │
│ ◉ System (Default)                      │  ← Option 2 (Selected)
│   Follows your device settings          │
│                                         │
│ ○ Dark Mode                             │  ← Option 3
│   Best for evening and low-light        │
│                                         │
└─────────────────────────────────────────┘
```

**Visual Specifications:**

```
Each radio option:
┌─────────────────────────────────────────┐
│ ○ Option Name                           │
│   Description text (14px)               │
│                                         │
│ Padding: 16px                           │
│ Border: 1px, surface-3 color            │
│ Border radius: 12px                     │
│ Hover: border-color → accent            │
│ Selected: border-color → accent         │
│          background → accent/5%         │
│                                         │
│ Radio circle: 20px diameter             │
│ Inner dot (selected): 8px diameter      │
│                                         │
└─────────────────────────────────────────┘
```

**States:**

```
UNSELECTED              HOVER                SELECTED
┌──────────┐            ┌──────────┐        ┌──────────┐
│ ○ Option │            │ ○ Option │        │ ◉ Option │
│ Border:  │            │ Border:  │        │ Border:  │
│ surface-3            │ accent   │        │ accent   │
│ Text: norm           │ Text: bld│        │ BG:      │
│          │            │          │        │ accent/5%│
└──────────┘            └──────────┘        └──────────┘
```

**Interaction:**
- Click anywhere in option box = select that mode
- Radio circle animates (0.2s cubic-bezier)
- Text color shifts to accent when selected
- Entire box gets accent border highlight

---

### 3.2 Accent Color Picker

#### Label & Description

```
┌─────────────────────────────────────────┐
│ Accent Color                            │
│ Choose your primary highlight color     │
├─────────────────────────────────────────┤
```

#### Color Swatch Grid

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  [Nori]  [Violet]  [Rose]  [Cyan]  [Mint]  [Amber]    │
│   ●       ●         ●       ●       ●      ●          │
│  40×40    40×40     40×40   40×40   40×40  40×40      │
│                                                         │
│  Spacing: 12px between swatches                        │
│  Rows: 2 rows of 3 on mobile, 1 row on desktop        │
│  Selection: 2px solid border + blue shadow            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Swatch Specifications (Each):**

```
40×40px square, 12px border-radius

DARK MODE (Unselected)
┌──────────┐
│ ███████  │  Solid color (e.g., #3b82f6 for Nori)
│ ███████  │  No border
│ ███████  │  Opacity: 0.8
│ ███████  │  Cursor: pointer
└──────────┘  Transition: all 0.2s ease

DARK MODE (Hover)
┌──────────┐
│ ███████  │  Same color
│ ███████  │  Scale: 1.1
│ ███████  │  Shadow: 0 0 20px accent/40%
│ ███████  │  Opacity: 1.0
└──────────┘  Transition: 0.2s ease

DARK MODE (Selected)
┌──────────┐
│ ███████  │  Same color
│ ███████  │  Border: 2px solid var(--color-nori)
│ ███████  │  Inset shadow: 0 0 20px accent/50%
│ ███████  │  Box-shadow: 0 0 24px accent/40%
│ ███████  │  Scale: 1.05
└──────────┘  Transition: 0.2s ease
```

**Light Mode Variations:**

In light mode, swatches show the light mode version of each color (darker shades for contrast):

```
Light Nori: #2563eb (instead of #3b82f6)
Light Rose: #e11d48 (instead of #f43f5e)
Light Mint: #059669 (instead of #4ade80)
etc.
```

**Color Labels Below Swatches:**

```
┌──────────┐
│ ███████  │
│ ███████  │
│ ███████  │
│ ███████  │
└──────────┘
  "Nori"      ← Label: 12px, text-secondary, centered
```

---

### 3.3 Preview Card

#### Live Preview Section

```
┌─────────────────────────────────────────┐
│ Preview                                 │
├─────────────────────────────────────────┤
│                                         │
│ Your Consuela will look like:          │  ← Help text
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ [Sample Card with Selected Colors]  │ │
│ │                                     │ │
│ │ This text uses your current colors  │ │
│ │ Background: Your theme (L/D/System) │ │
│ │                                     │ │
│ │ Button Color: [Your Accent]         │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Changes apply instantly (no reload)    │
│                                         │
└─────────────────────────────────────────┘
```

**Technical:**
- React state updates in real-time
- CSS variables change immediately
- No full page reload needed
- Uses ThemeContext from useTheme hook
- Card shows sample content with current colors
- Text color, background, and accent button all change

---

### 3.4 High Contrast Toggle

#### Accessibility Option

```
┌─────────────────────────────────────────┐
│ High Contrast Mode              [Toggle]│
│ Improve readability with                │
│ stronger color contrasts                │
│                                         │
│ • Borders: 2px instead of 1px          │
│ • Text: Pure black/white               │
│ • Opacity: No elements below 70%       │
│                                         │
└─────────────────────────────────────────┘
```

**Toggle Switch Styling:**

```
OFF (Default)                  ON
┌────────────────┐            ┌────────────────┐
│  ◯  ──────────  │ OFF        │  ───────── ◯  │ ON
│ surface-4 bg   │            │ accent-mint bg │
│ 44×24px        │            │ 44×24px        │
└────────────────┘            └────────────────┘
                              Animation: 0.3s ease
                              Circle slides left→right
```

---

## 4. Other Settings Sections

### Notifications Settings

```
┌─────────────────────────────────────────┐
│ Notifications                           │
├─────────────────────────────────────────┤
│                                         │
│ Push Notifications          [Toggle ON] │
│ Meal reminders              [Toggle ON] │
│ Event notifications         [Toggle ON] │
│ Emergency alerts            [Toggle ON] │
│ Daily digest email          [Toggle OFF]│
│                                         │
└─────────────────────────────────────────┘
```

### Calendar & Integrations

```
┌─────────────────────────────────────────┐
│ Calendar & Integrations                 │
├─────────────────────────────────────────┤
│                                         │
│ Connected Calendars                    │
│ • Google Calendar        [Connected ✓]  │
│ • Apple Calendar         [Disconnected]│
│                                         │
│ [+ Add Calendar]                        │
│                                         │
└─────────────────────────────────────────┘
```

### About & App Info

```
┌─────────────────────────────────────────┐
│ About Consuela                          │
├─────────────────────────────────────────┤
│                                         │
│ App Version:        1.0.0               │
│ Build:              Production          │
│ Last Updated:       May 20, 2026        │
│                                         │
│ [Check for Updates]                     │
│ [View Privacy Policy]                   │
│ [View Terms of Service]                 │
│                                         │
└─────────────────────────────────────────┘
```

---

## 5. Full Settings Page Layout Example

```
┌─────────────────────────────────────────────┐
│ [Menu] Settings              [☀️ Theme] │
├─────────────────────────────────────────────┤
│                                             │
│  YOUR PROFILE                               │
│  ┌─────────────────────────────────────┐   │
│  │ [Avatar] Garcia Family              │   │
│  │ jgarcia@home.local · Main Account   │   │
│  │ [Edit] [Sign Out]                   │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  THEME & APPEARANCE                         │
│  ┌─────────────────────────────────────┐   │
│  │ Display Mode                        │   │
│  │ ○ Light Mode                        │   │
│  │ ◉ System (Default)                  │   │
│  │ ○ Dark Mode                         │   │
│  │                                     │   │
│  │ Accent Color                        │   │
│  │ [🟦] [🟪] [🟥] [🟦] [🟩] [🟨]       │   │
│  │  Nori  Violet Rose Cyan  Mint Amber │   │
│  │                                     │   │
│  │ Preview                             │   │
│  │ ┌─────────────────────────────────┐ │   │
│  │ │ Your theme preview card...      │ │   │
│  │ └─────────────────────────────────┘ │   │
│  │                                     │   │
│  │ High Contrast Mode          [Toggle]│   │
│  └─────────────────────────────────────┘   │
│                                             │
│  NOTIFICATIONS                              │
│  ┌─────────────────────────────────────┐   │
│  │ Push Notifications    [ON ]          │   │
│  │ Meal Reminders        [ON ]          │   │
│  │ Event Alerts          [ON ]          │   │
│  │ Emergency Alerts      [ON ]          │   │
│  │ Daily Digest          [OFF]          │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  CALENDAR & INTEGRATIONS                    │
│  ┌─────────────────────────────────────┐   │
│  │ Google Calendar      [Connected ✓]  │   │
│  │ Apple Calendar       [Disconnected]  │   │
│  │ [+ Add Calendar]                    │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ABOUT                                      │
│  ┌─────────────────────────────────────┐   │
│  │ Version: 1.0.0                      │   │
│  │ [Check for Updates]                 │   │
│  │ [Privacy Policy] [Terms]            │   │
│  └─────────────────────────────────────┘   │
│                                             │
├─────────────────────────────────────────────┤
│ [Home] [Cal] [Chat] [Meal] [Task]          │
└─────────────────────────────────────────────┘
```

---

## 6. Interaction Flows

### Flow 1: Change Theme Mode

```
Step 1: User clicks "System" radio button
        ○ Light Mode
        ◉ System ← Clicked here
        ○ Dark Mode

Step 2: Selection animates (0.2s)
        Radio circle fills
        Background highlights with accent/5%
        Border turns accent color

Step 3: useTheme context updates
        setMode('system') called
        Data saved to localStorage

Step 4: CSS variables re-evaluate
        matchMedia listener checks system preference
        theme attribute on <html> updates
        All colors transition (0.3s)

Step 5: App re-renders
        All components using var(--color-*) update
        Preview card shows new colors
        No page reload needed
```

### Flow 2: Change Accent Color

```
Step 1: User clicks on "Violet" swatch
        Other swatches: 40×40px, opacity 0.8
        Violet swatch: 40×40px, border 2px accent

Step 2: Selection animates (0.2s)
        Swatch scales 1.05
        Blue glow appears (0 0 24px violet/40%)
        Inner shadow added

Step 3: useTheme context updates
        setAccentColor('violet') called
        Data saved to localStorage

Step 4: CSS updates
        All buttons, badges, accents → violet
        Links and interactive elements shift color
        Preview card updates instantly
        Accent color across entire app changes

Step 5: Visual feedback
        User sees preview card color change
        Buttons on page now use violet
        No action needed from user
```

### Flow 3: Toggle High Contrast

```
Step 1: User clicks toggle switch
        [OFF] → [ON]

Step 2: Toggle animates
        Circle slides right (0.3s)
        Background changes to mint
        Text changes to white

Step 3: useTheme context updates
        setContrastBoost(true) called
        data-contrast="boost" added to <html>

Step 4: CSS media query activates
        @media [data-contrast="boost"]
        All borders: 1px → 2px
        All text: darker/bolder
        Opacity floor: 70%

Step 5: App adapts
        Entire interface gains higher contrast
        Better readability
        No page reload
```

---

## 7. Mobile vs Desktop Considerations

### Mobile (< 640px)

```
Settings title spans full width
Profile section: Full width, stacked layout
Theme section:
  - Radio options: Full width, stacked
  - Color swatches: 2×3 grid (2 per row)
  - Preview card: Full width
  - Toggles: Full width, right-aligned
  - All padding: 16px
  - Section gap: 24px
Scrollable vertically
Bottom safe area padding for notches
```

### Tablet (640-1024px)

```
Settings in 2-column layout:
  - Left: Profile + Theme
  - Right: Notifications + About
Color swatches: Horizontal line of 6
Preview card: Larger, shows more content
Padding: 24px
Max width: 900px
Centered on screen
```

### Desktop (> 1024px)

```
Settings in 3-column layout:
  - Left column: Profile + Theme
  - Center column: Notifications + Calendar
  - Right column: About + Advanced
Color swatches: Single horizontal line
Preview card: Large, detailed
Padding: 32px
Max width: 1200px
Centered on screen
```

---

## 8. Technical Implementation Notes (Design-Only)

### State Management (Using useTheme Hook)

```typescript
const { mode, accentColor, contrastBoost, setMode, setAccentColor, setContrastBoost } = useTheme();

// On radio button click:
const handleModeChange = (newMode) => {
  setMode(newMode); // 'light', 'dark', 'system'
};

// On color swatch click:
const handleAccentChange = (color) => {
  setAccentColor(color); // 'nori', 'violet', 'rose', etc.
};

// On toggle click:
const handleContrastChange = () => {
  setContrastBoost(!contrastBoost);
};
```

### Real-Time Preview

```typescript
// Preview card automatically updates via CSS variables
<Card className="glass p-6">
  <p className="text-text-primary">This text is {mode}</p>
  <Button className="bg-accent-{accentColor}">
    Sample Button
  </Button>
</Card>

// No manual state needed - CSS variables handle it
```

### localStorage Persistence

```typescript
// Automatically handled by useTheme hook
// On app load:
1. Read from localStorage
2. Hydrate theme context
3. Apply CSS variables
4. Detect system preference if mode='system'

// On change:
1. Update state
2. Save to localStorage (automatic in useEffect)
3. Apply CSS variables
4. No page reload needed
```

---

## 9. Accessibility Specifications

### Form Semantics

```html
<fieldset>
  <legend>Display Mode</legend>
  <label>
    <input type="radio" name="theme-mode" value="light" />
    Light Mode
  </label>
  <label>
    <input type="radio" name="theme-mode" value="system" defaultChecked />
    System (Default)
  </label>
  <label>
    <input type="radio" name="theme-mode" value="dark" />
    Dark Mode
  </label>
</fieldset>
```

### Color Swatches

```html
<div role="group" aria-label="Accent color selection">
  <button
    className="color-swatch"
    style={{ backgroundColor: '#3b82f6' }}
    aria-pressed={accentColor === 'nori'}
    aria-label="Nori (Blue) - Primary brand color"
    onClick={() => setAccentColor('nori')}
  >
    Nori
  </button>
  <!-- Repeat for other colors -->
</div>
```

### Toggle Switch

```html
<button
  role="switch"
  aria-checked={contrastBoost}
  aria-label="Toggle high contrast mode for improved readability"
  onClick={() => setContrastBoost(!contrastBoost)}
>
  High Contrast Mode
</button>
```

### Focus States

```css
input:focus-visible,
button:focus-visible {
  outline: 2px solid var(--color-nori);
  outline-offset: 2px;
}

/* Color swatches */
.color-swatch:focus-visible {
  box-shadow: 0 0 0 3px var(--color-surface-1),
              0 0 0 5px var(--color-nori);
}
```

### Contrast Requirements

- Radio button labels: 12:1 contrast
- Color swatch labels: 8:1 contrast
- Selected state borders: Visible without color alone
- High contrast mode: Pure black/white available

---

## 10. Design Tokens for Settings

```
Section header:        H2, 24px, Bold, text-primary
Setting label:         14px, Medium, text-primary
Setting description:   12px, Regular, text-secondary
Radio option title:    14px, Regular, text-primary
Radio description:     12px, Regular, text-secondary
Color swatch label:    12px, Regular, text-secondary

Spacing:
  - Section margin:    24px
  - Item padding:      16px
  - Gap between items: 12px
  - Gap between colors: 12px

Colors:
  - Backgrounds:  var(--color-surface-N)
  - Text:         var(--color-text-primary)
  - Borders:      var(--color-surface-4)
  - Highlights:   var(--color-accent-{selected})
```

---

## 11. Validation & Error Handling

### What Should Happen

```
Valid selection:
  User clicks option → Saved to localStorage → Preview updates → No errors

System mode with light preference:
  mode='system', system=light → App shows light theme colors

Accent color not in list:
  Invalid color → Falls back to 'nori' → User sees default
  (This should never happen with proper UI)

localStorage unavailable:
  Use defaults in memory → App still works → Changes lost on refresh

Old theme config format:
  Try to parse, if invalid → Use defaults → Migrate on next save
```

---

## 12. Summary: Settings Page Content

| Section | Fields | Type | Interactions |
|---------|--------|------|--------------|
| Profile | Avatar, Name, Email | Display only | Edit, Sign Out buttons |
| Theme Mode | Light/Dark/System | Radio group | Click to select |
| Accent Color | 6 color swatches | Button grid | Click to select |
| Preview | Sample card | Display only | Updates automatically |
| Contrast | Toggle switch | Boolean | Click to toggle |
| Notifications | 5 toggles | Switches | Click to toggle |
| Calendar | Connected list | Links | Connect/Disconnect |
| About | Version info | Display only | Links to policies |

---

**Settings Page Design Complete — Ready for Implementation**
