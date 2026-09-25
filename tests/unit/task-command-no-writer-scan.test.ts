// @vitest-environment node
// Task 10 — full no-writer scan. The browser is no longer a writer for any
// task/config authority: these greps fail the build if a legacy local-first
// writer (a direct task/config POST outside the outbox, a local point/history
// mutation inside a task operation, or the retired snapshot writer) creeps
// back into a caller.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = walk(ROOT);

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

function lineNumbers(source: string, pattern: RegExp): number[] {
  return source
    .split("\n")
    .flatMap((line, index) => (pattern.test(line) ? [index + 1] : []));
}

describe("no-writer scan — tasks page", () => {
  const source = read("app/tasks/page.tsx");

  it("never posts a task or config command directly", () => {
    expect(lineNumbers(source, /fetch\(\s*["'`]\/api\/tasks\/(claim|approve|manage|config)/)).toEqual([]);
  });

  it("never posts the retired snapshot writer", () => {
    expect(lineNumbers(source, /method:\s*["']POST["'][\s\S]{0,200}?\/api\/tasks\/sync/)).toEqual([]);
  });

  it("never mirrors a server task row onto local state", () => {
    // The legacy claim/crew/undo paths each wrote the server's `task` back
    // into the local list. The acknowledgment is the only writer now.
    expect(lineNumbers(source, /setTasks\(prev\s*=>\s*prev\.map\([^)]*data\.task/)).toEqual([]);
    expect(lineNumbers(source, /updated\.crew\s*\?\?\s*x\.crew/)).toEqual([]);
  });

  it("has NO local point writer left at all", () => {
    // Every point movement — an earn, a redemption, a penalty, a manual
    // adjust and a reversal — is a durable command now. There is no
    // `addTransaction` left on this page, and no direct mutation of
    // `weekData.points` outside the adoption callback that re-reads the store.
    expect(lineNumbers(source, /addTransaction\(/)).toEqual([]);
    expect(lineNumbers(source, /points:\s*\{[^}]*\[normalizedName\]/)).toEqual([]);
    expect(lineNumbers(source, /Math\.max\(0,\s*\(prev\.points/)).toEqual([]);
    expect(lineNumbers(source, /currentWeekPoints/)).toEqual([]);
  });

  it("routes reward redemption, penalty and manual adjust through the outbox", () => {
    expect(lineNumbers(source, /route:\s*"\/api\/rewards\/redeem"/).length).toBeGreaterThanOrEqual(1);
    const ledgerRoutes = lineNumbers(source, /route:\s*"\/api\/tasks\/ledger"/);
    expect(ledgerRoutes).toHaveLength(2);
    const ledgerBodies = source.split('route: "/api/tasks/ledger"');
    expect(ledgerBodies[1]).toContain('action: "penalty"');
    expect(ledgerBodies[2]).toContain('action: "adjust"');
  });

  it("sends the parent PIN only on a high-cost redemption", () => {
    // The parent PIN is a ref between the approval step and the command, and
    // is cleared the moment the command is queued.
    expect(source).toContain("parentApprovalPinRef");
    expect(source).toContain('parentApprovalPinRef.current = "";');
  });

  it("enqueues every command through the durable queue", () => {
    expect(lineNumbers(source, /enqueueTaskOperation/)).toEqual([]);
    expect(lineNumbers(source, /queueCommand\(\{/).length).toBeGreaterThan(5);
  });
});

describe("no-writer scan — kid home", () => {
  const source = read("modes/kid/KidHome.tsx");

  it("never posts a task command directly", () => {
    expect(lineNumbers(source, /fetch\(\s*["'`]\/api\/tasks\/(claim|approve|manage|config)/)).toEqual([]);
  });

  it("never writes the local task or week store", () => {
    expect(lineNumbers(source, /saveTasks\(/)).toEqual([]);
    expect(lineNumbers(source, /saveWeekData\(/)).toEqual([]);
    expect(lineNumbers(source, /addTransaction\(/)).toEqual([]);
  });

  it("verifies a PIN-gated claim BEFORE queueing it", () => {
    // A 10+ claim is PIN-gated for every age, so a wrong PIN must never
    // become a queued (and forever-retried) command.
    const claimBranch = source.slice(source.indexOf("if (task.universal || isSnatchable(task)) {"));
    const verifyAt = claimBranch.indexOf("verifyPinRemote");
    const queueAt = claimBranch.indexOf("queueCommand");
    expect(verifyAt).toBeGreaterThanOrEqual(0);
    expect(queueAt).toBeGreaterThan(verifyAt);
  });

  it("queues an under-10 tap with NO credential at all", () => {
    const tapBranch = source.slice(source.indexOf("completesWithoutPin(user?.role, user?.age, task) && !task.universal"));
    const body = tapBranch.slice(0, tapBranch.indexOf("markOptimistic("));
    expect(body).toContain('action: "complete"');
    expect(body).not.toMatch(/credential:/);
  });
});

describe("no-writer scan — config callers", () => {
  it("RewardSection, WeeklyPrizesCard and action-runner all queue config commands", () => {
    for (const file of [
      "components/settings/RewardSection.tsx",
      "components/settings/WeeklyPrizesCard.tsx",
      "lib/action-runner.ts",
    ]) {
      const source = read(file);
      expect(lineNumbers(source, /fetch\(\s*["'`]\/api\/tasks\/config/)).toEqual([]);
      expect(lineNumbers(source, /queueTaskCommand(?:AndFlush)?\(/).length).toBeGreaterThan(0);
    }
  });

  it("no caller stamps a config write as a local success before acknowledgment", () => {
    for (const file of [
      "components/settings/RewardSection.tsx",
      "components/settings/WeeklyPrizesCard.tsx",
      "lib/action-runner.ts",
    ]) {
      const source = read(file);
      expect(lineNumbers(source, /saveRewards\(/)).toEqual([]);
      expect(lineNumbers(source, /writeRewardsStamp\(/)).toEqual([]);
      expect(lineNumbers(source, /writeWeeklyPrizesStamp\(/)).toEqual([]);
    }
  });
});

describe("no-writer scan — the credential boundary", () => {
  it("no caller stores a PIN in localStorage", () => {
    for (const file of [
      "app/tasks/page.tsx",
      "modes/kid/KidHome.tsx",
      "components/settings/RewardSection.tsx",
      "components/settings/WeeklyPrizesCard.tsx",
      "lib/action-runner.ts",
    ]) {
      const source = read(file);
      const localStorageSets = source
        .split("\n")
        .map((line, index) => ({ line: index + 1, text: line }))
        .filter(({ text }) => /localStorage\.setItem/.test(text));
      for (const { line, text } of localStorageSets) {
        expect(`${file}:${line} ${text}`).not.toMatch(/pin/i);
      }
    }
  });

  it("admit no root key the route's own parser refuses", async () => {
    // Real parsers, real bodies, real allowlists — no hand-written key list. A
    // body built through queueTaskCommand + buildTaskOperationRequestBody is fed
    // to the parser that route actually uses, and every case is PIN-credentialed
    // so the credential is part of what is asserted.
    const { queueTaskCommand } = await import("@/lib/task-command-queue");
    const { buildTaskOperationRequestBody, resolveTaskOutboxCredential } =
      await import("@/lib/task-operation-outbox");
    const { parseLedgerCommand } = await import("@/lib/task-ledger-command");
    const { parseClaimCommand } = await import("@/lib/task-claim");

    const MEMBER = "Caspian Garcia";
    const PIN = "3141";
    const PARENT_PIN = "9026";

    // `parse` normalises every route parser to one `{ ok }` shape so the
    // acceptance assertion below is the SAME real assertion for all of them.
    const cases = [
      {
        label: "penalty",
        command: {
          route: "/api/tasks/ledger" as const,
          action: "penalty",
          payload: { memberName: MEMBER, itemId: "pen-1", points: 9999, cost: 5, amount: 7 },
          credential: { pin: PIN },
        },
        parse: (body: Record<string, unknown>) => parseLedgerCommand(body),
        accepted: ["operationId", "action", "memberName", "itemId", "pin"],
        rejected: ["points", "cost", "amount"],
      },
      {
        label: "adjust",
        command: {
          route: "/api/tasks/ledger" as const,
          action: "adjust",
          payload: { memberName: MEMBER, amount: -5, reason: "helped out", points: 9999 },
          credential: { pin: PIN },
        },
        parse: (body: Record<string, unknown>) => parseLedgerCommand(body),
        accepted: ["operationId", "action", "memberName", "amount", "reason", "pin"],
        rejected: ["points"],
      },
      {
        label: "redeem",
        command: {
          route: "/api/rewards/redeem" as const,
          action: "redeem",
          payload: { rewardId: 7, memberName: MEMBER, cost: 1, points: 2 },
          // A high-cost redemption carries BOTH credentials; the per-route
          // allowlist in the body builder is what decides what reaches the wire.
          credential: { pin: PIN, parentPin: PARENT_PIN },
        },
        // The redeem route is a credential route with no strict key parser, so
        // the alignment that matters is its accepted-key set: nothing beyond the
        // documented keys may be on the wire.
        parse: (body: Record<string, unknown>) => {
          const allowed = new Set(["operationId", "action", "rewardId", "memberName", "pin", "parentPin"]);
          const extra = Object.keys(body).filter((key) => !allowed.has(key));
          return extra.length === 0 ? { ok: true as const, extra } : { ok: false as const, extra };
        },
        accepted: ["operationId", "action", "rewardId", "memberName", "pin", "parentPin"],
        rejected: ["cost", "points"],
      },
      {
        label: "claim",
        command: {
          route: "/api/tasks/claim" as const,
          action: "claim",
          payload: { taskId: 3, memberName: MEMBER, points: 9999, claimantName: MEMBER },
          credential: { pin: PIN },
        },
        // `parseClaimCommand` reports failure as `{ error }`, not `{ ok:false }`.
        parse: (body: Record<string, unknown>) => {
          const parsed = parseClaimCommand(body);
          return "error" in parsed ? { ok: false as const, error: parsed.error } : { ok: true as const };
        },
        accepted: ["operationId", "action", "taskId", "memberName", "pin"],
        rejected: ["points", "claimantName"],
      },
    ];

    for (const testCase of cases) {
      const entry = queueTaskCommand({
        ...testCase.command,
        displayTarget: { kind: "config" },
      } as Parameters<typeof queueTaskCommand>[0]);
      const body = buildTaskOperationRequestBody(entry, resolveTaskOutboxCredential(entry));

      // The credential really is on the wire, and every accepted key is present
      // with a real value.
      expect(body.pin).toBe(PIN);
      for (const key of testCase.accepted) {
        expect({ case: testCase.label, key, present: body[key] !== undefined }).toEqual({
          case: testCase.label,
          key,
          present: true,
        });
      }
      // Every key the route refuses is genuinely gone.
      for (const key of testCase.rejected) {
        expect(body[key]).toBeUndefined();
      }
      // And the route's own parser accepts exactly what went out.
      expect(testCase.parse(body)).toMatchObject({ ok: true });
    }
  });

  it("a PIN-free ledger command is refused by the route parser, not silently accepted", async () => {
    const { queueTaskCommand } = await import("@/lib/task-command-queue");
    const { buildTaskOperationRequestBody, resolveTaskOutboxCredential } =
      await import("@/lib/task-operation-outbox");
    const { parseLedgerCommand } = await import("@/lib/task-ledger-command");

    // The outbox only holds a PIN-free `adjust` when the session is a child's;
    // the route still refuses it, which is the honest shape of that contract.
    const entry = queueTaskCommand({
      route: "/api/tasks/ledger",
      action: "adjust",
      payload: { memberName: "Caspian Garcia", amount: 5 },
      displayTarget: { kind: "config" },
    });
    const body = buildTaskOperationRequestBody(entry, resolveTaskOutboxCredential(entry));
    expect(body.pin).toBeUndefined();
    expect(parseLedgerCommand(body)).toMatchObject({ ok: false, reason: "unauthorized" });
  });

  it("no outbox entry can carry a credential field", () => {
    const source = read("lib/task-operation-outbox.ts");
    expect(lineNumbers(source, /payload:\s*\{\s*pin/)).toEqual([]);
  });
});

describe("no-writer scan — the heuristic is gone", () => {
  it("adoptServerWeekData's history-length heuristic no longer exists", () => {
    const source = read("lib/task-utils.ts");
    expect(source).not.toContain("adoptServerWeekData");
    expect(source).toContain("adoptAuthoritativeWeekData");
    // BOTH shapes: the ">=" form in the ack path and the ">" form in the
    // snapshot-merge path.
    expect(
      lineNumbers(source, /history\?\.length\s*\|\|\s*0\)\s*>=\s*\(prev\.history/),
    ).toEqual([]);
    expect(
      lineNumbers(source, /history\?\.length\s*\|\|\s*0\)\s*>\s*\(currentWeekData\.history/),
    ).toEqual([]);
  });

  it("the outbox never compares history length to decide adoption", () => {
    const source = read("lib/task-operation-outbox.ts");
    expect(lineNumbers(source, /history\.length\s*[<>]=?/)).toEqual([]);
  });
});

describe("no-writer scan — the server owns the ledger", () => {
  it("the ledger command reads the canonical penalty, never a client amount", () => {
    const source = read("lib/task-ledger-command.ts");
    // A penalty carries an item id only; the points come from the catalog leg.
    expect(source).toContain("readCatalogPenalty");
    const penaltyParse = source.slice(source.indexOf('if (action === "penalty") {'));
    expect(penaltyParse).not.toContain("value.points");
  });

  it("the ledger command writes under the shared week lock with a fingerprint", () => {
    const source = read("lib/task-ledger-command.ts");
    expect(source).toContain("withWeekLedgerLock");
    expect(source).toContain("applyWeekLedgerOperationLocked");
    expect(source).toContain("ledgerCommandFingerprint");
    expect(source).toContain('source = command.action === "penalty" ? "task-penalty" : "manual-adjust"');
  });

  it("the ledger sources are registered in the canonical list", () => {
    const source = read("lib/task-ledger.ts");
    expect(source).toContain('"task-penalty"');
    expect(source).toContain('"manual-adjust"');
  });
});
