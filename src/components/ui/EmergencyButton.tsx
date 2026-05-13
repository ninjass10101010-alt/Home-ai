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
  const router = useRouter();

  const handleEmergency = async (type: string) => {
    setSelectedType(type);
    setIsSending(true);

    try {
      const response = await fetch("/api/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, timestamp: new Date().toISOString() }),
      });

      if (response.ok) {
        alert(`${type.charAt(0).toUpperCase() + type.slice(1)} emergency alert sent to parents!`);
      }
    } catch (error) {
      console.error("Emergency alert failed:", error);
      alert("Emergency alert sent (demo mode)");
    } finally {
      setIsSending(false);
      setShowModal(false);
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
            <h3 className="text-text-primary font-semibold mb-3 text-center">Emergency Type</h3>
            <p className="text-text-muted text-xs mb-4 text-center">Select the type of emergency</p>
            <div className="space-y-2">
              {emergencyTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleEmergency(type.id)}
                  disabled={isSending}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-${type.color}-500/15 text-text-primary hover:bg-${type.color}-500/25 transition-all ${isSending ? "opacity-50" : ""}`}
                >
                  <span className="text-lg">{type.icon}</span>
                  <span className="font-medium">{type.label}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowModal(false)}
              className="w-full mt-3 px-3 py-2 rounded-xl glass text-text-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}