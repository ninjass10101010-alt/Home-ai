"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import Avatar, { type AvatarSize } from "@/components/ui/Avatar";
import AvatarPicker from "@/components/profile/AvatarPicker";
import { normalizeAvatarSize, selectableAvatarSize, AVATAR_SIZE_OPTIONS } from "@/lib/avatar-size";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import { db } from "@/db";

interface ProfileSheetProps {
  open: boolean;
  onClose: () => void;
  member: AuthUser;
  panelClassName?: string;
}

export default function ProfileSheet({ open, onClose, member, panelClassName }: ProfileSheetProps) {
  const { logout } = useAuth();

  const memberSize = selectableAvatarSize(member.avatarSize);
  const [avatarValue, setAvatarValue] = useState<string>(member.emoji || "😊");
  const [sizeValue, setSizeValue] = useState<AvatarSize>(memberSize);
  const [avatarPin, setAvatarPin] = useState("");
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
  const avatarSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);
  const mountedRef = useRef(true);
  const operationGenerationRef = useRef(0);
  const operationTokenRef = useRef(0);
  const activeOperationRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (avatarSavedTimerRef.current) clearTimeout(avatarSavedTimerRef.current);
    if (pinSuccessTimerRef.current) clearTimeout(pinSuccessTimerRef.current);
    avatarSavedTimerRef.current = null;
    pinSuccessTimerRef.current = null;
  };

  const resetSensitiveState = () => {
    clearTimers();
    setAvatarValue(member.emoji || "😊");
    setSizeValue(memberSize);
    setAvatarPin("");
    setSavingAvatar(false);
    setAvatarSaved(false);
    setAvatarError(null);
    setPinOpen(false);
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setPinSaving(false);
    setPinError(null);
    setPinSuccess(false);
  };

  useLayoutEffect(() => {
    openRef.current = open;
    operationGenerationRef.current += 1;
  }, [open]);

  const beginOperation = () => {
    if (activeOperationRef.current !== null) return null;
    const token = ++operationTokenRef.current;
    activeOperationRef.current = token;
    return { generation: operationGenerationRef.current, token };
  };

  const isCurrentOperation = (generation: number, token: number) => (
    mountedRef.current
    && openRef.current
    && operationGenerationRef.current === generation
    && activeOperationRef.current === token
  );

  const isCurrentGeneration = (generation: number) => (
    mountedRef.current && openRef.current && operationGenerationRef.current === generation
  );

  const finishOperation = (generation: number, token: number) => {
    if (isCurrentOperation(generation, token)) activeOperationRef.current = null;
  };

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      activeOperationRef.current = null;
      clearTimers();
    };
  }, []);

  const handleClose = () => {
    operationGenerationRef.current += 1;
    activeOperationRef.current = null;
    resetSensitiveState();
    onClose();
  };

  const closePinEditor = () => {
    setPinOpen(false);
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setPinError(null);
    setPinSuccess(false);
  };

  const saveAvatar = async () => {
    const emojiChanged = Boolean(avatarValue) && avatarValue !== member.emoji;
    const sizeChanged = sizeValue !== memberSize;
    if (!emojiChanged && !sizeChanged) return;
    if (!avatarPin || !/^\d{4}$/.test(avatarPin)) {
      setAvatarError("Enter your 4-digit PIN to save.");
      return;
    }
    const operation = beginOperation();
    if (!operation) return;
    const { generation, token } = operation;
    setSavingAvatar(true);
    setAvatarError(null);
    setAvatarSaved(false);
    try {
      const patch: Record<string, unknown> = {};
      if (emojiChanged) patch.emoji = avatarValue;
      if (sizeChanged) patch.avatarSize = sizeValue;
      const res = await fetch("/api/members/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorName: member.name, actorPin: avatarPin, patch }),
      });
      const data = await res.json();
      if (!isCurrentOperation(generation, token)) return;
      if (!res.ok) {
        setAvatarError(data?.error || "Could not save your avatar. Try again.");
        return;
      }
      await db.refreshCaches();
      if (!isCurrentOperation(generation, token)) return;
      const localPatch: Record<string, unknown> = {};
      if (emojiChanged) localPatch.emoji = data.member?.emoji || avatarValue;
      if (sizeChanged) localPatch.avatarSize = data.member?.avatarSize || sizeValue;
      db.patchMemberLocal(member.name, localPatch);
      setAvatarSaved(true);
      if (avatarSavedTimerRef.current) clearTimeout(avatarSavedTimerRef.current);
      let avatarTimer: ReturnType<typeof setTimeout> | null = null;
      avatarTimer = setTimeout(() => {
        if (isCurrentGeneration(generation) && avatarSavedTimerRef.current === avatarTimer) {
          setAvatarSaved(false);
          avatarSavedTimerRef.current = null;
        }
      }, 2000);
      avatarSavedTimerRef.current = avatarTimer;
    } catch {
      if (isCurrentOperation(generation, token)) setAvatarError("Could not reach the dashboard. Check your connection and try again.");
    } finally {
      if (isCurrentOperation(generation, token)) {
        activeOperationRef.current = null;
        setSavingAvatar(false);
      }
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
    const operation = beginOperation();
    if (!operation) return;
    const { generation, token } = operation;
    setPinSaving(true);
    try {
      const res = await fetch("/api/members/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorName: member.name, actorPin: currentPin, newPin }),
      });
      const data = await res.json();
      if (!isCurrentOperation(generation, token)) return;
      if (!res.ok) {
        setPinError(data?.error || "Could not change your PIN.");
        return;
      }
      setPinSuccess(true);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      if (pinSuccessTimerRef.current) clearTimeout(pinSuccessTimerRef.current);
      let pinTimer: ReturnType<typeof setTimeout> | null = null;
      pinTimer = setTimeout(() => {
        if (isCurrentGeneration(generation) && pinSuccessTimerRef.current === pinTimer) {
          setPinSuccess(false);
          setPinOpen(false);
          pinSuccessTimerRef.current = null;
        }
      }, 1500);
      pinSuccessTimerRef.current = pinTimer;
    } catch {
      if (isCurrentOperation(generation, token)) setPinError("Could not reach the dashboard. Try again.");
    } finally {
      if (isCurrentOperation(generation, token)) {
        activeOperationRef.current = null;
        setPinSaving(false);
      }
    }
  };

  const pinInputClass =
    "w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-2.5 text-center text-xl tracking-[0.4em] text-text-primary outline-none placeholder:text-text-muted";

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Your profile"
      description={`Signed in as ${member.name.split(" ")[0]}`}
      panelClassName={panelClassName}
    >
      <button type="button" aria-label="Close profile" onClick={handleClose} className="float-right -mt-1 rounded-xl px-3 py-2 text-text-secondary hover:text-text-primary">×</button>
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
          <AvatarPicker value={avatarValue} onChange={setAvatarValue} fallbackEmoji={member.emoji || "😊"} previewSize={sizeValue} previewGlow={member.glow} />
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-semibold text-text-secondary">Avatar size</p>
            <div className="flex gap-1.5">
              {AVATAR_SIZE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={sizeValue === opt.value}
                  onClick={() => setSizeValue(opt.value)}
                  className={`tap-sm flex-1 rounded-xl px-2 py-1.5 text-xs font-bold ${
                    sizeValue === opt.value
                      ? "bg-[var(--color-accent-selected)] text-white"
                      : "glass-subtle text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 space-y-2.5">
            <input type="password" inputMode="numeric" maxLength={4} value={avatarPin} onChange={(e) => setAvatarPin(e.target.value.replace(/[^0-9]/g, ""))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-2.5 text-center text-lg tracking-[0.4em] text-text-primary outline-none placeholder:text-text-muted" placeholder="Enter PIN to confirm" />
            <SoftButton
              onClick={saveAvatar}
              disabled={savingAvatar || !avatarValue || avatarPin.length < 4 || (avatarValue === member.emoji && sizeValue === memberSize)}
              className="w-full"
            >
              {savingAvatar ? "Saving…" : avatarSaved ? "Saved ✓" : "Save avatar"}
            </SoftButton>
          </div>
          {avatarError && <p className="mt-2 text-xs font-medium text-[var(--color-accent-rose)]">{avatarError}</p>}
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
              {pinError && <p className="text-xs font-medium text-[var(--color-accent-rose)]">{pinError}</p>}
              {pinSuccess && <p className="text-xs font-semibold text-[var(--color-accent-mint)]">PIN updated ✓</p>}
              <div className="flex gap-2">
                <SoftButton onClick={savePin} disabled={pinSaving} className="flex-1">
                  {pinSaving ? "Saving…" : "Save PIN"}
                </SoftButton>
                <SoftButton variant="secondary" onClick={closePinEditor} className="flex-1">
                  Cancel
                </SoftButton>
              </div>
            </div>
          )}
          <div className="mt-2 space-y-2">
            <Link href="/settings" className="settings-wall-target" onClick={handleClose}>
              <span className="tap flex w-full items-center justify-between rounded-2xl bg-[var(--color-surface-2)] px-4 py-3 text-sm font-semibold text-text-primary">
                <span>⚙️ Full settings</span>
                <span className="text-text-muted">›</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => {
                logout();
                handleClose();
              }}
              className="tap flex w-full items-center justify-between rounded-2xl bg-[var(--color-surface-2)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-rose)]"
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