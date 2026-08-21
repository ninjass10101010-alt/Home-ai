# Home Calendar Important Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-visual-impact preview of up to 3 AI-detected important later-week events to the Home Today's Events widget using pre-scored importance stored in PocketBase.

**Architecture:** PocketBase schema extends `events` with importance fields. A cron API route scores events from Google Calendar sync using title keyword heuristics and persists scores. Home reads pre-scored events for next 7 days and renders up to 3 below today's events using existing SectionCard / ListRow UI.

**Tech Stack:** Next.js 14 App Router, TypeScript, PocketBase JS SDK, Vitest, Playwright

## Global Constraints

- No visual change to Today card chrome: same tone, protruding icon, centered header, footer style.
- Max 3 upcoming important events total, days > today and ≤ 7 days out.
- Scoring uses title keywords only for v1.
- Read-only from Google Calendar sync; no writes to Google.
- Existing `db.selectTodaysEvents` pattern must remain unchanged.

---

### Task 1: PocketBase events schema extension

**Files:**
- Modify: `Home-ai/scripts/pb-seed.mjs`
- Test: `tests/unit/pb-schema-importance.test.ts`

**Interfaces:**
- Produces: `events` collection fields `importanceScore` number, `importanceReason` text, `importanceUpdatedAt` datetime

- [ ] Step 1: Write the failing test

```typescript
import { describe, it, expect } from 'vitest'
describe('pb schema importance fields', () => {
  it('events collection has importanceScore', async () => {
    const schema = await getPbEventsSchema()
    expect(schema.fields.find(f => f.name === 'importanceScore')).toBeDefined()
  })
})
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/unit/pb-schema-importance.test.ts -v`
Expected: FAIL - field not found

- [ ] Step 3: Write minimal implementation

In `Home-ai/scripts/pb-seed.mjs` add patch:

```javascript
const ensureImportanceFields = async () => {
  const events = await pb.collection('events').listFields()
  const names = events.fields.map(f => f.name)
  if (!names.includes('importanceScore')) {
    await pb.collection('events').updateField('importanceScore', {
      name: 'importanceScore',
      type: 'number',
      system: false,
      required: false,
      presentable: false,
      options: { min: 0, max: 100 }
    })
  }
  // importanceReason, importanceUpdatedAt similar
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/unit/pb-schema-importance.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add Home-ai/scripts/pb-seed.mjs tests/unit/pb-schema-importance.test.ts
git commit -m "feat(pocketbase): add importance fields to events collection"
```

### Task 2: Importance scoring library

**Files:**
- Create: `Home-ai/src/lib/calendar/importance.ts`
- Test: `Home-ai/tests/unit/calendar/importance.test.ts`

**Interfaces:**
- Produces: `export function scoreEvent(event): { score: number, reason: string }`
- Consumes: event shape with `title`, `start`, `duration`, `members`

- [ ] Step 1: Write the failing test

```typescript
import { scoreEvent } from '@/lib/calendar/importance'
it('scores doctor keyword high', () => {
  const event = { title: 'Doctor appointment', start: '', duration: 60, members: [] }
  const { score } = scoreEvent(event)
  expect(score).toBeGreaterThanOrEqual(50)
})
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run Home-ai/tests/unit/calendar/importance.test.ts -v`
Expected: FAIL - module not found

- [ ] Step 3: Write minimal implementation

```typescript
const KEYWORDS = ['doctor','dentist','flight','parent teacher','game','tournament','interview','exam','recital','graduation','surgery','vaccine','birthday']
export function scoreEvent(event: any) {
  const title = (event.title||'').toLowerCase()
  let score = 0
  let reason = ''
  for (const kw of KEYWORDS) {
    if (title.includes(kw)) { score += 50; reason += kw+', ' }
  }
  if (title.startsWith(KEYWORDS.find(k=>title.includes(k))||'')) score+=20
  if (event.duration > 120) score+=10
  if (event.members?.length > 1) score+=10
  return { score: Math.min(100, score), reason: reason.trim() }
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run Home-ai/tests/unit/calendar/importance.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add Home-ai/src/lib/calendar/importance.ts Home-ai/tests/unit/calendar/importance.test.ts
git commit -m "feat(importance): add keyword scoring library"
```

### Task 3: Cron scorer API route

**Files:**
- Create: `Home-ai/src/app/api/cron/calendar/score-importance/route.ts`
- Test: `Home-ai/tests/integration/api/score-importance.test.ts`

**Interfaces:**
- Consumes: `scoreEvent` from Task 2
- Produces: HTTP 200 with `{ scored: number }`

- [ ] Step 1: Write failing test

```typescript
it('requires CRON_SECRET', async () => {
  const res = await fetch('/api/cron/calendar/score-importance')
  expect(res.status).toBe(401)
})
```

- [ ] Step 2: Run test

Run: `npx vitest run Home-ai/tests/integration/api/score-importance.test.ts -v`
Expected: FAIL

- [ ] Step 3: Write minimal implementation

```typescript
import { scoreEvent } from '@/lib/calendar/importance'
import { NextResponse } from 'next/server'
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', { status:401 })
  const today = new Date()
  const end = new Date(); end.setDate(today.getDate()+7)
  const events = await pb.collection('events').getFullList({ filter:`start >= "${today.toISOString()}" && start < "${end.toISOString()}"` })
  let scored = 0
  for (const e of events) {
    const { score, reason } = scoreEvent(e)
    if (score>0) { await pb.collection('events').update(e.id,{ importanceScore:score, importanceReason:reason, importanceUpdatedAt:new Date().toISOString() }); scored++ }
  }
  return NextResponse.json({ scored })
}
```

- [ ] Step 4: Run test

Run: `npx vitest run Home-ai/tests/integration/api/score-importance.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add Home-ai/src/app/api/cron/calendar/score-importance/route.ts Home-ai/tests/integration/api/score-importance.test.ts
git commit -m "feat(cron): add importance scoring endpoint"
```

### Task 4: Home data hook for upcoming important

**Files:**
- Create: `Home-ai/src/hooks/useHomeEvents.ts`
- Test: `Home-ai/tests/unit/hooks/useHomeEvents.test.ts`

**Interfaces:**
- Produces: `{ todayEvents, upcomingImportant }`

- [ ] Step 1: Write failing test

```typescript
it('limits upcomingImportant to 3', async () => { ... })
```

- [ ] Step 2: Run test

Run: `npx vitest run Home-ai/tests/unit/hooks/useHomeEvents.test.ts -v`
Expected: FAIL

- [ ] Step 3: Write implementation

```typescript
export async function getHomeEvents() {
  const todayEvents = await db.selectTodaysEvents()
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1)
  const end = new Date(); end.setDate(new Date().getDate()+7)
  const upcomingImportant = await pb.collection('events').getList(1,3,{ filter:`start >= "${tomorrow.toISOString()}" && start < "${end.toISOString()}" && importanceScore >= 50`, sort:'-importanceScore,start' })
  return { todayEvents, upcomingImportant: upcomingImportant.items }
}
```

- [ ] Step 4: Run test

Run: `npx vitest run Home-ai/tests/unit/hooks/useHomeEvents.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add Home-ai/src/hooks/useHomeEvents.ts Home-ai/tests/unit/hooks/useHomeEvents.test.ts
git commit -m "feat(home): add upcoming important events hook"
```

### Task 5: Home page UI integration

**Files:**
- Modify: `Home-ai/src/app/page.tsx:343-373`
- Test: `Home-ai/tests/e2e/home-today-important.spec.ts`

**Interfaces:**
- Consumes: `getHomeEvents` from Task 4

- [ ] Step 1: Write failing Playwright test

```typescript
test('Today card shows upcoming important', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Upcoming important')).toBeVisible()
})
```

- [ ] Step 2: Run test

Run: `npx playwright test Home-ai/tests/e2e/home-today-important.spec.ts -v`
Expected: FAIL

- [ ] Step 3: Write UI change

In `src/app/page.tsx` todayEvents case, after visible events map, add:

```tsx
{upcomingImportant.length > 0 && (
  <div className="pt-3 border-t border-white/10">
    <div className="text-[11px] uppercase tracking-wide text-text-muted mb-2">Upcoming important</div>
    <div className="space-y-2">
      {upcomingImportant.map(e => <ListRow key={e.id} ... />)}
    </div>
  </div>
)}
```

- [ ] Step 4: Run test

Run: `npx playwright test Home-ai/tests/e2e/home-today-important.spec.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add Home-ai/src/app/page.tsx Home-ai/tests/e2e/home-today-important.spec.ts
git commit -m "feat(home): render upcoming important events in Today card"
```

### Task 6: Verification

**Files:**
- Modify: `Home-ai/docs/CHANGELOG.md`

- [ ] Step 1: Run typecheck

Run: `npm run typecheck`
Expected: clean

- [ ] Step 2: Run unit tests

Run: `npx vitest run`
Expected: all pass

- [ ] Step 3: Run Playwright smoke

Run: `npx playwright test Home-ai/tests/e2e/home-today-important.spec.ts`
Expected: PASS at 390/768/1440

- [ ] Step 4: Update docs

Add entry to CHANGELOG

- [ ] Step 5: Commit

```bash
git add Home-ai/docs/CHANGELOG.md
git commit -m "chore: verify home important events feature"
```
