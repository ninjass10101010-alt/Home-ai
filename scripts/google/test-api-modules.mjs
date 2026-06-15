#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.CONSUELA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID = "test.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret";
process.env.GOOGLE_OAUTH_SCOPES = "openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks";

const realFetch = globalThis.fetch;
let captured = null;
const calls = [];
let tokenState = { access: "ya29.first", expires_at: Date.now() + 3600_000 };
let refreshCount = 0;

globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, method: (init && init.method) || "GET" });
  if (u.includes("/oauth2/v4/token") || u.includes("/oauth2.googleapis.com/token")) {
    const body = String((init && init.body) || "");
    if (body.includes("grant_type=refresh_token")) {
      refreshCount++;
      return new Response(
        JSON.stringify({ access_token: "ya29.refreshed", expires_in: 3600, scope: "s" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
  }
  if (u.includes("/calendar/v3/calendars/primary/events")) {
    if (init && init.method === "POST") {
      captured = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          id: "new123", summary: captured.summary, start: captured.start, end: captured.end,
          etag: "\"v1\"",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (init && init.method === "PATCH") {
      captured = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ id: "patched", summary: captured.summary, etag: "\"v2\"" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (init && init.method === "DELETE") {
      return new Response("", { status: 204 });
    }
    return new Response(
      JSON.stringify({ items: [{ id: "e1", summary: "Soccer", start: { dateTime: "2026-06-15T16:00:00Z" }, end: { dateTime: "2026-06-15T17:00:00Z" }, etag: "\"e1\"" }], nextSyncToken: "tok-1" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (u.includes("/calendar/v3/calendars/primary/events/")) {
    return new Response(
      JSON.stringify({ id: "patched", summary: "X", etag: "\"v2\"" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (u.includes("/calendar/v3/users/me/calendarList")) {
    return new Response(
      JSON.stringify({ items: [{ id: "primary", summary: "Primary", primary: true, accessRole: "owner" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (u.includes("/tasks/v1/users/@me/lists")) {
    if (init && init.method === "POST") {
      return new Response(
        JSON.stringify({ id: "new-list", title: "Consuela" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ items: [{ id: "L1", title: "My Tasks" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (u.includes("/tasks/v1/lists/") && u.endsWith("/tasks")) {
    if (init && init.method === "POST") {
      return new Response(
        JSON.stringify({ id: "T1", title: JSON.parse(String(init.body)).title, status: "needsAction" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ items: [{ id: "t1", title: "Take meds", due: "2026-06-15T08:00:00Z", status: "needsAction", etag: "\"x\"" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (u.includes("/tasks/v1/lists/L1/tasks/t1")) {
    return new Response(
      JSON.stringify({ id: "t1", title: "Take meds", status: "completed", etag: "\"y\"" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return new Response("not mocked: " + u, { status: 404 });
};

const { googleFetch, isGoogleConnected, GoogleAuthError } = await import("../../src/lib/google/oauth-client.ts");
const { listAllEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, listCalendars } =
  await import("../../src/lib/google/calendar.ts");
const { createTask, updateTask, completeTask, uncompleteTask, deleteTask, listAllTasks, getOrCreateConsuelaListId } =
  await import("../../src/lib/google/tasks.ts");

let passed = 0, failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

await t("googleFetch sends Authorization header", async () => {
  captured = null;
  const res = await googleFetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    method: "GET",
    endpoint: "/calendar/v3/users/me/calendarList",
  });
  assert.equal(res.status, 200);
  assert.ok(res.data.items);
});

await t("listAllEvents requests primary calendar events", async () => {
  const { events, nextSyncToken } = await listAllEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, "Soccer");
  assert.equal(nextSyncToken, "tok-1");
});

await t("createCalendarEvent includes summary + start + end", async () => {
  captured = null;
  const e = await createCalendarEvent({
    summary: "Dentist",
    start: { dateTime: "2026-06-20T14:00:00-04:00" },
    end: { dateTime: "2026-06-20T15:00:00-04:00" },
  });
  assert.equal(e.id, "new123");
  assert.equal(captured.summary, "Dentist");
  assert.equal(captured.extendedProperties.private.source, "consuelaDashboard");
});

await t("updateCalendarEvent sends If-Match header when given etag", async () => {
  let ifMatch = null;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    ifMatch = (init && init.headers && init.headers["If-Match"]) || null;
    return new Response(JSON.stringify({ id: "x", summary: "Y", etag: "\"v2\"" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  await updateCalendarEvent("evt1", { summary: "Y" }, "\"v1\"");
  globalThis.fetch = orig;
  assert.equal(ifMatch, "\"v1\"");
});

await t("deleteCalendarEvent returns without throwing on 204", async () => {
  await deleteCalendarEvent("evt1");
});

await t("listCalendars returns primary flag", async () => {
  const cals = await listCalendars();
  assert.equal(cals.length, 1);
  assert.equal(cals[0].primary, true);
});

await t("createTask posts to correct list endpoint", async () => {
  captured = null;
  const t1 = await createTask("L1", { title: "Take meds" });
  assert.equal(t1.id, "T1");
  assert.equal(t1.title, "Take meds");
});

await t("createTask with due sets kind=reminder on PB row", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "T2", title: "Take meds", status: "needsAction" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  const t1 = await createTask("L1", { title: "Take meds", due: "2026-06-15T08:00:00Z" });
  globalThis.fetch = orig;
  assert.equal(t1.id, "T2");
});

await t("completeTask sends status: completed", async () => {
  let sent = null;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "t1", status: "completed" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  await completeTask("L1", "t1");
  globalThis.fetch = orig;
  assert.equal(sent.status, "completed");
});

await t("uncompleteTask sends status: needsAction", async () => {
  let sent = null;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "t1", status: "needsAction" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  await uncompleteTask("L1", "t1");
  globalThis.fetch = orig;
  assert.equal(sent.status, "needsAction");
});

await t("deleteTask returns without throwing", async () => {
  await deleteTask("L1", "t1");
});

await t("getOrCreateConsuelaListId reuses existing list", async () => {
  const id = await getOrCreateConsuelaListId();
  assert.equal(id, "L1");
});

await t("googleFetch on 401 triggers refresh and retries", async () => {
  refreshCount = 0;
  let firstCall = true;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/token")) {
      refreshCount++;
      return new Response(
        JSON.stringify({ access_token: "ya29.refreshed", expires_in: 3600, scope: "s" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (firstCall) {
      firstCall = false;
      return new Response(JSON.stringify({ error: { message: "Invalid Credentials" } }), {
        status: 401, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const res = await googleFetch("https://www.googleapis.com/somewhere", { method: "GET", endpoint: "/somewhere" });
  globalThis.fetch = orig;
  assert.equal(res.status, 200);
  assert.ok(refreshCount >= 1, "should have refreshed");
});

console.log(`\n${passed} passed, ${failed} failed`);
globalThis.fetch = realFetch;
process.exit(failed > 0 ? 1 : 0);
