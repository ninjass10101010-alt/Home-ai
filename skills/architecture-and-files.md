# 🏗️ Skill: Architecture & File System

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  QNAP NAS (192.168.0.27)                                            │
│                                                                     │
│  ┌─────────────────┐   ┌──────────────────────┐   ┌─────────────┐  │
│  │  home-dashboard  │   │ consuela-telegram-bot │   │ pocketbase  │  │
│  │  Next.js :3000  │◄──│  Filesystem Bridge   │──►│  DB :8090   │  │
│  │                 │   │  :3005               │   │             │  │
│  └─────────────────┘   └──────────────────────┘   └─────────────┘  │
│                                                                     │
│  Docker Compose: /share/Container/home-dashboard/nas-docker-compose.yml │
│  Source Code:    /share/Container/home-dashboard/src/               │
│  Env Variables:  /share/Container/home-dashboard/.env               │
└─────────────────────────────────────────────────────────────────────┘
```
**Local Dev Machine:** `/Users/garciafam/openclaw/new/home-ai-app/`

---

## The File Map

```
src/
├── app/
│   ├── page.tsx                    ← HOME DASHBOARD (main widget display)
│   ├── layout.tsx                  ← Root layout, navigation shell
│   ├── chat/page.tsx               ← CHAT UI (message state, sessionStorage)
│   ├── calendar/page.tsx           ← CALENDAR (live events + members)
│   ├── emergency/page.tsx          ← EMERGENCY CONTACTS
│   ├── meals/MealsUnified.tsx      ← MEALS UI (planner/grocery/pantry)
│   ├── schedules/page.tsx          ← SCHEDULES page
│   ├── settings/page.tsx           ← SETTINGS (member management)
│   ├── tasks/page.tsx              ← TASKS page
│   └── api/
│       ├── chat/route.ts           ← ★ AI BRAIN — action schema engine ★
│       └── telegram/route.ts       ← Telegram webhook handler
├── components/
│   ├── ui/                         ← Reusable UI (Weather, Schedule, Sync)
│   └── meals/                      ← Meal/Pantry editor modals
└── lib/
    ├── pocketbase.ts               ← ★ PocketBase singleton client ★
    └── mealPlanningSync.ts         ← Meal→Grocery sync logic
```

## Environment Variables
Located at `/share/Container/home-dashboard/.env` on the NAS.
- `NEXT_PUBLIC_PB_URL`: PocketBase URL (`http://192.168.0.27:8090`)
- `OPENROUTER_API_KEY`: OpenRouter AI model access
- `TELEGRAM_BOT_TOKEN`: Telegram bot webhook auth
