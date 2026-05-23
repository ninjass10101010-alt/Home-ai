# Quick Reference Card — Consuela Dashboard Design

**Print this or keep open while implementing**

---

## 🎨 Theme Colors Quick Lookup

### Dark Mode (Default)
```
Background: #0f1117 → #434e60 (8 shades)
Text Primary: #f0f4ff
Text Secondary: #8892aa
Accent (Nori): #3b82f6
```

### Light Mode
```
Background: #ffffff → #bfc6d8 (8 shades)
Text Primary: #1a1a1a
Text Secondary: #5a5a5a
Accent (Nori): #2563eb
```

---

## 🎯 Accent Colors (6 Options)

| Name | Dark | Light | Use |
|------|------|-------|-----|
| Nori | #3b82f6 | #2563eb | Default, primary |
| Violet | #7c6ff7 | #7c3aed | Premium, special |
| Rose | #f43f5e | #e11d48 | Urgent, alerts |
| Cyan | #06b6d4 | #0891b2 | Info, secondary |
| Mint | #4ade80 | #059669 | Success, done |
| Amber | #f59e0b | #d97706 | Warnings, pending |

---

## ☀️/🌙 Theme Toggle Button

```
Location: TopBar, top-right corner
Size: 40×40px (48×48 with padding)
Icon: ☀️ (sun) in dark mode | 🌙 (moon) in light mode
On Click: Toggle theme instantly
Animation: Icon rotates 180°, fade colors (0.3s)
```

---

## 🎛️ Settings Page Theme Picker

### Theme Mode Selector
```
3 Radio Options:
├─ Light Mode
├─ System (Default)
└─ Dark Mode

Selected: Border color = accent, background = accent/5%
```

### Accent Color Picker
```
6 Color Swatches, 40×40px each
Spacing: 12px between swatches
Selected: 2px solid border + glow shadow
Rows: 2×3 on mobile, 1×6 on desktop
```

### Preview Card
```
Shows live preview of current colors
Updates instantly on selection
No page reload needed
```

---

## 🎨 Component States

### Button States
```
Default:  Normal opacity, normal scale
Hover:    Scale 1.05, shadow +8, 0.2s ease
Active:   Scale 0.98, background +20%, 0.1s ease
Disabled: Opacity 50%, no interaction
```

### Card States
```
Default:  border 8% opacity
Hover:    border 20% opacity, scale 1.02
Glow:     0 0 20px accent/10%
```

### Radio Button
```
Unselected: ○ border surface-3
Hover:      ○ border accent
Selected:   ◉ border accent, bg accent/5%
```

---

## ⏱️ Animation Timings

```
Fast:     0.15s (UI feedback - button clicks, icons)
Standard: 0.3s  (Default - hovers, cards, colors)
Slow:     0.5s  (Emphasis - theme toggle, page entry)

Easing: cubic-bezier(0.4, 0, 0.2, 1)
```

---

## 📱 Responsive Breakpoints

```
Mobile:  < 640px   (Full width, single column)
Tablet:  640-1024  (2-column, centered)
Desktop: > 1024    (3-column, dense)
```

---

## ♿ Accessibility Minimums

```
Contrast:     15:1 (dark), 12:1 (light) for main text
Focus:        2px solid outline, 2px offset
Touch:        44×44px minimum
Keyboard:     Tab navigation, Enter/Space to activate
Reduced Motion: Disabled animations on prefers-reduced-motion
```

---

## 📐 Spacing & Typography

### Spacing Scale
```
4px (base) → 8 → 12 → 16 → 24 → 32 → 48px
Card padding: 16px
Section gap: 24px
```

### Font Scale
```
Caption:  11px, Regular
Body:     14px, Regular
Headline: 16px, Semibold
H3:       20px, Semibold
H2:       24px, Semibold
H1:       32px, Bold

Font: Geist Sans (primary), Geist Mono (code)
```

---

## 🔑 CSS Variables Format

```css
/* All colors use this pattern: */
var(--color-{category}-{variant})

/* Examples: */
var(--color-surface-0)      /* Background */
var(--color-text-primary)   /* Main text */
var(--color-accent-violet)  /* Accent color */

/* Automatic theme switching */
[data-theme="dark"]  → Dark palette
[data-theme="light"] → Light palette
prefers-color-scheme → System detection
```

---

## 🔧 React Hook Usage (useTheme)

```typescript
const {
  mode,              // 'light' | 'dark' | 'system'
  accentColor,       // 'nori' | 'violet' | 'rose' | etc.
  contrastBoost,     // boolean
  isDark,            // boolean (computed)
  toggleTheme,       // () => void
  setMode,           // (mode) => void
  setAccentColor,    // (color) => void
  setContrastBoost   // (boost) => void
} = useTheme();
```

---

## 📄 Glass Morphism Classes

```html
<!-- Use one of these classes on any element: -->
<div class="glass">              <!-- Standard -->
<div class="glass-strong">       <!-- Strong/opaque -->
<div class="glass-subtle">       <!-- Subtle/light -->

<!-- CSS automatically handles dark/light mode -->
```

---

## 🎬 Common Animations

```css
/* Fade & Slide In (page entry) */
opacity: 0 → 1
transform: translateY(10px) → translateY(0)
timing: 0.4s ease

/* Button Hover */
scale: 1 → 1.05
box-shadow: increase
timing: 0.2s ease

/* Card Glow */
border-color: accent/0% → accent/40%
box-shadow: 0 0 20px accent/10%
timing: 0.3s ease

/* Theme Toggle Icon */
transform: rotate(0deg) → rotate(180deg)
timing: 0.5s ease
```

---

## ✅ Testing Checklist

- [ ] Light mode displays correctly
- [ ] Dark mode displays correctly
- [ ] System mode detects OS preference
- [ ] Theme toggle button works
- [ ] Settings theme picker works
- [ ] Accent colors change across app
- [ ] Colors persist in localStorage
- [ ] Contrast ratios meet WCAG AA
- [ ] Focus states visible
- [ ] Keyboard navigation works
- [ ] Mobile responsive works
- [ ] Animations respect prefers-reduced-motion
- [ ] Screen reader compatible
- [ ] All links and buttons accessible

---

## 📚 Document Map

```
DESIGN_INDEX.md
  ↓
  ├─ DESIGN_PACKAGE_SUMMARY.md      (Overview)
  ├─ UI_DESIGN_SPECIFICATION.md     (Complete spec)
  ├─ DESIGN_VISUAL_REFERENCE.md     (Quick lookups)
  └─ SETTINGS_PAGE_DESIGN.md        (Settings detail)
```

**Start here:** DESIGN_INDEX.md or DESIGN_PACKAGE_SUMMARY.md  
**Implementation reference:** UI_DESIGN_SPECIFICATION.md  
**Quick lookups:** DESIGN_VISUAL_REFERENCE.md  
**Settings implementation:** SETTINGS_PAGE_DESIGN.md

---

## 🚀 Implementation Order

1. **Phase 1:** ✓ Theme infrastructure (done)
2. **Phase 2:** Update UI components
3. **Phase 3:** Redesign pages
4. **Phase 4:** Add animations
5. **Phase 5:** Accessibility testing

---

## 💡 Pro Tips

- **Always use CSS variables** — Never hardcode colors
- **Test both themes** — Check light AND dark mode
- **Verify contrast** — Use WebAIM contrast checker
- **Respect preferences** — Honor prefers-color-scheme & prefers-reduced-motion
- **Mobile first** — Design for mobile, enhance for desktop
- **Use semantic HTML** — `<button>` not `<div>` for clickables
- **Check accessibility** — Use browser DevTools accessibility panel

---

## 🔗 Key Files in Project

```
src/
├── lib/theme-config.ts         ← Color palettes & types
├── hooks/useTheme.ts           ← Theme context hook
├── app/layout.tsx              ← ThemeProvider wrapper
├── app/globals.css             ← CSS variables
├── components/ui/
│   ├── ThemeToggle.tsx         ← Sun/Moon button
│   ├── Card.tsx                ← Glass morphism
│   ├── Button.tsx              ← All variants
│   └── TopBar.tsx              ← Theme toggle placement
└── app/settings/page.tsx       ← Theme picker UI

Design docs (root):
├── DESIGN_INDEX.md
├── DESIGN_PACKAGE_SUMMARY.md
├── UI_DESIGN_SPECIFICATION.md
├── DESIGN_VISUAL_REFERENCE.md
└── SETTINGS_PAGE_DESIGN.md
```

---

## 📞 Quick Reference by Task

| Task | Document | Section |
|------|----------|---------|
| "What colors should I use?" | DESIGN_VISUAL_REFERENCE.md | Color System |
| "How do I implement settings?" | SETTINGS_PAGE_DESIGN.md | Entire doc |
| "What's the theme toggle button?" | UI_DESIGN_SPECIFICATION.md | Section 3 |
| "Component specifications?" | UI_DESIGN_SPECIFICATION.md | Section 5 |
| "Page layouts?" | UI_DESIGN_SPECIFICATION.md | Section 6 |
| "Animations timing?" | DESIGN_VISUAL_REFERENCE.md | Animation Timings |
| "Accessibility requirements?" | UI_DESIGN_SPECIFICATION.md | Section 8 |
| "Design tokens?" | DESIGN_VISUAL_REFERENCE.md | Design Tokens |
| "Responsive design?" | UI_DESIGN_SPECIFICATION.md | Section 9 |

---

**Print this card and keep it at your desk!**

Last updated: May 20, 2026
