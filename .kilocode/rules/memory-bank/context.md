# Active Context: Consuela — AI Family Organizer

## Current State

**Status**: ✅ Full V1 application built and deployed

Consuela is a production-ready AI-powered family organizer web app with 6 core screens, a full design system, and interactive UI. Built on Next.js 16 + React 19 + Tailwind CSS 4. Dashboard now fetches real data from database instead of hardcoded mock data.

## Recently Completed

- [x] Global design system: dark theme, nori-green brand palette, glass morphism, custom CSS tokens
- [x] Shared UI components: BottomNav, TopBar, Card, Button, Badge, Avatar, PageShell
- [x] Home Dashboard — family greeting, today's events, meal strip, task summary, grocery snapshot, AI quick-ask CTA
- [x] Chat/AI Assistant — conversational UI, mock NLP responses, action cards, voice button, typing indicator, suggested prompts
- [x] Calendar — monthly grid with event dots, member filter, day selection, upcoming events
- [x] Meal Planner — weekly strip, meal detail with nutrition toggle, AI suggestions, pantry status, dietary preferences, recipe import (Pinterest, TikTok, browser, PDF) with basic parsing capabilities
- [x] Grocery List — redesigned as hybrid shopping/list creation experience with categories, priorities, quantities, notes, and edit capabilities
- [x] Tasks & Chores — task list with priority indicators, member filter, recurring chores, completion tracking, Leaderboard + Rewards tabs
- [x] Settings — family profile, member roles, integrations (Google & Apple iCloud services), notification toggles, AI preferences, privacy
- [x] Add Grocery tab to BottomNav for dedicated grocery list navigation
- [x] Implement manual pantry item entry in Meals page with status selector
- [x] Fixed family icon consistency between dashboard and settings pages by standardizing Avatar variant="emoji"
- [x] Database persistence implemented with Drizzle ORM + SQLite (tables: members, events, meals, tasks, grocery_items, pantry_items)
- [x] **Emergency Button feature** - Red floating emergency button on homepage with modal for selecting fire/water/injury/general emergency types, triggers free SMS notifications to parents via email-to-SMS gateways and email alerts via Gmail
- [x] **Emergency Contacts page** - Dedicated `/emergency` page with contact cards for Mom, Dad, Grandma, Step-Dad, Step-Mom and common urgency scenarios
- [x] **Family Schedule display** - ScheduleDisplay component showing daily routines (lunch, bedtime, etc.) with time-sorted timeline
- [x] **BottomNav updates** - Added Emergency and Settings tabs to navigation
- [x] **Real Database Queries** - Replaced all hardcoded dashboard data with real database queries for family members, events, tasks, and schedules
- [x] **Weather Widget** - Added clickable location editing for custom city management
- [x] **Settings Add Member** - Fixed non-functional Add button by removing premature resetForm call
- [x] **Sync Status Widget** - Made Total Links count and status text dynamic based on connected services
- [x] **Inline Edit UI** - Added click-to-edit for time/title fields in ScheduleDisplay widget; audited all Add button handlers for resetForm side-effects

## File Structure

```
src/
  app/
    page.tsx              — Home Dashboard (with EmergencyButton, ScheduleDisplay)
    layout.tsx            — Root layout (metadata, fonts)
    globals.css           — Design tokens + Tailwind theme
    chat/page.tsx         — AI Chat Interface
    calendar/page.tsx     — Family Calendar
    meals/page.tsx        — Meal Planner
    grocery/page.tsx      — Grocery List
    tasks/page.tsx        — Tasks & Chores + Leaderboard
    settings/page.tsx     — Family Profile & Settings
    emergency/page.tsx    — Emergency Contacts page
    api/
      emergency/route.ts  — Emergency notification API endpoint
  components/ui/
    BottomNav.tsx         — 8-tab mobile nav (Home, Chat, Calendar, Meals, Tasks, Grocery, Emergency, Settings)
    TopBar.tsx            — Sticky top navigation
    Card.tsx              — Glass morphism card
    Button.tsx            — Primary/secondary/ghost/danger variants
    Badge.tsx             — Colored pill badges
    Avatar.tsx            — Family member avatars with emoji/initials
    PageShell.tsx         — Shared page wrapper with BottomNav
    SyncManager.tsx       — Google & Apple iCloud services sync manager
    EmergencyButton.tsx   — Red emergency button with type selection modal
    ScheduleDisplay.tsx   — Daily schedule/timeline display component
  db/
    index.ts              — Database client
    schema.ts             — Table definitions (added schedules, emergency_contacts)
    migrate.ts            — Migration script
    migrations/           — Generated migration files
```

## Design System

- **Brand**: Consuela green (#22c55e) as primary accent
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
| `/emergency` | Emergency Contacts & 911 button |

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
| Mar 2026 | Full Consuela V1 app built — 7 pages, design system, AI chat, all core features |
| May 2026 | Fixed Avatar component, added Grocery nav tab, implemented pantry manual entry, fixed dashboard event emojis and styling |
| May 2026 | Redesigned grocery page as supermarket-style shopping experience with aisles, cart sidebar, quick add bar |
| May 2026 | Fixed family icon consistency by standardizing Avatar variant="emoji" in settings page |
| May 2026 | Enhanced grocery page as hybrid creation/list experience with priorities, quantities, notes, and inline editing |
| May 2026 | Fixed layout.tsx Next.js architecture issue by removing "use client" from root layout and creating providers.tsx wrapper for ToastProvider and OpenClawDrive client components, allowing proper metadata and viewport exports |
| May 2026 | Fixed Settings Add button, added editable location to Weather widget, dynamic sync status/links count in SyncManager; pushed updates to GitHub |

## Next Steps (V2)

- Real AI API integration with OpenClaw/OpenRouter/Google AI for chat
- Database persistence (Drizzle + SQLite) for family data
- Push notifications (Web Push API) for reminders and alerts
- Speech API option for voice-first interactions
- Grocery API integrations (Walmart/Instacart and other services)
- Google/Apple Calendar OAuth sync (future)
- React Native mobile app (shared logic, future)
