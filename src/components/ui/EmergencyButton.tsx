"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import { useWallMode } from "@/hooks/useWallMode";

interface EmergencyButtonProps {
  className?: string;
}

const emergencyTypes = [
  { id: "fire", label: "Fire", icon: "🔥" },
  { id: "water", label: "Water Leak", icon: "💧" },
  { id: "injury", label: "Injury", icon: "🤕" },
  { id: "general", label: "General", icon: "🚨" },
];

type ContactsSource = "live" | "cache";

interface EmergencyResultDetails {
  successful: number;
  total: number;
  failed?: number;
  partial?: boolean;
  contactsSource?: ContactsSource;
  houseAlert?: { sent: number; failed: number; notes: string[] };
}

interface EmergencyResult {
  success: boolean;
  partial: boolean;
  message: string;
  contactsSource?: ContactsSource;
  details?: EmergencyResultDetails;
  /** Server-declared cooldown (ms) — the retry button stays inert until it elapses. */
  retryAfterMs?: number;
}

const GENERIC_FAILURE_COPY =
  "Emergency alert failed. Please try again or call emergency services directly.";

// Route error codes the emergency routes can return, in human words. A parent
// in a real emergency must never read a snake_case code off the result screen,
// so any code-shaped error that has no human `message` beside it is translated
// here instead of rendered verbatim.
const EMERGENCY_ERROR_COPY: Record<string, string> = {
  emergency_cooldown: "An emergency alert was sent recently. Wait a moment before trying again.",
  emergency_in_flight: "An emergency alert is already sending. Wait for it to finish before trying again.",
  pin_check_failed: "Could not check the family PIN. Please try again or call emergency services directly.",
  contacts_unavailable: "Emergency contacts could not be read. No alert was sent — please call emergency services directly.",
  delivery_failed: "No emergency channel confirmed delivery. Please call emergency services directly.",
  service_not_configured: "SMS and email are not configured for alerts. Please call emergency services directly.",
  config_resolution_failed: "SMS and email could not be configured. Please call emergency services directly.",
};

// machine_code / machineCode / machine_code_with_digits — anything shaped like
// an internal identifier rather than a sentence.
const ERROR_CODE_SHAPE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.ceil(value), 10 * 60_000);
}

function humanizeError(error: unknown, retryAfterMs?: number): string | undefined {
  if (typeof error !== "string") return undefined;
  const text = error.trim();
  if (!text) return undefined;
  // A human sentence from the route ("Invalid PIN") is already copy.
  if (!ERROR_CODE_SHAPE.test(text)) return text;
  if (text === "emergency_cooldown" && retryAfterMs) {
    return `An emergency alert was sent recently. Wait ${Math.ceil(retryAfterMs / 1000)} seconds before trying again.`;
  }
  return EMERGENCY_ERROR_COPY[text] ?? GENERIC_FAILURE_COPY;
}

function parseContactsSource(value: unknown): ContactsSource | undefined {
  return value === "live" || value === "cache" ? value : undefined;
}

function parseEmergencyDetails(value: unknown): EmergencyResultDetails | undefined {
  if (!isRecord(value)) return undefined;
  const successful = value.successful;
  const total = value.total;
  const failed = value.failed;
  const contactsSource = parseContactsSource(value.contactsSource);
  const houseValue = value.houseAlert;
  const houseAlert = isRecord(houseValue)
    && typeof houseValue.sent === "number"
    && typeof houseValue.failed === "number"
    && Array.isArray(houseValue.notes)
    && houseValue.notes.every((note) => typeof note === "string")
    ? { sent: houseValue.sent, failed: houseValue.failed, notes: houseValue.notes }
    : undefined;
  if (typeof successful !== "number" || typeof total !== "number") {
    if (!houseAlert) return undefined;
    return {
      successful: 0,
      total: 0,
      houseAlert,
      ...(contactsSource ? { contactsSource } : {}),
    };
  }
  return {
    successful,
    total,
    ...(typeof failed === "number" ? { failed } : {}),
    ...(value.partial === true ? { partial: true } : {}),
    ...(contactsSource ? { contactsSource } : {}),
    ...(houseAlert ? { houseAlert } : {}),
  };
}

export default function EmergencyButton({ className = "" }: EmergencyButtonProps) {
  const { wall } = useWallMode();
  const [showModal, setShowModal] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<EmergencyResult | null>(null);
  const [pinInput, setPinInput] = useState("");
  const pinReady = /^\d{4}$/.test(pinInput);
  const primaryActionRef = useRef<HTMLButtonElement | null>(null);
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  const retryFocusRef = useRef(false);
  const sendingRef = useRef(false);
  const [retrySeconds, setRetrySeconds] = useState(0);

  // The route's cooldown is honored in real time: the remaining seconds drive
  // both the on-screen notice and whether Try Again may re-submit, so a parent
  // cannot hammer the 30s guard while an alert is already going out.
  const retryBlocked = retrySeconds > 0;

  // When the result screen replaces the type picker, move focus to its primary
  // action so the dialog's focus trap keeps a live target inside the panel.
  // "Try Again" unmounts that button while the dialog stays open — hand focus
  // to the PIN input instead of letting activeElement fall to body.
  useEffect(() => {
    if (result) {
      primaryActionRef.current?.focus();
    } else if (retryFocusRef.current) {
      retryFocusRef.current = false;
      pinInputRef.current?.focus();
    }
  }, [result]);

  // Count the cooldown down once a second while it is on screen.
  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = setInterval(() => setRetrySeconds((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [retrySeconds]);

  const closeFlow = () => {
    if (isSending || sendingRef.current) return;
    setShowModal(false);
    setSelectedType(null);
    setResult(null);
    setRetrySeconds(0);
    // The PIN lives in memory only — drop it as soon as the dialog closes.
    setPinInput("");
  };

  const handleEmergency = async (type: string) => {
    // The PIN is typed by the user here and verified server-side against
    // PocketBase — the client never stores or carries a copy of it.
    if (!pinReady || sendingRef.current) return;
    sendingRef.current = true;
    setSelectedType(type);
    setIsSending(true);
    setResult(null);
    setRetrySeconds(0);

    try {
      const response = await fetch("/api/emergency", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-emergency-pin": pinInput,
        },
        body: JSON.stringify({ type, timestamp: new Date().toISOString(), pin: pinInput }),
      });

      const data = await response.json() as unknown;
      const payload = isRecord(data) ? data : null;
      const responseStatus = typeof response.status === "number"
        ? response.status
        : response.ok ? 200 : 500;
      const details = parseEmergencyDetails(payload?.details);
      const contactsSource = parseContactsSource(payload?.contactsSource) ?? details?.contactsSource;
      const retryAfterMs = parseRetryAfterMs(payload?.retryAfterMs);
      const success = response.ok !== false
        && responseStatus >= 200
        && responseStatus < 300
        && payload?.success === true;
      const partial = success && (payload?.partial === true || details?.partial === true);
      if (success) {
        setResult({
          success: true,
          partial,
          contactsSource,
          message: typeof payload?.message === "string" ? payload.message : "Emergency alert sent.",
          details,
        });
      } else {
        // The route's human `message` always wins; `error` is only consulted
        // when there is no message, and a code-shaped error is translated into
        // a sentence rather than shown to a parent mid-emergency.
        const message = typeof payload?.message === "string" && payload.message.trim()
          ? payload.message
          : responseStatus >= 200 && responseStatus < 300
            ? "Emergency service returned an invalid result. Please try again or call emergency services directly."
            : humanizeError(payload?.error, retryAfterMs) ?? GENERIC_FAILURE_COPY;
        setResult({
          success: false,
          partial: false,
          contactsSource,
          message,
          details,
          ...(retryAfterMs ? { retryAfterMs } : {}),
        });
        if (retryAfterMs) setRetrySeconds(Math.ceil(retryAfterMs / 1000));
      }
    } catch (error) {
      console.error("Emergency alert failed:", error);
      setResult({
        success: false,
        partial: false,
        message: "Network error - emergency alert may not have been sent. Please try again or call emergency services directly."
      });
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  const resultColor = result?.success
    ? result.partial ? "var(--color-accent-amber)" : "var(--color-accent-mint)"
    : "var(--color-accent-rose)";

  return (
    <>
      {/* Alarm surface: locked to the rose token (AGENTS.md reserves rose for
          alarm semantics), never the seasonal accent, and ≥44px. */}
      <button
        onClick={() => setShowModal(true)}
        className={`fixed top-4 right-4 z-50 flex ${wall ? "h-16 w-16" : "h-11 w-11"} items-center justify-center rounded-full bg-[var(--color-accent-rose)] text-white hover:opacity-90 tap ${className}`}
        style={{ boxShadow: "0 0 24px color-mix(in srgb, var(--color-accent-rose) 35%, transparent)" }}
        aria-label="Emergency"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
          <path d="M12 2L4 7v6c0 5 3.5 9.7 8 11 4.5-1.3 8-6 8-11V7l-8-5z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 8v4M12 16h.01" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <Modal open={showModal} onClose={closeFlow} title="Emergency">
        {result ? (
          // Result screen — persistent until an explicit Done (no auto-close:
          // a 3s vanishing confirmation is the worst place to lose your place).
          <div className="text-center" role="status">
            <div
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
              style={{
                background: `color-mix(in srgb, ${resultColor} 15%, transparent)`,
                color: resultColor,
              }}
            >
              {result.success ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <p
              className="mb-2 text-base font-semibold"
              style={{ color: resultColor }}
            >
              {result.success ? result.partial ? "Alert Partially Sent" : "Alert Sent" : "Alert Failed"}
            </p>
            <p className="mb-4 text-sm text-text-secondary">{result.message}</p>
            {retryBlocked ? (
              <p
                role="alert"
                className="mb-3 rounded-2xl border border-[var(--color-accent-amber)]/30 bg-[var(--color-accent-amber)]/10 p-3 text-sm font-semibold text-[var(--color-accent-amber)]"
              >
                You can try again in {retrySeconds} second{retrySeconds === 1 ? "" : "s"}.
              </p>
            ) : null}
            {result.contactsSource === "cache" ? (
              <p
                role="alert"
                className="mb-3 rounded-2xl border border-[var(--color-accent-amber)]/30 bg-[var(--color-accent-amber)]/10 p-3 text-sm font-semibold text-[var(--color-accent-amber)]"
              >
                Warning: stale cached contacts were used. Recipients may be out of date; verify them before retrying.
              </p>
            ) : null}
            {result.success && result.details ? (
              <div className="mb-3 space-y-1 text-sm text-text-primary">
                <p className="font-medium">
                  {result.partial
                    ? `Primary contacts: ${result.details.successful} of ${result.details.total} confirmed.`
                    : `Sent to ${result.details.successful} of ${result.details.total} contacts`}
                </p>
                {result.details.houseAlert ? (
                  <p>
                    House channels: {result.details.houseAlert.sent} sent, {result.details.houseAlert.failed} failed.
                    {result.details.houseAlert.notes.length > 0 ? ` Notes: ${result.details.houseAlert.notes.join("; ")}` : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="mb-4 text-xs text-text-secondary">
              If this is a life-threatening emergency, call 911.
            </p>
            {result.success ? (
              <button
                ref={primaryActionRef}
                onClick={closeFlow}
                className="min-h-[44px] w-full rounded-2xl bg-[color-mix(in_srgb,var(--color-accent-selected)_60%,black)] px-3 py-2 text-sm font-semibold text-white tap"
              >
                Done
              </button>
            ) : (
              <button
                ref={primaryActionRef}
                onClick={() => {
                  // Server-declared cooldown still running — refuse to re-send
                  // rather than spend the parent's tap on a guaranteed 429.
                  if (retryBlocked) return;
                  // Drop the stale PIN too — a failed send must not leave the
                  // credential sitting in the field for the next attempt.
                  retryFocusRef.current = true;
                  setResult(null);
                  setPinInput("");
                }}
                aria-disabled={retryBlocked ? "true" : undefined}
                className="min-h-[44px] w-full rounded-2xl px-3 py-2 text-sm font-medium tap"
                style={{
                  background: "color-mix(in srgb, var(--color-accent-rose) 15%, transparent)",
                  color: "var(--color-accent-rose)",
                }}
              >
                Try Again
              </button>
            )}
          </div>
        ) : (
          // Emergency type selection
          <>
            <input
              ref={pinInputRef}
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Family PIN"
              aria-label="Family PIN"
              disabled={isSending}
              className="mb-3 w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-2 text-center text-xl tracking-[0.5em] text-text-primary outline-none placeholder:tracking-normal placeholder:text-text-muted focus:border-[color-mix(in_srgb,var(--color-accent-rose)_50%,transparent)] disabled:opacity-50"
            />
            {!pinReady && (
              <p className="text-text-muted text-xs text-center -mt-2 mb-3">Enter any family member&apos;s 4-digit PIN</p>
            )}
            <div className="space-y-2">
              {emergencyTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleEmergency(type.id)}
                  disabled={isSending || !pinReady}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-text-primary transition-all hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none min-h-[44px]"
                  style={{ background: "color-mix(in srgb, var(--color-accent-rose) 10%, transparent)" }}
                >
                  {isSending && selectedType === type.id ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-lg">{type.icon}</span>
                  )}
                  <span className="font-medium">{type.label}</span>
                </button>
              ))}
            </div>
            <button
              onClick={closeFlow}
              disabled={isSending}
              className="w-full mt-3 min-h-[44px] px-3 py-2 rounded-2xl material-regular text-text-secondary text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        )}
      </Modal>
    </>
  );
}
