# Active Context: Nori — AI Family Organizer

## Current State

**Status**: ✅ Full V1 application built and deployed

Nori is a production-ready AI-powered family organizer web app with 6 core screens, a full design system, and interactive UI. Built on Next.js 16 + React 19 + Tailwind CSS 4.

## Recently Completed

- [x] Global design system: dark theme, nori-green brand palette, glass morphism, custom CSS tokens
- [x] Shared UI components: BottomNav, TopBar, Card, Button, Badge, Avatar, PageShell
- [x] Home Dashboard — family greeting, today's events, meal strip, task summary, grocery snapshot, AI quick-ask CTA
- [x] Chat/AI Assistant — conversational UI, mock NLP responses, action cards, voice button, typing indicator, suggested prompts
- [x] Calendar — monthly grid with event dots, member filter, day selection, upcoming events
- [x] Meal Planner — weekly strip, meal detail with nutrition toggle, AI suggestions, pantry status, dietary preferences
- [x] Grocery List — categorized items, check-off, progress bar, add item, store integrations (Instacart/Walmart/Amazon)
- [x] Tasks & Chores — task list with priority indicators, member filter, recurring chores, completion tracking, Leaderboard + Rewards tabs
- [x] Settings — family profile, member roles, subscription stats, integrations, notification toggles, AI preferences, privacy

## File Structure

```
src/
  app/
    page.tsx              — Home Dashboard
    layout.tsx            — Root layout (metadata, fonts)
    globals.css           — Design tokens + Tailwind theme
    chat/page.tsx         — AI Chat Interface
    calendar/page.tsx     — Family Calendar
    meals/page.tsx        — Meal Planner
    grocery/page.tsx      — Grocery List
    tasks/page.tsx        — Tasks & Chores + Leaderboard
    settings/page.tsx     — Family Profile & Settings
  components/ui/
    BottomNav.tsx         — 5-tab mobile nav (Home, Chat, Calendar, Meals, Tasks)
    TopBar.tsx            — Sticky top navigation
    Card.tsx              — Glass morphism card
    Button.tsx            — Primary/secondary/ghost/danger variants
    Badge.tsx             — Colored pill badges
    Avatar.tsx            — Family member avatars with emoji/initials
    PageShell.tsx         — Shared page wrapper with BottomNav
```

## Design System

- **Brand**: Nori green (#22c55e) as primary accent
- **Theme**: Dark (#0f1117 background), glass morphism cards
- **Secondary accents**: violet, amber, cyan, rose
- **Typography**: Geist Sans (variable font)
- **Mobile-first**: max-w-lg centered, bottom nav, safe area insets

## Product Architecture

### Pages & Routes
| Route | Page |
|-------|------|
| `/` | Home Dashboard |
| `/chat` | AI Assistant |
| `/calendar` | Family Calendar |
| `/meals` | Meal Planner |
| `/grocery` | Grocery List |
| `/tasks` | Tasks & Chores |
| `/settings` | Family Profile |

### AI Chat Features (mock)
- Intent matching for: events, meals, chores, grocery, weekly summary, reminders
- Action confirmation cards rendered inline
- Typing indicator with animation
- 6 suggested prompt chips on initial load
- Voice button (UI only — connects to Web Speech API in production)

## Session History

| Date | Changes |
|------|---------|
| Initial | Template created with base Next.js setup |
| Mar 2026 | Full Nori V1 app built — 7 pages, design system, AI chat, all core features |

## Next Steps (V2)

- Real OpenAI/Claude API integration for chat
- Authentication (NextAuth or Clerk)
- Database (Drizzle + SQLite or Postgres)
- Google/Apple Calendar OAuth sync
- Push notifications (Web Push API)
- Instacart/Walmart grocery API integration
- Voice-first mode with Web Speech API
- React Native mobile app (shared logic)
