"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";

interface EmergencyButtonProps {
  className?: string;
}

const emergencyTypes = [
  { id: "fire", label: "Fire", icon: "🔥", color: "rose" },
  { id: "water", label: "Water Leak", icon: "💧", color: "cyan" },
  { id: "injury", label: "Injury", icon: "🤕", color: "amber" },
  { id: "general", label: "General", icon: "🚨", color: "violet" },
];

export default function EmergencyButton({ className = "" }: EmergencyButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{success: boolean, message: string, details?: any} | null>(null);
  const [pinInput, setPinInput] = useState("");
  const pinReady = /^\d{4}$/.test(pinInput);
  const router = useRouter();

  const { colors, accentRgb } = useAtmosphericTheme();

  const handleEmergency = async (type: string) => {
    // The PIN is typed by the user here and verified server-side against
    // PocketBase — the client never stores or carries a copy of it.
    if (!pinReady) return;
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

      const data = await response.json();

      if (response.ok) {
        setResult({ success: true, message: data.message, details: data.details });
        // Auto-close modal after 3 seconds on success
        setTimeout(() => {
          setShowModal(false);
          setResult(null);
        }, 3000);
      } else {
        setResult({ success: false, message: data.error });
      }
    } catch (error) {
      console.error("Emergency alert failed:", error);
      setResult({
        success: false,
        message: "Network error - emergency alert may not have been sent. Please try again or call emergency services directly."
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`fixed top-4 right-4 z-50 w-10 h-10 rounded-full text-white shadow-lg hover:opacity-90 tap ${className}`}
        style={{
          background: colors.accentColor,
          boxShadow: `0 0 24px ${colors.glow}`,
        }}
        aria-label="Emergency"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6 mx-auto">
          <path d="M12 2L4 7v6c0 5 3.5 9.7 8 11 4.5-1.3 8-6 8-11V7l-8-5z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 8v4M12 16h.01" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowModal(false)}>
          <div className="glass rounded-2xl p-5 w-full max-w-xs" style={{ boxShadow: `0 0 24px ${colors.glow}` }} onClick={(e) => e.stopPropagation()}>
            {result ? (
              // Result screen
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                  style={{
                    background: `${colors.accentColor}20`,
                    color: colors.accentColor,
                  }}>
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
                <h3 className={`font-semibold mb-2 ${result.success ? "text-green-400" : "text-red-400"}`}>
                  {result.success ? "Alert Sent" : "Alert Failed"}
                </h3>
                <p className="text-text-secondary text-sm mb-4">{result.message}</p>
                {result.details && (
                  <div className="text-xs text-text-muted mb-4">
                    Sent to {result.details.successful}/{result.details.total} contacts
                  </div>
                )}
                {!result.success && (
                  <button
                    onClick={() => setResult(null)}
                    className="w-full px-3 py-2 rounded-2xl bg-rose-500/15 text-rose-400 text-sm font-medium hover:bg-rose-500/25 transition-colors"
                  >
                    Try Again
                  </button>
                )}
              </div>
            ) : (
              // Emergency type selection
              <>
                <h3 className="text-text-primary font-semibold mb-3 text-center">Emergency Type</h3>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Family PIN"
                  aria-label="Family PIN"
                  disabled={isSending}
                  className="w-full bg-[var(--color-surface-2)] text-text-primary text-center text-xl tracking-[0.5em] rounded-2xl px-4 py-2 outline-none border border-white/10 focus:border-rose-400/50 placeholder:text-text-muted placeholder:tracking-normal disabled:opacity-50 mb-3"
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
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-text-primary transition-all hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none"
                      style={{ background: `rgba(${accentRgb},0.15)` }}
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
                  onClick={() => setShowModal(false)}
                  disabled={isSending}
                  className="w-full mt-3 px-3 py-2 rounded-2xl glass text-text-secondary text-sm disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}