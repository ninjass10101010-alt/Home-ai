import { fileURLToPath } from "node:url";

const LOCAL_SERVICE_URL = "http://127.0.0.1:1";
export const NEXT_FONT_MOCK_PATH = fileURLToPath(new URL("./next-font-mock.json", import.meta.url));

export const PROBE_RUNTIME_KEYS = Object.freeze([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "LANG",
  "LC_ALL",
]);

export const SAFE_PROBE_ENV = Object.freeze({
  CI: "1",
  NODE_ENV: "development",
  NEXT_RUNTIME: "nodejs",
  TZ: "UTC",
  SESSION_COOKIE_SECURE: "false",
  NEXT_FONT_GOOGLE_MOCKED_RESPONSES: NEXT_FONT_MOCK_PATH,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_TELEMETRY_LOG: "",
  NEXT_PUBLIC_APP_URL: LOCAL_SERVICE_URL,
  NEXT_PUBLIC_URL: LOCAL_SERVICE_URL,
  NEXT_PUBLIC_PB_URL: LOCAL_SERVICE_URL,
  FINANCE_DASHBOARD_URL: LOCAL_SERVICE_URL,
  HERMES_CHAT_URL: LOCAL_SERVICE_URL,
  HA_HOST: LOCAL_SERVICE_URL,
  MQTT_BROKER: LOCAL_SERVICE_URL,
  AI_PROVIDER_URL: LOCAL_SERVICE_URL,
  FALLBACK_API_URL: LOCAL_SERVICE_URL,
  PB_ADMIN_EMAIL: "",
  PB_ADMIN_PASS: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_OAUTH_SCOPES: "",
  CONSUELA_ENCRYPTION_KEY: "",
  CRON_SECRET: "",
  ADMIN_SECRET: "",
  SESSION_SECRET: "",
  AI_PROVIDER_KEY: "",
  AI_PROVIDER_MODELS: "",
  OPENROUTER_API_KEY: "",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_MIRROR_BOT_TOKEN: "",
  HA_TOKEN: "",
  MQTT_USER: "",
  MQTT_PASS: "",
  HA_GROCERY_TODO_NAME: "",
  GMAIL_USER: "",
  GMAIL_APP_PASSWORD: "",
  TELEGRAM_ALERT_CHAT_ID: "",
  INSTACART_API_KEY: "",
  MEALDB_KEY: "1",
  COMPOSIO_API_KEY: "",
  GREENLIGHT_API_KEY: "",
  KHAN_API_KEY: "",
  FALLBACK_API_KEY: "",
  FALLBACK_MODELS: "",
  EMERGENCY_PIN_BYPASS: "",
  GOOGLE_VISION_API_KEY: "",
  LAT: "0",
  LON: "0",
});

export function buildProbeEnv(appUrl, sourceEnv = process.env) {
  const runtimeEnv = {};
  for (const key of PROBE_RUNTIME_KEYS) {
    const value = sourceEnv[key];
    if (typeof value === "string") runtimeEnv[key] = value;
  }
  return {
    ...runtimeEnv,
    ...SAFE_PROBE_ENV,
    NEXT_PUBLIC_APP_URL: appUrl,
    NEXT_PUBLIC_URL: appUrl,
  };
}
