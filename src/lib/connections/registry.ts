/**
 * Connection Registry — Defines all available integrations.
 *
 * Each connection defines its auth requirements, what it enables,
 * and how to set it up. The ConnectionManager UI reads from this
 * registry to render the settings cards.
 */

import type { ConnectionConfig } from "./types";
export type { ConnectionConfig } from "./types";

export const CONNECTIONS: ConnectionConfig[] = [
  // ─── Grocery & Shopping ──────────────────────────────────────────────────
  {
    id: "instacart",
    name: "Instacart",
    description: "Turn meal plans into shoppable grocery carts. Get delivery in 30-60 min from 1,800+ retailers.",
    emoji: "🛒",
    category: "grocery",
    authType: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        placeholder: "idp_xxxxxxxxxxxxxxxx",
        type: "password",
        required: true,
        helpText: "Get your key from the Instacart Developer Portal.",
      },
    ],
    features: [
      "One-click 'Order Delivery' on meal plan cards",
      "Consuela AI creates shopping lists from chat",
      "Recipe pages with pantry item detection",
      "Delivery from Kroger, Costco, Safeway, and more",
    ],
    setupUrl: "https://docs.instacart.com/developer_platform_api/guide/get_api_key",
    available: true,
  },

  {
    id: "amazon",
    name: "Amazon",
    description: "Search Amazon for household items, compare prices, and track orders.",
    emoji: "📦",
    category: "shopping",
    authType: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "Composio API Key",
        placeholder: "composio_xxxxxxxxxxxxxxxx",
        type: "password",
        required: true,
        helpText: "Amazon search is powered by Composio. Get a free key.",
      },
    ],
    features: [
      "Search for household items from the dashboard",
      "Compare prices across Amazon products",
      "Quick-add items to your Amazon cart",
    ],
    setupUrl: "https://dashboard.composio.dev",
    available: true,
    composioProvider: "amazon",
  },

  {
    id: "walmart",
    name: "Walmart",
    description: "Search Walmart products and create shopping lists for delivery or pickup.",
    emoji: "🏪",
    category: "shopping",
    authType: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "Composio API Key",
        placeholder: "composio_xxxxxxxxxxxxxxxx",
        type: "password",
        required: true,
        helpText: "Walmart search is powered by Composio.",
      },
    ],
    features: [
      "Search Walmart products from the dashboard",
      "Create shopping lists for delivery/pickup",
      "Price comparison with other retailers",
    ],
    setupUrl: "https://dashboard.composio.dev",
    available: true,
    composioProvider: "walmart",
  },

  // ─── Music ───────────────────────────────────────────────────────────────
  {
    id: "spotify",
    name: "Spotify",
    description: "Family playlists, bedtime lullabies, car ride music. Control playback from the dashboard.",
    emoji: "🎵",
    category: "music",
    authType: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "Composio API Key",
        placeholder: "composio_xxxxxxxxxxxxxxxx",
        type: "password",
        required: true,
        helpText: "Spotify integration is powered by Composio (84 tools). Get a free key.",
      },
    ],
    features: [
      "Family playlists — create and manage together",
      "Bedtime mode auto-plays lullabies for kids",
      "Morning playlist starts when you open the dashboard",
      "Search tracks, add to queue, control playback",
      "Dinner ambiance playlists",
    ],
    setupUrl: "https://dashboard.composio.dev",
    available: true,
    composioProvider: "spotify",
  },

  // ─── Maps & Location ─────────────────────────────────────────────────────
  {
    id: "google_maps",
    name: "Google Maps",
    description: "Travel times to events, 'leave by' reminders, and location search for activities.",
    emoji: "🗺️",
    category: "maps",
    authType: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "Composio API Key",
        placeholder: "composio_xxxxxxxxxxxxxxxx",
        type: "password",
        required: true,
        helpText: "Maps integration is powered by Composio. Get a free key.",
      },
      {
        key: "homeAddress",
        label: "Home Address",
        placeholder: "123 Main St, Whitehall, MI",
        type: "text",
        required: false,
        helpText: "Used to calculate travel times from your home.",
      },
    ],
    features: [
      "Travel time on every calendar event card",
      "'Leave by' reminders so you're never late",
      "AI: 'When should I leave for soccer?' → directions",
      "Search for restaurants, activities, and services",
      "Flight and hotel search for family trips",
    ],
    setupUrl: "https://dashboard.composio.dev",
    available: true,
    composioProvider: "composio_search",
  },

  // ─── Calendar & Communication ────────────────────────────────────────────
  {
    id: "gmail",
    name: "Gmail",
    description: "Auto-import events from school emails, sports schedules, and doctor appointments.",
    emoji: "📧",
    category: "calendar",
    authType: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "Composio API Key",
        placeholder: "composio_xxxxxxxxxxxxxxxx",
        type: "password",
        required: true,
        helpText: "Gmail integration is powered by Composio.",
      },
    ],
    features: [
      "Forward school emails → events auto-appear on calendar",
      "AI extracts dates, times, locations from any email",
      "Parent approves before adding (no surprise events)",
      "Weekly digest: what's coming up for the family",
    ],
    setupUrl: "https://dashboard.composio.dev",
    available: true,
    composioProvider: "gmail",
  },

  // ─── Smart Home ──────────────────────────────────────────────────────────
  {
    id: "home_assistant",
    name: "Home Assistant",
    description: "Control lights, thermostat, locks, and cameras from the family dashboard.",
    emoji: "🏠",
    category: "smart_home",
    authType: "api_key",
    fields: [
      {
        key: "url",
        label: "Home Assistant URL",
        placeholder: "http://homeassistant.local:8123",
        type: "url",
        required: true,
        helpText: "Your Home Assistant instance URL.",
      },
      {
        key: "token",
        label: "Long-Lived Access Token",
        placeholder: "eyJ0eXAiOiJKV1Qi...",
        type: "password",
        required: true,
        helpText: "Create one at: Profile → Security → Long-Lived Access Tokens",
      },
    ],
    features: [
      "Control lights, thermostat, and locks from dashboard",
      "Bedtime mode: dim lights, set temp, lock doors",
      "Morning mode: turn on lights, start coffee maker",
      "See who's home with presence sensors",
      "Camera snapshots on the dashboard",
    ],
    available: true,
  },

  // ─── Finance & Allowance ─────────────────────────────────────────────────
  {
    id: "greenlight",
    name: "Greenlight",
    description: "Connect kid allowance. Convert Consuela points to real money on their debit card.",
    emoji: "💳",
    category: "finance",
    authType: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "Greenlight API Key",
        placeholder: "gl_xxxxxxxxxxxxxxxx",
        type: "password",
        required: true,
        helpText: "Available with Greenlight Infinity or Business plans.",
      },
      {
        key: "pointsToCashRate",
        label: "Points → Cash Rate",
        placeholder: "50",
        type: "text",
        required: false,
        helpText: "How many points = $1.00? Default: 50 points = $1.",
      },
    ],
    features: [
      "Kids convert reward points to real cash",
      "Auto-deposit to Greenlight debit card",
      "Parent sets weekly caps and approval requirements",
      "Teaches financial literacy through earning",
    ],
    available: false, // Requires paid Greenlight plan
  },

  // ─── Photos ──────────────────────────────────────────────────────────────
  {
    id: "google_photos",
    name: "Google Photos",
    description: "Family memories on the dashboard. 'This day last year' and recent photo widgets.",
    emoji: "📸",
    category: "photos",
    authType: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "Composio API Key",
        placeholder: "composio_xxxxxxxxxxxxxxxx",
        type: "password",
        required: true,
        helpText: "Google Photos is powered by Composio.",
      },
    ],
    features: [
      "Family photos widget on Home dashboard",
      "'This Day Last Year' memories",
      "Auto-create albums from events (soccer games, birthdays)",
      "Kids can view family photos in their mode",
    ],
    setupUrl: "https://dashboard.composio.dev",
    available: true,
    composioProvider: "googlephotos",
  },

  // ─── Education ────────────────────────────────────────────────────────────
  {
    id: "khan_academy",
    name: "Khan Academy",
    description: "Track kids' learning progress in math, reading, science, and writing.",
    emoji: "📚",
    category: "education",
    authType: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "Khan Academy Teacher API Key",
        placeholder: "ka_xxxxxxxxxxxxxxxx",
        type: "password",
        required: false,
        helpText: "Optional. Without an API key, you can still manually track learning minutes.",
      },
    ],
    features: [
      "Weekly learning goals (math, reading, science, writing)",
      "Learning streak tracking",
      "Progress bars for each subject",
      "Kids log minutes with +5m / +15m buttons",
      "Bonus quest points for meeting weekly goals",
    ],
    setupUrl: "https://www.khanacademy.org/coach/teachers",
    available: true,
  },

  // ─── Food Delivery ───────────────────────────────────────────────────────
  {
    id: "doordash",
    name: "DoorDash",
    description: "No plans for dinner? One-tap food delivery from local restaurants.",
    emoji: "🍕",
    category: "food_delivery",
    authType: "api_key",
    fields: [
      {
        key: "apiKey",
        label: "Composio API Key",
        placeholder: "composio_xxxxxxxxxxxxxxxx",
        type: "password",
        required: true,
        helpText: "Restaurant search via Composio. Ordering opens DoorDash.",
      },
    ],
    features: [
      "'No plans?' widget with one-tap restaurant suggestions",
      "Cuisine-based search (pizza, Mexican, sushi)",
      "Deep links to DoorDash for ordering",
      "Family favorite restaurants saved",
    ],
    setupUrl: "https://dashboard.composio.dev",
    available: true,
    composioProvider: "composio_search",
  },
];

/**
 * Get a connection config by ID.
 */
export function getConnection(id: string): ConnectionConfig | undefined {
  return CONNECTIONS.find((c) => c.id === id);
}

/**
 * Get connections by category.
 */
export function getConnectionsByCategory(category: string): ConnectionConfig[] {
  return CONNECTIONS.filter((c) => c.category === category);
}

/**
 * Get all category labels.
 */
export const CATEGORY_LABELS: Record<string, { emoji: string; label: string }> = {
  grocery: { emoji: "🛒", label: "Grocery & Shopping" },
  shopping: { emoji: "📦", label: "Shopping" },
  music: { emoji: "🎵", label: "Music & Entertainment" },
  maps: { emoji: "🗺️", label: "Maps & Location" },
  calendar: { emoji: "📧", label: "Calendar & Communication" },
  smart_home: { emoji: "🏠", label: "Smart Home" },
  finance: { emoji: "💳", label: "Finance & Allowance" },
  photos: { emoji: "📸", label: "Photos & Memories" },
  food_delivery: { emoji: "🍕", label: "Food Delivery" },
  education: { emoji: "📚", label: "Education" },
};
