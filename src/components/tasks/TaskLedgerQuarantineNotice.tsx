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

async function postQuarantine(mode: QuarantineRequest["mode"], localWeekData: WeekData) {
  const body: QuarantineRequest = { mode, localWeekData };
  const response = await fetch("/api/tasks/quarantine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as QuarantineResponse;
  return json?.ok === true ? json : null;
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
        const json = await postQuarantine("dry-run", localWeekData);
        if (dead || !json) return;
        const count = json.report.quarantined.length;
        if (count === 0) {
          markHandled();
          return;
        }
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
      const json = await postQuarantine("export", localWeekData);
      if (!json) {
        setError("Couldn't write the export file. Try again in a moment.");
        return;
      }
      markHandled();
      setState({ count: json.report.quarantined.length, path: json.path ?? null });
    } catch {
      setError("Couldn't reach Consuela — check the connection and try again.");
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
          <p className="text-sm font-bold text-[var(--color-accent-amber)]">
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
          {error && <p className="mt-1 text-xs text-[var(--color-accent-rose)]">{error}</p>}
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
