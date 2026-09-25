"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import FormField from "@/components/patterns/FormField";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";

type TestAlertStatus = "idle" | "sending" | "success" | "error";

interface DeliveryChannel {
  contact?: string;
  method: string;
  success: boolean;
  error?: string;
}

interface DeliveryDetails {
  total: number;
  successful: number;
  failed: number;
  partial: boolean;
  warning?: string;
  contactsSource: "live" | "cache" | null;
  results: Array<{ contact: string; results: DeliveryChannel[] }>;
  channelResults: DeliveryChannel[];
  houseAlert: { sent: number; failed: number; notes: string[] } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseChannel(value: unknown): DeliveryChannel | null {
  if (!isRecord(value) || typeof value.method !== "string" || typeof value.success !== "boolean") return null;
  return {
    ...(typeof value.contact === "string" ? { contact: value.contact } : {}),
    method: value.method,
    success: value.success,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function parseDeliveryDetails(value: unknown): DeliveryDetails | null {
  if (!isRecord(value)) return null;
  const details = isRecord(value.details) ? value.details : null;
  const houseValue = details?.houseAlert ?? value.houseAlert;
  const houseAlert = isRecord(houseValue)
    && typeof houseValue.sent === "number"
    && typeof houseValue.failed === "number"
    && Array.isArray(houseValue.notes)
    && houseValue.notes.every((note) => typeof note === "string")
    ? { sent: houseValue.sent, failed: houseValue.failed, notes: houseValue.notes }
    : null;
  const results = Array.isArray(details?.results)
    ? details.results.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.contact !== "string" || !Array.isArray(entry.results)) return [];
        const channels = entry.results.map(parseChannel).filter((entry): entry is DeliveryChannel => entry !== null);
        return channels.length > 0 ? [{ contact: entry.contact, results: channels }] : [];
      })
    : [];
  const channelResults = Array.isArray(details?.channelResults)
    ? details.channelResults.map(parseChannel).filter((entry): entry is DeliveryChannel => entry !== null)
    : results.flatMap((entry) => entry.results);
  const total = details?.total;
  const successful = details?.successful;
  const failed = details?.failed;
  if (typeof total !== "number" || typeof successful !== "number" || typeof failed !== "number") return null;
  const partial = typeof value.partial === "boolean"
    ? value.partial
    : typeof details?.partial === "boolean"
      ? details.partial
      : false;
  const warning = typeof value.warning === "string"
    ? value.warning
    : typeof details?.warning === "string"
      ? details.warning
      : undefined;
  const sourceValue = details?.contactsSource ?? value.contactsSource;
  const contactsSource = sourceValue === "live" || sourceValue === "cache" ? sourceValue : null;
  return {
    total,
    successful,
    failed,
    partial,
    ...(warning ? { warning } : {}),
    contactsSource,
    results,
    channelResults,
    houseAlert,
  };
}

export interface EmergencyTestDialogProps {
  open: boolean;
  onClose: () => void;
}

const PIN_ID = "settings-emergency-test-pin";
const PIN_HELPER_ID = "settings-emergency-test-pin-helper";
const PIN_ERROR_ID = "settings-emergency-test-pin-error";
const TERMINAL_ACTION_ID = "settings-emergency-test-terminal-action";

export default function EmergencyTestDialog({ open, onClose }: EmergencyTestDialogProps) {
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<TestAlertStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryDetails | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      requestRef.current += 1;
      sendingRef.current = false;
      setPin("");
      setStatus("idle");
      setError(null);
      setDelivery(null);
    });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (status === "success" || status === "error") {
      document.getElementById(TERMINAL_ACTION_ID)?.focus();
    }
  }, [status]);

  const clearSensitiveState = () => {
    setPin("");
    setError(null);
    setDelivery(null);
  };

  const handleClose = () => {
    if (status !== "idle" || sendingRef.current) return;
    requestRef.current += 1;
    clearSensitiveState();
    setStatus("idle");
    onClose();
  };

  const handleDone = () => {
    if (status !== "success") return;
    requestRef.current += 1;
    clearSensitiveState();
    setStatus("idle");
    onClose();
  };

  const handleRetry = () => {
    if (status !== "error") return;
    requestRef.current += 1;
    clearSensitiveState();
    setStatus("idle");
    inputRef.current?.focus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status !== "idle" || sendingRef.current) return;
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter exactly four digits.");
      inputRef.current?.focus();
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    sendingRef.current = true;
    const isCurrentRequest = () => mountedRef.current && requestRef.current === requestId;
    setStatus("sending");
    setError(null);
    inputRef.current?.focus();

    try {
      const response = await fetch("/api/emergency/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
       if (!isCurrentRequest()) return;
       const responseData = data && typeof data === "object" ? data as { success?: unknown; error?: unknown; message?: unknown } : null;
       const responseDelivery = parseDeliveryDetails(data);
       if (!response.ok || responseData?.success !== true) {
         const serverError = typeof responseData?.message === "string"
           ? responseData.message
           : typeof responseData?.error === "string"
             ? responseData.error
             : "";
         setPin("");
         setDelivery(responseDelivery);
         setStatus("error");
         setError(serverError || "Test alert failed. Try again.");
         inputRef.current?.focus();
         return;
       }
       setPin("");
       setDelivery(responseDelivery);
       setStatus("success");
       setError(null);
    } catch {
      if (!isCurrentRequest()) return;
      setPin("");
      setStatus("error");
      setError("Couldn't reach the test alert service. Check the connection and try again.");
      inputRef.current?.focus();
    } finally {
      if (isCurrentRequest()) sendingRef.current = false;
    }
  };

  const terminal = status === "success" || status === "error";
  const footer = terminal ? (
    <SoftButton
      id={TERMINAL_ACTION_ID}
      variant={status === "success" ? "success" : "primary"}
      onClick={status === "success" ? handleDone : handleRetry}
      className="flex-1"
    >
      {status === "success" ? "Done" : "Retry"}
    </SoftButton>
  ) : (
    <>
      <SoftButton variant="secondary" onClick={handleClose} disabled={status !== "idle"} className="flex-1">
        Cancel
      </SoftButton>
      <SoftButton
        type="submit"
        form="settings-emergency-test-form"
        loading={status === "sending"}
        disabled={!/^\d{4}$/.test(pin) || status !== "idle"}
        className="flex-1"
      >
        Send test
      </SoftButton>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Test alert"
      description="Send a real test alert through the configured SMS, email, and house channels."
      panelClassName="settings-dialog"
      footer={footer}
    >
      <form
        id="settings-emergency-test-form"
        data-state={status}
        onSubmit={handleSubmit}
        aria-busy={status === "sending"}
        className="space-y-4"
      >
        <div className="rounded-2xl border border-[var(--color-accent-rose)]/25 bg-[var(--color-accent-rose)]/10 p-4">
          <p className="text-sm font-semibold text-[var(--color-accent-rose)]">This test alert is not a real emergency.</p>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            Sending it will contact your real primary recipients through the configured SMS, email, and house channels.
          </p>
        </div>
        <FormField
          label="4-digit PIN"
          controlId={PIN_ID}
          helperId={PIN_HELPER_ID}
          errorId={PIN_ERROR_ID}
          helperText="The PIN stays in this form and is cleared when the test finishes."
        >
          <input
            ref={inputRef}
            id={PIN_ID}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(event) => {
              if (status !== "idle") return;
              setPin(event.target.value.replace(/\D/g, "").slice(0, 4));
              setError(null);
            }}
            readOnly={status !== "idle"}
            aria-readonly={status !== "idle"}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${PIN_HELPER_ID} ${PIN_ERROR_ID}` : PIN_HELPER_ID}
            className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-center text-2xl tracking-[0.4em] text-text-primary outline-none placeholder:text-text-muted"
            placeholder="0000"
            autoFocus
          />
        </FormField>
        {error ? (
          <p id={PIN_ERROR_ID} role="alert" className="rounded-2xl border border-[var(--color-accent-rose)]/25 bg-[var(--color-accent-rose)]/10 p-3 text-sm font-semibold text-[var(--color-accent-rose)]">
            {error}
          </p>
        ) : null}
        {status === "success" || (status === "error" && delivery) ? (
          <div
            data-emergency-test-delivery="true"
            className={`space-y-2 rounded-2xl border p-3 text-sm text-text-primary ${status === "error" ? "border-[var(--color-accent-rose)]/25 bg-[var(--color-accent-rose)]/10" : "border-[var(--color-accent-mint)]/25 bg-[var(--color-accent-mint)]/10"}`}
            role="status"
          >
            <p className="font-semibold">
              {status === "error"
                ? "Test delivery incomplete."
                : delivery?.partial
                  ? "Test alert partially delivered."
                  : "Test alert sent."}
            </p>
            {delivery ? <p>Primary contacts: {delivery.successful} of {delivery.total} confirmed.</p> : null}
            {delivery?.contactsSource === "cache" ? (
              <p className="font-semibold text-[var(--color-accent-amber)]">
                This result used stale cached contacts. Verify recipients before sending another test.
              </p>
            ) : null}
            {delivery?.houseAlert ? (
              <p>
                House channels: {delivery.houseAlert.sent} sent, {delivery.houseAlert.failed} failed.
                {delivery.houseAlert.notes.length > 0 ? ` Notes: ${delivery.houseAlert.notes.join("; ")}` : ""}
              </p>
            ) : null}
            {delivery?.warning ? <p className="text-text-secondary">{delivery.warning}</p> : null}
          </div>
        ) : null}
        <p className="text-xs leading-5 text-text-secondary">
          If someone is in immediate danger, contact local emergency services directly instead of using this test.
        </p>
      </form>
    </Modal>
  );
}
