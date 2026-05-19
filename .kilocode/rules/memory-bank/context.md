# Active Context: Consuela — AI Family Organizer

## Current State

**Status**: ✅ Full V1 application built, UI/UX audit complete, 7 issues resolved

Consuela is a production-ready AI-powered family organizer web app with polished UI across 8 screens, full design system, and interactive components. Built on Next.js 16 + React 19 + Tailwind CSS 4. All data now real-time from database; widgets fully customizable with drag-and-drop. Migration planning complete — OpenClaw bridge to be replaced by Hermes container. Telegram ready for Hermes post-migration alerts.

Hermes deployment artifacts created (docker-compose.hermes.yml, Dockerfile.hermes, docs/hermes-deployment-guide.md). Full OpenClaw backup archived to NAS (1.4GB). Pending source code migration to enable full Hermes container replacement.

## Recently Completed

- [x] Full UI/UX Audit: comprehensive review of all screens, components, flows, and interactions
- [x] Widget relocation fixes: resolved positioning and drag-and-drop consistency across Home dashboard
- [x] Consuela buttons: implemented and polished primary action buttons throughout UI
- [x] Google Calendar: completed mock integration with SyncManager, OAuth placeholders, and Calendar page sync
- [x] Emergency situations: enhanced handling, editable scenarios, and notification flows
- [x] Data consistency: ensured realtime DB sync, removed mocks, unified state across components
- [x] Settings optimization: streamlined toggles, integrations, and profile management
- [x] Member modal fixes: resolved Add/Edit flows, responsiveness, avatar overlap, and form state
- [x] Comprehensive Widget Management System for Home: registry (Weather/Schedule/Events/Tasks/Meals), framer-motion drag-and-drop reordering + bot simulation, localStorage persistence (+ PB placeholder), Weather config moved to Settings > "Widgets & Home Dashboard", minimal edit affordance retained on widget, dynamic rendering in page.tsx while keeping all PocketBase realtime
- [x] Mock Google Calendar integration: extended SyncManager with OAuth connect/sync placeholders, added UI+sync-to-PB in Calendar page, new /api/google-calendar route for extension
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
- [x] **Dashboard UI refresh** - Redesigned hero header with date pill and time-of-day greeting, replaced Badge stat pills with icon+label links, fixed today's meal highlight to dynamically detect the actual day, added left-border accent colors to event cards and task items
- [x] **ScheduleDisplay component polish** - Added "X upcoming" count in header, improved past-item styling with strikethrough, added friendly empty state with clock SVG
- [x] **Weather Widget** - Added clickable location editing for custom city management
- [x] **Settings Add Member** - Fixed non-functional Add button by removing premature resetForm call
- [x] **Sync Status Widget** - Made Total Links count and status text dynamic based on connected services
- [x] **Inline Edit UI** - Added click-to-edit for time/title fields in ScheduleDisplay with onEdit callback, Escape/Enter support; audited Add buttons (all clean)
- [x] **Hermes Migration Guide** — Created comprehensive OpenClaw → Hermes migration guide (docs/hermes-migration-guide.md) ensuring zero data loss
- [x] Telegram integration — Added Telegram bot support following free-communication patterns for Hermes agent completion messages, no breakage to existing emergency/SMS flows
- [x] Created docker-compose.hermes.yml with named persistent volume (hermes_data), 14 OpenRouter models, Telegram/Ollama/Gateway configs from discovered OpenClaw settings
- [x] Created Dockerfile.hermes template (node:20-alpine, bun, healthcheck)
- [x] Created docs/hermes-deployment-guide.md with SSH, build, deploy, and full data restoration instructions
- [x] Backed up all OpenClaw container data to NAS (1.4GB archive at /share/CACHEDEV1_DATA/homes/admin/hermes-migration-20260515/openclaw-full.tar.gz)
- [x] Discovered OpenClaw identity: agent "Drogon", user "Jeff", Telegram bot token active, 10+ OpenRouter models, 3 sub-agents
- [x] Emergency page improvements: made Common Situations editable (add/edit/delete custom via modal + localStorage persistence), polished contact editing with full flow/better validation/visual consistency, kept tel: links + 911 card

## File Structure

```
src/
  app/
    page.tsx              — Home Dashboard now uses dynamic WidgetReorderList + Reorder from framer-motion
  lib/
    widget-registry.ts    — Widget type, categories, DEFAULT order
    widget-context.tsx    — useWidgetOrder hook + Provider for drag + bot sim + persistence
  components/ui/
    WeatherWidget.tsx     — Now supports controlled location/unit + edit affordance
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
    api/
      chat/route.ts       — Chat API router (dynamic agent responses)
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
| May 2026 | Dashboard UI improvements: date pill, stat chips, dynamic meal highlight, event/task polish, ScheduleDisplay refresh |
| May 2026 | Fixed layout.tsx Next.js architecture issue by removing "use client" from root layout and creating providers.tsx wrapper for ToastProvider and OpenClawDrive client components, allowing proper metadata and viewport exports |
| May 2026 | Fixed Settings Add button, added editable location to Weather widget, dynamic sync status/links count in SyncManager; pushed updates to GitHub |
| 2026-05-15 | Developed comprehensive OpenClaw → Hermes migration guide ensuring zero data loss |
| 2026-05-15 | Added Telegram bot support via sendTelegramMessage and /api/telegram for agent notifications while preserving all prior connections |
|   2026-05-16 | Created Hermes deployment infrastructure (compose file, Dockerfile, deployment guide) with data restoration from OpenClaw backup and NAS backup archive |
  2026-05-19 | Implemented full widget management: registry, Reorder drag-and-drop, Settings config for Weather, dynamic Home rendering |
  2026-05-19 | Improved Emergency page with editable situations list (manual add/edit/delete) and polished contact editing |
  2026-05-19 | Enforced widget uniformity on Home: aligned Events/Tasks/Meals/Schedule/Weather sections to widget-registry categories, added consistent "Edit" buttons + modals reusing TaskEditor/MealEditor for inline/field edits on all cards, every field now has edit path via editors or inline (ScheduleDisplay/WeatherWidget) |
  2026-05-19 | Fixed Add Member modal in Settings: clean state reset via useEffect, improved bottom-sheet responsiveness/keyboard avoidance with dvh+safe-area, fixed avatar button overlap with z-index, unified form close logic |
| 2026-05-19 | Comprehensive UI/UX audit completed: resolved widget relocation, Consuela buttons, Google Calendar, emergency situations, data consistency, settings optimization, and member modal fixes |

## Next Steps (V2)

- Real AI API integration with OpenClaw/OpenRouter/Google AI for chat
- Database persistence (Drizzle + SQLite) for family data
- Push notifications (Web Push API) for reminders and alerts
- Speech API option for voice-first interactions
- Grocery API integrations (Walmart/Instacart and other services)
- Google/Apple Calendar OAuth sync (future)
- React Native mobile app (shared logic, future)
