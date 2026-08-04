"use client";

import { useState } from "react";
import Link from "next/link";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import Avatar, { type AvatarSize } from "@/components/ui/Avatar";
import AvatarPicker from "@/components/profile/AvatarPicker";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import { db } from "@/db";

const avatarSizes = new Set<AvatarSize>(["xs", "sm", "md", "base", "lg"]);
const normalizeAvatarSize = (size?: string): AvatarSize => (avatarSizes.has(size as AvatarSize) ? (size as AvatarSize) : "md");

interface ProfileSheetProps {
  open: boolean;
  onClose: () => void;
  member: AuthUser;
}

export default function ProfileSheet({ open, onClose, member }: ProfileSheetProps) {
  const { logout, changePin } = useAuth();

  const [avatarValue, setAvatarValue] = useState<string>(member.emoji || "😊");
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarSaved, setAvatarSaved] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [pinOpen, setPinOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState(false);

  const saveAvatar = async () => {
    if (!avatarValue || avatarValue === member.emoji) return;
    setSavingAvatar(true);
    setAvatarError(null);
    setAvatarSaved(false);
    try {
      const res = await fetch("/api/members/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorName: member.name, actorPin: member.pin, patch: { emoji: avatarValue } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAvatarError(data?.error || "Could not save your avatar. Try again.");
        return;
      }
      await db.refreshCaches();
      setAvatarSaved(true);
      setTimeout(() => setAvatarSaved(false), 2000);
    } catch {
      setAvatarError("Could not reach the dashboard. Check your connection and try again.");
    } finally {
      setSavingAvatar(false);
    }
  };

  const savePin = async () => {
    setPinError(null);
    setPinSuccess(false);
    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
      setPinError("All three fields must be 4-digit codes.");
      return;
    }
    if (newPin !== confirmPin) {
      setPinError("The new PIN and its confirmation don't match.");
      return;
    }
    setPinSaving(true);
    try {
      const res = await fetch("/api/members/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorName: member.name, actorPin: currentPin, newPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPinError(data?.error || "Could not change your PIN.");
        return;
      }
      await changePin(newPin);
      setPinSuccess(true);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setTimeout(() => {
        setPinSuccess(false);
        setPinOpen(false);
      }, 1500);
    } catch {
      setPinError("Could not reach the dashboard. Try again.");
    } finally {
      setPinSaving(false);
    }
  };

  const pinInputClass =
    "w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-2.5 text-center text-xl tracking-[0.4em] text-text-primary outline-none placeholder:text-text-muted";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Your profile"
      description={`Signed in as ${member.name.split(" ")[0]}`}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar
            name={member.name}
            color={member.color}
            emoji={member.emoji}
            size={normalizeAvatarSize(member.avatarSize)}
            variant="emoji"
            glow={member.glow}
          />
          <div>
            <h4 className="text-base font-bold text-text-primary">{member.name}</h4>
            <p className="text-sm capitalize text-text-muted">{member.role}</p>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/50 p-4">
          <h5 className="mb-3 text-sm font-bold text-text-primary">Change your avatar</h5>
          <AvatarPicker value={avatarValue} onChange={setAvatarValue} />
          <div className="mt-3 flex gap-2">
            <SoftButton
              onClick={saveAvatar}
              disabled={savingAvatar || !avatarValue || avatarValue === member.emoji}
              className="flex-1"
            >
              {savingAvatar ? "Saving…" : avatarSaved ? "Saved ✓" : "Save avatar"}
            </SoftButton>
          </div>
          {avatarError && <p className="mt-2 text-xs font-medium text-rose-300">{avatarError}</p>}
        </div>

        <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/50 p-4">
          <h5 className="mb-3 text-sm font-bold text-text-primary">Account</h5>
          {!pinOpen ? (
            <button
              type="button"
              onClick={() => setPinOpen(true)}
              className="tap flex w-full items-center justify-between rounded-2xl bg-[var(--color-surface-2)] px-4 py-3 text-sm font-semibold text-text-primary"
            >
              <span>🔑 Change PIN</span>
              <span className="text-text-muted">›</span>
            </button>
          ) : (
            <div className="space-y-2.5">
              <input type="password" inputMode="numeric" maxLength={4} value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/[^0-9]/g, ""))} className={pinInputClass} placeholder="Current PIN" />
              <input type="password" inputMode="numeric" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, ""))} className={pinInputClass} placeholder="New PIN" />
              <input type="password" inputMode="numeric" maxLength={4} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/[^0-9]/g, ""))} className={pinInputClass} placeholder="Confirm new PIN" />
              {pinError && <p className="text-xs font-medium text-rose-300">{pinError}</p>}
              {pinSuccess && <p className="text-xs font-semibold text-emerald-300">PIN updated ✓</p>}
              <div className="flex gap-2">
                <SoftButton onClick={savePin} disabled={pinSaving} className="flex-1">
                  {pinSaving ? "Saving…" : "Save PIN"}
                </SoftButton>
                <SoftButton variant="secondary" onClick={() => setPinOpen(false)} className="flex-1">
                  Cancel
                </SoftButton>
              </div>
            </div>
          )}
          <div className="mt-2 space-y-2">
            <Link href="/settings" onClick={onClose}>
              <span className="tap flex w-full items-center justify-between rounded-2xl bg-[var(--color-surface-2)] px-4 py-3 text-sm font-semibold text-text-primary">
                <span>⚙️ Full settings</span>
                <span className="text-text-muted">›</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => {
                logout();
                onClose();
              }}
              className="tap flex w-full items-center justify-between rounded-2xl bg-[var(--color-surface-2)] px-4 py-3 text-sm font-semibold text-rose-300"
            >
              <span>🚪 Sign out</span>
              <span className="text-text-muted">›</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}