# UI/UX Pro Max Skill

## Atmospheric Theme Implementation Guide

This skill provides the complete pattern for synchronizing components with the atmospheric theme system.

### Core Hook: `useAtmosphericTheme`

```tsx
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";

function Component() {
  const { colors, accentRgb } = useAtmosphericTheme();
  // colors.glow, colors.gradientStop, colors.accentColor
}
```

### Fallback Pattern (for outside providers)

```tsx
const { colors, accentRgb } = useAtmosphericTheme();
// If hook throws (outside provider), use fallback:
// colors.glow = "rgba(59,130,246,0.18)"
// colors.gradientStop = "rgba(147,197,253,0.10)"
// colors.accentColor = "#3b82f6"
```

### Color Replacement Rules

| Old Pattern | New Pattern |
|-------------|-------------|
| `bg-nori-500/15` | `rgba(${accentRgb},0.15)` |
| `bg-rose-500/15` | `rgba(244,63,94,0.15)` |
| `text-nori-400` | `{ color: colors.accentColor }` |
| `shadow-nori-500/25` | `boxShadow: "0 0 24px " + colors.glow` |

### CSS Classes to Add

- Add `glass` class to all surface containers
- Add `isometric-card` class for 3D perspective transforms
- Add seasonal box-shadow: `style={{ boxShadow: "0 0 24px " + colors.glow }}`

### Complete Component Template

```tsx
"use client";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";

export default function Component() {
  const { colors, accentRgb } = useAtmosphericTheme();

  return (
    <div 
      className="glass isometric-card rounded-2xl p-4"
      style={{ 
        background: colors.gradientStop || "...",
        boxShadow: "0 0 24px " + colors.glow 
      }}
    >
      <div style={{ color: colors.accentColor }}>Themed Text</div>
      <div style={{ background: `rgba(${accentRgb},0.15)` }}>Accent Bg</div>
    </div>
  );
}
```

### Seasonal Theme Integration Points

- **Spring**: Cherry blossoms, pink accents (#ec4899)
- **Summer**: Palm trees, golden accents (#d97706)
- **Autumn**: Oak leaves, orange accents (#c2410c)
- **Winter**: Aurora, blue accents (#2563eb)
- **Holiday overlays** automatically override seasonal themes via provider