"use client";

import { useRef, useState } from "react";
import MemberPickerModal from "@/components/auth/MemberPickerModal";
import KidProfileSheet from "@/components/modes/kid/KidProfileSheet";
import ProfileSheet from "@/components/profile/ProfileSheet";
import Avatar from "@/components/ui/Avatar";
import SoftButton from "@/components/ui/SoftButton";
import { db } from "@/db";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import {
  sanitizeMemberPickerIdentity,
  type MemberPickerIdentity,
} from "@/lib/member-picker-identity";
import SettingsSignInDialog from "@/components/settings/SettingsSignInDialog";

function ProfileSummary({ member, onOpen }: { member: AuthUser; onOpen: () => void }) {
  return (
    <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <Avatar
          name={member.name}
          color={member.color}
          emoji={member.emoji}
          size="lg"
          variant="emoji"
          glow={member.glow}
          animated={false}
        />
        <div className="min-w-0">
          <p className="text-sm text-text-secondary">Signed in</p>
          <h3 className="truncate text-lg font-bold text-text-primary">{member.name}</h3>
        </div>
      </div>
      <SoftButton onClick={onOpen} aria-label="Edit profile" className="w-full sm:w-auto">
        Edit profile
      </SoftButton>
    </div>
  );
}

function ParentProfile({ member }: { member: AuthUser }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ProfileSummary member={member} onOpen={() => setOpen(true)} />
      <ProfileSheet
        open={open}
        onClose={() => setOpen(false)}
        member={member}
        panelClassName="settings-dialog"
      />
    </>
  );
}

function KidProfile({ member }: { member: AuthUser }) {
  const [open, setOpen] = useState(false);
  const profile = {
    name: member.name,
    color: member.color,
    emoji: member.emoji,
    avatarSize: member.avatarSize,
    glow: member.glow,
  };

  return (
    <>
      <ProfileSummary member={member} onOpen={() => setOpen(true)} />
      <KidProfileSheet
        open={open}
        onClose={() => setOpen(false)}
        member={profile}
        panelClassName="settings-dialog"
      />
    </>
  );
}

function GuestProfile() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [members, setMembers] = useState<MemberPickerIdentity[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberPickerIdentity | null>(null);
  const signInTriggerRef = useRef<HTMLDivElement>(null);

  const openPicker = () => {
    const roster = db.selectMembersDetailed().flatMap((member) => {
      const identity = sanitizeMemberPickerIdentity(member);
      return identity ? [identity] : [];
    });
    setMembers(roster);
    setSelectedMember(null);
    setPickerOpen(true);
  };
  const pickerMembers = members.flatMap((member) => {
    const identity = sanitizeMemberPickerIdentity(member);
    return identity ? [identity] : [];
  });

  return (
    <>
      <div className="mt-4 flex flex-col items-start gap-3">
        <div>
          <h3 className="text-lg font-bold text-text-primary">Sign in to manage your profile</h3>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            Choose your face, then enter your private PIN.
          </p>
        </div>
        <div ref={signInTriggerRef} className="w-full sm:w-auto">
          <SoftButton onClick={openPicker} aria-label="Sign in" className="w-full">
            Sign in
          </SoftButton>
        </div>
      </div>
      <MemberPickerModal
        open={pickerOpen}
        members={pickerMembers}
        onSelect={(member) => {
          const identity = sanitizeMemberPickerIdentity(member);
          if (!identity) return;
          signInTriggerRef.current?.querySelector("button")?.focus();
          setPickerOpen(false);
          setSelectedMember(identity);
        }}
        onClose={() => setPickerOpen(false)}
        panelClassName="settings-dialog"
        description="Pick your face, then enter your 4-digit PIN."
      />
      <SettingsSignInDialog
        open={selectedMember !== null}
        memberName={selectedMember?.name ?? null}
        onClose={() => setSelectedMember(null)}
        onSuccess={() => setSelectedMember(null)}
      />
    </>
  );
}

export default function MeSettingsSection() {
  const { currentUser, hydrated } = useAuth();

  return (
    <section aria-labelledby="settings-me-heading" className="space-y-4">
      <div
        aria-busy={!hydrated}
        className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-0)]/35 p-6"
      >
        <h2 id="settings-me-heading" className="text-lg font-bold text-text-primary">
          Your profile
        </h2>
        {!hydrated ? (
          <p role="status" className="mt-3 text-sm leading-6 text-text-secondary">
            Checking your profile…
          </p>
        ) : !currentUser ? (
          <GuestProfile />
        ) : currentUser.role === "parent" ? (
          <ParentProfile member={currentUser} />
        ) : (
          <KidProfile member={currentUser} />
        )}
      </div>
    </section>
  );
}
