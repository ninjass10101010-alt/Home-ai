# Calendar Tab Replaces More, Emergency Moves to Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the More tab in CapsuleNav with a Calendar tab, redirect `/more` → `/calendar`, and surface Emergency reference tools from a new Settings card.

**Architecture:** A small, additive navigation change. `CapsuleNav` swaps one nav item (icon + href + label). `next.config.ts` gains a permanent redirect. The More page file is deleted; its `MoreMenuItem` pattern is reused for a new SectionCard row on Settings. The `/emergency` page and alert flows are untouched. Playwright scripts are the regression probes (nav labels, redirect, Settings card).

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS 4, Node Playwright (`scripts/consuela/*.mjs`).

## Global Constraints

- No new dependencies. No changes to `src/app/emergency/page.tsx`, `EmergencyButton.tsx`, or `POST /api/emergency`.
- Nav item count stays 6 (`--capsule-scale` math depends on it); Calendar occupies More's old last slot.
- Icons use the existing inline-SVG stroke family: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={active ? 2.5 : 2}`, `strokeLinecap="round"`, `strokeLinejoin="round"`.
- AGENTS.md must be updated in the same session (mandatory per its own rules): §1.1 nav table + "Navigation model" line, §1.5 Common Journeys (two stale journeys must be fixed), a new UI Change Record block, a Change Log entry, and the Current Dashboard Snapshot.
- Verification baseline: `npm run typecheck` clean; `npx vitest run` = 166/167 (the 1 failure is the pre-existing PB-env one in `tests/integration/api-routes.test.ts:446` — requires `PB_ADMIN_EMAIL`/`PB_ADMIN_PASS`, not caused by this work).
- All work commits on branch `warm-glass-v2` (current HEAD `ba2a591`).

---

### Task 1: CapsuleNav — More item becomes Calendar

**Files:**
- Modify: `src/components/ui/CapsuleNav.tsx:62-72` (the More nav item object)
- Test: `scripts/consuela/test-capsule-nav.mjs:71` (LABELS array)

**Interfaces:**
- Produces: nav item `{ href: "/calendar", label: "Calendar", icon: (active: boolean) => JSX }` — same shape as the other 5 items, so the map at `CapsuleNav.tsx:113` needs no changes. Active detection (`pathname === item.href`) works because `/calendar` is an exact route.

- [ ] **Step 1: Update the failing test (LABELS) first**

In `scripts/consuela/test-capsule-nav.mjs`, replace line 71:

```js
const LABELS = ["Home", "Ask", "Meals", "Tasks", "Settings", "More"];
```

with:

```js
const LABELS = ["Home", "Ask", "Meals", "Tasks", "Settings", "Calendar"];
```

Also update the header comment (lines 8–9): `(Home, Ask, Meals, Tasks, Settings, More)` → `(Home, Ask, Meals, Tasks, Settings, Calendar)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/consuela/test-capsule-nav.mjs`
Expected: FAIL — `missing item Calendar` (and the "six items present" count check still passes since More still renders).

- [ ] **Step 3: Swap the nav item in CapsuleNav.tsx**

Replace the More item object (lines 62–72):

```tsx
  {
    href: "/more",
    label: "More",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="12" r="1.5" fill="currentColor" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        <circle cx="18" cy="12" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
```

with:

```tsx
  {
    href: "/calendar",
    label: "Calendar",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
        <path d="M3.5 9.5h17" />
        <path d="M8 2.5v4" />
        <path d="M16 2.5v4" />
        <path d="M8.5 13.5h.01" />
        <path d="M12 13.5h.01" />
        <path d="M15.5 13.5h.01" />
        <path d="M8.5 17h.01" />
        <path d="M12 17h.01" />
        <path d="M15.5 17h.01" />
      </svg>
    ),
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/consuela/test-capsule-nav.mjs`
Expected: `ALL CAPSULE NAV CHECKS PASSED` — 6 items, Home expanded on `/`, click-switch, keyboard focus, no overflow at 375/390px.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` — expected clean.
```bash
git add src/components/ui/CapsuleNav.tsx scripts/consuela/test-capsule-nav.mjs
git commit -m "feat(nav): More tab becomes Calendar in CapsuleNav"
```

---

### Task 2: Redirect /more → /calendar, delete the More page, retarget AdultHome link

**Files:**
- Modify: `next.config.ts` (add `redirects()`)
- Delete: `src/app/more/page.tsx`
- Modify: `src/modes/adult/AdultHome.tsx:156` (link target)
- Test: `scripts/consuela/test-capsule-nav.mjs` (add redirect + Calendar click assertions)

**Interfaces:**
- Consumes: Task 1's Calendar nav item (clicking it must land on `/calendar`).
- Produces: a 301 permanent redirect `/more` → `/calendar`; zero remaining `href="/more"` references in the app.

- [ ] **Step 1: Add the failing redirect assertions to the test script**

In `scripts/consuela/test-capsule-nav.mjs`, append this block right after the keyboard check (after line 121, before the viewport loop at line 123):

```js
    await page.locator('.capsule-nav button[aria-label="Calendar"]').click();
    await page.waitForURL("**/calendar", { timeout: 30_000 });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.capsule-nav button[aria-label="Calendar"]').getAttribute("aria-current"), "page", "Calendar should be current on /calendar");
    console.log("6. Calendar tab navigates to /calendar and becomes active");

    const resp = await page.request.get(BASE + "/more", { maxRedirects: 0 });
    assert.ok(resp.status() === 307 || resp.status() === 308 || resp.status() === 301, `expected redirect status, got ${resp.status()}`);
    const loc = resp.headers()["location"];
    assert.match(loc, /\/calendar$/, `redirect location should be /calendar, got ${loc}`);
    console.log("7. /more redirects to /calendar");
```

Note: Next.js dev mode serves redirects with a 307 by default; production uses 301 (the `permanent: true` flag). Accept 301/307/308 so the script passes in both.

- [ ] **Step 2: Renumber the final console.log**

Change the last log line (currently line 140) from `console.log("6. no horizontal overflow + capsule auto-scales at 375px and 390px");` to `console.log("8. no horizontal overflow + capsule auto-scales at 375px and 390px");`.

- [ ] **Step 3: Run the test to verify the new checks fail**

Run: `node scripts/consuela/test-capsule-nav.mjs`
Expected: FAIL at the new step 6 — Calendar click never reaches `/calendar` (`waitForURL` times out), because the nav still shows More.

- [ ] **Step 4: Add the redirect to next.config.ts**

Replace the whole file:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async redirects() {
    return [
      {
        source: "/more",
        destination: "/calendar",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 5: Delete the More page**

```bash
rm src/app/more/page.tsx
```

- [ ] **Step 6: Retarget the AdultHome weather "Details →" link**

In `src/modes/adult/AdultHome.tsx:156`, change:

```tsx
        <Link href="/more" className="text-[10px] font-semibold text-[var(--color-accent-selected)]">Details →</Link>
```

to:

```tsx
        <Link href="/calendar" className="text-[10px] font-semibold text-[var(--color-accent-selected)]">Details →</Link>
```

- [ ] **Step 7: Verify no /more references remain + run the test**

Run: `grep -rn '"/more"\|/more' src next.config.ts --include='*.tsx' --include='*.ts' | grep -v node_modules` — expected: no matches (or only in this plan's docs).
Run: `node scripts/consuela/test-capsule-nav.mjs`
Expected: `ALL CAPSULE NAV CHECKS PASSED` including the new steps 6–7.

- [ ] **Step 8: Typecheck + commit**

Run: `npm run typecheck` — expected clean.
```bash
git add next.config.ts src/modes/adult/AdultHome.tsx scripts/consuela/test-capsule-nav.mjs
git rm src/app/more/page.tsx
git commit -m "feat(nav): redirect /more to /calendar, delete More page"
```

---

### Task 3: Settings — Emergency reference card

**Files:**
- Modify: `src/app/settings/page.tsx` (import + new SectionCard after the "Emergency contacts" card)
- Test: `scripts/consuela/verify-emergency-settings.mjs` (NEW — Playwright probe)

**Interfaces:**
- Consumes: `MoreMenuItem` from `@/components/patterns/MoreMenuItem` (kept in the codebase after the More page deletion), `SectionCard` (already imported in settings/page.tsx).
- Produces: a SectionCard with title "Emergency", rose tone, 🛡️ protruding icon, and a `MoreMenuItem` row linking to `/emergency`.

- [ ] **Step 1: Write the failing verification script**

Create `scripts/consuela/verify-emergency-settings.mjs`:

```js
#!/usr/bin/env node
// Playwright probe: Settings now surfaces the Emergency reference page.
//
// Usage:
//   node scripts/consuela/verify-emergency-settings.mjs
//
// What it verifies:
//   1. /settings renders an "Emergency" SectionCard whose link row points to /emergency.
//   2. Tapping it lands on the emergency reference page (contacts + 911 present).
//
// Boots its own `npm run dev -p <free port>`.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 3301;
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForReady(deadlineMs = 240_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 200) return;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error("dev server did not become ready");
}

async function bootDevServer(port) {
  rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true });
  const logDir = mkdtempSync(path.join(os.tmpdir(), "emergency-settings-test-"));
  const logPath = path.join(logDir, "next-dev.log");
  const log = createWriteStream(logPath);
  const child = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return { child, logPath };
}

const serverLogTail = (logPath) => {
  try {
    return readFileSync(logPath, "utf8").split("\n").slice(-30).join("\n");
  } catch {
    return "(no log)";
  }
};

async function main() {
  const { child, logPath } = await bootDevServer(PORT);
  let browser;
  try {
    await waitForReady();
    console.log(`dev server ready at ${BASE}`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    await page.goto(BASE + "/settings", { waitUntil: "domcontentloaded" });
    const link = page.locator('a[href="/emergency"]');
    await link.waitFor({ state: "visible", timeout: 60_000 });
    const card = link.locator("xpath=ancestor::section[1]");
    assert.match(await card.textContent(), /Emergency/, "Settings should have an Emergency card");
    console.log("1. Settings renders an Emergency card linking to /emergency");

    await link.click();
    await page.waitForURL("**/emergency", { timeout: 30_000 });
    await page.waitForTimeout(800);
    const body = await page.locator("body").textContent();
    assert.match(body, /911/, "emergency page should mention 911");
    assert.match(body, /Emergency/i, "emergency page should render its title");
    console.log("2. Emergency card opens the reference page (911 + title present)");

    console.log("\nALL EMERGENCY-SETTINGS CHECKS PASSED");
  } catch (err) {
    console.error("\nFAILED:");
    console.error(err.message);
    console.error("--- dev server log tail ---");
    console.error(serverLogTail(logPath));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    child.kill("SIGTERM");
  }
}

main();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/consuela/verify-emergency-settings.mjs`
Expected: FAIL — `waitFor` times out (`a[href="/emergency"]` not found on /settings).

- [ ] **Step 3: Add the MoreMenuItem import**

In `src/app/settings/page.tsx`, add to the existing imports so the `@/components/patterns` group stays alphabetical (`FormField`, `MoreMenuItem`, `PageHeader`, `SectionCard`):

```tsx
import MoreMenuItem from "@/components/patterns/MoreMenuItem";
```

- [ ] **Step 4: Add the Emergency card after the "Emergency contacts" card**

In `src/app/settings/page.tsx`, immediately after the closing `</SectionCard>` of "Emergency contacts" (line 700), insert:

```tsx

          <SectionCard title="Emergency" description="Call cards, common situations, and 911 reference." icon="🛡️" tone="#f43f5e">
            <MoreMenuItem icon="🛡️" title="Open emergency reference" description="Contacts, common situations, and 911" href="/emergency" />
          </SectionCard>
```

- [ ] **Step 5: Run the verification script**

Run: `node scripts/consuela/verify-emergency-settings.mjs`
Expected: `ALL EMERGENCY-SETTINGS CHECKS PASSED`.

- [ ] **Step 6: Typecheck + full vitest + commit**

Run: `npm run typecheck` — expected clean.
Run: `npx vitest run` — expected 166/167 (only the pre-existing PB-env failure).
```bash
git add src/app/settings/page.tsx scripts/consuela/verify-emergency-settings.mjs
git commit -m "feat(settings): Emergency reference card linking to /emergency"
```

---

### Task 4: AGENTS.md — nav table, journeys, UI Change Record, Change Log, snapshot

**Files:**
- Modify: `AGENTS.md` (same session, per its mandatory rule)

**Interfaces:**
- Consumes: nothing new; documents Tasks 1–3 exactly as implemented.

- [ ] **Step 1: Update §1.1 nav table + Navigation model line**

1. Replace the `| More | /more | ...` row in the §1.1 table with:

```markdown
| Calendar       | `/calendar`    | Calendar grid (rect + binding rings + day dots) | Family routines, events, and month view |
```

2. In the "Navigation model:" bullet (under "IMPORTANT BUILD NOTE" area and in the §1.1 intro paragraph), replace `(Home, Ask, Meals, Tasks, Settings, More)` with `(Home, Ask, Meals, Tasks, Settings, Calendar)`. The same list appears in "Current Dashboard Snapshot" → "CapsuleNav:" line — update it too.
3. In the §1.1 intro paragraph "The active item expands into a neon-lime pill" text, no item-list change is needed beyond what the table shows.

- [ ] **Step 2: Fix the two stale Common Journeys (§1.5)**

1. Replace the whole "How do I get to the grocery list?" answer with:

```markdown
**"How do I get to the grocery list?"**  
Tap **Meals** in the bottom bar, then the **Grocery** tab. From Home you can also tap any quick "Grocery list" prompt in the AI chat bubble.
```

2. Replace the whole "Where are Emergency and Settings now?" answer with:

```markdown
**"Where are Emergency and Settings now?"**  
Tap **Settings** in the bottom bar. The new **Emergency** card opens the quick-reference page (contacts, common situations, 911); the rest of Settings holds theme, family, routines, emergency contacts, layout, and data controls. The bottom bar's Calendar tab replaces the old More menu.
```

- [ ] **Step 3: Add a UI Change Record block**

Insert a new record directly above the existing `### UI Change Record — 2026-08-20 — Protruding weather-style icons...` record:

```markdown
### UI Change Record — 2026-08-20 — Calendar tab replaces More; Emergency moves to Settings
- Added / Changed: `src/components/ui/CapsuleNav.tsx` (the sixth nav item is now Calendar — `href: "/calendar"`, calendar-grid SVG icon, label "Calendar"; the three-dots More item is gone; still 6 items, Calendar sits in More's old last slot so `--capsule-scale` geometry is unchanged), `next.config.ts` (new `redirects()` — `/more` → `/calendar`, `permanent: true`), `src/app/more/page.tsx` (DELETED), `src/modes/adult/AdultHome.tsx` (weather "Details →" link retargeted `/more` → `/calendar`), `src/app/settings/page.tsx` (new "Emergency" SectionCard — 🛡️ protruding icon, rose `#f43f5e` tone, `MoreMenuItem` row "Open emergency reference" → `/emergency` — placed directly below the existing "Emergency contacts" config card), `scripts/consuela/test-capsule-nav.mjs` (LABELS → Calendar; new assertions: Calendar tab navigates + becomes current, `/more` returns a redirect to `/calendar`), `scripts/consuela/verify-emergency-settings.mjs` (NEW — Playwright probe: Settings Emergency card opens the reference page)
- Visual / Motion: The bottom capsule's last tab now reads "Calendar" with a calendar-grid icon (rounded rect, top rule, binding rings, day dots — same stroke family as the other tabs). The More page is gone; visiting old bookmarks or the adult-mode "Details →" link redirects to the Calendar tab. Settings now has a second Emergency card: rose-tinted, 🛡️ protruding icon, one row that opens the existing reference page (contact cards, common situations, 911). No new motion; the floating red shield on Home, the `/emergency` page, and the alert flow are untouched.
- Color sources: Reuses the existing rose `#f43f5e` (emergency tone) and warm-glass tokens; no new colors.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "The bottom bar's More tab is now a Calendar tab — the calendar-grid icon sits right where More used to be, and the old More address quietly forwards to the Calendar. Emergency reference tools (contact cards, common situations, and the 911 button) now live in Settings under a red shield card. The red emergency button on Home and the alert flow are exactly the same."
```

- [ ] **Step 4: Add the Change Log entry + update the snapshot line**

1. Insert at the TOP of the Change Log list (above the `- 2026-08-20 — feat(ui): Protruding weather-style icons...` entry):

```markdown
- 2026-08-20 — feat(nav): Calendar tab replaces More; Emergency moves to Settings. `src/components/ui/CapsuleNav.tsx` — sixth item is now Calendar (`/calendar`, calendar-grid SVG; three-dots More removed; still 6 items, same last slot → capsule geometry unchanged). `next.config.ts` — `redirects()`: `/more` → `/calendar` (permanent). `src/app/more/page.tsx` deleted. `src/modes/adult/AdultHome.tsx` — weather "Details →" retargeted to `/calendar`. `src/app/settings/page.tsx` — new "Emergency" SectionCard (🛡️, rose `#f43f5e`, `MoreMenuItem` row → `/emergency`) below the "Emergency contacts" config card. Scripts: `test-capsule-nav.mjs` LABELS + redirect/Calendar assertions; new `verify-emergency-settings.mjs` probe. Verified: typecheck clean, vitest 166/167 (pre-existing PB-env failure), both Playwright scripts pass.
```

2. Prepend to the "Current Dashboard Snapshot" first line (keep the existing text after it):

```markdown
- **Last Updated:** 2026-08-20 | **Calendar tab replaces More; Emergency in Settings** — the bottom capsule's last tab is now Calendar (`/calendar`, calendar-grid icon); the More page is deleted and `/more` 301-redirects to `/calendar` (old bookmarks + the adult-mode weather "Details →" link land on Calendar). The Emergency reference page (contacts, common situations, 911) is now one tap away from Settings via a new rose 🛡️ card below the "Emergency contacts" config card. The floating red shield on Home and the alert flow are untouched.
```

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md — Calendar tab, /more redirect, Emergency in Settings"
```

---

### Task 5: Full verification pass

- [ ] **Step 1: Run the full battery**

```bash
npm run typecheck
npx vitest run
node scripts/consuela/test-capsule-nav.mjs
node scripts/consuela/verify-emergency-settings.mjs
```

Expected:
- `npm run typecheck` — clean.
- `npx vitest run` — 166 pass, 1 fail (pre-existing PB-env integration test, unrelated).
- `test-capsule-nav.mjs` — `ALL CAPSULE NAV CHECKS PASSED` (6 items incl. Calendar, expansion/aria-current/keyboard, `/more` redirect, no overflow at 375/390).
- `verify-emergency-settings.mjs` — `ALL EMERGENCY-SETTINGS CHECKS PASSED`.

- [ ] **Step 2: Confirm commit history**

Run: `git log --oneline -6`
Expected: 4 new commits on top of `ba2a591` — the Task 1–4 commits, in order.