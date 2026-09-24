# Product — Consuela (Home-ai)

> User flows, step-by-step walkthroughs, and user-facing procedures — moved verbatim from AGENTS.md §1.5 / §2.1–2.2 / SOP-001..004 on 2026-09-24 (structure change). Product vision (users, MVP, positioning, non-goals) lives one level up: `../docs/PRODUCT.md` in the parent Dashboard repo.

## User Journeys

### 1.5 Common User Journeys (copy-paste ready answers)

**"How do I get to the grocery list?"**  
Tap **Meals** in the bottom bar, then the **🛒 Shop** step. From Home you can also tap any quick "Grocery list" prompt in the AI chat bubble. Old links like `/meals?tab=grocery` still work — they land on Shop (likewise `?tab=pantry` → 🥫 Stock, `?tab=recipes` → 🍽️ Plan with the Recipe box opened).

**"How do I get meal ingredients onto the grocery list?"**  
On the **🛒 Shop** step tap **"Add missing from meal plan"**. A preview sheet opens listing exactly what will be added (nothing is added yet) — tap **Add N** to confirm. Low or out-of-stock pantry items work the same way from **🥫 Stock**: tap **"Add low & out to grocery list"**, review the preview sheet, then confirm.

**"How do I change which store an item is from?"**  
Tap the colored store pill (e.g. "Aldi") next to any grocery item. A modal opens showing six pinned stores (Aldi, Meijer, Walmart, Target, Family Fare, Costco) plus 11 more Instacart stores in Holland. Tap a store to reassign the item. The pill updates immediately.

**"How do I compare prices across stores?"**  
On the **🛒 Shop** step, tap **"Compare Prices"** to see per-store totals in a grid of your items × stores. Assign a store and the cheapest split is highlighted, with a savings callout showing how much you save vs. the worst case. Tap **"Apply to all"** to set the cheapest store as default for every item. Note: Walmart items show a search link instead of a price — Walmart is not on Instacart in Holland.

**"How do I order groceries on Instacart?"**  
On the **🛒 Shop** step, tap **"📤 Order from Instacart"**. The order sheet groups your list by store — pick one store, or tap **"Order All Stores"** to place them all at once. Either way you get a shoppable Instacart cart link per store to check out. You can also use the per-store **"🤖 Ask Instacart at {store}"** buttons in the right rail, or ask Clem (the 🛒 floating button, bottom-right) for help with your list, prices, or ordering.

**"Where is the recipe box?"**  
It's folded into the **🍽️ Plan** step — tap **Recipe box** to expand it (New Recipe, search, and import live inside). `/meals?tab=recipes` opens Plan with the box already expanded.

**"How do I see how to cook a saved recipe?"**  
Tap the recipe's card in the 🍽️ Plan step's Recipe box (or the › chevron on a planned meal's row) — it opens the recipe page with the ingredient amounts and numbered steps. Tap **👨‍🍳 Cook mode** for a full-screen checklist: tick ingredients as you gather them and steps as you finish; your progress stays for the day, and the last step brings up "Enjoy!". Recipes deleted from the box still open from planned meals as a saved copy, with a note that they're gone from the recipe box.

**"Where are Emergency and Settings now?"**  
Tap **Settings** in the bottom bar. The new **Emergency** card opens the quick-reference page (contacts, common situations, 911); the rest of Settings holds theme, family, routines, emergency contacts, layout, and data controls. The bottom bar's Calendar tab replaces the old More menu.

**"Where is the family ledger?"**  
Sign in as a parent. On Home, tap the green **The Ledger 📒** card (cash / debt / this month) — it opens the full Ledger inside the dashboard at `/ledger`. Kids and signed-out guests don't see the card or the page (middleware bounces them). The Ledger is Alex's finance app, surfaced unchanged through the dashboard.

**"How do I trigger a real emergency alert?"**  
On the Home screen, tap the red shield icon in the top-right corner. Choose one of the four serious types. The system will attempt SMS + email to your configured primary contacts.

**"I just added a custom meal — where does it appear?"**  
It appears immediately in the weekly Plan view on its chosen day. Its missing ingredients don't jump onto the grocery list automatically — on the **🛒 Shop** step, tap **"Add missing from meal plan"**, review the preview sheet, and tap **Add N** to confirm.

**"How do I mark a pending task done?"**  
Open the **Tasks** tab, find the item under **Pending**, then swipe the row right or tap the row. Enter the 4-digit PIN to complete it.

**"How do I log out?"**  
On the Home screen, tap the small sign-out icon (door + arrow) in the top-right header, just to the left of the avatar. Confirm in the "Sign out of {name}?" modal. You can also tap the gear-icon **Sign out** row on the Settings page.

**"How do I change my profile picture?"**  
Tap your avatar on the Home screen (either the one in the top-right header or the family strip). The profile sheet opens. Under **Change your avatar**, pick an emoji from the category grid, or tap **📷 Upload photo** to use a picture from your device. After you choose a photo, a **full-screen positioner** opens — drag the photo to move it and scroll, pinch, or use the −/+ buttons to zoom so the face is placed where you want, then tap **Apply**. The photo is saved as a 256px avatar. Tap **Save avatar** and the new picture appears everywhere — Home, Tasks leaderboard, avatar strip. You can switch back to emoji anytime with the **🙂 Use emoji** button.

**"How do I change my PIN?"**  
Tap your avatar on Home to open the profile sheet, then tap **🔑 Change PIN**. Enter your current PIN, your new 4-digit PIN, and confirm it. The new PIN works immediately for completing tasks and emergency alerts.

**"What are 'Up for grabs' tasks on the Tasks tab?"**  
Two kinds of tasks can live there: **universal** chores (marked "Universal task" — anyone can claim them anytime) and chores marked **"⏰ Up for grabs when late"** that went past their due date without being done — the moment that happens they're fair game for anyone. Tap the **🤝 Up for grabs** filter tile on the Tasks tab to see both. Tap a task, confirm who's claiming it, enter that member's PIN — the points go to the claimant (the original assignee keeps the points they already had). Tasks that are late-and-stealable show "was due {day}" in the row. If two people grab the same task at once, the first one wins.

**"Why is there a countdown next to my avatar?"**  
For family safety, Consuela signs you out automatically after 30 minutes of no activity. The small `⏳ mm:ss` pill in the Home header shows how much time is left, but only appears once you've been idle for at least a minute (so it doesn't distract active use). In the last 30 seconds, a toast appears at the top of the screen: "You'll be signed out in {N}s — tap to stay." Tap the toast (or just keep using the dashboard) to reset the timer back to 30 minutes.

**"How do I connect Google Calendar + Tasks + Reminders?"**  
Go to **Settings → Integrations → Connect Google account**. The card shows a 6-character code (e.g. `ABCD-1234`) and a button to open `google.com/device`. On any phone or laptop, sign in to the Google account you want Consuela to sync with, enter the code, and grant Calendar + Tasks access. The dashboard polls every 5 seconds; once you grant access, the card flips to "Connected as you@gmail.com · Synced Xs ago". You can then add a reminder on the Tasks tab, and it will appear in Google Tasks under the "Consuela" list. Calendar events added in Google will appear in the Calendar tab within 5 minutes (or tap **Sync now** for an immediate pull).

**"Why don't I see Reminders on the Tasks tab?"**  
You haven't connected Google yet, or the connected account has no tasks with a `due` date. Go to **Settings → Integrations** to connect; once connected, the Reminders section groups by Overdue / Today / Tomorrow / This week / Later.

**"How do I add a reminder?"**  
Open the **Tasks** tab, scroll to the **Reminders** card, tap **+ Add reminder**, type the title, pick the date and time, tap Save. The reminder appears in Google Tasks (under the "Consuela" list) and on any device signed into that Google account within seconds.

**"How do I see what Consuela noticed?"**  
The Home screen has a **"Consuela suggests"** card that lists what Consuela spotted on its own — pantry items running low, chores with 3+ missed days this week, calendar events overlapping by 30+ minutes, and weeks with no meals planned. Each suggestion row has an **act** button (turns it into a task / grocery item / event) and a **dismiss** button (or snooze). The full list lives on the **/suggestions** page (tap "All suggestions" on the card) with filter chips by type and a snooze option.

**"Why is there a morning briefing card at the top of Home?"**  
Every morning at 7am the dashboard cron writes a briefing for the day — today's events, tasks, meals, and suggestions — and Home shows it as a collapsed card at the very top with a count badge. Tap it to expand, then tap **"Got it"** to acknowledge; it stays hidden for the rest of the day and comes back fresh the next morning.

**"How often does Calendar sync?"**  
Every **5 minutes**, automatically — a host crontab entry pings the calendar-sync cron route (protected by `CRON_SECRET`). The Settings → Integrations Google card says **"Sync now (every 5 min)"** and shows **"Last auto-sync: Xs/m/h ago"** so you can see when the last automatic pull happened. You can still tap **Sync now** for an immediate manual pull.

**"How do Telegram and dashboard chat sync?"**  
Consuela has a mirror bot (user-created via **@BotFather** with a new bot token → add the bot to the family Telegram group). The bot's token goes in `TELEGRAM_MIRROR_BOT_TOKEN` (wired into docker-compose, empty default — set the token and restart the container). A 5-minute poll pulls group messages into the **same daily chat thread** (`YYYY-MM-DD`) as the dashboard's Ask Consuela page, so Telegram and dashboard messages appear in one unified conversation per day. Setup steps: create the bot with @BotFather, add it to the group, set `TELEGRAM_MIRROR_BOT_TOKEN` in the dashboard's environment, restart the container, and the poller picks it up.

**"How do I start a new conversation with Consuela?"**  
Type **/new** (or **/restart**) in the Ask Consuela message box and send it — or tap the reset button at the top of the chat and confirm. Consuela starts fresh: the screen clears to a clean thread with a "✨ New conversation" marker, and she won't remember the earlier conversation. Nothing is deleted — the older messages are still kept in the family thread on the server, just not shown on screen. Note: /new doesn't work while Consuela is mid-reply; tap the stop button first.

**"How does the wall display show the family board when idle?"**  
Fully Kiosk's Screensaver is pointed at `<dashboard-url>/screensaver` with a low screensaver brightness. After 5 minutes of nobody touching it, the ambient board fades in (clock, weather, tonight's dinner, what's next, chore progress, Consuela's digest). A tap — or the front-camera motion detection — wakes straight back to the live dashboard. Everything on the ambient board is read-only; chores, meals and alerts still need a signed-in member and their PIN.

**"How do I change Consuela's brain?"**  
Go to **Settings → AI Models**. The card now shows exactly what's answering: each provider row lists its models as chips tagged **Brain** (the one answering) or **Fallback**, and if Consuela is running on the legacy env/`FALLBACK_*` chain instead of a saved provider, that chain renders as a read-only "env" group so you can always see reality. Tap **+ Add provider**, paste the API base URL (e.g. `https://api.b.ai/v1`) and key, tap **Load models** to fetch the live list, keep the models you want (first in the chain answers), then **Save provider**. Use the ↑↓ arrows to reorder providers (the first provider's first model is the brain) or the ↑↓ on a model chip to reorder within a provider. ⚡ **Test** pings the provider's `/v1/models` and reports "ok — N models · Xms". 🗑️ asks for confirmation before removing. If a provider dies mid-chat, Consuela automatically falls to the next model in the chain. The **AI Health** section at the bottom shows how recent chat requests went — "Last 20: 14 ok · 2 wrap-up · 1 timeout · avg 3.4s", the last failure's reason, and a colored dot trail (green ok · blue wrap-up · amber ran out of steps · red timeout/client-gone) — so a "Consuela is being weird" report answers from the dashboard, not from digging through container logs.

**"How do weekly prizes work?"**  
Parents set them in **Settings → 🏆 Weekly prizes** — up to three prizes (emoji + what you win, like "Picks Friday's family movie"). During the week the Tasks leaderboard's **Weekly prizes** card shows who's currently holding each prize, the countdown to reset, and your personal gap ("You're 50 pts from a prize"); the podium's top three also wear 🎁 ribbons, and the Home leaderboard widget and kid home each carry a one-line race status. When the week flips on **Monday**, the race locks in: the top 3 are written into the Hall of Fame with their prize text frozen forever, and each winner sees a little confetti celebration with their prize exactly once — on any device. All-time points never reset — every member's weekly number is shown beside their "N all-time" total, so the Monday reset starts a fresh race without taking anything away.

---

## Step-by-Step Workflows (agent procedures for helping users)

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
- UI shows a persistent success/failure screen — on success: "Sent to X of Y contacts" + the call-911 line + an explicit Done button (no auto-close); the typed PIN is cleared when the dialog closes.

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

## SOPs (user-facing procedures)

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

#### SOP-004: Change Your Own Profile Picture or PIN (Daily)
**Purpose:** Let a signed-in family member update their own avatar (emoji or photo) and PIN from a social-media-style profile sheet.

**Prerequisites:** Signed in on Home (avatar visible in the header or family strip).

**Step-by-Step:**
1. Tap your avatar on Home (top-right header or family strip).
2. In the profile sheet, pick an emoji from a category grid, or tap **📷 Upload photo** and choose a photo from the device (PNG/JPG/WebP/GIF, ≤5MB; resized to 256px webp automatically).
3. Tap **Save avatar** — the change is written via `POST /api/members/profile` (PIN-verified server-side) and refreshed across the app.
4. To change your PIN: tap **🔑 Change PIN**, enter current + new + confirm, tap **Save PIN** (`POST /api/members/pin`). The new PIN is active immediately.

**Expected Results / Success Signals**
- UI: "Saved ✓" on the button; the avatar updates on Home, Tasks, and leaderboard.
- Backend / DB: `members.emoji` row updated in PocketBase (`data:image/webp;base64,...` for photos).

**Rollback / Undo**
- Switch back to emoji with **🙂 Use emoji** in the same sheet, or ask a parent to edit the member in Settings → Family Members.

**Agent Notes**
- Parent-side edits for other members remain client-side (Settings → Family Members); parents are trusted admins.
- Photo storage is inline base64 in the `members.emoji` field (capped at 256px so PB rows stay small).

