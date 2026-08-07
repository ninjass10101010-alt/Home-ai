# Consuela Integration Plan
### AI Services & Third-Party Integrations for the Family Dashboard

**Status:** Research Complete — Implementation Plan
**Date:** July 2026

---

## Research Summary

After analyzing 200+ available services, Composio's 1,000+ tool catalog, and direct API availability, here are the **highest-value integrations** for a family-oriented dashboard, organized by impact.

---

## Integration Tiers

```
┌──────────────────────────────────────────────────────────────────┐
│  TIER 1 — HIGH IMPACT, LOW EFFORT (Start here)                  │
│  Instacart, Spotify, Google Maps, Gmail-to-Calendar              │
│  ~80% of families need these. Most have MCP/API ready.          │
│                                                                  │
│  TIER 2 — HIGH IMPACT, MEDIUM EFFORT                            │
│  Smart Home (Home Assistant), Amazon/Walmart, Google Photos,     │
│  Allowance/Banking, Food Delivery                                │
│  ~60% of families. Some configuration required.                  │
│                                                                  │
│  TIER 3 — NICE TO HAVE                                          │
│  Education tracking, Ride-sharing, Notion, Trello/Asana          │
│  ~30% of families. Situational value.                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Tier 1 — High Impact, Low Effort

### 1. 🛒 Instacart — Grocery Shopping from Meal Plans

**Why it matters:** The #1 friction point in meal planning is "now what do I buy?" Instacart turns your Consuela meal plan into a shoppable cart with one click.

**API:** [Instacart Developer Platform](https://docs.instacart.com/developer_platform_api/) — REST API + MCP server (perfect for Consuela's Hermes AI)

**Available tools:**
- `create_recipe_page` — Turn a recipe into a shoppable Instacart page
- `create_shopping_list` — Turn grocery list items into a shoppable cart
- Supports 1,800+ retailers including Kroger, Costco, Safeway, Albertsons

**Integration flow:**
```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  MEAL PLAN      │     │  CONSUELA    │     │  INSTACART      │
│  Taco Tuesday   │────▶│  API route   │────▶│  Shopping List  │
│  ingredients:   │     │  /api/       │     │  ┌───────────┐  │
│  - ground beef  │     │  instacart   │     │  │ 🛒 Checkout│  │
│  - tortillas    │     │              │     │  └───────────┘  │
│  - cheese       │     └──────────────┘     └─────────────────┘
└─────────────────┘
```

**Dashboard integration (Kid Mode vs Adult Mode):**
```tsx
// Adult Mode: Meal Plan widget gets "Order from Instacart" button
<Surface variant="glass-subtle">
  <h3>Taco Tuesday 🌮</h3>
  <p>Ground beef, tortillas, cheese, lettuce</p>
  <div className="flex gap-2 mt-2">
    <SoftButton variant="secondary">View Recipe</SoftButton>
    <SoftButton onClick={orderFromInstacart}>
      🛒 Order Delivery
    </SoftButton>
  </div>
</Surface>

// Kid Mode: "Dinner?" widget shows tonight's meal with fun emoji
<Surface variant="warm">
  <span className="text-4xl">🌮</span>
  <h3>Taco Tuesday!</h3>
  <p>Yummy tacos tonight! 🤤</p>
</Surface>
```

**API example:**
```tsx
// src/lib/instacart.ts
const INSTACART_API_KEY = process.env.INSTACART_API_KEY;
const INSTACART_BASE = "https://connect.instacart.com/idp/v1";

export async function createShoppingList(items: {
  title: string;
  ingredients: { name: string; quantity: string; unit: string }[];
}) {
  const response = await fetch(`${INSTACART_BASE}/products/products_link`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${INSTACART_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      title: items.title,
      link_type: "shopping_list",
      line_items: items.ingredients.map(ing => ({
        name: ing.name,
        quantity: parseInt(ing.quantity),
        unit: ing.unit,
      })),
      landing_page_configuration: {
        partner_linkback_url: `${process.env.NEXT_PUBLIC_URL}/meals`,
      },
    }),
  });

  const data = await response.json();
  return data; // { url: "https://instacart.com/..." }
}
```

**Hermes AI integration:**
```
User: "What do I need for taco night?"
Consuela: "For Taco Tuesday you'll need ground beef, tortillas,
           cheese, lettuce, tomatoes, and sour cream.
           Want me to add these to an Instacart order? 🛒"
User: "Yes please!"
Consuela: "Done! Here's your Instacart cart: [link]
           Estimated delivery: 45 min, $12.99 fee"
```

---

### 2. 🎵 Spotify — Family Music & Bedtime Mode

**Why it matters:** Music is central to family life — morning wake-up playlists, car rides, bedtime lullabies, dinner ambiance. Composio provides 84 Spotify tools including playlist management and playback control.

**API:** Via Composio MCP (no separate Spotify API key needed)

**Available tools (84 total):**
- `spotify_create_playlist` — Create family playlists
- `spotify_add_to_playlist` — Add songs to family playlist
- `spotify_search_tracks` — Search for songs
- `spotify_get_playback_state` — What's playing now
- `spotify_start_playback` — Play a playlist
- Triggers: `New Device Added`, `Playlist Changed`

**Dashboard integration:**
```
ADULT MODE                          KID MODE
┌──────────────────────┐            ┌──────────────────────┐
│ 🎵 Now Playing        │            │ 🎵 Family Jams!       │
│ "Walking on Sunshine" │            │                       │
│ ☀️ Morning Playlist    │            │ ▶️ Bedtime Lullabies   │
│ [⏸ Pause] [⏭ Next]   │            │ ▶️ Dance Party         │
│                       │            │ ▶️ Car Ride Songs      │
│ Tonight's vibe:       │            │                       │
│ 🍽️ Dinner Jazz        │            │ Tap a playlist to     │
│ 🌙 Bedtime Lullaby    │            │ start playing! 🎶     │
└──────────────────────┘            └──────────────────────┘
```

**Composio integration code:**
```tsx
// src/lib/composio-spotify.ts
import { Composio } from "@composio/core";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

// Get family playlists
export async function getFamilyPlaylists(userId: string) {
  const tools = await composio.getTools({
    userId,
    toolkits: ["spotify"],
  });
  return tools; // 84 Spotify tools ready to use
}

// In Hermes AI — Consuela can control Spotify
export async function playBedtimeMusic(userId: string) {
  const session = composio.create({
    userId,
    toolkits: ["spotify"],
  });

  // Search for lullabies
  const result = await session.execute({
    tool: "spotify_search_tracks",
    params: { query: "bedtime lullabies for kids" },
  });

  // Start playback
  await session.execute({
    tool: "spotify_start_playback",
    params: { uris: result.tracks.slice(0, 10).map(t => t.uri) },
  });
}
```

**Bedtime mode trigger:**
```tsx
// When bedtime mode activates at 8pm, automatically play lullabies
useEffect(() => {
  if (isBedtime && mode === "kid") {
    playBedtimeMusic(currentUser.id);
    // Kid dashboard shows "Sweet dreams" + music now playing
  }
}, [isBedtime]);
```

---

### 3. 🗺️ Google Maps — Directions to Events + Location Awareness

**Why it matters:** Families constantly ask "how do I get there?" Composio provides Google Maps Search that can find addresses, get directions, and estimate travel times — all integrated into calendar events.

**Available tools:**
- `google_maps_search` — Find locations, restaurants, activities
- `amazon_product_search` — Search for household items (also via Composio)
- `walmart_search` — Search Walmart for products
- `flight_search` — Plan family vacations
- `hotel_search` — Find hotels for trips

**Dashboard integration:**
```
ADULT MODE — Calendar Event
┌──────────────────────────────────────┐
│ ⚽ Soccer Practice                    │
│ 4:00 PM · Whitehall Community Field  │
│                                      │
│ 📍 12 min drive · 4.2 mi             │
│ [🗺️ Directions]  [⏰ Leave at 3:45]  │
│                                      │
│ 🌧️ Rain expected at 4:30 PM         │
│    [Bring jackets ☂️]                │
└──────────────────────────────────────┘

// Via Hermes AI:
User: "When should I leave for soccer practice?"
Consuela: "Soccer is at 4:00 PM at Whitehall Community Field.
           It's a 12-minute drive, so leave by 3:45 PM.
           Heads up — rain is expected at 4:30, so bring
           jackets! ☔"
```

**Composio integration:**
```tsx
// src/lib/composio-maps.ts
export async function getDirectionsToEvent(event: {
  title: string;
  location?: string;
  time: string;
}) {
  const session = composio.create({
    userId: currentUser.id,
    toolkits: ["composio_search"],
  });

  // Get travel time
  const result = await session.execute({
    tool: "COMPOSIO_SEARCH_GOOGLE_MAPS",
    params: {
      query: `directions to ${event.location}`,
      location: userHomeAddress,
    },
  });

  return {
    duration: result.duration, // "12 min"
    distance: result.distance, // "4.2 mi"
    leaveBy: calculateLeaveBy(event.time, result.duration),
  };
}
```

---

### 4. 📧 Gmail → Calendar Auto-Import (Sense-style)

**Why it matters:** The #1 time sink for parents is manually entering events from school emails, sports schedules, and doctor appointments. Composio provides Gmail access that can be paired with Consuela's AI to auto-extract events.

**Available tools via Composio:**
- Gmail: `list_emails`, `read_email`, `search_emails`
- Google Calendar: `create_event`, `list_events`, `update_event`
- Combined: AI reads school email → extracts events → adds to calendar

**Dashboard integration:**
```
ADULT MODE — Smart Inbox Widget
┌──────────────────────────────────────┐
│ 📧 Auto-Imported Events              │
│                                      │
│ From: Whitehall Elementary            │
│ "Field Trip Permission Slip"         │
│ → 📅 Oct 15, 9AM-2PM                │
│   [✅ Approve]  [❌ Skip]            │
│                                      │
│ From: Caspian's Soccer League        │
│ "Schedule Update — Week of 7/21"     │
│ → 📅 Tue 6PM, Thu 6PM, Sat 10AM    │
│   [✅ Add all]  [Review]             │
└──────────────────────────────────────┘
```

**Hermes AI integration:**
```tsx
// src/lib/gmail-calendar-ai.ts
export async function processSchoolEmail(email: any) {
  // Consuela reads the email and extracts events
  const events = await hermesChat(`
    Extract all events, dates, times, and locations from this email:
    ${email.body}

    Return as JSON array: [{ title, date, time, location, type }]
  `);

  return events.map((event: any) => ({
    ...event,
    source: "gmail_auto_import",
    needsApproval: true, // Parent approves before adding
  }));
}
```

---

## Tier 2 — High Impact, Medium Effort

### 5. 🏠 Smart Home (Home Assistant)

**Why it matters:** The dashboard becomes the control center for the entire home. Lights, thermostat, locks, cameras — all controllable from the family dashboard.

**Integration:** Home Assistant has a REST API and WebSocket API. Can also be added via Composio.

**Dashboard integration:**
```
ADULT MODE — Home Control Widget
┌──────────────────────────────────────┐
│ 🏠 Home Status                       │
│                                      │
│ 🌡️ 72°F  │ 💡 Living Room: ON       │
│ 🔒 Front: Locked │ 🚗 Garage: Closed │
│                                      │
│ Scenes:                              │
│ [🌅 Morning] [🍽️ Dinner] [🌙 Night] │
│                                      │
│ Bedtime Mode activates at 8:00 PM:   │
│ → Lights dim to 20%                  │
│ → Thermostat → 68°F                  │
│ → Lock all doors                     │
│ → Kids' tablets → Do Not Disturb     │
└──────────────────────────────────────┘
```

**Code example:**
```tsx
// src/lib/home-assistant.ts
const HA_URL = process.env.HOME_ASSISTANT_URL;
const HA_TOKEN = process.env.HA_LONG_LIVED_TOKEN;

export async function activateBedtimeScene() {
  // Dim all lights
  await callService("light", "turn_on", {
    entity_id: "group.all_lights",
    brightness: 50, // 20%
    color_temp: 400, // warm
  });

  // Set thermostat
  await callService("climate", "set_temperature", {
    entity_id: "climate.thermostat",
    temperature: 68,
  });

  // Lock doors
  await callService("lock", "lock", {
    entity_id: "group.all_locks",
  });
}
```

---

### 6. 📦 Amazon / Walmart — Household Product Search

**Why it matters:** When the grocery list includes household items (diapers, cleaning supplies, paper towels), parents need to compare prices and order. Composio provides Amazon and Walmart product search.

**Available tools via Composio:**
- `amazon_product_search` — Search products with pricing
- `walmart_search` — Search Walmart products
- `flight_search`, `hotel_search` — Plan family trips

**Dashboard integration:**
```
ADULT MODE — Quick Order Widget
┌──────────────────────────────────────┐
│ 📦 Household Restock                  │
│                                      │
│ From grocery list:                    │
│ ☐ Paper towels — $8.99 (Amazon)      │
│ ☐ Diapers — $24.99 (Walmart)         │
│ ☐ Dish soap — $3.49 (Amazon)         │
│                                      │
│ Total: $37.47                        │
│ [🛒 Order from Amazon]               │
│ [🛒 Order from Walmart]              │
│ [📊 Compare prices]                  │
└──────────────────────────────────────┘
```

---

### 7. 💰 Allowance / Banking (Greenlight, Homey)

**Why it matters:** The Reward Shop is fun, but connecting it to REAL money makes it powerful. When kids redeem "Ice cream trip" for 100pts, it could actually deposit $5 into their Greenlight card.

**Integration approaches:**
- **Greenlight** — Debit cards for kids with parental controls (API available for partners)
- **Homey** — Allowance with bank transfers via Composio
- **Consuela Points → Cash** — Custom conversion rate set by parents

**Dashboard integration:**
```
KID MODE — Rewards Shop Enhancement
┌──────────────────────────────────────┐
│ 🏪 Reward Shop                       │
│                                      │
│ You have: 125 points                 │
│ Cash value: $6.25 (50pts = $1)       │
│                                      │
│ 🍦 Ice cream trip     100 pts        │
│ 📱 30 min screen time  25 pts        │
│ 🎬 Pick movie night    50 pts        │
│                                      │
│ 💸 Convert to cash:                  │
│ 100 pts → $2.00 to my Greenlight    │
│ [Convert]                            │
└──────────────────────────────────────┘

PARENT SETTINGS — Allowance Config
┌──────────────────────────────────────┐
│ 💰 Points to Cash Conversion          │
│                                      │
│ Rate: 50 points = $1.00             │
│ Weekly cap: $10.00                   │
│ Auto-deposit to: Greenlight ****2847 │
│ Requires approval: ✅                │
└──────────────────────────────────────┘
```

---

### 8. 🍕 Food Delivery (DoorDash, Uber Eats)

**Why it matters:** When there's no meal planned, or everyone's too tired to cook, one-tap food delivery saves the evening. Instacart handles groceries; DoorDash handles prepared meals.

**Note:** DoorDash and Uber Eats don't have public consumer APIs yet. Integration would be via deep links or Composio's search tools for restaurant discovery.

**Dashboard integration:**
```
ADULT MODE — "No plans for tonight?" Widget
┌──────────────────────────────────────┐
│ 🍽️ No dinner planned                 │
│                                      │
│ Quick options:                        │
│ [🍕 Pizza] [🌮 Mexican] [🍣 Sushi]  │
│ [🍔 Burgers] [🥗 Healthy]            │
│                                      │
│ Or order groceries:                   │
│ [🛒 Instacart — 30 min delivery]     │
└──────────────────────────────────────┘
```

---

### 9. 📸 Google Photos — Family Memories

**Why it matters:** Families take hundreds of photos. Having a "This Day Last Year" or "Recent Family Photos" widget brings warmth to the dashboard.

**Available via Composio:**
- Google Photos: upload, search, create albums
- Google Drive: store family documents

**Dashboard integration:**
```
FAMILY MODE — Memories Widget
┌──────────────────────────────────────┐
│ 📸 This Week in Photos               │
│                                      │
│ [🖼️] [🖼️] [🖼️]                     │
│ Soccer game · Beach day · Birthday   │
│                                      │
│ 📅 On this day last year:            │
│ Camping trip at Ludington State Park │
└──────────────────────────────────────┘
```

---

## Tier 3 — Nice to Have

### 10. 📚 Education (Khan Academy, Reading Progress)

Track kids' learning progress. Connect to Khan Academy for math/science tracking. Show reading minutes as bonus quests.

### 11. 🚗 Ride-Sharing (Uber Family Profile)

For older kids with permission — safe, tracked rides to school/events. Parent gets notifications.

### 12. 📋 Notion / Trello — Family Projects

For bigger family projects (vacation planning, home renovation, event planning). Connect Consuela tasks to project boards.

---

## Composio Setup Guide

### Step 1: Install Composio

```bash
npm install @composio/core @composio/openai
```

### Step 2: Configure for Hermes

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  composio:
    url: "https://connect.composio.dev/mcp"
    headers:
      x-consumer-api-key: "${COMPOSIO_API_KEY}"
    connect_timeout: 60
    timeout: 180
```

### Step 3: Enable Toolkits

```tsx
// src/lib/composio-config.ts
export const FAMILY_TOOLKITS = [
  "spotify",           // 84 tools — music
  "composio_search",   // Amazon, Walmart, Maps, Flights
  "googlecalendar",    // Calendar management
  "gmail",             // Email reading
  "googledrive",       // File storage
  "googlephotos",      // Photo memories
];
```

### Step 4: Connect Services in Settings

```
ADULT MODE — Settings → Integrations
┌──────────────────────────────────────┐
│ 🔗 Connected Services                │
│                                      │
│ ✅ Google Calendar                   │
│ ✅ Gmail                             │
│ ☐ Spotify              [Connect]     │
│ ☐ Instacart            [Connect]     │
│ ☐ Home Assistant       [Connect]     │
│ ☐ Google Photos        [Connect]     │
│ ☐ Amazon               [Connect]     │
│ ☐ Greenlight           [Connect]     │
│ ☐ Khan Academy         [Connect]     │
│                                      │
│ Powered by Composio (1,000+ tools)   │
└──────────────────────────────────────┘
```

---

## Implementation Priority & Timeline

```
WEEK 1-2: Instacart Integration (highest ROI)
  ├─ Create /api/instacart route
  ├─ Add "Order from Instacart" to meal cards (Adult Mode)
  ├─ Hermes AI: "What do I need to buy?" → Instacart list
  └─ Kid Mode: dinner widget shows meal name + emoji

WEEK 3-4: Composio Setup + Spotify
  ├─ Install @composio/core
  ├─ Configure MCP in Hermes
  ├─ Add Spotify widget (Adult Mode)
  ├─ Bedtime mode → auto-play lullabies (Kid Mode)
  └─ Settings → Integration connections page

WEEK 5-6: Google Maps + Gmail-to-Calendar
  ├─ Event cards get travel time + leave-by reminder
  ├─ Hermes: "When should I leave?" → Maps directions
  ├─ Gmail auto-import widget (Adult Mode)
  └─ AI extracts events from forwarded emails

WEEK 7-8: Smart Home + Food Delivery
  ├─ Home Assistant connection
  ├─ Bedtime mode triggers home scenes
  ├─ "No plans?" → DoorDash/Uber Eats deep links
  └─ Amazon/Walmart product search for household items

WEEK 9-10: Allowance + Google Photos
  ├─ Points-to-cash conversion
  ├─ Greenlight bank integration
  ├─ Photo memories widget (Family Mode)
  └─ "This Day Last Year" feature
```

---

## The Vision

After all integrations, Consuela becomes the **single pane of glass** for family life:

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Good afternoon, Garcia Family! ☀️                       │
│                                                          │
│  ┌── SCHEDULE ────────┐  ┌── TODAY ──────────────────┐  │
│  │ 9:00  🏃 Workout   │  │ ☀️ 78°F — Soccer weather! │  │
│  │ 10:00 🦷 Dentist   │  │                           │  │
│  │ 16:00 ⚽ Soccer    │  │ 🛒 Instacart arrives 2PM   │  │
│  │ 18:30 🍽️ Dinner   │  │ 🎵 Now: Dance Party playlist│  │
│  │     [🗺️ 12min]    │  │ 🏠 Home: 72°F, all locked │  │
│  └────────────────────┘  │ 💰 Caspian: 125pts ($6.25) │  │
│                           └───────────────────────────┘  │
│  ┌── MEALS ───────────────────────────────────────────┐  │
│  │ Mon: Pasta 🍝  Tue: Tacos 🌮 [🛒 Order]           │  │
│  │ Wed: Stir Fry 🥢  Thu: Pizza 🍕  Fri: Grill 🥩    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  💬 "Hey Consuela, do we have anything this weekend?"    │
│     → "Saturday: Caspian's tournament 9AM-12PM.         │
│        Sunday: Free! Want me to plan a family outing?"   │
│                                                          │
│  🛒 🎵 🗺️ 💰 🏠 📧 🍕 📸 📚                            │
│  All connected. All in one place.                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**The family doesn't open 12 different apps anymore. They open Consuela.**
