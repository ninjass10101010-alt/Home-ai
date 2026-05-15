"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();

  const handleEmergency = async (type: string) => {
    setSelectedType(type);
    setIsSending(true);
    setResult(null);

    try {
      const response = await fetch("/api/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, timestamp: new Date().toISOString() }),
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
        className={`fixed top-4 right-4 z-50 w-10 h-10 rounded-full bg-rose-500 text-white shadow-lg shadow-rose-500/30 hover:bg-rose-400 active:scale-95 transition-all ${className}`}
        aria-label="Emergency"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6 mx-auto">
          <path d="M12 2L4 7v6c0 5 3.5 9.7 8 11 4.5-1.3 8-6 8-11V7l-8-5z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 8v4M12 16h.01" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowModal(false)}>
          <div className="glass rounded-2xl p-5 w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
            {result ? (
              // Result screen
              <div className="text-center">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
                  result.success
                    ? "bg-green-500/20 text-green-400"
                    : "bg-red-500/20 text-red-400"
                }`}>
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
                    className="w-full px-3 py-2 rounded-xl bg-nori-500 text-white hover:bg-nori-400 transition-colors"
                  >
                    Try Again
                  </button>
                )}
              </div>
            ) : (
              // Emergency type selection
              <>
                <h3 className="text-text-primary font-semibold mb-3 text-center">Emergency Type</h3>
                <p className="text-text-muted text-xs mb-4 text-center">Select the type of emergency</p>
                <div className="space-y-2">
                  {emergencyTypes.map((type) => (
                    <button
                      key={type.id}
                      onClick={() => handleEmergency(type.id)}
                      disabled={isSending}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-text-primary transition-all ${
                        isSending ? "opacity-50 cursor-not-allowed" : `bg-${type.color}-500/15 hover:bg-${type.color}-500/25`
                      }`}
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
                  className="w-full mt-3 px-3 py-2 rounded-xl glass text-text-secondary text-sm disabled:opacity-50"
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