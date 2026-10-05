// Composio v3.1 contract — pinned for the Google Calendar/Tasks adapter.
//
// Source of truth: Composio public docs (composio.dev/toolkits/googlecalendar,
// /googletasks; docs.composio.dev/reference/api-reference/connected-accounts),
// verified 2026-10-05. The live probe (Task 1 Step 2) must confirm these with
// the real COMPOSIO_API_KEY before deploy; if a slug 404s at runtime, re-run
// that probe and update THIS file only.
//
// Do NOT hardcode an action slug anywhere else — import from here.

export const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3.1";

export const COMPOSIO_EXECUTE_PATH = `${COMPOSIO_API_BASE}/tools/execute`;
export const COMPOSIO_TOOLS_PATH = `${COMPOSIO_API_BASE}/tools`;
export const COMPOSIO_CONNECTED_ACCOUNTS_PATH = `${COMPOSIO_API_BASE}/connected_accounts`;
export const COMPOSIO_CONNECTED_ACCOUNT_LINK_PATH = `${COMPOSIO_API_BASE}/connected_accounts/link`;
export const COMPOSIO_AUTH_CONFIGS_PATH = `${COMPOSIO_API_BASE}/auth_configs`;

export const COMPOSIO_TOOLKITS = {
  CALENDAR: "googlecalendar",
  TASKS: "googletasks",
} as const;

export type ComposioToolkit = (typeof COMPOSIO_TOOLKITS)[keyof typeof COMPOSIO_TOOLKITS];

// Verified action slugs (public docs, 2026-10-05).
// NOTE: there is no GOOGLECALENDAR_SYNC_EVENTS action. Incremental sync tokens
// are NOT exposed through Composio — the adapter does a full-window
// EVENTS_LIST per calendar (30 days back / 90 forward) and upserts by
// (calendar_id, google_id). See spec §3.
export const COMPOSIO_ACTIONS = {
  LIST_CALENDARS: "GOOGLECALENDAR_LIST_CALENDARS",
  LIST_EVENTS: "GOOGLECALENDAR_EVENTS_LIST",
  CREATE_EVENT: "GOOGLECALENDAR_CREATE_EVENT",
  UPDATE_EVENT: "GOOGLECALENDAR_PATCH_EVENT",
  DELETE_EVENT: "GOOGLECALENDAR_DELETE_EVENT",
  TASKS_LIST_TASKLISTS: "GOOGLETASKS_LIST_TASK_LISTS",
  TASKS_CREATE_TASK_LIST: "GOOGLETASKS_CREATE_TASK_LIST",
  TASKS_LIST_TASKS: "GOOGLETASKS_LIST_TASKS",
  TASKS_CREATE_TASK: "GOOGLETASKS_INSERT_TASK",
  TASKS_UPDATE_TASK: "GOOGLETASKS_PATCH_TASK",
  TASKS_DELETE_TASK: "GOOGLETASKS_DELETE_TASK",
} as const;

// Arg-name notes (confirm live in Task 1):
// - GOOGLECALENDAR_EVENTS_LIST REQUIRES time_min/time_max (no default window).
//   Calendar id arg is `calendar_id` (primary is the literal "primary").
// - GOOGLETASKS_LIST_TASKS response key is `tasks`; pass showCompleted when
//   filtering by completed date.
// - Composio execute response shape is `{ data, successful, error }`.
export const COMPOSIO_CONNECT_FLOW_NOTES = {
  // Connect Links are PER-TOOLKIT: POST /connected_accounts/link takes exactly
  // one auth_config_id. Calendar is the required connect; Tasks is a separate,
  // optional second connect. A stable family-scoped user_id is used.
  USER_ID: "consuela-family",
  // Auth config: reuse an existing managed config for the toolkit, else create
  // one with managed auth:
  //   GET  /auth_configs?toolkit_slug=<slug>
  //   POST /auth_configs  { toolkit: { slug }, auth_config: { type: "use_composio_managed_auth" } }
  // Then POST /connected_accounts/link { auth_config_id, user_id }
  //   -> { redirect_url, connected_account_id, expires_at, link_token }
} as const;
