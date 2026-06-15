"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import SigmaImage from "@/components/ui/SigmaImage";

interface PinModalProps {
  memberName: string;
  memberEmoji: string;
  memberColor: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const colorVarMap: Record<string, string> = {
  green: "mint",
  violet: "violet",
  amber: "amber",
  cyan: "cyan",
  rose: "rose",
  blue: "nori",
};

export default function PinModal({ memberName, memberEmoji, memberColor, onClose, onSuccess }: PinModalProps) {
  const { login } = useAuth();
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const accentVar = colorVarMap[memberColor || "green"] || memberColor || "green";
  const safeEmoji = memberEmoji || "😊";
  const safeName = memberName || "User";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (pinInput.length < 4) return;
    setLoading(true);
    setPinError("");

    const result = login(safeName, pinInput);
    if (result.success) {
      onSuccess?.();
    } else {
      setPinError(result.error || "Incorrect PIN");
      setPinInput("");
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-0 rounded-2xl p-6 mx-4 w-full max-w-sm border border-surface-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-4">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl mx-auto ring-2 transition-transform duration-200 overflow-hidden`}
            style={{
              backgroundColor: `color-mix(in srgb, var(--color-accent-${accentVar}) 20%, transparent)`,
              borderColor: `var(--color-accent-${accentVar})`,
            }}
          >
            {safeEmoji.startsWith("data:") || safeEmoji.startsWith("http") ? (
              <SigmaImage src={safeEmoji} alt={safeName} shape="circle" />
            ) : (
              safeEmoji
            )}
          </div>
          <h3 className="text-text-primary font-semibold mt-3 text-lg">Welcome, {safeName.split(" ")[0]}!</h3>
          <p className="text-text-secondary text-sm mt-1">Enter your PIN to continue</p>
        </div>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pinInput}
          onChange={(e) => {
            setPinInput(e.target.value.replace(/[^0-9]/g, ""));
            setPinError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="4-digit PIN"
          className="w-full bg-surface-2 text-text-primary text-center text-2xl tracking-[0.5em] rounded-2xl px-4 py-3 outline-none border-2 border-surface-3 focus:border-nori-500/50 placeholder:text-text-muted"
          autoFocus
          disabled={loading}
        />

        {pinError && (
          <p className="text-rose-400 text-xs text-center mt-2 animate-in">{pinError}</p>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSubmit}
            disabled={pinInput.length < 4 || loading}
            className="flex-1 py-2.5 rounded-2xl font-semibold text-sm disabled:opacity-40 transition-colors text-white bg-nori-500 hover:bg-nori-400"
          >
            {loading ? "Verifying..." : "Sign In"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-2xl bg-surface-2 text-text-secondary text-sm font-medium hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
