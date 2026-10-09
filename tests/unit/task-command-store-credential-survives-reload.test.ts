// @vitest-environment jsdom
// B1a RED — "a PIN-gated command re-sent after a reload asks for the PIN
// again, it is not refused". Symptom (d): the PIN lives only in an in-memory
// map (task-command-store.ts:86-107) while the entry lives in localStorage.
// After a reload the re-send carries no pin and processEntry maps the 401/403
// straight to markFailed (task-command-store.ts:770-775) — a permanent refusal
// instead of an `auth-required` re-prompt. The storage boundary rewrites every
// persisted `auth-required` to `failed` on read (task-operation-payload.ts:
// 501-509), which also makes the "🔒 N waiting on a PIN" banner dead code.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  __resetTaskCommandCredentialsForTests,
  __resetTaskOutboxForTests,
  enqueueTaskOperation,
  flushTaskOutbox,
  listTaskOutbox,
  registerTaskOutboxDriver,
  rememberTaskCommandCredential,
  TASK_STORE_LOCAL_EXPIRY_MS,
  type TaskOutboxDriver,
  type TaskOutboxEntry,
} from "@/lib/task-command-store";
import { buildTaskOperationRequestBody, parseTaskOperationEntry } from "@/lib/task-operation-payload";

const OPERATION_ID = "op-pin-reload";

function approveEntry(operationId = OPERATION_ID): TaskOutboxEntry {
  return enqueueTaskOperation({
    operationId,
    route: "/api/tasks/approve",
    action: "approve",
    payload: { taskId: 101, memberName: "Rebecca Garcia" },
    displayTarget: { kind: "approval", taskId: 101, title: "Dishes" },
  });
}

/** The route's actual refusal for a credential-less approve POST. */
function credentialRefusingDriver(seen: Record<string, unknown>[]): TaskOutboxDriver {
  return {
    send: async (entry, credential) => {
      const body = buildTaskOperationRequestBody(entry, credential);
      seen.push(body);
      if (typeof body.pin !== "string" || body.pin.length === 0) {
        return {
          status: 401,
          body: { operationId: entry.operationId, success: false, reason: "unauthorized", code: "unauthorized" },
        };
      }
      return { status: 200, body: { operationId: entry.operationId, success: true, weekData: {} as any } };
    },
    pullSnapshot: async () => ({ snapshot: null, reconciled: true }),
    adoptSnapshot: async () => {},
  };
}

async function withDriver<T>(driver: TaskOutboxDriver, run: () => Promise<T>): Promise<T> {
  const restore = registerTaskOutboxDriver(driver);
  try {
    return await run();
  } finally {
    restore();
  }
}

function entryOf(operationId = OPERATION_ID): TaskOutboxEntry | undefined {
  return listTaskOutbox().find((entry) => entry.operationId === operationId);
}

beforeEach(() => {
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
});

describe("a PIN-gated command re-sent after a reload asks for the PIN again, it is not refused", () => {
  it("parks the reloaded command as auth-required instead of failing it unauthorized", async () => {
    approveEntry();
    rememberTaskCommandCredential(OPERATION_ID, { pin: "1234" });
    // The reload: localStorage survives, the in-memory credential map does not.
    __resetTaskCommandCredentialsForTests();

    const seen: Record<string, unknown>[] = [];
    await withDriver(credentialRefusingDriver(seen), () => flushTaskOutbox());

    // The re-send really did go out credential-less.
    expect(seen).toHaveLength(1);
    expect("pin" in seen[0]).toBe(false);

    const entry = entryOf();
    expect(entry?.status).toBe("auth-required");
    expect(entry?.lastErrorCategory).not.toBe("unauthorized");
  });

  it("round-trips auth-required through the storage boundary unchanged", () => {
    const parsed = parseTaskOperationEntry({
      version: 1,
      operationId: "op-persisted-auth-required",
      route: "/api/tasks/approve",
      action: "approve",
      payload: { taskId: 101, memberName: "Rebecca Garcia" },
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      status: "auth-required",
      lastErrorCategory: "network",
      displayTarget: { kind: "approval", taskId: 101 },
    });

    expect(parsed?.status).toBe("auth-required");
  });

  it("does not terminalise an overnight entry as a network expiry", async () => {
    approveEntry();
    rememberTaskCommandCredential(OPERATION_ID, { pin: "1234" });
    __resetTaskCommandCredentialsForTests();

    const now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now + TASK_STORE_LOCAL_EXPIRY_MS + 60_000);
    try {
      const seen: Record<string, unknown>[] = [];
      await withDriver(credentialRefusingDriver(seen), () => flushTaskOutbox());
    } finally {
      vi.restoreAllMocks();
    }

    const entry = entryOf();
    expect(entry?.lastErrorReason).not.toBe("queue_expired");
    expect(entry?.lastErrorCategory).not.toBe("network");
  });

  it("parks a credential-less 400 invalid_body as auth-required too", async () => {
    // The approve route's parser requires memberName+pin, so the credential-
    // less re-send is refused 400 invalid_body BEFORE auth runs. That is the
    // same missing-PIN state as a 401, and must ask for the PIN again.
    approveEntry();
    rememberTaskCommandCredential(OPERATION_ID, { pin: "1234" });
    __resetTaskCommandCredentialsForTests();

    const seen: Record<string, unknown>[] = [];
    const driver: TaskOutboxDriver = {
      send: async (entry, credential) => {
        const body = buildTaskOperationRequestBody(entry, credential);
        seen.push(body);
        if (typeof body.pin !== "string" || body.pin.length === 0) {
          return {
            status: 400,
            body: {
              operationId: entry.operationId,
              success: false,
              reason: "invalid_body",
              code: "invalid_body",
              error: "invalid_body",
            },
          };
        }
        return { status: 200, body: { operationId: entry.operationId, success: true, weekData: {} as any } };
      },
      pullSnapshot: async () => ({ snapshot: null, reconciled: true }),
      adoptSnapshot: async () => {},
    };
    await withDriver(driver, () => flushTaskOutbox());

    const entry = entryOf();
    expect(entry?.status).toBe("auth-required");
    expect(entry?.lastErrorReason).toBe("pin_required");
  });
});
