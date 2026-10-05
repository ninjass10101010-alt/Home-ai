"use client";

import { useEffect, useRef, useState } from "react";
import SoftButton from "@/components/ui/SoftButton";
import Surface from "@/components/ui/Surface";
import type { QuarantineRequest, QuarantineResponse } from "@/lib/task-ledger-quarantine";
import type { WeekData } from "@/types/tasks";

const HANDLED_KEY = "consuela-ledger-quarantine-handled-v1";

interface QuarantineNoticeState {
  count: number;
  path: string | null;
}

function alreadyHandled(): boolean {
  try {
    return window.localStorage.getItem(HANDLED_KEY) !== null;
  } catch {
    return false;
  }
}

function markHandled(): void {
  try {
    window.localStorage.setItem(HANDLED_KEY, new Date().toISOString());
  } catch {
    return;
  }
}

/**
 * The stored week key must be SHAPE-valid AND round-trip through `Date` —
 * `2026-13-45` matches the regex and is not a week. Mirrors the server's
 * `isCanonicalWeekKey`, which lives in a route this component cannot import.
 */
const WEEK_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function isRealWeekKey(value: unknown): value is string {
  if (typeof value !== "string" || !WEEK_KEY_SHAPE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * An unknown canonical week is a NAMED state, not an error and not a zero.
 * `/api/tasks/quarantine` answers 409 `canonical_week_unknown` for a week key it
 * holds no row for. It used to answer those with an EMPTY canonical ledger
 * instead, which told a device whose stored `weekStart` was not byte-identical
 * to a server row that the family had earned nothing that week — and this
 * notice then rendered that as "N old entries on this device are not on the
 * server", a confident WRONG verdict that pushed a parent to export and
 * dismiss real history.
 */
type QuarantineOutcome =
  | { kind: "report"; response: QuarantineResponse }
  | { kind: "unknown-week" }
  | { kind: "unavailable" }
  | { kind: "unreachable" };

async function postQuarantine(mode: QuarantineRequest["mode"], localWeekData: WeekData): Promise<QuarantineOutcome> {
  const body: QuarantineRequest = { mode, localWeekData };
  try {
    const response = await fetch("/api/tasks/quarantine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 409) return { kind: "unknown-week" };
    if (!response.ok) return { kind: "unavailable" };
    const json = (await response.json()) as QuarantineResponse;
    // The claim is only readable against a REAL canonical week. A 200 whose
    // report carries a null/blank/impossible week key is an unknown, and the
    // route's own note is explicit that "a future 200-with-empty-report here
    // would silently restore the false claim" — so the client is the second
    // gate, not just the reader of a 409.
    if (json?.ok !== true || !json.report || !isRealWeekKey(json.report.canonicalWeekStart)) {
      return { kind: "unknown-week" };
    }
    return { kind: "report", response: json };
  } catch {
    return { kind: "unreachable" };
  }
}

export default function TaskLedgerQuarantineNotice({
  localWeekData,
  isParent,
}: {
  localWeekData: WeekData;
  isParent: boolean;
}) {
  const [state, setState] = useState<QuarantineNoticeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const askedRef = useRef(false);

  useEffect(() => {
    if (!isParent || askedRef.current || alreadyHandled()) return;
    askedRef.current = true;
    let dead = false;
    void (async () => {
      try {
        const outcome = await postQuarantine("dry-run", localWeekData);
        if (dead || outcome.kind !== "report") return;
        const count = outcome.response.report.quarantined.length;
        if (count === 0) return;
        setState({ count, path: null });
      } catch {
        return;
      }
    })();
    return () => {
      dead = true;
    };
  }, [isParent, localWeekData]);

  if (!isParent || !state) return null;

  const runExport = async () => {
    setBusy(true);
    setError(null);
    try {
      // `postQuarantine` never throws: it resolves an outcome, so an unknown
      // week, a failed write and an unreachable server are three DIFFERENT
      // messages rather than one "something went wrong".
      const outcome = await postQuarantine("export", localWeekData);
      if (outcome.kind === "unknown-week") {
        // Nothing was compared, so nothing was written: "we couldn't confirm
        // this week" is the only honest thing to say. Never marked handled —
        // the parent's rows are exactly where they were.
        setError(
          "Consuela couldn't confirm this week on the server, so there is nothing to compare these entries against yet. Nothing was changed or deleted.",
        );
        return;
      }
      if (outcome.kind !== "report") {
        setError(
          outcome.kind === "unreachable"
            ? "Couldn't reach Consuela — check the connection and try again."
            : "Couldn't write the export file. Try again in a moment.",
        );
        return;
      }
      markHandled();
      setState({ count: outcome.response.report.quarantined.length, path: outcome.response.path ?? null });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    markHandled();
    setState(null);
  };

  return (
    <Surface
      variant="warm"
      radius="2xl"
      padding="md"
      className="border border-[var(--color-accent-amber)]/30"
      data-testid="task-ledger-quarantine-notice"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden="true">🗄️</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--color-accent-ink-amber)]">
            {state.count} old {state.count === 1 ? "entry" : "entries"} on this device
            {state.count === 1 ? "" : "ies"} {state.count === 1 ? "is" : "are"} not on the server
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Nothing was sent to the server. Export them to a file to look over, or leave them
            where they are.
          </p>
          {state.path && (
            <p className="mt-1 break-all text-xs text-text-secondary">
              Saved to <span className="text-text-primary">{state.path}</span>
            </p>
          )}
          {error && <p className="mt-1 text-xs text-[var(--color-accent-ink-rose)]">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!state.path && (
              <SoftButton
                size="sm"
                loading={busy}
                aria-label="Export unmatched local ledger rows"
                onClick={() => {
                  void runExport();
                }}
              >
                Export to a file
              </SoftButton>
            )}
            <SoftButton
              size="sm"
              variant="ghost"
              aria-label="Dismiss the local ledger quarantine notice"
              onClick={dismiss}
            >
              {state.path ? "Done" : "Not now"}
            </SoftButton>
          </div>
        </div>
      </div>
    </Surface>
  );
}
