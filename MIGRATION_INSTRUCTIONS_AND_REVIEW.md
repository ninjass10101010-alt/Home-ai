# Consuela Dashboard — Migration Instructions & Comprehensive Code Review

**Date:** 2026-07-20  
**Branch:** `arena/019f76eb-home-ai`  
**Last Commit:** `5520314`

---

## Part 1: Migration Instructions

### Overview

The Consuela dashboard has **two distinct database layers** that must be migrated separately:

| Layer | System | Script | Status |
|-------|--------|--------|--------|
| **Core** (members, events, tasks, meals, etc.) | PocketBase + Drizzle ORM | `scripts/pb-seed.mjs` | Existing |
| **Features** (5 new Nori-inspired features) | PocketBase collections | `src/db/features/migrate.ts` + `src/db/features/seed.ts` | New, needs execution |

### Prerequisites

1. **PocketBase must be running** at `http://192.168.0.28:8090` (or set `NEXT_PUBLIC_PB_URL`)
2. Admin credentials configured in environment:
   - `PB_ADMIN_EMAIL` (default: `admin@consuela.app`)
   - `PB_ADMIN_PASS` (default: `26649_alan`)
3. Node.js 18+ with `tsx` installed (`npx tsx` available)

### Step-by-Step Execution

#### Step 1: Verify PocketBase Connectivity

```bash
# Test if PocketBase is reachable
curl http://192.168.0.28:8090/api/health
# Expected: {"code":200,"message":"API is healthy."}
```

If PocketBase is on a different host, update the URL:
```bash
export NEXT_PUBLIC_PB_URL="http://your-host:8090"
```

#### Step 2: Run Core PocketBase Seed (Existing Data)

This creates the core collections: `members`, `meal_plan_entries`, `recipes`, `pantry_items`, `grocery_list_items`, `events`, `tasks`, `schedules`, `emergency_contacts`, `auth_sessions`, and more.

```bash
npm run pb:seed
# or manually:
node scripts/pb-seed.mjs
```

**What this creates:**
- 9 family members (2 parents, 5 children, 2 pets) with PIN codes
- Meal plan entries with nutritional data
- Recipe catalog
- Pantry inventory (plenty/low/out status)
- Grocery list with categories and aisles
- Events, tasks, schedules, emergency contacts

#### Step 3: Run Feature Schema Migration (New Collections)

This creates **20 new PocketBase collections** for the 5 feature modules:

```bash
npm run migrate:features
# or manually:
npx tsx src/db/features/migrate.ts
```

**Collections created (in dependency order):**

| # | Collection | Feature | Purpose |
|---|-----------|---------|---------|
| 1 | `skill_branches` | Skill Tree | Learning path categories (Math, Reading, etc.) |
| 2 | `achievements` | Skill Tree | Unlockable badges/trophies |
| 3 | `daily_quotes` | Morning Briefing | Motivational quote library |
| 4 | `time_capsules` | Time Capsule | Locked memory containers |
| 5 | `capsule_contents` | Time Capsule | Photos/text/voice inside capsules |
| 6 | `skill_tree_profiles` | Skill Tree | Per-user XP/level/progress |
| 7 | `quests` | Skill Tree | Learning tasks with XP rewards |
| 8 | `user_achievements` | Skill Tree | Earned achievement records |
| 9 | `money_mountains` | Money Mountain | Savings goals with progress |
| 10 | `mountain_milestones` | Money Mountain | 25%/50%/75%/100% markers |
| 11 | `mountain_transactions` | Money Mountain | Deposit/withdrawal/match records |
| 12 | `allowance_settings` | Money Mountain | Parent controls for child allowance |
| 13 | `briefing_preferences` | Morning Briefing | Per-user briefing display settings |
| 14 | `briefing_history` | Morning Briefing | Log of past briefings shown |
| 15 | `ai_preferences` | Family AI | Consuela personality/privacy settings |
| 16 | `conversations` | Family AI | Conversation threads |
| 17 | `conversation_messages` | Family AI | Individual messages with intent parsing |
| 18 | `conversation_feedback` | Family AI | 👍/👎 feedback on AI responses |
| 19 | `proactive_suggestions` | Family AI | AI-initiated suggestion cards |

The migration is **idempotent** — it checks if each collection exists before creating it, so running it multiple times is safe.

#### Step 4: Run Feature Seed (Default Data)

```bash
npm run seed:features
# or manually:
npx tsx src/db/features/seed.ts
```

**What this populates:**
- **30 daily quotes** across 6 categories (motivational, funny, family, wisdom, kids, gratitude)
- **5 skill tree branches** (Math Explorer, Word Wizard, Science Detective, Creative Genius, Life Skills Master)
- **19 achievements** (milestone, streak, mastery categories with rarity tiers)
- **AI preferences** for all existing users (default: casual tone, moderate emojis)
- **Briefing preferences** for all existing users (default: all sections enabled, 6am-11am window)

#### Step 5: Verify Migration Success

```bash
# Quick health check — should show all collections
curl -s http://192.168.0.28:8090/api/collections | python3 -c "
import sys, json
data = json.load(sys.stdin)
names = [c['name'] for c in data.get('collections', [])]
features = ['time_capsules','capsule_contents','skill_tree_profiles','skill_branches',
            'quests','achievements','user_achievements','money_mountains',
            'mountain_milestones','mountain_transactions','allowance_settings',
            'daily_quotes','briefing_preferences','briefing_history',
            'ai_preferences','conversations','conversation_messages',
            'conversation_feedback','proactive_suggestions']
print(f'Total collections: {len(names)}')
for f in features:
    status = '✅' if f in names else '❌ MISSING'
    print(f'  {status} {f}')
"
```

### Migration Rollback

PocketBase does not support automatic rollback. To remove feature collections:

```bash
# Via PocketBase Admin UI: http://192.168.0.28:8090/_/
# Navigate to each collection → Settings → Delete collection

# Or via API (requires admin auth):
curl -X DELETE http://192.168.0.28:8090/api/collections/proactive_suggestions \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

**Delete order matters** — reverse of creation to respect foreign keys:
1. `conversation_feedback` → `conversation_messages` → `conversations`
2. `proactive_suggestions` → `ai_preferences`
3. `briefing_history` → `briefing_preferences` → `daily_quotes`
4. `allowance_settings` → `mountain_transactions` → `mountain_milestones` → `money_mountains`
5. `user_achievements` → `quests` → `skill_tree_profiles`
6. `capsule_contents` → `time_capsules`
7. `achievements` → `skill_branches`

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `ECONNREFUSED` on migrate | PocketBase isn't running. Start it or check `NEXT_PUBLIC_PB_URL` |
| `401 Unauthorized` | Admin credentials wrong. Check `PB_ADMIN_EMAIL` / `PB_ADMIN_PASS` |
| Collection already exists | Normal — migration skips existing collections (idempotent) |
| Relation field errors | Ensure referenced collections were created first (use `getOrderedSchemas` order) |
| `tsx: command not found` | Install: `npm install -D tsx` or use `npx tsx` |

---

## Part 2: Comprehensive Code Review

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Consuela Dashboard (Next.js)                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Pages (src/app/)                                           │
│  ├── page.tsx ................. Main dashboard              │
│  ├── calendar/ ................ Family calendar              │
│  ├── tasks/ ................... Chore management             │
│  ├── meals/ ................... Meal planning                │
│  ├── grocery/ ................. Grocery list                 │
│  ├── emergency/ ............... Emergency contacts           │
│  ├── chat/ .................... Chat interface               │
│  ├── rewards/ ................. Rewards/penalties            │
│  ├── settings/ ................ App settings                 │
│  │                                                          │
│  │  ── Feature Pages (Phase 2/3) ──                        │
│  ├── time-capsule/ ............ 🕰️ Memory time capsules     │
│  ├── skill-tree/ .............. 🌳 Gamified learning         │
│  ├── money-mountain/ .......... 🏔️ Savings goals            │
│  └── analytics/ ............... 📊 Schedule insights         │
│                                                             │
│  Database Layer                                              │
│  ├── db/index.ts .............. Sync-aware cache layer       │
│  ├── db/pb-db.ts .............. PocketBase CRUD wrapper     │
│  ├── db/schema.ts ............. Drizzle ORM schema (legacy) │
│  ├── db/migrate.ts ............ Drizzle migrations (empty!)  │
│  └── db/features/ ............. Feature DB schemas & tools  │
│      ├── migrate.ts ........... Creates PB collections      │
│      ├── seed.ts .............. Populates default data       │
│      ├── time-capsule.ts       (types + schema + helpers)   │
│      ├── skill-tree.ts         (types + schema + helpers)   │
│      ├── money-mountain.ts     (types + schema + helpers)   │
│      ├── morning-briefing.ts   (types + schema + helpers)   │
│      └── family-ai.ts          (types + schema + helpers)   │
│                                                             │
│  AI Layer (src/lib/)                                        │
│  ├── hermes-tools.ts .......... 20+ tool definitions        │
│  ├── conflict-detection.ts .... Schedule conflict checker   │
│  └── auto-buffer-scheduling ... Travel/prep time buffers    │
│                                                             │
│  Components (src/components/)                               │
│  ├── ui/ ...................... Design system (44 files)    │
│  ├── money-mountain/ .......... 6 feature components        │
│  ├── skill-tree/ .............. 8 feature components        │
│  ├── time-capsule/ ............ 6 feature components        │
│  ├── analytics/ ............... 3 feature components        │
│  ├── conflicts/ ............... ConflictWarning             │
│  └── clarification/ ........... ClarificationModal          │
│                                                             │
│  API Routes (src/app/api/) ................... 46 routes    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Database Architecture — Critical Issues

#### 🔴 Issue 1: Dual Database Pattern (High Priority)

The app has **two separate database access layers** that duplicate logic:

| File | Pattern | Methods |
|------|---------|---------|
| `src/db/index.ts` | **Client-side cache** with in-memory arrays, syncs to PB | Used by pages at render time (synchronous getters) |
| `src/db/pb-db.ts` | **Server-side async** PB wrapper with fallback data | Used by API routes |

**Problem:** `db/index.ts` maintains its own copies of `membersCache`, `eventsCache`, etc., with manual cache refresh logic. `pb-db.ts` has identical fallback data hardcoded separately. When data changes, the two can diverge.

**Impact:** Stale data shown on the client until `refreshCaches()` fires (every 30s). Race conditions between cache writes.

**Recommendation:** Consolidate into a single data access layer. The cache layer (`db/index.ts`) should delegate to `pb-db.ts` for all mutations, and both should share the same fallback data from a single source.

#### 🔴 Issue 2: Empty Drizzle Migration File

`src/db/migrate.ts` is **completely empty** (0 bytes). The `db:migrate` npm script points to it:

```json
"db:migrate": "node src/db/migrate.ts"
```

This will silently do nothing. The actual PocketBase migrations are handled by `scripts/pb-seed.mjs`, which creates collections via the PocketBase admin API.

**Recommendation:** Either remove the empty `db:migrate` script or redirect it to `scripts/pb-seed.mjs`. The Drizzle schema (`src/db/schema.ts`) exists but appears to be unused — PocketBase handles all actual persistence.

#### 🟡 Issue 3: Feature Schemas Not Integrated with Cache Layer

The 5 new features (`time-capsule`, `skill-tree`, `money-mountain`, `morning-briefing`, `family-ai`) have full PocketBase schemas defined but **no cache layer** in `db/index.ts` or `db/pb-db.ts`. The feature pages make direct `fetch()` calls to API routes:

```tsx
// money-mountain/page.tsx
const response = await fetch('/api/money-mountain');
```

This means feature data bypasses the in-memory cache entirely, which is actually fine for now since there's no server-side rendering of feature data. However, it creates an inconsistency with how core features (members, events, meals) work.

**Recommendation:** Document this architectural decision. If features grow, consider adding a `db/features-client.ts` that mirrors the cache pattern.

### 2.3 Feature Code Quality

#### ✅ Strengths

1. **Well-typed schemas** — Each feature module (`src/db/features/*.ts`) has thorough TypeScript interfaces, PocketBase schemas with proper field types, indexes, and helper functions.

2. **Consistent component patterns** — All 4 feature pages use the same design system (`Card`, `Button`, `Surface`, `Skeleton`, `EmptyState`) with Framer Motion animations.

3. **Comprehensive default data** — 30 quotes, 5 skill branches, 19 achievements, 5 mountain themes, outfit suggestions — all ready for seeding.

4. **Proper dependency ordering** — The migration script's `getOrderedSchemas()` ensures collections are created in the right order for foreign key references.

5. **Idempotent operations** — Both migration and seed scripts check for existing data before inserting.

#### 🟡 Issues Found

##### Issue 4: Missing `src/db/features/migrate.ts` — Empty Core Migration

The `db/features/migrate.ts` imports `getAdminPB` from `@/lib/pb`, which requires admin authentication. If the admin login fails, the entire migration fails silently. There's no retry logic.

```typescript
// Current: fails immediately if PB admin auth fails
const pb = getAdminPB();
```

**Recommendation:** Add connection validation at the start of `runFeatureMigration()`:
```typescript
try {
  await pb.health.check();
} catch {
  throw new Error('Cannot connect to PocketBase. Check NEXT_PUBLIC_PB_URL.');
}
```

##### Issue 5: Hardcoded User ID in Feature Pages

All 4 feature pages use `'demo-user'` as the user ID header:

```tsx
headers: { 'x-user-id': 'demo-user' },
```

This means multi-user support is not implemented — all feature data is shared under one synthetic user.

**Recommendation:** When auth is ready, replace with the actual authenticated user's ID from the session.

##### Issue 6: `hermes-tools.ts` Tool Array Has Missing Closing Bracket

Line 505 in `hermes-tools.ts` — the `create_buffers` tool handler closes properly, but the TOOLS array closing `];` is on line 511 without a preceding comma. The previous agent fixed a duplicate `},` here, but the structure should be verified:

```typescript
// Line ~503-511
    },
  },
];   // <-- TOOLS array close

export function getAllTools(): Tool[] {
```

This looks correct after the fix. ✅

##### Issue 7: Feature API Routes Not Reviewed

The 46 API routes under `src/app/api/` include feature-specific routes:
- `/api/money-mountain` (GET + POST)
- `/api/money-mountain/[id]` (GET + POST for transactions)
- `/api/skill-tree` (GET)
- `/api/skill-tree/quests/[id]/start` (POST)
- `/api/skill-tree/quests/[id]/complete` (POST)
- `/api/skill-tree/branches/[id]/unlock` (POST)
- `/api/time-capsules` (GET + POST)
- `/api/time-capsules/[id]` (GET)
- `/api/time-capsules/[id]/view` (POST)
- `/api/time-capsules/unlock` (POST)

**These were not reviewed** — they need verification that they correctly use `getAdminPB()` and handle errors properly.

##### Issue 8: `family-ai.ts` System Prompt — Template Literal Escaping

Line ~360 in `family-ai.ts`:
```typescript
${context.isWeekend ? '🎉 It\'s the weekend!' : ''}
```

This is correct after the previous fix (single quote escaped inside template literal). ✅

##### Issue 9: `XP_REWARDS` Type Mismatch

In `skill-tree.ts`, line ~310:
```typescript
export const XP_REWARDS: Record<QuestDifficulty, { easy: number; medium: number; hard: number }> = {
  read: { easy: 10, medium: 25, hard: 50 },
  ...
```

The type says `Record<QuestDifficulty, ...>` but the keys are `QuestType` values (`read`, `math`, `science`...), not `QuestDifficulty` values (`easy`, `medium`, `hard`). This is a type annotation error — it compiles because TypeScript is lenient with object literal excess properties, but the type is semantically wrong.

**Fix:** Change to `Record<QuestType, ...>`.

##### Issue 10: `shouldShowBriefing` Logic Bug

In `morning-briefing.ts`, `shouldShowBriefing()` has redundant checks:

```typescript
export function shouldShowBriefing(prefs: BriefingPreference): boolean {
  // Check if within briefing window
  if (currentTime < prefs.briefingStartTime || currentTime > prefs.briefingEndTime) {
    return false;
  }
  // Check if past skip time  
  if (currentTime > prefs.skipAfterTime) {
    return false;
  }
  return true;
}
```

If `skipAfterTime` defaults to `"11:00"` and `briefingEndTime` also defaults to `"11:00"`, the second check is redundant. But if `skipAfterTime` is *earlier* than `briefingEndTime`, the first check lets it through and the second catches it — so they serve different purposes. Not a bug, just potentially confusing.

### 2.4 Merge Conflict Resolution — Verification

All 6 previously-conflicted files have been cleaned:

| File | Status | Notes |
|------|--------|-------|
| `src/components/conflicts/ConflictWarning.tsx` | ✅ Clean | Uses Surface, Button, design system |
| `src/components/clarification/ClarificationModal.tsx` | ✅ Clean | Uses Surface, design system |
| `src/app/time-capsule/page.tsx` | ✅ Clean | 160 lines, well-structured |
| `src/app/analytics/page.tsx` | ✅ Clean | 91 lines, tab-based layout |
| `src/app/skill-tree/page.tsx` | ✅ Clean | 264 lines, full feature page |
| `src/app/money-mountain/page.tsx` | ✅ Clean | 285 lines, full feature page |
| `src/lib/hermes-tools.ts` | ✅ Clean | Duplicate `},` removed |

**No merge conflict markers remain** in the codebase (verified via `grep`).

### 2.5 Security Concerns

#### 🔴 Issue 11: Admin Credentials in Source Code

`scripts/pb-seed.mjs` has hardcoded credentials:
```javascript
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || "admin@consuela.app";
const ADMIN_PASS = process.env.PB_ADMIN_PASS || "26649_alan";
```

**Recommendation:** Remove default values and require environment variables. Add `.env.example` with placeholders.

#### 🟡 Issue 12: `x-user-id` Header Trust

All API routes accept user identity via `x-user-id` header with no validation:
```tsx
headers: { 'x-user-id': 'demo-user' }
```

This is fine for development but **critical to fix before production** — any client can impersonate any user by changing this header.

### 2.6 Missing Pieces Summary

| Area | What Exists | What's Missing |
|------|-------------|----------------|
| **DB Layer** | Feature schemas, migration script, seed script | Integration with cache layer, empty drizzle migration |
| **API Routes** | All feature routes present | Not reviewed for error handling |
| **Components** | Full component sets for all 4 features | No server-side rendering of feature data |
| **Types** | Comprehensive TypeScript interfaces | `XP_REWARDS` type mismatch |
| **Testing** | `vitest` and `playwright` configured | No actual test files written |
| **Auth** | PIN-based member auth exists | Feature pages use hardcoded `demo-user` |
| **Documentation** | JSDoc on most functions | No API documentation |

### 2.7 Recommended Next Steps (Priority Order)

1. **Run migrations** when PocketBase is available (Steps 1-5 above)
2. **Fix `XP_REWARDS` type** — change `Record<QuestDifficulty, ...>` to `Record<QuestType, ...>`
3. **Populate `src/db/migrate.ts`** or redirect `db:migrate` script to the working migration
4. **Review API routes** — verify error handling, auth, and data validation
5. **Add `.env.example`** with all required environment variables
6. **Write integration tests** for the feature API routes
7. **Consolidate database layers** — merge `db/index.ts` and `db/pb-db.ts` fallback data
8. **Replace hardcoded `demo-user`** with actual auth when ready

---

## Appendix: Collection Relationship Map

```
users
├── conversations ──┬── conversation_messages ── conversation_feedback
│                   └── (userId)
├── proactive_suggestions (userId)
├── ai_preferences (userId)
├── time_capsules ─── capsule_contents
├── skill_tree_profiles (userId)
├── user_achievements ── achievements
├── money_mountains ──┬── mountain_milestones
│                     └── mountain_transactions
├── allowance_settings (parentId → users, childId → users)
├── briefing_preferences (userId)
├── briefing_history ── daily_quotes
└── quests ── skill_branches
```

---

*Review prepared for branch `arena/019f76eb-home-ai` on the `ninjass10101010-alt/Home-ai` repository.*
