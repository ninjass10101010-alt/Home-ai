"use client";

import { useEffect, useRef, useState } from "react";
import AvatarPicker from "@/components/profile/AvatarPicker";
import FormField from "@/components/patterns/FormField";
import SectionCard from "@/components/patterns/SectionCard";
import SettingsConfirmDialog from "@/components/settings/SettingsConfirmDialog";
import WeeklyPrizesCard from "@/components/settings/WeeklyPrizesCard";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import IconButton from "@/components/ui/IconButton";
import ListRow from "@/components/ui/ListRow";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import Toast from "@/components/ui/Toast";
import Toggle from "@/components/ui/Toggle";
import { db } from "@/db";
import { useSettingsFeedback } from "@/hooks/useSettingsFeedback";
import { AVATAR_SIZE_OPTIONS, selectableAvatarSize } from "@/lib/avatar-size";
import {
  sanitizeMemberPickerIdentity,
  type MemberPickerIdentity,
} from "@/lib/member-picker-identity";

type MemberRole = "parent" | "child" | "pet";
type MemberAge = string | number;

interface FamilyMember extends MemberPickerIdentity {
  role: string;
  age: MemberAge;
  joined: string;
}

interface MemberForm {
  name: string;
  emoji: string;
  role: MemberRole;
  pin?: string;
  age: MemberAge;
  avatarSize: string;
  glow: boolean;
  imageUrl: string;
}

interface MemberErrors {
  name?: string;
  pin?: string;
  age?: string;
}

const MEMBER_NAME_ID = "settings-family-member-name";
const MEMBER_NAME_ERROR_ID = "settings-family-member-name-error";
const MEMBER_AGE_ID = "settings-family-member-age";
const MEMBER_AGE_HELPER_ID = "settings-family-member-age-helper";
const MEMBER_AGE_ERROR_ID = "settings-family-member-age-error";
const MEMBER_PIN_ID = "settings-family-member-pin";
const MEMBER_PIN_HELPER_ID = "settings-family-member-pin-helper";
const MEMBER_PIN_ERROR_ID = "settings-family-member-pin-error";

const DEFAULT_MEMBER_FORM: MemberForm = {
  name: "",
  emoji: "😊",
  role: "child",
  age: "",
  avatarSize: "md",
  glow: false,
  imageUrl: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMemberRole(value: unknown): MemberRole {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  return role === "parent" || role === "pet" || role === "child" ? role : "child";
}

function toFamilyMember(value: unknown): FamilyMember | null {
  const identity = sanitizeMemberPickerIdentity(value);
  if (!identity || !isRecord(value)) return null;
  const role = typeof value.role === "string" && value.role.trim() ? value.role : "child";
  const age = typeof value.age === "string" || typeof value.age === "number" ? value.age : "";
  const joined = typeof value.joined === "string" ? value.joined : "";
  return { ...identity, role, age, joined };
}

function readFamilyMembers(): FamilyMember[] {
  return db.selectMembersDetailed().flatMap((value) => {
    const member = toFamilyMember(value);
    return member ? [member] : [];
  });
}

function isImageAvatar(value: string) {
  return value.startsWith("data:") || value.startsWith("http");
}

export default function FamilySettingsSection() {
  const { feedback, showFeedback } = useSettingsFeedback();
  const [members, setMembers] = useState<FamilyMember[]>(readFamilyMembers);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);
  const [memberForm, setMemberForm] = useState<MemberForm>(DEFAULT_MEMBER_FORM);
  const [memberErrors, setMemberErrors] = useState<MemberErrors>({});
  const [starterPin, setStarterPin] = useState<{ name: string; pin: string } | null>(null);
  const [savingMember, setSavingMember] = useState(false);
  const [memberPendingDelete, setMemberPendingDelete] = useState<FamilyMember | null>(null);
  const [deletingMember, setDeletingMember] = useState(false);
  const saveInFlightRef = useRef(false);
  const memberFormSessionRef = useRef(0);

  useEffect(() => {
    const handleMembersUpdated = () => setMembers(readFamilyMembers());
    handleMembersUpdated();
    window.addEventListener("consuela-members-updated", handleMembersUpdated);
    return () => window.removeEventListener("consuela-members-updated", handleMembersUpdated);
  }, []);

  const openMemberModal = (member?: FamilyMember) => {
    if (saveInFlightRef.current) return;
    memberFormSessionRef.current += 1;
    setEditingMember(member ?? null);
    setStarterPin(null);
    if (member) {
      const currentAvatar = member.emoji ?? "😊";
      const hasCustomImage = isImageAvatar(currentAvatar);
      setMemberForm({
        name: member.name,
        emoji: hasCustomImage ? "😊" : currentAvatar,
        role: normalizeMemberRole(member.role),
        pin: "",
        age: member.age,
        avatarSize: selectableAvatarSize(member.avatarSize),
        glow: member.glow,
        imageUrl: hasCustomImage ? currentAvatar : "",
      });
    } else {
      setMemberForm({ ...DEFAULT_MEMBER_FORM });
    }
    setMemberErrors({});
    setMemberModalOpen(true);
  };

  const closeMemberModal = () => {
    if (saveInFlightRef.current) return;
    setStarterPin(null);
    setMemberModalOpen(false);
  };

  const validateMember = () => {
    const errors: MemberErrors = {};
    if (!memberForm.name.trim()) {
      errors.name = "Enter a name so tasks and avatars know who this is.";
    }
    if (memberForm.pin && !/^\d{4}$/.test(memberForm.pin)) {
      errors.pin = "PIN must be exactly 4 digits — or leave it blank to keep the current PIN.";
    }
    if (
      memberForm.age !== "" &&
      (!/^\d{1,3}$/.test(String(memberForm.age)) || Number(memberForm.age) < 1 || Number(memberForm.age) > 120)
    ) {
      errors.age = "Age must be 1–120 (or blank).";
    }
    setMemberErrors(errors);
    const firstInvalidId = errors.name
      ? MEMBER_NAME_ID
      : errors.age
        ? MEMBER_AGE_ID
        : errors.pin
          ? MEMBER_PIN_ID
          : null;
    if (firstInvalidId) document.getElementById(firstInvalidId)?.focus();
    return Object.keys(errors).length === 0;
  };

  const refreshRoster = () => {
    setMembers(readFamilyMembers());
  };

  const saveMember = async () => {
    if (saveInFlightRef.current || !validateMember()) return;
    saveInFlightRef.current = true;
    setSavingMember(true);
    const session = memberFormSessionRef.current;
    const isEditing = editingMember !== null;
    const editingName = editingMember?.name ?? "";
    const trimmedName = memberForm.name.trim();
    const payload: Record<string, unknown> = {
      name: trimmedName,
      emoji: memberForm.imageUrl.trim() || memberForm.emoji,
      role: memberForm.role,
      age: memberForm.age === "" ? undefined : Number(memberForm.age),
      avatarSize: memberForm.avatarSize,
      glow: memberForm.glow,
    };
    if (isEditing && memberForm.pin) payload.pin = memberForm.pin;
    const isCurrentSession = () => memberFormSessionRef.current === session;

    try {
      const res = await fetch("/api/members/admin", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEditing
          ? { id: editingMember?.pbId, name: editingName, patch: payload }
          : { ...payload, joined: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }) }),
      });
      if (!isCurrentSession()) return;
      if (!res.ok) {
        if (isEditing) {
          showFeedback(
            res.status === 403
              ? "🔒 Adults only — sign in as a parent to edit members."
              : "❌ Couldn't update member",
            "error",
          );
        } else {
          showFeedback(
            res.status === 403
              ? "🔒 Adults only — sign in as a parent to add members."
              : res.status === 409
                ? `⚠️ ${trimmedName} is already on the family list.`
                : "❌ Couldn't add member",
            "error",
          );
        }
        return;
      }

      if (!isEditing) {
        const payload = await res.json().catch(() => null) as { starterPin?: unknown } | null;
        const returnedPin = typeof payload?.starterPin === "string" ? payload.starterPin : "";
        if (!/^\d{4}$/.test(returnedPin)) {
          showFeedback("Member added, but the server did not return a starter PIN. Try again.", "error");
          return;
        }
        setStarterPin({ name: trimmedName, pin: returnedPin });
        setMemberForm({ ...DEFAULT_MEMBER_FORM });
        setMemberErrors({});
      }

      let refreshed = false;
      try {
        refreshed = await db.refreshMembersCache();
      } catch {
        if (isCurrentSession()) {
          showFeedback(
            "Member saved, but the shared family roster could not refresh. Review the result before trying again.",
            "error",
          );
        }
        return;
      }
      if (!isCurrentSession()) return;
      if (!refreshed) {
        showFeedback(
          "Member saved, but the shared family roster could not refresh. Review the result before trying again.",
          "error",
        );
        return;
      }

      refreshRoster();
      if (isEditing) setMemberModalOpen(false);
      showFeedback(`${isEditing ? "✅ Updated" : "✅ Added"} ${trimmedName}`, "success");
    } catch {
      if (isCurrentSession()) {
        showFeedback(isEditing ? "❌ Couldn't update member" : "❌ Couldn't add member", "error");
      }
    } finally {
      saveInFlightRef.current = false;
      setSavingMember(false);
    }
  };

  const deleteMember = async (member: FamilyMember) => {
    setDeletingMember(true);
    try {
      try {
        const res = await fetch("/api/members/admin", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: member.pbId, name: member.name }),
        });
        if (!res.ok) {
          const error = await res.json().catch(() => ({ error: "" })) as { error?: string };
          showFeedback(
            error.error === "last_parent"
              ? "⚠️ At least one parent must remain."
              : res.status === 403
                ? "🔒 Adults only — sign in as a parent to remove members."
                : "❌ Couldn't remove member",
            "error",
          );
          return;
        }
      } catch {
        showFeedback("❌ Couldn't remove member", "error");
        return;
      }

      let refreshed = false;
      try {
        refreshed = await db.refreshMembersCache();
      } catch {
        setMembers((current) => current.filter((candidate) => candidate.name !== member.name));
        showFeedback(
          `Removed ${member.name} locally, but the shared family roster could not refresh.`,
          "error",
        );
        return;
      }
      if (!refreshed) {
        setMembers((current) => current.filter((candidate) => candidate.name !== member.name));
        showFeedback(
          `Removed ${member.name} locally, but the shared family roster could not refresh.`,
          "error",
        );
        return;
      }
      refreshRoster();
      showFeedback(`🗑️ Removed ${member.name}`, "success");
    } finally {
      setDeletingMember(false);
      setMemberPendingDelete(null);
    }
  };

  const inviteMember = async () => {
    const shareData = {
      title: "Consuela — AI Family Organizer",
      text: "Join our family on Consuela! Manage calendars, meals, chores, and more.",
      url: window.location.origin,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        return;
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareData.url);
      showFeedback("📋 Link copied to clipboard", "success");
    } catch {
      showFeedback(`📋 Share link: ${shareData.url}`, "neutral");
    }
  };

  return (
    <section className="space-y-6" aria-label="Family settings">
      <Toast open={feedback !== null} tone={feedback?.tone}>{feedback?.message}</Toast>
      <SectionCard title="Family members" description="People, pets, and roles" icon="👨‍👩‍👧‍👦" headingLevel="h2">
        <div className="space-y-3">
          {members.map((member) => (
            <ListRow
              key={member.pbId || `fallback:${member.name}`}
              title={member.name}
              subtitle={`${member.role} · ${member.joined}`}
              leftRailColor="var(--color-accent-apricot)"
              leading={(
                <Avatar
                  name={member.name}
                  color="green"
                  emoji={member.emoji}
                  size="sm"
                  variant="emoji"
                />
              )}
              trailing={(
                <div className="flex items-center gap-1">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label="Edit member"
                    disabled={savingMember || !member.pbId}
                    onClick={() => { if (member.pbId) openMemberModal(member); }}
                  >
                    ✎
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="danger"
                    aria-label={`Remove ${member.name}`}
                    disabled={savingMember || !member.pbId}
                    className="relative before:absolute before:-inset-1 before:content-['']"
                    onClick={() => { if (member.pbId) setMemberPendingDelete(member); }}
                  >
                    ×
                  </IconButton>
                </div>
              )}
            />
          ))}
          {members.length === 0 && (
            <EmptyState
              title="No members yet"
              description="Add the first family member to start organizing."
              actionLabel="Add member"
              onAction={() => openMemberModal()}
            />
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <SoftButton onClick={() => openMemberModal()} disabled={savingMember} className="flex-1">Add member</SoftButton>
          <SoftButton variant="secondary" onClick={inviteMember} disabled={savingMember} className="flex-1">Invite</SoftButton>
        </div>
      </SectionCard>

      <WeeklyPrizesCard showToast={showFeedback} />

      <Modal
        open={memberModalOpen}
        onClose={closeMemberModal}
        title={editingMember ? "Edit member" : "Add member"}
        description="Family members appear in avatars, tasks, and the Home row."
        panelClassName="settings-dialog"
        footer={starterPin ? (
          <SoftButton onClick={closeMemberModal} className="flex-1">Done</SoftButton>
        ) : (
          <>
            <SoftButton onClick={saveMember} loading={savingMember} className="flex-1">Save</SoftButton>
            <SoftButton
              variant="secondary"
              onClick={closeMemberModal}
              disabled={savingMember}
              className="flex-1"
            >
              Cancel
            </SoftButton>
          </>
        )}
      >
        <fieldset disabled={savingMember} className="space-y-4 border-0 p-0">
          {starterPin ? (
            <div data-starter-pin="true" className="rounded-2xl border border-[var(--color-accent-mint)]/30 bg-[var(--color-accent-mint)]/10 p-4 text-center">
              <p className="text-sm font-semibold text-text-primary">Starter PIN for {starterPin.name}</p>
              <p className="mt-2 font-mono text-3xl font-bold tracking-[0.35em] text-text-primary">{starterPin.pin}</p>
              <p className="mt-2 text-xs text-text-secondary">Show this once. Share it securely with the new member.</p>
            </div>
          ) : null}
          <FormField
            label="Name"
            controlId={MEMBER_NAME_ID}
            errorId={MEMBER_NAME_ERROR_ID}
            errorText={memberErrors.name}
          >
            <input
              id={MEMBER_NAME_ID}
              aria-invalid={Boolean(memberErrors.name)}
              aria-describedby={memberErrors.name ? MEMBER_NAME_ERROR_ID : undefined}
              value={memberForm.name}
              onChange={(event) => {
                setMemberForm((current) => ({ ...current, name: event.target.value }));
                setMemberErrors((current) => ({ ...current, name: undefined }));
              }}
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-secondary"
              placeholder="Member name"
            />
          </FormField>
          <FormField label="Avatar">
            <AvatarPicker
              value={isImageAvatar(memberForm.imageUrl) ? memberForm.imageUrl : memberForm.emoji}
              fallbackEmoji={memberForm.emoji}
              previewSize={memberForm.avatarSize}
              previewGlow={memberForm.glow}
              onChange={(next) => {
                const isImage = isImageAvatar(next);
                setMemberForm((current) => ({
                  ...current,
                  imageUrl: isImage ? next : "",
                  emoji: isImage ? current.emoji || "😊" : next,
                }));
              }}
            />
          </FormField>
          <FormField label="Role">
            <select
              value={memberForm.role}
              onChange={(event) => setMemberForm((current) => ({
                ...current,
                role: event.target.value as MemberRole,
              }))}
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none"
            >
              <option value="parent">Parent</option>
              <option value="child">Child</option>
              <option value="pet">Pet</option>
            </select>
          </FormField>
          <FormField
            label="Age"
            controlId={MEMBER_AGE_ID}
            helperId={MEMBER_AGE_HELPER_ID}
            errorId={MEMBER_AGE_ERROR_ID}
            helperText="Under 10 signs in with one tap"
            errorText={memberErrors.age}
          >
            <input
              id={MEMBER_AGE_ID}
              aria-invalid={Boolean(memberErrors.age)}
              aria-describedby={memberErrors.age ? MEMBER_AGE_ERROR_ID : MEMBER_AGE_HELPER_ID}
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              aria-label="Age"
              value={memberForm.age}
              onChange={(event) => {
                setMemberForm((current) => ({ ...current, age: event.target.value }));
                setMemberErrors((current) => ({ ...current, age: undefined }));
              }}
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-secondary"
              placeholder="Age"
            />
          </FormField>
          {editingMember ? (
            <FormField
              label="PIN"
              controlId={MEMBER_PIN_ID}
              helperId={MEMBER_PIN_HELPER_ID}
              errorId={MEMBER_PIN_ERROR_ID}
              helperText="Leave blank to keep the current PIN."
              errorText={memberErrors.pin}
            >
              <input
                id={MEMBER_PIN_ID}
                aria-invalid={Boolean(memberErrors.pin)}
                aria-describedby={memberErrors.pin ? MEMBER_PIN_ERROR_ID : MEMBER_PIN_HELPER_ID}
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={memberForm.pin ?? ""}
                onChange={(event) => {
                  setMemberForm((current) => ({
                    ...current,
                    pin: event.target.value.replace(/[^0-9]/g, "").slice(0, 4),
                  }));
                  setMemberErrors((current) => ({ ...current, pin: undefined }));
                }}
                className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-secondary"
                placeholder="0000"
              />
            </FormField>
          ) : (
            <p className="text-xs text-text-muted">
              The server assigns their starter PIN after the member is added.
            </p>
          )}
          <div className="flex items-center justify-between">
            <FormField label="Avatar size">
              <div className="flex gap-1.5">
                {AVATAR_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={memberForm.avatarSize === option.value}
                    onClick={() => setMemberForm((current) => ({
                      ...current,
                      avatarSize: option.value,
                    }))}
                    className={`tap-sm rounded-xl px-3 py-1.5 text-xs font-bold ${
                      memberForm.avatarSize === option.value
                        ? "bg-[var(--color-accent-selected)] text-white"
                        : "glass-subtle text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </FormField>
            <Toggle
              checked={memberForm.glow}
              onCheckedChange={(checked) => setMemberForm((current) => ({ ...current, glow: checked }))}
              label="Glow"
            />
          </div>
        </fieldset>
      </Modal>

      <SettingsConfirmDialog
        open={memberPendingDelete !== null}
        title={memberPendingDelete ? `Remove ${memberPendingDelete.name}?` : "Remove member"}
        confirmLabel="Remove member"
        busy={deletingMember}
        onConfirm={() => {
          if (memberPendingDelete) void deleteMember(memberPendingDelete);
        }}
        onClose={() => setMemberPendingDelete(null)}
      >
        <p className="text-sm text-text-secondary">
          {memberPendingDelete
            ? `${memberPendingDelete.name} will disappear from avatars, tasks, and the family row on every device.`
            : "This member will be removed from the family roster."}
        </p>
      </SettingsConfirmDialog>
    </section>
  );
}
