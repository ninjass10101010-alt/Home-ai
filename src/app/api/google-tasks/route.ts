import { NextRequest, NextResponse } from "next/server";
import { isGoogleConnected, GoogleAuthError } from "@/lib/google/oauth-client";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";
import { getStoredTokens } from "@/lib/google/token-store.ts";
import {
  createTask,
  updateTask,
  deleteTask,
  completeTask,
  uncompleteTask,
  createReminder,
  getConsuelaListId,
  readCachedTasks,
  readCachedReminders,
  syncTasks,
} from "@/lib/google/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureGoogleCollections();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, tasks: [], reminders: [], error: "PocketBase not reachable" },
      { status: 200 },
    );
  }

  const { searchParams } = new URL(req.url);
  const resource = searchParams.get("resource") || "all";
  const sync = searchParams.get("sync");

  if (!(await isGoogleConnected())) {
    return NextResponse.json({ ok: true, connected: false, tasks: [], reminders: [] });
  }

  if (sync === "now") {
    try {
      await syncTasks();
    } catch (e: any) {
      console.error("[google-tasks] sync-now failed:", e?.message);
    }
  }

  try {
    const tokens = await getStoredTokens();
    const hasTasksScope = tokens?.scope?.includes("googleapis.com/auth/tasks");
    if (!hasTasksScope) {
      return NextResponse.json({
        ok: true,
        connected: true,
        tasks: [],
        reminders: [],
        tasks_scope_granted: false,
        notice:
          "Google Tasks scope is not granted. Reminders and Tasks sync are paused until you add the Tasks scope (requires a Web OAuth client with a public redirect URI).",
      });
    }
    const tasks = resource === "reminders" ? [] : await readCachedTasks();
    const reminders = resource === "tasks" ? [] : await readCachedReminders();
    return NextResponse.json({ ok: true, connected: true, tasks, reminders, tasks_scope_granted: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, tasks: [], reminders: [], error: e?.message },
      { status: 200 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await isGoogleConnected())) {
    return NextResponse.json(
      { ok: false, code: "no_grant", error: "Google account is not connected" },
      { status: 409 },
    );
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (body.action === "reminder") {
      if (!body.title || !body.due) {
        return NextResponse.json(
          { ok: false, error: "title and due are required" },
          { status: 400 },
        );
      }
      const result = await createReminder({
        title: body.title,
        due: body.due,
        notes: body.notes,
      });
      return NextResponse.json({ ok: true, kind: "reminder", ...result });
    }

    if (body.action === "create") {
      if (!body.title) {
        return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });
      }
      const listId = body.tasklistId || (await getConsuelaListId());
      const task = await createTask(listId, {
        title: body.title,
        notes: body.notes,
        due: body.due,
        status: body.status,
      });
      return NextResponse.json({ ok: true, kind: "create", task });
    }

    if (body.action === "update") {
      if (!body.tasklistId || !body.taskId) {
        return NextResponse.json(
          { ok: false, error: "tasklistId and taskId required" },
          { status: 400 },
        );
      }
      const task = await updateTask(body.tasklistId, body.taskId, {
        title: body.title,
        notes: body.notes,
        due: body.due,
        status: body.status,
      });
      return NextResponse.json({ ok: true, kind: "update", task });
    }

    if (body.action === "complete") {
      if (!body.tasklistId || !body.taskId) {
        return NextResponse.json(
          { ok: false, error: "tasklistId and taskId required" },
          { status: 400 },
        );
      }
      const task = await completeTask(body.tasklistId, body.taskId);
      return NextResponse.json({ ok: true, kind: "complete", task });
    }

    if (body.action === "uncomplete") {
      if (!body.tasklistId || !body.taskId) {
        return NextResponse.json(
          { ok: false, error: "tasklistId and taskId required" },
          { status: 400 },
        );
      }
      const task = await uncompleteTask(body.tasklistId, body.taskId);
      return NextResponse.json({ ok: true, kind: "uncomplete", task });
    }

    if (body.action === "delete") {
      if (!body.tasklistId || !body.taskId) {
        return NextResponse.json(
          { ok: false, error: "tasklistId and taskId required" },
          { status: 400 },
        );
      }
      await deleteTask(body.tasklistId, body.taskId);
      return NextResponse.json({ ok: true, kind: "delete" });
    }

    return NextResponse.json(
      { ok: false, error: `Unknown action: ${body.action}` },
      { status: 400 },
    );
  } catch (e: any) {
    if (e instanceof GoogleAuthError) {
      return NextResponse.json(
        { ok: false, code: e.code, error: e.message },
        { status: e.code === "no_grant" ? 409 : 401 },
      );
    }
    console.error("[google-tasks] action failed:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Task action failed" },
      { status: 500 },
    );
  }
}
