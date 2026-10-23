import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import {
  type ConnectedAccount,
  ComposioError,
  COMPOSIO_TOOLKITS,
  getConnectedAccount,
  listConnectedAccounts,
} from "@/lib/google/composio";
import {
  type ConnectionSnapshot,
  readConnectionSnapshot,
  TASKS_SNAPSHOT_KEY,
  writeConnectionSnapshot,
} from "@/lib/google/connection-state";
import { syncCalendar } from "@/lib/google/calendar";
import { pruneCachedEvents } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Toolkit = (typeof COMPOSIO_TOOLKITS)[keyof typeof COMPOSIO_TOOLKITS];

function snapshotKeyFor(toolkit: Toolkit): string | undefined {
  return toolkit === COMPOSIO_TOOLKITS.TASKS ? TASKS_SNAPSHOT_KEY : undefined;
}

function composioErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ComposioError)) return null;
  const status =
    error.code === "not_configured" ? 503 : error.code === "auth_failed" ? 401 : 502;
  return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown error";
}

function stateUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "google_state_unavailable", error: "Google connection state unavailable" },
    { status: 503 },
  );
}

export async function GET(req: NextRequest) {
  const auth = await authorizeCurrentParentRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "unauthorized" },
      { status: auth.status ?? 401 },
    );
  }

  const requested = new URL(req.url).searchParams.get("toolkit");
  if (
    requested !== null &&
    requested !== COMPOSIO_TOOLKITS.CALENDAR &&
    requested !== COMPOSIO_TOOLKITS.TASKS
  ) {
    return NextResponse.json({ ok: false, error: "invalid_toolkit" }, { status: 400 });
  }
  const toolkit: Toolkit =
    requested === COMPOSIO_TOOLKITS.TASKS ? COMPOSIO_TOOLKITS.TASKS : COMPOSIO_TOOLKITS.CALENDAR;
  const key = snapshotKeyFor(toolkit);

  let snapshot: ConnectionSnapshot;
  try {
    snapshot = await readConnectionSnapshot(key);
  } catch (error) {
    console.warn("[google/composio/status]", errorMessage(error));
    return stateUnavailableResponse();
  }

  let connectedAccountId = snapshot.connectedAccountId;
  let account: ConnectedAccount | null = null;
  if (connectedAccountId) {
    try {
      account = await getConnectedAccount(connectedAccountId);
    } catch (error) {
      const mapped = composioErrorResponse(error);
      if (mapped) return mapped;
      console.warn("[google/composio/status]", errorMessage(error));
      return NextResponse.json(
        { ok: false, code: "api_error", error: "Composio status check failed" },
        { status: 502 },
      );
    }
  }

  // The snapshot is a cache; Composio is the source of truth. A reconnect can
  // leave the snapshot pointing at an old pending/failed account while the
  // replacement is ACTIVE, and a cleared snapshot can still have a live grant.
  // Recover that grant instead of asking the family to connect again.
  if (!account || account.status !== "ACTIVE") {
    let accounts: ConnectedAccount[] = [];
    try {
      accounts = await listConnectedAccounts(toolkit);
    } catch (error) {
      if (!account) {
        if (error instanceof ComposioError && error.code === "not_configured") {
          return NextResponse.json({ ok: true, connected: false });
        }
        const mapped = composioErrorResponse(error);
        if (mapped) return mapped;
        console.warn("[google/composio/status]", errorMessage(error));
        return NextResponse.json(
          { ok: false, code: "api_error", error: "Composio status check failed" },
          { status: 502 },
        );
      }
      console.warn("[google/composio/status] account list failed:", errorMessage(error));
    }

    const active = accounts.find((candidate) => candidate.status === "ACTIVE");
    if (active) {
      account = active;
      connectedAccountId = active.id;
    } else if (!account) {
      const pending = accounts.find(
        (candidate) => candidate.status === "INITIALIZING" || candidate.status === "INITIATED",
      ) ?? accounts[0];
      if (pending) {
        account = pending;
        connectedAccountId = pending.id;
      }
    }
  }

  if (!connectedAccountId) {
    return NextResponse.json({ ok: true, connected: false });
  }

  const now = new Date().toISOString();
  if (account && account.status === "ACTIVE") {
    if (snapshot.status !== "ACTIVE") {
      try {
        await writeConnectionSnapshot(
          {
            connectedAccountId: account.id || connectedAccountId,
            status: "ACTIVE",
            accountEmail: account.email,
            connectedAt: snapshot.connectedAt ?? now,
            lastVerifiedAt: now,
          },
          key,
        );
      } catch (error) {
        console.warn("[google/composio/status] snapshot persist failed:", errorMessage(error));
      }
      if (toolkit === COMPOSIO_TOOLKITS.CALENDAR) {
        try {
          await syncCalendar();
        } catch (error) {
          console.warn("[google/composio/status] initial sync failed:", errorMessage(error));
        }
      }
    }
    return NextResponse.json({
      ok: true,
      connected: true,
      status: "ACTIVE",
      toolkit,
      connected_account_id: account.id || connectedAccountId,
      account_email: account.email,
    });
  }

  const accountStatus = account?.status || "NOT_FOUND";
  // A calendar account that was ACTIVE and is no longer (FAILED/REVOKED/
  // NOT_FOUND) invalidates every cached event row — without this, the next
  // reconnect serves the previous account's ghost events. Tasks has no
  // calendar-event cache, so only the calendar snapshot prunes.
  if (
    toolkit === COMPOSIO_TOOLKITS.CALENDAR &&
    snapshot.status === "ACTIVE" &&
    accountStatus !== "ACTIVE"
  ) {
    try {
      await pruneCachedEvents();
    } catch (error) {
      console.warn("[google/composio/status] cache prune failed:", errorMessage(error));
    }
  }
  if (snapshot.status !== accountStatus || snapshot.connectedAccountId !== connectedAccountId) {
    try {
      await writeConnectionSnapshot(
        {
          connectedAccountId,
          status: accountStatus,
          ...(account?.email ? { accountEmail: account.email } : {}),
          lastVerifiedAt: now,
        },
        key,
      );
    } catch (error) {
      console.warn("[google/composio/status] snapshot persist failed:", errorMessage(error));
    }
  }
  return NextResponse.json({
    ok: true,
    connected: false,
    status: accountStatus,
    reason: account ? "account_not_active" : "account_not_found",
  });
}
