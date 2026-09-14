"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import WidgetCard from "@/components/patterns/WidgetCard";
import SoftButton from "@/components/ui/SoftButton";
import Modal from "@/components/ui/Modal";
import Skeleton from "@/components/ui/Skeleton";
import Toast from "@/components/ui/Toast";
import { useAuth } from "@/hooks/useAuth";
import { verifyPinRemote, unreachableCopy } from "@/modes/kid/kid-store";

// Task 11 — "Consuela's week": grounded weekly planning for parents on the
// Calendar tab. Reads the schedule_week planner (Task 9, zero tools, nothing
// written), then offers PIN-gated "Add to calendar" per proposed buffer via
// POST /api/consuela/planner/apply. The PIN goes through the shared server
// seam (verifyPinRemote is THE PIN seam) and is never persisted; closing the
// modal clears it.

export interface PlannerConflict {
  title: string;
  message: string;
}

export interface PlannerBuffer {
  title: string;
  start: string;
  end: string;
}

export interface WeekPlan {
  conflicts: PlannerConflict[];
  buffers: PlannerBuffer[];
  suggestions: string[];
}

// Pure buffer-ISO → add_event args. "2026-09-11T14:30" (validator-guaranteed
// local ISO, space separator tolerated, seconds trimmed) → {date, time}; a
// bare date yields no time key so the tool keeps its own default.
export function bufferToAddEventArgs(b: PlannerBuffer): { title: string; date: string; time?: string } {
  const [date, rest] = String(b.start).split(/[T ]/);
  const args: { title: string; date: string; time?: string } = { title: b.title, date };
  if (rest) args.time = rest.slice(0, 5);
  return args;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function timeOf(iso: string): string {
  const rest = String(iso).split(/[T ]/)[1];
  return rest ? rest.slice(0, 5) : "";
}

function dateOf(iso: string): string {
  const parts = String(iso).split("T")[0].split(/[ -]/).map(Number);
  if (parts.length >= 3 && parts[1] >= 1 && parts[1] <= 12) return `${MONTH_LABELS[parts[1] - 1]} ${parts[2]}`;
  return String(iso).slice(0, 10);
}

type Status = "idle" | "loading" | "ok" | "empty" | "error";

const MONTH_KICKER = "text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary";

export default function ConsuelaWeekCard() {
  const { currentUser } = useAuth();
  const [status, setStatus] = useState<Status>("idle");
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addedBuffers, setAddedBuffers] = useState<Record<number, true>>({});

  const [applyIdx, setApplyIdx] = useState<number | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  const reviewWeek = useCallback(async () => {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/hermes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "planner", intent: "schedule_week" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setStatus("error");
        setErrorMsg("Couldn't reach Consuela's planner — check the connection and try again.");
        return;
      }
      const r = data.result ?? {};
      const next: WeekPlan = {
        conflicts: Array.isArray(r.conflicts) ? r.conflicts : [],
        buffers: Array.isArray(r.buffers) ? r.buffers : [],
        suggestions: Array.isArray(r.suggestions) ? r.suggestions : [],
      };
      setPlan(next);
      setAddedBuffers({});
      const calm = !next.conflicts.length && !next.buffers.length && !next.suggestions.length;
      setStatus(calm ? "empty" : "ok");
    } catch {
      setStatus("error");
      setErrorMsg("Couldn't reach Consuela's planner — check the connection and try again.");
    }
  }, []);

  const closePin = useCallback(() => {
    // PIN cleared on close (repo rule): the typed code never outlives the dialog.
    setApplyIdx(null);
    setPinValue("");
    setPinError(null);
    setPinBusy(false);
  }, []);

  const submitPin = useCallback(async () => {
    if (applyIdx === null || pinBusy) return;
    const pin = pinValue;
    setPinValue("");
    if (pin.length < 4 || !currentUser) return;
    setPinBusy(true);
    setPinError(null);
    const verify = await verifyPinRemote(currentUser.name, pin);
    if (verify.status !== "ok") {
      setPinBusy(false);
      setPinError(verify.status === "unreachable" ? unreachableCopy() : "Wrong PIN. Try again.");
      return;
    }
    const buffer = plan?.buffers[applyIdx];
    if (!buffer) {
      setPinBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/consuela/planner/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-consuela-pin": pin },
        body: JSON.stringify({ tool: "add_event", args: bufferToAddEventArgs(buffer) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setPinBusy(false);
        setPinError("Wrong PIN. Try again.");
        return;
      }
      if (!res.ok || !data.ok) {
        setPinBusy(false);
        setPinError(String(data.error || "Could not add the event."));
        return;
      }
      const idx = applyIdx;
      setAddedBuffers((prev) => ({ ...prev, [idx]: true }));
      closePin();
      showToast("✅ Added to calendar");
    } catch {
      setPinBusy(false);
      setPinError(unreachableCopy());
    }
  }, [applyIdx, pinBusy, pinValue, currentUser, plan, closePin, showToast]);

  if (currentUser?.role !== "parent") return null;

  const openApply = (i: number) => {
    setApplyIdx(i);
    setPinValue("");
    setPinError(null);
    setPinBusy(false);
  };

  const askHref = (question: string) => `/chat?q=${encodeURIComponent(question)}`;

  return (
    <WidgetCard tone="#8b5cf6" icon={<span aria-hidden="true">{`\uD83E\uDDE0`}</span>}>
      <div className="calendar-panel-header">
        <div className="calendar-panel-heading">
          <div className="calendar-panel-icon">{`\uD83D\uDDD3\uFE0F`}</div>
          <div>
            <h3 className="calendar-panel-title">{"Consuela's week"}</h3>
            <p className="calendar-panel-subtitle">
              {"Reads this week's calendar; writes nothing without your PIN."}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3">
        {status === "idle" && (
          <SoftButton size="md" className="w-full min-h-[44px]" onClick={() => void reviewWeek()}>
            Review the week
          </SoftButton>
        )}

        {status === "loading" && (
          <div className="space-y-2" role="status" aria-label="Consuela is reviewing the week">
            <Skeleton variant="text" className="w-3/4" />
            <Skeleton variant="text" className="w-full" />
            <Skeleton variant="text" className="w-2/3" />
          </div>
        )}

        {status === "error" && (
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">{errorMsg}</p>
            <SoftButton size="md" variant="secondary" className="min-h-[44px]" onClick={() => void reviewWeek()}>
              Try again
            </SoftButton>
          </div>
        )}

        {status === "empty" && (
          <p className="text-sm text-text-secondary">No conflicts this week — the calendar looks calm.</p>
        )}

        {status === "ok" && plan && (
          <div className="space-y-4">
            {plan.conflicts.length > 0 && (
              <div className="space-y-2">
                <p className={MONTH_KICKER}>Conflicts</p>
                {plan.conflicts.map((c, i) => (
                  <div
                    key={`c${i}`}
                    className="rounded-2xl border-l-2 px-4 py-3"
                    style={{
                      borderColor: "var(--color-accent-rose)",
                      background: "color-mix(in srgb, var(--color-accent-rose) 8%, transparent)",
                    }}
                  >
                    <p className="text-sm font-semibold text-text-primary break-words">{c.title}</p>
                    <p className="text-xs text-text-secondary break-words">{c.message}</p>
                    <Link
                      href={askHref(`Why is "${c.title}" a conflict?`)}
                      className={`${MONTH_KICKER} tap-sm mt-1 inline-block widget-accent-text`}
                    >
                      Ask about this →
                    </Link>
                  </div>
                ))}
              </div>
            )}

            {plan.buffers.length > 0 && (
              <div className="space-y-2">
                <p className={MONTH_KICKER}>Protected buffers</p>
                {plan.buffers.map((b, i) => (
                  <div
                    key={`b${i}`}
                    className="rounded-2xl border-l-2 px-4 py-3"
                    style={{
                      borderColor: "var(--color-accent-mint)",
                      background: "color-mix(in srgb, var(--color-accent-mint) 8%, transparent)",
                    }}
                  >
                    <p className="text-sm font-semibold text-text-primary break-words">{b.title}</p>
                    <p className="text-xs text-text-secondary">
                      {dateOf(b.start)} · {timeOf(b.start)} → {timeOf(b.end)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {addedBuffers[i] ? (
                        <SoftButton size="md" variant="success" disabled className="min-h-[44px]">
                          Added ✓
                        </SoftButton>
                      ) : (
                        <SoftButton size="md" className="min-h-[44px]" onClick={() => openApply(i)}>
                          Add to calendar
                        </SoftButton>
                      )}
                      <Link
                        href={askHref(`What should I know about the "${b.title}" buffer?`)}
                        className={`${MONTH_KICKER} tap-sm widget-accent-text`}
                      >
                        Ask about this →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {plan.suggestions.length > 0 && (
              <div className="space-y-2">
                <p className={MONTH_KICKER}>Planning notes</p>
                {plan.suggestions.map((s, i) => (
                  <div key={`s${i}`} className="rounded-2xl bg-[var(--color-surface-2)]/60 px-4 py-3">
                    <p className="text-sm text-text-primary break-words">{s}</p>
                    <Link
                      href={askHref(`Tell me more about your plan: ${s}`)}
                      className={`${MONTH_KICKER} tap-sm mt-1 inline-block widget-accent-text`}
                    >
                      Ask about this →
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mounted with the open flag — never conditionally mount the Modal
          wrapper, so its exit animation can play (repo contract). */}
      <Modal
        open={applyIdx !== null}
        onClose={closePin}
        title="Enter a PIN"
        description="Adding to the calendar is protected. Enter your 4-digit PIN to continue."
        footer={
          <>
            <SoftButton
              onClick={() => void submitPin()}
              disabled={pinValue.length < 4 || pinBusy}
              className="flex-1"
            >
              Submit
            </SoftButton>
            <SoftButton variant="secondary" onClick={closePin} className="flex-1">
              Cancel
            </SoftButton>
          </>
        }
      >
        <div className="space-y-4">
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pinValue}
            onChange={(e) => setPinValue(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pinValue.length >= 4) void submitPin();
            }}
            placeholder="4-digit PIN"
            autoFocus
            className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
          />
          {pinError && (
            <p role="status" className="text-center text-sm text-[var(--color-accent-rose)]">
              {pinError}
            </p>
          )}
        </div>
      </Modal>

      <Toast open={toast !== null} tone="success">
        {toast}
      </Toast>
    </WidgetCard>
  );
}
