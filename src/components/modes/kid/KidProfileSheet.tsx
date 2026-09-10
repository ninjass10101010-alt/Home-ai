"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Avatar from "@/components/ui/Avatar";
import AvatarPicker from "@/components/profile/AvatarPicker";
import SoftButton from "@/components/ui/SoftButton";
import Toggle from "@/components/ui/Toggle";
import { useAuth } from "@/hooks/useAuth";
import { normalizeAvatarSize, AVATAR_SIZE_OPTIONS } from "@/lib/avatar-size";

export default function KidProfileSheet({ open, onClose, member, points }: {
  open: boolean;
  onClose: () => void;
  member: { name: string; color: string; emoji: string; avatarSize?: string; glow?: boolean };
  points?: number;
}) {
  const { logout } = useAuth();
  const [emoji, setEmoji] = useState(member.emoji);
  const [size, setSize] = useState(normalizeAvatarSize(member.avatarSize));
  const [glow, setGlow] = useState(Boolean(member.glow));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [signOutArmed, setSignOutArmed] = useState(false);

  // Immediate-apply save: child sessions are PIN-free server-side. On 401
  // (pet session, expired) the picker REVERTS — honestly stated.
  const save = async (patch: Record<string, unknown>, revert: () => void) => {
    setSaving(true); setSaveError(null); setSavedMsg(false);
    try {
      const res = await fetch("/api/members/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      if (!res.ok) {
        setSaveError("Parents change this in Settings.");
        revert();
        return;
      }
      setSavedMsg(true);
    } catch {
      setSaveError("Couldn't reach Consuela — check the connection and try again.");
      revert();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={member.name.split(" ")[0]}
      description={points != null ? `${points} points this week — you're on a roll!` : undefined}
      footer={
        signOutArmed ? (
          <>
            <SoftButton variant="secondary" className="flex-1" onClick={() => setSignOutArmed(false)}>Stay</SoftButton>
            <SoftButton className="flex-1" onClick={logout}>Sign me out</SoftButton>
          </>
        ) : (
          <SoftButton variant="secondary" className="flex-1" onClick={() => setSignOutArmed(true)}>🚪 Sign out</SoftButton>
        )
      }
    >
      <div className="flex flex-col items-center gap-4">
        <Avatar name={member.name} color={member.color} emoji={emoji} size="lg" variant="emoji" glow={glow} />
        <AvatarPicker value={emoji} fallbackEmoji={member.emoji || "😊"} previewSize={size} previewGlow={glow}
          onChange={(next) => { const prev = emoji; setEmoji(next); void save({ emoji: next }, () => setEmoji(prev)); }} />
        {/* Avatar size — friendly labels from the single source of truth */}
        <div className="flex items-center justify-center gap-2">
          {AVATAR_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={size === opt.value}
              onClick={() => { const prev = size; setSize(opt.value); void save({ avatarSize: opt.value }, () => setSize(prev)); }}
              className={`tap px-4 py-2 rounded-full text-sm font-semibold border ${
                size === opt.value
                  ? "bg-[var(--color-accent-selected)]/20 border-[var(--color-accent-selected)]/50 text-text-primary"
                  : "bg-white/[0.06] border-white/10 text-text-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {/* Glow row — kid copy (Toggle renders the label + aria-label) */}
        <Toggle
          checked={glow}
          onCheckedChange={(v) => { const prev = glow; setGlow(v); void save({ glow: v }, () => setGlow(prev)); }}
          label="✨ Sparkly glow"
          className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
        />
        {saveError && <p className="text-sm font-bold text-[var(--color-accent-rose)]" role="alert">{saveError}</p>}
        {savedMsg && <p className="text-sm font-bold text-[var(--color-accent-mint)]">Saved!</p>}
      </div>
    </Modal>
  );
}
