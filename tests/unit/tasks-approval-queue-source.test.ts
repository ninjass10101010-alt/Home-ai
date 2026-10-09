// @vitest-environment node
// F2 — the approval queue reads the SUBSTITUTED rows.
//
// The approval queue was the ONE array on /tasks that bypassed the substituted
// source every other surface reads (`page.tsx:2116-2119` at B2's tip). `tasks`
// is the raw server array; `interactiveRows` is the server's rows with a
// queued edit's copy substituted in and a queued delete's row already hidden.
//
// This is a SOURCE contract, not a render test, and deliberately so: with
// today's UI a completed pending-approval row cannot be edited or deleted
// (both are gated behind `startEdit`, reachable only from `pending.map`, while
// `isPendingApproval` requires `completed`), so no tap sequence — and no
// fixture — can produce the divergence. The bug is the call site's SOURCE.
//
// B1a's live hazard one level up — approve-all's `taskIds` including a
// queued-deleted id — is ALREADY FIXED in `page.tsx` by B1a's own
// `!optimisticRemoved.includes(...)` filter. F2 must not touch or duplicate
// it; this suite pins that it survives unchanged. F2's source change
// incidentally removes queued-deleted ids from `taskIds` (interactiveRows is
// built from serverTasks), but the CONTRACT for that id set is B1a's.
//
// One deliberate deviation from the plan's literal Step 1.2: the two
// `target` lookups inside `submitApproval` read `pendingApprovals` (the
// substituted queue) rather than `interactiveRows` directly. That closure is
// declared ABOVE the `interactiveRows` memo, and capturing a useMemo from an
// earlier closure makes the React Compiler bail out with
// `react-hooks/preserve-manual-memoization` on every existing memo in the
// component (8 findings, measured). `pendingApprovals` is
// `interactiveRows.filter(isPendingApproval)` — the same substituted source —
// and the plan's own `taskIds` arm already reads it this way. The render-time
// PIN dialog sits AFTER the memo, so it reads `interactiveRows` directly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const source = readFileSync(join(process.cwd(), "src/app/tasks/page.tsx"), "utf8");

function lineNumbers(pattern: RegExp): number[] {
  return source
    .split("\n")
    .flatMap((line, index) => (pattern.test(line) ? [index + 1] : []));
}

describe("approval-queue source contract — the substituted source", () => {
  it("reads no pending-approval row from the raw tasks array", () => {
    expect(lineNumbers(/tasks\.filter\(isPendingApproval\)/)).toEqual([]);
  });

  it("resolves no approval target from the raw tasks array", () => {
    expect(lineNumbers(/tasks\.find\(\(x\) => x\.id === approvalTaskId\)/)).toEqual([]);
  });

  it("builds the queue from interactiveRows, not some other array", () => {
    expect(source).toContain("interactiveRows.filter(isPendingApproval)");
  });

  it("resolves the command arms and the dialog from the substituted queue", () => {
    // Two lookups inside `submitApproval` (declared above the memo — see the
    // header) read the queue itself; the render-time dialog reads the memo.
    // Neither can be raw `tasks`.
    expect(source).toContain("pendingApprovals.find((x) => x.id === approvalTaskId)");
    expect(source).toContain("interactiveRows.find((x) => x.id === approvalTaskId)");
    expect(source).not.toContain("tasks.find((x) => x.id === approvalTaskId)");
  });
});

describe("approval-queue source contract — the premises the fix relies on", () => {
  it("serverTasks already excludes every queued-removed id", () => {
    // `interactiveRows` is built from `serverTasks`, so F2's queue does not
    // need its own hidden-id filter — but only because of THIS line.
    const serverTasks = source.slice(
      source.indexOf("const serverTasks ="),
      source.indexOf("const serverTasks =") + 220,
    );
    expect(serverTasks).toContain("!optimisticRemoved.includes(t.id)");
  });

  it("optimisticUpdates is de-duplicated LAST-WINS by id", () => {
    // Otherwise a doubly-queued edit could put one chore in the queue twice,
    // and approve-all would send the same id twice in `taskIds`.
    const block = source.slice(source.indexOf("const optimisticUpdates ="));
    expect(block.slice(0, 260)).toContain("new Map<number, Task>()");
    expect(block.slice(0, 260)).toContain("byId.set(row.task.id, row.task)");
  });
});

describe("approval-queue source contract — behaviours the fix must not change", () => {
  it("keeps the approval card independent of the member filter", () => {
    const at = source.indexOf("const pendingApprovals =");
    expect(at).toBeGreaterThanOrEqual(0);
    const line = source.slice(at, source.indexOf("\n", at));
    expect(line).not.toMatch(/filterMember|memberScoped|\bfiltered\b/);
  });

  it("leaves approve-all's taskIds selection to B1a, filter intact", () => {
    // B1a owns the id set, including its obligation to exclude queued-deleted
    // rows. F2 must not alter it; this pins B1a's landed shape so a later
    // edit — F2's or anyone's — that drops the filter fails loudly.
    const selection = source.slice(source.indexOf("const taskIds = pendingApprovals"));
    const head = selection.slice(0, 200);
    expect(head).toContain("pendingApprovals");
    expect(head).toContain("!optimisticRemoved.includes(p.id)");
    expect(head).toContain(".map((p) => p.id)");
  });
});
