// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import TaskLedgerQuarantineNotice from "@/components/tasks/TaskLedgerQuarantineNotice";
import type { Transaction, WeekData } from "@/types/tasks";

const NOTICE_TESTID = "task-ledger-quarantine-notice";
const EXPORT_LABEL = "Export unmatched local ledger rows";
const DISMISS_LABEL = "Dismiss the local ledger quarantine notice";
const HANDLED_KEY = "consuela-ledger-quarantine-handled-v1";

const localWeekData: WeekData = {
  weekStart: "2026-09-21",
  points: { Alex: 5 },
  streak: {},
  lastActive: {},
  history: [
    {
      id: 7,
      timestamp: "2026-09-22T10:00:00.000Z",
      member: "Alex",
      type: "earn",
      amount: 5,
      description: "Completed: Dishes",
      taskId: 42,
    },
  ] satisfies Transaction[],
};

function report(quarantined: number) {
  return {
    version: 1 as const,
    generatedAt: "2026-09-24T12:00:00.000Z",
    localWeekStart: "2026-09-21",
    canonicalWeekStart: "2026-09-21",
    exactMatches: [],
    semanticMatches: [],
    quarantined: Array.from({ length: quarantined }, (_value, index) => ({
      id: 100 + index,
      timestamp: "2026-09-23T10:00:00.000Z",
      member: "Alex",
      type: "earn" as const,
      amount: 3,
      description: "Completed: Leftover",
    })),
  };
}

const fetchMock = vi.hoisted(() => vi.fn());
(globalThis as any).fetch = fetchMock;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function render(ui: React.ReactNode) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(ui);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return el;
}

async function press(el: HTMLElement, label: string) {
  const button = el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  fetchMock.mockReset();
});

describe("TaskLedgerQuarantineNotice", () => {
  it("stays silent and never asks the server for a non-parent session", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, mode: "dry-run", report: report(2) }));
    const el = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent={false} />);

    expect(el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the unmatched count to a parent", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, mode: "dry-run", report: report(2) }));
    const el = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);

    const notice = el.querySelector(`[data-testid="${NOTICE_TESTID}"]`);
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("2");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as any).body)).toMatchObject({
      mode: "dry-run",
      localWeekData: { weekStart: "2026-09-21" },
    });
  });

  it("renders nothing when every local transaction is already accounted for", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, mode: "dry-run", report: report(0) }));
    const el = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);

    expect(el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).toBeNull();
  });

  it("leaves the notice armed after an empty dry run so a later unmatched row still surfaces", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, mode: "dry-run", report: report(0) }));
    const el = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);

    expect(el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).toBeNull();
    expect(localStorage.getItem(HANDLED_KEY)).toBeNull();

    fetchMock.mockResolvedValue(jsonResponse({ ok: true, mode: "dry-run", report: report(2) }));
    const later = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);

    const notice = later.querySelector(`[data-testid="${NOTICE_TESTID}"]`);
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("2");
  });

  it("shows the exported path once and never offers the notice again", async () => {
    const path = "/srv/dashboard/local-quarantine/task-ledger-2026-09-24T12-00-00-000Z.json";
    fetchMock.mockImplementation(async (_url: string, init: any) =>
      jsonResponse(JSON.parse(init.body).mode === "export"
        ? { ok: true, mode: "export", report: report(2), path }
        : { ok: true, mode: "dry-run", report: report(2) }),
    );

    const el = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);
    await press(el, EXPORT_LABEL);

    expect(el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)!.textContent).toContain(path);

    const again = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);
    expect(again.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).toBeNull();
  });

  it("does not come back after a parent dismisses it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, mode: "dry-run", report: report(3) }));
    const el = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);
    await press(el, DISMISS_LABEL);

    expect(el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).toBeNull();
    const again = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);
    expect(again.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).toBeNull();
  });

  it("keeps the notice and explains a failed export without marking it handled", async () => {
    fetchMock.mockImplementation(async (_url: string, init: any) => {
      if (JSON.parse(init.body).mode === "export") return { ok: false, status: 500, json: async () => ({}) };
      return jsonResponse({ ok: true, mode: "dry-run", report: report(1) });
    });

    const el = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);
    await press(el, EXPORT_LABEL);

    expect(el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).not.toBeNull();
    expect(el.textContent).toMatch(/couldn.t write/i);
    const again = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);
    expect(again.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).not.toBeNull();
  });

  it("asks only once per mount", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, mode: "dry-run", report: report(1) }));
    const el = await render(<TaskLedgerQuarantineNotice localWeekData={localWeekData} isParent />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).not.toBeNull();
  });
});
