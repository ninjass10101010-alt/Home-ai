# Consuela Dashboard — Agent Operational Manual

> **For the AI Coding Agent (Kilo) only.**  
> This is your single source of truth when a user asks how to **use**, **configure**, **troubleshoot**, or **extend** the live Consuela family dashboard.  
> Always start here before answering operational questions. Cross-reference the linked deep docs.  
> **Mandatory:** After any code change that touches UI, navigation, meals, emergency, or integrations, update this file in the same session.

**Current Dashboard Snapshot** (maintain on every relevant change)  
- **Last Updated:** 2026-05-27 | Source of truth: immersive weather widget implementation + hermes-api work  
- **Last major UI refresh:** 2026-05-21 — motion icons, 3D floating elements, AnimatedEmoji, glass/isometric cards, gradient orbs  
- **Active integrations:** Meals ↔ Pantry ↔ Grocery bidirectional sync (`mealSyncService`), Emergency SMS + Email (free Gmail + carrier gateways), AI Chat ("Ask Consuela"), full theme system (3 modes + 6 accent colors), PocketBase data layer
- **Navigation model:** Persistent bottom tab bar (8 items) + always-visible floating red Emergency shield button (top-right on Home)
- **Tech surface for ops:** Next.js 16 + React 19 + Tailwind CSS 4, PocketBase backend (`pocketbase` SDK), API routes under `src/app/api/`, custom SVG animations (no framer-motion)

---

## 1. User Interface (UI) Navigation

### 1.1 Current Layout & Navigation Model

The dashboard is a mobile-first, glass-morphism, bottom-nav app with a persistent floating action for emergencies.

**Bottom Tab Bar (always present, `BottomNav.tsx`):**

| Label          | Route          | Icon (active = heavier stroke / filled)          | Primary Notes |
|----------------|----------------|--------------------------------------------------|---------------|
| Home           | `/`            | House                                            | Dashboard with weather, today's events, quick AI ask, weekly meals preview, tasks |
| Ask Consuela   | `/chat`        | Speech bubble with 3 dots (primary, filled when active) | Main conversational interface |
| Calendar       | `/calendar`    | Calendar grid                                    | Events + schedule |
| Meals          | `/meals`       | Pot / plate                                      | Weekly recipe-style meal planner + pantry sync + grocery generator |
| Tasks          | `/tasks`       | Checklist                                        | Chore list with points |
| Grocery        | `/grocery`     | Shopping cart                                    | Smart list with manual overrides and sync status |
| Emergency      | `/emergency`   | Shield                                           | **Non-critical** quick reference page (minor issues + contact list). Serious alerts use the floating button |
| Settings       | `/settings`    | Gear                                             | Theme (dark/light/system + 6 accents + high-contrast), family members, emergency contacts config |

**Floating Emergency Button (always on Home, `EmergencyButton.tsx`):**
- Fixed position: `top-4 right-4`, `z-50`
- Red rose-500 circle with white shield + exclamation SVG
- Taps → modal with 4 serious types: 🔥 Fire, 💧 Water Leak, 🤕 Injury, 🚨 General
- On selection → POST `/api/emergency` → dual notification (SMS via carrier email-to-SMS + HTML email via Gmail App Password)
- Success state: green check + "Alert Sent" + auto-close after 3s + count of successful deliveries
- Failure: red X + "Try Again" + advice to call 911 directly

**Recent Visual Language (as of adbe770):**
- Glass / translucent surfaces with 20px blur
- Isometric cards with perspective hover lift (`isometric-card` class)
- Gradient orbs as decorative background elements (pulse + melt animations)
- Safe-area insets respected for iOS notch / home indicator

**How to document future UI updates (mandatory for the agent):**
Use this exact delta format in the "What's New" area and update 1.5 journeys:

```markdown
### UI Change Record — YYYY-MM-DD — <short commit subject>
- Added / Changed: <component or page>
- Visual / Motion: <describe exactly what user sees, file paths, CSS classes>
- Agent action required: Update this section + Common Journeys + any affected SOP
- User-facing description (copy-paste ready for responses):
  > "On the Home screen the chat bubble now gently floats up and down..."
```

### 1.2 Documenting Recent & Future UI Updates

**Current "What's New" (2026-05-26 immersive weather refresh):**
As of the latest build, the Home dashboard weather widget features:
- **Immersive Weather Widget** (`src/components/ui/WeatherWidget.tsx`): Full-bleed glassmorphism backgrounds with seasonal/holiday themes.
- **Season backdrops**: `SpringBackdrop` (cherry blossoms, mist), `SummerBackdrop` (palm silhouettes, heat haze, galaxy stars), `AutumnBackdrop` (bare oak trees, fog), `WinterBackdrop` (aurora borealis, icicles, pine silhouettes).
- **Holiday overlays**: `ChristmasOverlay` (fairy lights, snow), `HalloweenOverlay` (bats, moon, mist), `FireworksOverlay` (4th of July bursts), `ValentinesOverlay` (floating hearts, rose glow), `NewYearsOverlay` (golden sparkles, champagne fizz).
- **Particle system**: `WeatherParticles` component with animated SVG/CSS particles — blossom petals, autumn leaves, fireflies, snowflakes, sparks, hearts.
- **Settings integration**: Holiday/Event Theme selector in Settings (`src/app/settings/page.tsx`) with live preview.
- Users can force-enable any holiday theme or use auto-detection based on date.

### 1.3 Motion & Animated Elements

See files:
- `src/components/3d/Icon3D.tsx` + `index.ts`
- `src/components/ui/AnimatedEmoji.tsx`
- `src/app/globals.css` (search for `@keyframes float`, `.floating`, isometric hover)

**Agent rule:** Never describe the old static emoji experience. Always mention the gentle floating / keyframe motion when talking about the Home screen or meal cards.

### 1.4 Theme & Accessibility Controls

- Three modes (dark default, light, system) persisted in `localStorage` under `home-ai-theme-config`
- 6 accent colors (mint, cyan, violet, amber, rose, nori)
- High-contrast boost toggle
- All colors via CSS variables (`--color-accent-*`, `--color-surface-*`, etc.)
- Controlled by `useTheme` hook (`src/hooks/useTheme.tsx`) and inline anti-FOUC script in `layout.tsx`

Settings page is the single place users change this. Changes are instant across the entire app.

### 1.5 Common User Journeys (copy-paste ready answers)

**"How do I get to the grocery list?"**  
Tap the "Grocery" tab in the bottom bar (shopping-cart icon). From Home you can also tap any quick "Grocery list" prompt in the AI chat bubble.

**"How do I trigger a real emergency alert?"**  
On the Home screen, tap the red shield icon in the top-right corner. Choose one of the four serious types. The system will attempt SMS + email to your configured primary contacts.

**"I just added a custom meal — where does it appear?"**  
It appears immediately in the weekly Meals view on its chosen day. If you tap "Sync with Pantry & Grocery", missing ingredients are added to the Grocery list with the correct aisle and priority.

---

## 2. Integration Workflows (Step-by-Step Agent Procedures)

### 2.1 Meal / Recipe Management (Setup • Execution • Troubleshooting)

**Setup (one-time or after DB reset):**
1. Ensure the in-memory DB is seeded (see `db:seed-emergency` script or manual population in `src/db/index.ts`).
2. (Optional) Run `npm run db:migrate-node` if using the node migration path.
3. On first load of `/meals`, the default 7-day plan + sample pantry + grocery items are present.

**Daily Execution (what a user actually does in the UI):**
1. Tap **Meals** tab.
2. Scroll the horizontal "This Week's Meals" strip (or tap a day to edit).
3. To add a custom recipe-style meal:
   - Tap the + or "Add custom" control
   - Choose emoji from the food emoji grid (or type custom)
   - Enter name, prep time, servings, calories, macros, tags, full instructions
   - Assign to a weekday
4. Tap the big **Sync Pantry & Grocery** button (or the per-item sync).
5. Switch to **Grocery** tab — new items appear with correct category/aisle/priority. User can toggle "manual override" to prevent future auto-sync from changing them.
6. From Home or Chat, say to Consuela: "Add salmon for Thursday and put missing items on the grocery list."

**Troubleshooting Tree (use this exact flow when user reports problems):**
- Sync button does nothing or shows old data → Check that `mealSyncService` is imported and the button calls the bidirectional sync methods. Verify `lastSyncedAt` timestamps in the in-memory store.
- Grocery items missing after adding meal → Ensure the recipe's `ingredients` array uses names that match pantry/grocery catalog (case-insensitive substring match in current implementation).
- Custom meal disappears on refresh → Currently in-memory only; tell user "Data is demo-only until we persist to real DB."
- Full reset: run the seed script + hard reload.

**Deep reference (read first when answering advanced questions):**  
`MEAL_SYSTEM_ARCHITECTURE.md` (data model, AI-ready fields, sync rules) and `src/app/meals/page.tsx` (the actual UI + service calls).

**Agent copy-paste template for users:**
> "Open the Meals tab, tap the add button, pick an emoji and fill in the details, then hit the Sync button. Your new meal will appear on the chosen day and any missing ingredients will be added to Grocery with the right aisle."

### 2.2 Emergency Protocols (Configuration • Button Deployment • Testing • Fallbacks)

**Configuration (exact steps the agent must walk a user through):**
1. Get a Gmail account with 2FA enabled.
2. Generate a 16-character App Password for "Mail" at https://myaccount.google.com/apppasswords.
3. Add to `.env.local` (or `.env`):
   ```
   GMAIL_USER=your@gmail.com
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```
4. Edit the placeholder contacts in `src/db/index.ts:120` (`emergencyContactsData`):
   - Use real E.164 phone numbers (`+15551234567`)
   - Real email addresses
   - Keep `isPrimary: true` for the ones that should receive alerts
5. (Recommended) Also populate the friendlier list in `src/app/emergency/page.tsx` for the non-critical quick-reference page.

**Button Behavior (what actually happens):**
- Floating red shield (Home only for now) → modal with 4 types.
- Selection calls `fetch("/api/emergency", { method: "POST", body: { type, timestamp } })`.
- Backend (`src/app/api/emergency/route.ts`) looks up primary contacts, sends SMS via carrier gateways (`sendSMSViaEmail` in `src/lib/free-communication.ts`) + HTML email.
- Returns `{ success, message, details: { successful, total } }`.
- UI shows success/failure state and auto-closes on success.

**Testing Procedure (safe, repeatable):**
- In dev: start server, tap the button, choose "General", watch Gmail Sent folder and recipient phone/email.
- Or use the curl in `TEST_EMERGENCY.md`.
- Production: same, but rate-limit yourself (Gmail free tier = 500 emails/day).

**Fallbacks & Limitations (always mention):**
- No real auth on the button yet — anyone with the app can trigger.
- US carriers primarily.
- SMS delivery can take 1–5 min; email is faster.
- If Gmail creds missing → clear error "service not configured".
- Always advise: "For life-threatening situations, call 911 directly."

**Deep references (read before giving config help):**  
`EMERGENCY_SETUP.md` (full Gmail + carrier list + security notes)  
`TEST_EMERGENCY.md` (curl + expected results)  
`src/app/api/emergency/route.ts` and `src/lib/free-communication.ts`

**Agent rule:** Emergency questions are high priority. Never guess. Always say: "First let me read the live Emergency section in AGENTS.md, then we'll follow the exact configuration steps together."

---

## 3. Operational Clarity — Agent Role Definition

### 3.1 Core Responsibilities
- You are the **live dashboard expert**. Every answer about how the app behaves for a human user must be 100% consistent with the "Current Dashboard Snapshot" and the subsections above.
- When a user describes a problem or asks for a how-to, your first internal action is to re-read the relevant part of this file.
- After you help implement or modify any dashboard feature, you are also responsible for updating this manual in the same turn.

### 3.2 Action Triggers & Mandatory Behaviors

| User Request / Situation                        | You MUST Do Immediately                                                                 |
|------------------------------------------------|------------------------------------------------------------------------------------------|
| "How do I navigate to X?" or "What's the new icon?" | Read 1.1–1.3 first. Give exact tab + visual description including motion if applicable. |
| "The emergency button isn't working"           | Read 2.2 in full. Ask for the exact error message, then walk the config checklist.      |
| "I added a meal but grocery didn't update"     | Read 2.1 troubleshooting tree. Never guess at the service logic.                        |
| "I just pushed a new floating animation"       | Update the UI Change Record + 1.3 + any affected journey in this file before replying.  |
| Any question about "the dashboard"             | Open this file first. Only fall back to reading raw source if this doc is insufficient. |

### 3.3 Expected Outcomes & Verification Checklists

Before you send any reply about the dashboard, mentally tick:
- [ ] I referenced the exact current component or file path the user would see.
- [ ] I gave a short, copy-paste-ready instruction the user can follow in the UI.
- [ ] I mentioned the motion/animated elements when describing Home or Meals.
- [ ] I noted whether this file itself now needs an update because of the conversation.
- [ ] I linked the appropriate deep doc (`EMERGENCY_SETUP.md`, `MEAL_SYSTEM_ARCHITECTURE.md`, etc.) for power users.

### 3.4 Anti-Patterns (never do these)
- Never say "look in the code" or "check src/app/page.tsx".
- Never describe the pre-2026-05-21 static emoji experience.
- Never give production deployment advice without the Gmail limits + security warnings.
- Never claim data is persisted when it is still in-memory only.

---

## 4. Standard Operating Procedures (SOPs)

### 4.1 Reusable SOP Template (copy this block when creating new ones)

```markdown
#### SOP-XXX: <Short Descriptive Title> (Lifecycle Phase: Onboard | Daily | Maintain | Incident | Rollout | Retire)

**Purpose**  
One-sentence goal from the human user's perspective.

**Prerequisites**
- What the user or admin must have ready
- Files / env vars to touch (with exact paths)
- Docs the agent must read first (always include the relevant deep doc)

**Step-by-Step** (imperative, one action per line, numbered)
1. Open the Settings tab...
2. ...

**Expected Results / Success Signals**
- UI: "You should now see a green success toast and the new contact in the list."
- Backend / DB: "A new row appears in emergencyContactsData with isPrimary: true"
- Logs / Notifications: "Gmail sent folder contains the alert"

**Rollback / Undo**
- Exact reverse steps or DB edit command

**Agent Notes**
- Verbatim sentence you should say to the user
- When to escalate: "If the above fails, read the full EMERGENCY_SETUP.md §Troubleshooting"
- Related SOPs
```

### 4.2 Initial Lifecycle SOPs (seed examples — expand as features grow)

#### SOP-001: Onboarding a New Family Member (Onboard)
**Purpose:** Add a person to the family roster so they appear in avatars, get assigned tasks, and can be emergency contacts.

**Prerequisites:** Access to `src/db/index.ts` (or the future real DB UI in Settings).

**Step-by-Step:**
1. In `membersData` array add a new object with id, name, emoji, color, etc.
2. (Future) Expose the same form in the Settings → Family section.
3. For emergency: also add an entry to `emergencyContactsData` if they should receive alerts.
4. Hard reload the app or trigger any state reset so the new member appears in Home family row and avatar pickers.

**Expected Results:** New avatar shows in the top family strip on Home. The person can be assigned tasks and appears in the Emergency quick-reference page.

**Agent Notes:** "After adding them in the code, tell the user to pull the latest and hard-refresh. Their emoji will now animate if it matches one of the special cases in AnimatedEmoji.tsx."

#### SOP-002: Daily Morning Dashboard Check (Daily)
**Purpose:** Quick overview of the day using the motion-rich Home screen.

1. Open the app → land on Home.
2. Read the date pill and greeting.
3. Check the floating weather widget.
4. Review today's events (color-coded left borders).
5. Look at the week's meal strip — tap any day to jump to Meals.
6. Use one of the quick AI prompts or the big "Ask Consuela" glass card (the one with the floating chat Icon3D).
7. If anything looks off with meals/grocery, tap the Meals tab and hit Sync.

**Success:** User feels informed in <30 seconds and can act via chat or direct tabs.

#### SOP-003: Rolling Out a New Motion Icon or Animated Emoji (Rollout)
**Purpose:** Add or modify a floating/animated visual element safely.

1. Edit or add a case inside `Icon3D.tsx` (for simple gradient icons) or `AnimatedEmoji.tsx` (for complex keyframe SVGs).
2. Import and place it inside a `div className="... floating"` container on the target page (usually Home or Meals).
3. Update the "What's New" + 1.3 Motion section in this AGENTS.md with the exact visual description and commit.
4. If the emoji is used in meal cards or family avatars, make sure the fallback pop-bounce still works.
5. Test in both light and dark themes + high-contrast mode.

**Agent Notes:** "Every new animated element must be documented here the same day it ships."

(Additional SOPs for Incident Response on emergency false-positive, full data reset after schema change, etc. will be added as they are needed.)

### 4.3 How to Create a New SOP
1. Pick the next SOP-XXX number.
2. Choose the lifecycle phase.
3. Fill the template above.
4. Add it under 4.2.
5. Update the table of contents if you added a new top-level section.
6. Commit the change to this file together with the feature.

---

## Appendices & Quick References

### Core Operational Docs (read these when the summary here is not enough)
- `EMERGENCY_SETUP.md` — Full Gmail + carrier gateway configuration and security notes
- `TEST_EMERGENCY.md` — Exact curl command and expected Gmail/SMS behavior
- `MEAL_SYSTEM_ARCHITECTURE.md` — Complete data model, sync rules, AI-ready fields for meals/pantry/grocery
- `UI_DESIGN_SPECIFICATION.md` — Design system, all CSS variables, component patterns, accessibility rules
- `UI_DESIGN_VISUAL_REFERENCE.md` + `DESIGN_INDEX.md` — Visual comps and component inventory
- `SETTINGS_PAGE_DESIGN.md` — Theme + family + emergency contact UI details
- `QUICK_REFERENCE_CARD.md` — One-page cheat sheet for humans
- `src/components/3d/Icon3D.tsx` and `src/components/ui/AnimatedEmoji.tsx` — the actual motion source
- `src/components/ui/WeatherWidget.tsx` — immersive weather visuals, season/holiday backdrops, particle system
- `src/hooks/useWidgetTheme.ts` — shared theme hook for weather and other widgets
- `src/lib/weather-config.ts` — weather configuration types and defaults

### Project Scaffolding Recipes (original content preserved for the coding agent)
When users request features beyond the base template, check `.kilocode/recipes/`.

| Recipe       | File                                | When to Use                                           |
| ------------ | ----------------------------------- | ----------------------------------------------------- |
| Add Database | `.kilocode/recipes/add-database.md` | When user needs data persistence (users, posts, etc.) |

**How to use:** Read the recipe → follow steps → update the relevant memory bank.

### Memory Bank Maintenance (still required)
After completing a user request that changes architecture, tech, or goals, update:
- `.kilocode/rules/memory-bank/context.md`
- `.kilocode/rules/memory-bank/tech.md`, `product.md`, `architecture.md` as appropriate
- `.kilo/rules/memory-bank/context.md` (lighter mirror)

---

## Change Log (this manual only)

- 2026-05-26 — feat: Immersive Weather Widget Visuals. Full glassmorphism backgrounds with season-specific SVG backdrops (Spring: cherry blossoms, Summer: palm/heat haze, Autumn: oak/fog, Winter: aurora/icicles) and holiday overlays (Christmas: fairy lights, Halloween: bats, 4th of July: fireworks, Valentine's: hearts, New Year's: gold sparkles). Added Holiday/Event Theme selector in Settings with live preview. Fixed CSS reduce-motion query to include all particle animations.
- 2026-05-26 — feat: enhance weather widget with summer/winter particle effects. Added summer (heat waves) and winter (ice crystals) particle effects to weather widget. Updated AGENTS.md to document the change.
- 2026-05-23 — Initial comprehensive operational manual created per quiet-wizard plan. Added full UI navigation (including motion refresh), meal & emergency workflows, agent role definition, SOP template + examples, and appendix of all existing design docs. Preserved original recipe/memory-bank guidance at the bottom.

---

**End of Agent Operational Manual**

Remember: This file + the 2–3 linked deep docs it points to are sufficient for you to give perfect, up-to-date, safe instructions to any user of the Consuela dashboard. When in doubt, re-read this file first.
