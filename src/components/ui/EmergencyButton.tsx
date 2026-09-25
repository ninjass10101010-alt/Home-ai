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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  const closeFlow = () => {
    if (isSending || sendingRef.current) return;
    setShowModal(false);
    setSelectedType(null);
    setResult(null);
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
        setResult({
          success: false,
          partial: false,
          contactsSource,
          message: responseStatus >= 200 && responseStatus < 300
            ? "Emergency service returned an invalid result. Please try again or call emergency services directly."
            : typeof payload?.error === "string"
              ? payload.error
              : typeof payload?.message === "string"
                ? payload.message
                : "Emergency alert failed.",
          details,
        });
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
                className="min-h-[44px] w-full rounded-2xl bg-[var(--color-accent-button,var(--color-accent-selected))] px-3 py-2 text-sm font-semibold text-white tap"
              >
                Done
              </button>
            ) : (
              <button
                ref={primaryActionRef}
                onClick={() => {
                  // Drop the stale PIN too — a failed send must not leave the
                  // credential sitting in the field for the next attempt.
                  retryFocusRef.current = true;
                  setResult(null);
                  setPinInput("");
                }}
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
              className="w-full mt-3 min-h-[44px] px-3 py-2 rounded-2xl glass text-text-secondary text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        )}
      </Modal>
    </>
  );
}
