// Services & Keys registry — the code-defined whitelist of externally
// configurable integrations. The /api/services/* routes accept ONLY
// (service, key) pairs listed here; anything else, including boot-critical
// secrets, is rejected. Secret fields are AES-256-GCM encrypted at rest via
// src/lib/secret-box.ts and never returned by GET endpoints.

export interface ServiceFieldDef {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  helpText: string;
  placeholder?: string;
  /** Non-secret values client widgets may read via GET /api/services/runtime */
  publicRuntime?: boolean;
}

export interface ServiceDef {
  id: string;
  displayName: string;
  description: string;
  testFnId: string;
  fields: ServiceFieldDef[];
}

export const SERVICES_REGISTRY: ServiceDef[] = [
  {
    id: "home_assistant",
    displayName: "Home Assistant",
    description:
      "House tab controls, security panel, notifications, grocery→todo mirror",
    testFnId: "ha",
    fields: [
      { key: "HA_HOST", label: "HA URL", secret: false, required: true, helpText: "e.g. http://homeassistant.local:8123", placeholder: "http://homeassistant.local:8123" },
      { key: "HA_TOKEN", label: "Long-lived access token", secret: true, required: true, helpText: "HA → Profile → Security → Long-lived access tokens" },
      { key: "MQTT_BROKER", label: "MQTT broker URL", secret: false, required: false, helpText: "Optional Zigbee2MQTT tap, e.g. mqtt://192.168.0.28:1883" },
      { key: "MQTT_USER", label: "MQTT username", secret: false, required: false, helpText: "Only if your broker requires auth" },
      { key: "MQTT_PASS", label: "MQTT password", secret: true, required: false, helpText: "" },
      { key: "HA_GROCERY_TODO_NAME", label: "Grocery todo list name", secret: false, required: false, helpText: "List created inside HA; default 'Consuela Grocery'", placeholder: "Consuela Grocery" },
    ],
  },
  {
    id: "telegram_alert",
    displayName: "Telegram Alerts",
    description: "Emergency + briefing push to your family Telegram chat",
    testFnId: "telegram_alert",
    fields: [
      { key: "TELEGRAM_BOT_TOKEN", label: "Bot token", secret: true, required: true, helpText: "From @BotFather — the alert-sending bot" },
      { key: "TELEGRAM_ALERT_CHAT_ID", label: "Alert chat ID", secret: false, required: true, helpText: "Numeric chat id of the family group" },
    ],
  },
  {
    id: "telegram_mirror",
    displayName: "Telegram Mirror Bot",
    description: "Mirrors family group messages into Ask Consuela (30-min poll)",
    testFnId: "telegram_mirror",
    fields: [
      { key: "TELEGRAM_MIRROR_BOT_TOKEN", label: "Mirror bot token", secret: true, required: true, helpText: "A second bot added to the group, from @BotFather" },
    ],
  },
  {
    id: "gmail_emergency",
    displayName: "Gmail Emergency Email/SMS",
    description: "Emergency email + email-to-SMS carrier blasts",
    testFnId: "gmail",
    fields: [
      { key: "GMAIL_USER", label: "Gmail address", secret: false, required: true, helpText: "The sending account, e.g. alerts@gmail.com" },
      { key: "GMAIL_APP_PASSWORD", label: "App password", secret: true, required: true, helpText: "Google account → Security → App passwords (16 chars)" },
    ],
  },
  {
    id: "hermes",
    displayName: "Hermes AI",
    description: "Ask Consuela intelligence + recipe parsing",
    testFnId: "hermes",
    fields: [
      { key: "HERMES_API_URL", label: "Hermes URL", secret: false, required: true, helpText: "OpenAI-compatible endpoint base", placeholder: "http://hermes-agent-2:8642" },
      { key: "HERMES_API_KEY", label: "API key", secret: true, required: false, helpText: "Leave empty if Hermes runs without a key" },
    ],
  },
  {
    id: "instacart",
    displayName: "Instacart",
    description: "Meal plan → shoppable carts",
    testFnId: "instacart",
    fields: [
      { key: "INSTACART_API_KEY", label: "API key", secret: true, required: true, helpText: "From the Instacart developer portal" },
    ],
  },
  {
    id: "themealdb",
    displayName: "TheMealDB",
    description: "Recipe search catalog in the Recipes tab",
    testFnId: "themealdb",
    fields: [
      { key: "MEALDB_KEY", label: "API key", secret: false, required: false, helpText: "Default '1' is the public test key; paid key removes limits", placeholder: "1" },
    ],
  },
  {
    id: "weather_location",
    displayName: "Weather Location",
    description: "Coordinates for the Open-Meteo forecast (no API key needed)",
    testFnId: "none",
    fields: [
      { key: "LAT", label: "Latitude", secret: false, required: true, helpText: "Decimal degrees, e.g. 42.7875", publicRuntime: true },
      { key: "LON", label: "Longitude", secret: false, required: true, helpText: "Decimal degrees, e.g. -86.1089", publicRuntime: true },
    ],
  },
  {
    id: "composio",
    displayName: "Composio Widgets",
    description: "Shared key for Spotify/Walmart/Maps widget tools",
    testFnId: "composio",
    fields: [
      { key: "COMPOSIO_API_KEY", label: "Composio API key", secret: true, required: true, helpText: "From composio.dev dashboard" },
    ],
  },
  {
    id: "greenlight",
    displayName: "Greenlight",
    description: "Points→allowance transfers (widget)",
    testFnId: "greenlight",
    fields: [
      { key: "GREENLIGHT_API_KEY", label: "API key", secret: true, required: false, helpText: "Stored for when the integration is enabled" },
    ],
  },
  {
    id: "khanacademy",
    displayName: "Khan Academy",
    description: "Learning minutes widget",
    testFnId: "khanacademy",
    fields: [
      { key: "KHAN_API_KEY", label: "API key", secret: true, required: false, helpText: "Stored for when the integration is enabled" },
    ],
  },
];

// These NEVER become registry-configurable — they are required for the app
// (and PB) to boot/authenticate at all. A DB lockout must not be possible.
export const BOOT_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "SESSION_SECRET",
  "ADMIN_SECRET",
  "CRON_SECRET",
  "PB_ADMIN_EMAIL",
  "PB_ADMIN_PASS",
  "NEXT_PUBLIC_PB_URL",
  "CONSUELA_ENCRYPTION_KEY",
]);

function allFields(): Array<ServiceFieldDef & { service: string }> {
  return SERVICES_REGISTRY.flatMap((s) =>
    s.fields.map((f) => ({ ...f, service: s.id }))
  );
}

export function isRegistryPair(service: string, key: string): boolean {
  if (BOOT_EXCLUDED_KEYS.has(key)) return false;
  return allFields().some((f) => f.service === service && f.key === key);
}

export function isSecretPair(service: string, key: string): boolean {
  if (!isRegistryPair(service, key)) return false;
  return allFields().some(
    (f) => f.service === service && f.key === key && f.secret
  );
}

export function getServiceDef(service: string): ServiceDef | undefined {
  return SERVICES_REGISTRY.find((s) => s.id === service);
}

export type ServiceId = string;
