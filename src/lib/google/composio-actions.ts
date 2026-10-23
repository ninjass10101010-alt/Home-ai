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

// Arg names are LIVE-VERIFIED against the real API (2026-10-05) and are
// PER-ACTION — do not assume one convention:
// - GOOGLECALENDAR_EVENTS_LIST: camelCase — calendarId, timeMin, timeMax,
//   singleEvents, showDeleted, maxResults, pageToken, orderBy, timeZone,
//   syncToken, iCalUID, eventTypes, updatedMin. timeMin/timeMax REQUIRED (no
//   default window); the snake_case variants are silently ignored.
// - GOOGLECALENDAR_LIST_CALENDARS: snake_case — page_token, sync_token,
//   max_results, show_hidden, show_deleted, min_access_role.
// - GOOGLECALENDAR_CREATE_EVENT: snake_case — calendar_id, summary,
//   description, location, timezone, start_datetime, end_datetime,
//   event_duration_hour, event_duration_minutes, attendees.
// - GOOGLECALENDAR_PATCH_EVENT: snake_case — calendar_id, event_id, summary,
//   description, location, timezone, start_time, end_time, attendees, status.
// - GOOGLECALENDAR_DELETE_EVENT: event_id, calendar_id, send_updates,
//   send_notifications.
// - GOOGLETASKS_LIST_TASK_LISTS: pageToken, maxResults.
// - GOOGLETASKS_LIST_TASKS: tasklist_id, showCompleted, showDeleted,
//   showHidden, updatedMin, dueMin/dueMax, completedMin/Max, maxResults,
//   pageToken. Response key is `tasks`.
// - GOOGLETASKS_INSERT_TASK: tasklist_id, title, notes, due, status,
//   completed.
// - GOOGLETASKS_PATCH_TASK: tasklist_id, task_id, title, notes, due, status,
//   completed.
// - GOOGLETASKS_DELETE_TASK: tasklist_id, task_id.
// - GOOGLETASKS_CREATE_TASK_LIST: tasklist_title (NOT `title`).
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
